import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { AgentProjectError } from "@/lib/agents/require-agent";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { writeInbox } from "@/lib/agent-api/inbox";
import { eventStreamBus, type StreamEvent } from "@/lib/events/stream-bus";
import { logger } from "@/lib/logger";
import { AGENT_EVENT_TYPES } from "@/lib/agent-api/event-types";

export { AGENT_EVENT_TYPES, type AgentEventType } from "@/lib/agent-api/event-types";

/**
 * Agent event feed (#445).
 *
 * Agents poll `GET /api/v1/events?after=&afterId=&wait=` to learn what changed
 * inside their tenant. The cursor is `(txid, id)` on `AgentEvent` (#739):
 * `txid` is the id of the transaction that wrote the event, and a poll only
 * returns events whose transaction can no longer be running. `createdAt` is
 * set before commit, so ordering by it let an event that committed late land
 * behind a cursor that had already moved past it.
 *
 * Webhooks deliver the same event ids, so a client can dedupe across both
 * channels.
 */

export const EVENT_MAX_WAIT_SECONDS = 25;
export const EVENT_POLL_INTERVAL_MS = 500; // first check; later ones back off (#545)
export const EVENT_MAX_POLL_INTERVAL_MS = 4_000;

/**
 * Delay before the next long-poll query (#545). Starts at 500 ms so a waiter
 * still learns about a new event quickly, then doubles up to 4 s: a client
 * waiting the full 25 s makes ~8 queries instead of 50.
 */
export function nextPollDelayMs(attempt: number, maxMs = EVENT_MAX_POLL_INTERVAL_MS): number {
  if (!Number.isFinite(attempt) || attempt < 0) return EVENT_POLL_INTERVAL_MS;
  return Math.min(maxMs, EVENT_POLL_INTERVAL_MS * 2 ** Math.min(Math.floor(attempt), 10));
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export type EventPayload = Prisma.InputJsonObject;

/** How often to look for the committed row, and how long to wait between looks. */
const COMMIT_WAIT_ATTEMPTS = 20;
const COMMIT_WAIT_DELAY_MS = 50;

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function broadcast(event: StreamEvent): void {
  try {
    eventStreamBus.broadcast(event);
  } catch {
    // Ignore broadcast failures to not block publishing
  }
}

/**
 * Broadcast an event only once its row is committed (#524).
 *
 * `publish()` usually runs inside the caller's transaction, and an
 * uncommitted row is invisible to other connections. Broadcasting straight
 * away let a subscriber read an `issue.confirmation` event whose confirmation row
 * was not readable yet, and a transaction that rolled back still emitted its
 * event — the event outliving the change it described. The event and the row
 * have to land together: wait for the row to become visible, and drop the
 * event when the transaction rolled back and it never does.
 *
 * A lookup that fails leaves the row's visibility unknown, so it counts as
 * "not visible yet": the wait is retried, and if it never becomes readable
 * the event is dropped rather than sent on a guess. An event may describe a
 * change that never happened, and subscribers must not see one.
 *
 * Returns true when the event was broadcast.
 */
export async function broadcastWhenCommitted(
  event: StreamEvent,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<boolean> {
  const attempts = options.attempts ?? COMMIT_WAIT_ATTEMPTS;
  const delayMs = options.delayMs ?? COMMIT_WAIT_DELAY_MS;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let committed: { id: string; projectId: string | null } | null = null;
    try {
      committed = await prisma.agentEvent.findUnique({
        where: { id: event.id },
        select: { id: true, projectId: true },
      });
    } catch (error) {
      // A TypeError means the lookup can't be made at all (a client without
      // the model, as in a unit test's partial Prisma mock). Waiting won't
      // fix it, so give up now instead of retrying for a second.
      if (error instanceof TypeError) return false;
      // The row cannot be read, so its visibility is unknown. Treat it as
      // not visible yet and try again; broadcasting here would send an event
      // whose row may never exist.
      logger.warn("agent event row lookup failed; waiting for the row", {
        eventId: event.id,
        type: event.type,
        error,
      });
    }
    if (committed) {
      // #607: the row carries the project the trigger derived from `bugId`.
      // Without it the bus cannot enforce a project-scoped key's boundary.
      broadcast({ ...event, projectId: committed.projectId ?? event.projectId ?? null });
      return true;
    }
    await waitMs(delayMs);
  }
  // The transaction rolled back, or the row never became readable: the event
  // never happened as far as anyone can tell, so nothing is sent.
  return false;
}

/**
 * Writes one `AgentEvent` row. Call this inside the same transaction that
 * performs the domain change so the event commits atomically with it.
 *
 * Export contract: other issues call `publish()` to emit events into the feed.
 * This PR adds `issue.created` and `comment.created`.
 */
export async function publish(
  db: PrismaClient | Prisma.TransactionClient,
  params: {
    tenantId: string;
    type: string;
    payload: EventPayload;
    actorAgentId?: string | null;
    bugId?: string | null;
    /** An event with no issue (an idea's) names its project here; an issue's comes from the trigger. */
    projectId?: string | null;
  },
): Promise<{ id: string }> {
  const event = await db.agentEvent.create({
    data: {
      tenantId: params.tenantId,
      type: params.type,
      payload: params.payload,
      actorAgentId: params.actorAgentId ?? null,
      bugId: params.bugId ?? null,
      ...(params.projectId ? { projectId: params.projectId } : {}),
    },
    select: { id: true },
  });
  const subscriptions = await db.webhookSubscription.findMany({
    where: { enabled: true, agent: { tenantId: params.tenantId, revokedAt: null,
      owner: { memberships: { some: { tenantId: params.tenantId } } } },
      // Empty filter = every event; otherwise only the subscribed types (#512).
      OR: [{ events: { isEmpty: true } }, { events: { has: params.type } }] },
    select: { id: true },
  });
  if (subscriptions.length) await db.webhookDelivery.createMany({
    data: subscriptions.map(({ id }) => ({ subscriptionId: id, eventId: event.id, nextAttemptAt: new Date() })),
    skipDuplicates: true,
  });
  // #601: what this event addresses to one agent goes to its inbox too.
  await writeInbox(db, { id: event.id, ...params });
  // #524: the event reaches subscribers only once its row is committed.
  void broadcastWhenCommitted({
    id: event.id,
    type: params.type,
    payload: params.payload as unknown,
    actorAgentId: params.actorAgentId ?? null,
    bugId: params.bugId ?? null,
    projectId: params.projectId ?? null,
    tenantId: params.tenantId,
    createdAt: new Date(),
  }).catch(() => {
    // Ignore broadcast failures to not block publishing
  });
  return event;
}

// Make the type importable without importing Prisma everywhere.
type PrismaClient = typeof prisma;

// ---------------------------------------------------------------------------
// Poll cursor
// ---------------------------------------------------------------------------

/**
 * A position in the feed. Responses always hand out `{ txid, id }`. The
 * `{ createdAt, id }` form is what cursors issued before #739, and the manual
 * `after=<ISO>&afterId=` form, decode to; it still works as a starting point.
 */
export type EventCursor =
  | { txid: bigint; id: string }
  | { createdAt: Date; id: string };

/** Encode a cursor to an opaque string safe in query parameters. */
export function encodeEventCursor(cursor: EventCursor): string {
  const value = "txid" in cursor
    ? ["t", cursor.txid.toString(), cursor.id]
    : [cursor.createdAt.toISOString(), cursor.id];
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

const PG_BIGINT_MIN = BigInt("-9223372036854775808");
const PG_BIGINT_MAX = BigInt("9223372036854775807");

/** Decode a cursor produced by `encodeEventCursor`. Returns `null` on invalid input. */
export function decodeEventCursor(raw: string | null | undefined): EventCursor | null {
  if (!raw || raw.length > 300) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(value)) return null;
    if (value.length === 3 && value[0] === "t") {
      const [, txid, id] = value;
      if (typeof txid !== "string" || !/^-?\d{1,19}$/.test(txid) || typeof id !== "string" || !id.trim() || id.length > 191) return null;
      // 19 digits can still overflow Postgres bigint; Prisma would throw a 500.
      const parsed = BigInt(txid);
      if (parsed < PG_BIGINT_MIN || parsed > PG_BIGINT_MAX) return null;
      return { txid: parsed, id };
    }
    if (value.length !== 2) return null;
    const [iso, id] = value;
    if (typeof iso !== "string" || !z.iso.datetime({ offset: true }).safeParse(iso).success || typeof id !== "string" || !id.trim() || id.length > 191) return null;
    const createdAt = new Date(iso);
    return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Parse `?after=<cursor>&afterId=<id>` from query params.
 *
 * Two forms are supported:
 * 1. `after=<base64url cursor>` — cursor from a previous response.
 * 2. `after=<ISO timestamp>&afterId=<id>` — explicit position (convenient for
 *    manual calls; id breaks ties when two events share a timestamp).
 *
 * Returns `null` when no cursor is present, or `"invalid"` when the cursor is
 * malformed so the caller can return a 400.
 */
export function parseEventCursor(
  params: URLSearchParams,
): EventCursor | null | "invalid" {
  const after = params.get("after");
  const afterId = params.get("afterId");

  if (after === null && afterId === null) return null;
  if (!after) return "invalid";

  // If afterId is provided, treat `after` as an ISO timestamp.
  if (afterId !== null) {
    const createdAt = new Date(after);
    if (!z.iso.datetime({ offset: true }).safeParse(after).success || !afterId.trim() || afterId.length > 191) return "invalid";
    return { createdAt, id: afterId };
  }

  // Otherwise try to decode it as a cursor blob.
  const cursor = decodeEventCursor(after);
  return cursor ?? "invalid";
}

/**
 * The 400 message for a cursor `parseEventCursor` called "invalid" (#465):
 * names the parameter and the rule instead of a bare "Invalid cursor.".
 */
export function eventCursorError(params: URLSearchParams): string {
  const after = params.get("after");
  const afterId = params.get("afterId");
  const isTimestamp = after !== null && z.iso.datetime({ offset: true }).safeParse(after).success;

  if (!after && afterId !== null) return "afterId is only valid together with a timestamp after.";
  if (afterId !== null) {
    if (!isTimestamp) {
      return "after must be an ISO-8601 timestamp with a time and offset (e.g. 2026-10-21T00:00:00.000Z) when afterId is set.";
    }
    return "afterId must be a non-empty event id of at most 191 characters.";
  }
  if (isTimestamp) return "afterId is required when after is a timestamp.";
  return "Invalid cursor. Pass the cursor from a previous response, or an ISO timestamp in after together with afterId.";
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * Optional narrowing of the feed (#602). The cursor stays global, so a
 * filtered poll can resume from (or hand over) the same cursor as an
 * unfiltered one.
 */
export type EventFilters = {
  /** Exact event types. */
  types?: string[];
  /** Type prefixes from `claim.*` entries, stored as `claim.`. */
  typePrefixes?: string[];
  projectId?: string;
  bugId?: string;
};

export type EventFilterError = { error: string; validTypes?: readonly string[] };

/** True for a usable id filter value: non-blank and at most 191 chars (the Prisma key width). */
function validId(value: string): boolean {
  return value.trim() !== "" && value.length <= 191;
}

/**
 * Parse `?types=&projectId=&bugId=`. `types` is a comma list of event types
 * or `prefix.*` patterns; an unknown entry is an error that lists the valid
 * types so the caller can return a 400.
 */
export function parseEventFilters(params: URLSearchParams): EventFilters | EventFilterError {
  const filters: EventFilters = {};

  const typesRaw = params.get("types");
  if (typesRaw !== null) {
    const entries = [...new Set(typesRaw.split(",").map((t) => t.trim()).filter(Boolean))];
    if (!entries.length) return { error: "types must list at least one event type.", validTypes: AGENT_EVENT_TYPES };
    const known = new Set<string>(AGENT_EVENT_TYPES);
    const types: string[] = [];
    const typePrefixes: string[] = [];
    const unknown: string[] = [];
    for (const entry of entries) {
      if (known.has(entry)) types.push(entry);
      else if (entry.endsWith(".*") && entry.length > 2 && AGENT_EVENT_TYPES.some((t) => t.startsWith(entry.slice(0, -1)))) {
        typePrefixes.push(entry.slice(0, -1));
      } else unknown.push(entry);
    }
    if (unknown.length) {
      return { error: `Unknown event type: ${unknown.slice(0, 10).join(", ").slice(0, 300)}.`, validTypes: AGENT_EVENT_TYPES };
    }
    if (types.length) filters.types = types;
    if (typePrefixes.length) filters.typePrefixes = typePrefixes;
  }

  for (const key of ["projectId", "bugId"] as const) {
    const value = params.get(key);
    if (value === null) continue;
    if (!validId(value)) return { error: `Invalid ${key}.` };
    filters[key] = value;
  }

  return filters;
}

// ---------------------------------------------------------------------------
// Key project scope (#405)
// ---------------------------------------------------------------------------

/**
 * Enforces the key's project on event filters (#405).
 *
 * A key issued for one project must never receive another project's events,
 * the same promise the issue and job routes already make. For a scoped
 * key:
 * - an explicit `projectId` for another project throws `AgentProjectError`
 *   (the wrapper answers `403 project_forbidden`);
 * - a `bugId` is looked up only inside the caller's tenant, so an
 *   unknown id and another tenant's id are indistinguishable (both 404);
 *   a same-tenant bug outside the key's project throws `AgentProjectError`
 *   (403); events for a bug are only written for issues in the key's project;
 * - with no explicit `projectId`, the poll is filtered to the key's project
 *   so an unfiltered poll cannot sweep the whole tenant.
 *
 * A legacy key (no `projectId`) keeps today's tenant-wide behavior.
 * Body note: `scopeEventFilters` narrows to the key's project exactly, so
 * tenant-level events that carry no `projectId` at all (`goal.*`, #405
 * follow-up) are not visible to scoped keys until they persist one.
 */
export type ScopedEventFilters = { filters: EventFilters } | { status: number; error: string };

/** Applies the rules documented on `ScopedEventFilters`/(#405) above; never mutates `filters`. */
export async function scopeEventFilters(
  agent: Pick<AgentContext, "tenantId" | "projectId" | "projectSlug">,
  filters: EventFilters,
  db: Pick<typeof prisma, "bug"> = prisma,
): Promise<ScopedEventFilters> {
  if (!agent.projectId) return { filters };
  if (filters.projectId && filters.projectId !== agent.projectId) {
    throw new AgentProjectError(agent.projectSlug);
  }
  if (filters.bugId) {
    // Tenant-bound lookup: an id from another tenant must look exactly like a
    // missing one, so the lookup never confirms a cross-tenant bug exists.
    const bug = await db.bug.findFirst({
      where: { id: filters.bugId, tenantId: agent.tenantId },
      select: { projectId: true },
    });
    if (!bug) return { status: 404, error: "Issue not found." };
    if (bug.projectId !== agent.projectId) throw new AgentProjectError(agent.projectSlug);
  }
  return { filters: { ...filters, projectId: agent.projectId } };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const eventSelect = {
  id: true,
  type: true,
  payload: true,
  actorAgentId: true,
  bugId: true,
  createdAt: true,
  txid: true,
} satisfies Prisma.AgentEventSelect;

export type AgentEventRow = {
  id: string;
  type: string;
  payload: Prisma.JsonValue;
  actorAgentId: string | null;
  bugId: string | null;
  createdAt: Date;
  txid: bigint;
};

/**
 * The oldest transaction id that may still be running (#739). Every
 * transaction below it has committed or rolled back, so an event with a
 * smaller `txid` is either visible now or never will be. A later poll can only
 * reveal events with a `txid` at or above this, which is past any cursor
 * handed out now.
 */
async function settledBefore(): Promise<bigint> {
  const [row] = await prisma.$queryRaw<{ xmin: string }[]>`
    SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin`;
  return BigInt(row.xmin);
}

/**
 * The visibility predicate behind a poll cursor: events strictly after
 * `(txid, id)` (or `(createdAt, id)` for a first page), so ties break by id
 * and a cursor never repeats or skips a row.
 */
function afterCursor(cursor: EventCursor): Prisma.AgentEventWhereInput {
  if ("txid" in cursor) {
    return {
      OR: [
        { txid: { gt: cursor.txid } },
        { txid: cursor.txid, id: { gt: cursor.id } },
      ],
    };
  }
  return {
    OR: [
      { createdAt: { gt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { gt: cursor.id } },
    ],
  };
}

/**
 * Fetch events for `agent.tenantId` that come after `cursor`, in ascending
 * order (oldest first). Reads 101 rows so the route can detect another page.
 * Events from transactions that may still be running are held back until
 * they settle, so a cursor never moves past an event that is about to appear.
 * `filters` narrow the result; the `(tenantId, projectId|bugId, txid, id)`
 * indexes keep project and issue polls off the tenant-wide scan (#602).
 */
export async function listEvents(
  agent: Pick<AgentContext, "tenantId">,
  cursor: EventCursor | null,
  filters: EventFilters = {},
): Promise<AgentEventRow[]> {
  const typeMatches: Prisma.AgentEventWhereInput[] = [
    ...(filters.types?.length ? [{ type: { in: filters.types } }] : []),
    ...(filters.typePrefixes ?? []).map((prefix) => ({ type: { startsWith: prefix } })),
  ];
  const where: Prisma.AgentEventWhereInput = {
    tenantId: agent.tenantId,
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    ...(filters.bugId ? { bugId: filters.bugId } : {}),
    ...(typeMatches.length ? { AND: [typeMatches.length === 1 ? typeMatches[0]! : { OR: typeMatches }] } : {}),
    txid: { lt: await settledBefore() },
    ...(cursor ? afterCursor(cursor) : {}),
  };
  return prisma.agentEvent.findMany({
    where,
    orderBy: [{ txid: "asc" }, { id: "asc" }],
    take: 101,
    select: eventSelect,
  });
}

/**
 * Long-poll implementation: wait up to `waitSeconds` for at least one new
 * event after `cursor`, polling the DB every `pollIntervalMs` ms.
 *
 * Returns immediately when events are already available.
 */
export async function pollEvents(
  agent: Pick<AgentContext, "tenantId">,
  cursor: EventCursor | null,
  waitSeconds: number,
  filters: EventFilters = {},
  pollIntervalMs = EVENT_POLL_INTERVAL_MS,
): Promise<AgentEventRow[]> {
  const wait = Number.isFinite(waitSeconds) ? Math.max(0, Math.min(waitSeconds, EVENT_MAX_WAIT_SECONDS)) : 0;
  const deadline = Date.now() + wait * 1000;

  for (let attempt = 0; ; attempt += 1) {
    const rows = await listEvents(agent, cursor, filters);
    if (rows.length > 0 || Date.now() >= deadline) return rows;
    // Sleep for one interval, but don't overshoot the deadline.
    const remaining = deadline - Date.now();
    if (remaining <= 0) return rows;
    const delay = pollIntervalMs === EVENT_POLL_INTERVAL_MS
      ? nextPollDelayMs(attempt)
      : pollIntervalMs;
    await new Promise((resolve) => setTimeout(resolve, Math.min(delay, remaining)));
  }
}
