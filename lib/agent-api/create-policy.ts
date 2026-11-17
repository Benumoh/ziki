import { typeFitsTrack, wrongTrackMessage } from "@/lib/marketing/idea-track";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient, type WorkTrack } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  fallbackTerms,
  normalizeQuery,
  pickSimilar,
  shouldSearch,
  SIMILAR_LIMIT,
  SIMILAR_STATUSES,
  type ScoredIssue,
  type SimilarIssue,
} from "@/lib/similar-issues";

/**
 * What happens when an agent files a report (#441). Every report is an idea
 * (#idea-table): the create route calls `createIdeaWithPolicy` and maps its
 * result to a response; it does not repeat any of these rules:
 *
 * - `Idempotency-Key` is required. The same agent and key within 24 hours
 *   returns the idea it already made instead of inserting another.
 * - Open issues with a similar title in the same project are a `409` with the
 *   matches, until the agent repeats the same key with `acknowledgeSimilar`.
 * - `typeId`, when given, must be an active issue type.
 *
 * It also exports the `(createdAt, id)` cursor #429 pages lists with.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export const IDEMPOTENCY_HEADER = "Idempotency-Key";
/** How long a key keeps returning the idea it made. */
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_KEY_MAX = 255;

/** Stable JSON serialization so equivalent request objects hash consistently. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

/** Hash the normalized issue-create payload for idempotency comparisons. */
export function hashCreateRequest(body: unknown): string {
  return createHash("sha256").update(stableJson(body)).digest("hex");
}

/** A key is 1–255 visible ASCII characters, like a UUID or a hash. */
export function parseIdempotencyKey(raw: string | null | undefined): string | null {
  const key = raw?.trim();
  if (!key || key.length > IDEMPOTENCY_KEY_MAX) return null;
  return /^[\x21-\x7e]+$/.test(key) ? key : null;
}

/** `acknowledgeSimilar` from a JSON body or a query string. */
export function isAcknowledged(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

// ---------------------------------------------------------------------------
// Similar issues
// ---------------------------------------------------------------------------

/** Searched over, then cut to SIMILAR_LIMIT once scored (as /api/issues/similar). */
const CANDIDATES = 10;

/**
 * Open issues in this project whose title looks like `title`, using the same
 * scoring as the reporter's "is it one of these?" hint (lib/similar-issues.ts).
 */
export async function findSimilarIssues(
  db: Db,
  scope: { organisationId: string; projectId: string },
  title: string,
  /** Only work on this track counts: a marketing task never duplicates a product report. */
  track: WorkTrack = "product",
  includeIdeas = true,
): Promise<SimilarIssue[]> {
  const query = normalizeQuery(title);
  if (!shouldSearch(query)) return [];
  try {
    // Open ideas count too (#idea-table): a second report of the same idea is a duplicate as well.
    const rows = await db.$queryRaw<ScoredIssue[]>`
      SELECT "id", "number", "title", "status"::text AS "status", "voteCount", 'issue' AS "kind",
             GREATEST(similarity("title", ${query}), word_similarity(${query}, "title")) AS "score"
      FROM "Bug"
      WHERE "isDeleted" = false
        AND "track"::text = ${track}
        AND "organisationId" = ${scope.organisationId}
        AND "projectId" = ${scope.projectId}
        AND "status"::text = ANY(${SIMILAR_STATUSES as string[]})
        AND ("title" % ${query} OR ${query} <% "title")
      UNION ALL
      SELECT "id", "number", "title", 'open' AS "status", "score" AS "voteCount", 'idea' AS "kind",
             GREATEST(similarity("title", ${query}), word_similarity(${query}, "title")) AS "score"
      FROM "Idea"
      WHERE "isDeleted" = false
        AND "track"::text = ${track}
        AND "organisationId" = ${scope.organisationId}
        AND "projectId" = ${scope.projectId}
        AND "status" = 'open'
        AND ${includeIdeas}
        AND ("title" % ${query} OR ${query} <% "title")
      ORDER BY "score" DESC
      LIMIT ${CANDIDATES}`;
    return pickSimilar(rows);
  } catch (error) {
    console.error("[agent-create] trigram search failed; using plain matching for this request", error);
  }
  const terms = fallbackTerms(query);
  if (terms.length < 1) return [];
  const titleMatch = terms.map((t) => ({ title: { contains: t, mode: "insensitive" as const } }));
  const [issues, ideas] = await Promise.all([
    db.bug.findMany({
      where: { organisationId: scope.organisationId, projectId: scope.projectId, track, isDeleted: false, status: { in: [...SIMILAR_STATUSES] }, AND: titleMatch },
      select: { id: true, number: true, title: true, status: true, voteCount: true },
      orderBy: [{ voteCount: "desc" }, { updatedAt: "desc" }],
      take: SIMILAR_LIMIT,
    }),
    includeIdeas ? db.idea.findMany({
      where: { organisationId: scope.organisationId, projectId: scope.projectId, track, isDeleted: false, status: "open", AND: titleMatch },
      select: { id: true, number: true, title: true, score: true },
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
      take: SIMILAR_LIMIT,
    }) : Promise.resolve([]),
  ]);
  return [
    ...issues.map((issue) => ({ ...issue, kind: "issue" as const })),
    ...ideas.map(({ score, ...idea }) => ({ ...idea, status: "open" as const, voteCount: score, kind: "idea" as const })),
  ].slice(0, SIMILAR_LIMIT);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/** The fields the policy decides; the route adds title, description and the rest. */
export type PolicyFields = { typeId: string | null };

export type CreatePolicyInput = {
  agent: { agentId: string; organisationId: string };
  projectId: string;
  /** The raw `Idempotency-Key` header. */
  idempotencyKey: string | null | undefined;
  /** SHA-256 hash of the normalized create request. */
  requestHash: string;
  /** Already validated by the route; used for the similar-issue check. */
  title: string;
  typeId?: unknown;
  /** Product (the default) or marketing: decides which types fit and which reports count as similar. */
  track?: WorkTrack;
  acknowledgeSimilar?: unknown;
  /** Inserts the idea inside the policy's transaction and returns its id. */
  insert: (tx: Prisma.TransactionClient, fields: PolicyFields) => Promise<{ id: string }>;
  now?: Date;
};

export type CreatePolicyResult =
  | { status: 201; ideaId: string; replayed: false }
  | { status: 200; ideaId: string; replayed: true }
  | { status: 400; error: "missing_idempotency_key" | "invalid_idempotency_key"; message: string }
  | { status: 422; error: "invalid_type"; message: string }
  | { status: 422; error: "wrong_track"; message: string }
  | { status: 409; error: "similar_issues"; message: string; matches: SimilarIssue[] }
  | { status: 409; error: "idempotency_conflict"; message: string };

/** An active issue type on the idea's track, `null` for none, or why the given one can't be used. */
type TypeCheck = { ok: true; typeId: string | null } | { ok: false; error: "invalid_type" | "wrong_track" };

async function resolveTypeId(
  db: Db,
  typeId: unknown,
  organisationId: string,
  track: WorkTrack,
): Promise<TypeCheck> {
  if (typeId === undefined || typeId === null || typeId === "") return { ok: true, typeId: null };
  if (typeof typeId !== "string" || typeId.length > 191) return { ok: false, error: "invalid_type" };
  const type = await db.issueType.findUnique({
    where: { id_organisationId: { id: typeId, organisationId } },
    select: { isActive: true, track: true },
  });
  if (!type?.isActive) return { ok: false, error: "invalid_type" };
  if (!typeFitsTrack(type.track, track)) return { ok: false, error: "wrong_track" };
  return { ok: true, typeId };
}

/** The idea an unexpired key already made, or `null`. */
async function replayFor(db: Db, agentId: string, key: string, cutoff: Date) {
  const existing = await db.idempotencyKey.findUnique({
    where: { agentId_key: { agentId, key } },
    select: { ideaId: true, createdAt: true, requestHash: true },
  });
  if (!existing || existing.createdAt <= cutoff) return null;
  return existing;
}

function replayOrConflict(
  existing: { ideaId: string | null; requestHash: string | null },
  requestHash: string,
): CreatePolicyResult {
  if (existing.requestHash !== requestHash) {
    return {
      status: 409,
      error: "idempotency_conflict",
      message: "This Idempotency-Key was already used with a different request body.",
    };
  }
  if (existing.ideaId) return { status: 200, ideaId: existing.ideaId, replayed: true };
  return {
    status: 409,
    error: "idempotency_conflict",
    message: "A request with this Idempotency-Key is in progress or failed. Use a new key.",
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function createIdeaWithPolicy(input: CreatePolicyInput): Promise<CreatePolicyResult> {
  const { agent, projectId } = input;
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - IDEMPOTENCY_WINDOW_MS);

  if (!input.idempotencyKey?.trim()) {
    return {
      status: 400,
      error: "missing_idempotency_key",
      message: `Send an ${IDEMPOTENCY_HEADER} header so a retry can't create the idea twice.`,
    };
  }
  const key = parseIdempotencyKey(input.idempotencyKey);
  if (!key) {
    return {
      status: 400,
      error: "invalid_idempotency_key",
      message: `${IDEMPOTENCY_HEADER} must be 1–${IDEMPOTENCY_KEY_MAX} visible ASCII characters, such as a UUID.`,
    };
  }

  // A retry only replays when its normalized request matches the original.
  const earlier = await replayFor(prisma, agent.agentId, key, cutoff);
  if (earlier) return replayOrConflict(earlier, input.requestHash);

  const track = input.track ?? "product";
  const type = await resolveTypeId(prisma, input.typeId, agent.organisationId, track);
  if (!type.ok) {
    return type.error === "wrong_track"
      ? { status: 422, error: "wrong_track", message: wrongTrackMessage(track) }
      : { status: 422, error: "invalid_type", message: "typeId is not an active issue type." };
  }
  const typeId = type.typeId;

  if (!isAcknowledged(input.acknowledgeSimilar)) {
    const matches = await findSimilarIssues(prisma, { organisationId: agent.organisationId, projectId }, input.title, track);
    if (matches.length > 0) {
      // A concurrent retry may have just created the idea, whose issue-free title
      // match is still this request's: replay it instead.
      const justMade = await replayFor(prisma, agent.agentId, key, cutoff);
      if (justMade) return replayOrConflict(justMade, input.requestHash);
      return {
        status: 409,
        error: "similar_issues",
        message:
          "Open issues with a similar title exist. If yours is different, repeat the request with the same Idempotency-Key and acknowledgeSimilar=true.",
        matches,
      };
    }
  }

  try {
    const ideaId = await prisma.$transaction(async (tx) => {
      // A key older than the window is free to reuse.
      await tx.idempotencyKey.deleteMany({
        where: { agentId: agent.agentId, key, createdAt: { lte: cutoff } },
      });
      // Taking the key first means a concurrent retry waits on it, then fails
      // the unique check and replays this idea below.
      const held = await tx.idempotencyKey.create({
        data: { agentId: agent.agentId, key, requestHash: input.requestHash, createdAt: now },
        select: { id: true },
      });
      const idea = await input.insert(tx, { typeId });
      await tx.idempotencyKey.update({ where: { id: held.id }, data: { ideaId: idea.id } });
      return idea.id;
    });
    return { status: 201, ideaId, replayed: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await replayFor(prisma, agent.agentId, key, cutoff);
    if (winner) return replayOrConflict(winner, input.requestHash);
    return {
      status: 409,
      error: "idempotency_conflict",
      message: "A request with this Idempotency-Key is in progress. Retry it shortly.",
    };
  }
}

// ---------------------------------------------------------------------------
// List cursor
// ---------------------------------------------------------------------------

/**
 * A position in a list ordered by `(createdAt, id)`. The id breaks ties, so
 * two issues created in the same millisecond are never skipped or repeated.
 * Offsets aren't used: a new issue would shift every later page.
 */
export type IssueCursor = { createdAt: Date; id: string };

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function encodeCursor(cursor: IssueCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt.toISOString(), cursor.id])).toString("base64url");
}

/** `null` for anything that isn't a cursor this module made. */
export function decodeCursor(raw: string | null | undefined): IssueCursor | null {
  if (!raw || raw.length > 200) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [iso, id] = value;
    if (typeof iso !== "string" || typeof id !== "string" || !id || id.length > 191) return null;
    const createdAt = new Date(iso);
    return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
  } catch {
    return null;
  }
}

/** "desc" for newest first (lists), "asc" for oldest first (feeds). */
export type CursorDirection = "asc" | "desc";

/** Rows after `cursor` in `direction`. Empty when there's no cursor. */
export function cursorWhere(cursor: IssueCursor | null, direction: CursorDirection = "desc"): Prisma.BugWhereInput {
  if (!cursor) return {};
  const beyond = direction === "desc" ? "lt" : "gt";
  return {
    OR: [
      { createdAt: { [beyond]: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { [beyond]: cursor.id } },
    ],
  };
}

export function cursorOrderBy(direction: CursorDirection = "desc"): Prisma.BugOrderByWithRelationInput[] {
  return [{ createdAt: direction }, { id: direction }];
}

/** What a caller is told when `?limit=` is not a usable value (#454). */
export const LIMIT_RANGE_ERROR =
  `limit must be a whole number between 1 and ${MAX_PAGE_SIZE}; the default is ${DEFAULT_PAGE_SIZE}.`;

/**
 * A `?limit=` value. Absent means `DEFAULT_PAGE_SIZE`, a value above the
 * maximum is clamped to it, and anything that is not a whole number in range
 * is `null` so the caller can reject it with `LIMIT_RANGE_ERROR`.
 *
 * #454: this used to fall back to the default for every unusable value, so
 * `limit=0`, `limit=-5` and `limit=abc` all silently returned a 25-item page
 * and `limit=1.5` silently returned one item - a client sending the wrong
 * value never learned it had been ignored.
 */
export function pageSize(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return DEFAULT_PAGE_SIZE;
  const value = raw.trim();
  if (value === "") return DEFAULT_PAGE_SIZE;
  // Only digits: rejects "-5", "1.5", "abc", "1e3" and " 1 2 ".
  if (!/^\d+$/.test(value)) return null;
  const n = Number.parseInt(value, 10);
  if (n < 1) return null;
  return Math.min(n, MAX_PAGE_SIZE);
}

/**
 * Fetch `limit + 1` rows with `cursorWhere` and `cursorOrderBy`, then pass
 * them here: the extra row only says whether there's a next page.
 */
export function toPage<T extends IssueCursor>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}
