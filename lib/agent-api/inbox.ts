import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { extractMentionedAgentIds, extractMentionedUserIds } from "@/lib/mentions";
import { commentPermalinkPath } from "@/lib/comment-window";
import { issueHref } from "@/lib/issue-ref";
import { absoluteUrl } from "@/lib/site-url";
import { markMessagesRead } from "@/lib/agent-messages";
import { isOfferExpired } from "@/lib/agent-api/offer-expiry";
import { DEFAULT_PROJECT_WORKFLOW } from "@/lib/workflow-config";
import {
  EVENT_MAX_WAIT_SECONDS,
  nextPollDelayMs,
  type EventCursor,
} from "@/lib/agent-api/events";

/**
 * Agent inbox (#601).
 *
 * `/api/v1/events` is the whole tenant's feed. The inbox is only what is
 * addressed to one agent: an offer to it, a reply to its comment, a mention
 * of it or its owner, an answer to its question, a person's decision on what it
 * proposed, or a release of its claim. `publish()` writes the rows in the
 * same transaction as the event, so polling is one indexed query on
 * `(agentId, createdAt, id)` instead of a scan of every event.
 */

export const INBOX_KINDS = ["offer", "reply", "mention", "answer", "message", "approval", "claim"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

type Db = typeof prisma | Prisma.TransactionClient;

export type InboxDelivery = { agentId: string; kind: InboxKind; commentId?: string | null };

export type InboxEvent = {
  id: string;
  tenantId: string;
  type: string;
  payload: Prisma.InputJsonObject;
  actorAgentId?: string | null;
  bugId?: string | null;
};

/** Releases the agent made itself (or can no longer read about) are not news to it. */
const SELF_RELEASE_REASONS = new Set(["declined", "agent", "revoked"]);
const REDESIGN_DECISIONS = new Set(["redesign.approved", "redesign.rejected", "redesign.chosen"]);

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function objectPayload(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function claimAgentId(db: Db, claimId: unknown): Promise<string | null> {
  const id = text(claimId);
  if (!id) return null;
  const claim = await db.issueClaim.findUnique({ where: { id }, select: { agentId: true } });
  return claim?.agentId ?? null;
}

/**
 * Agents @mentioned by name (#603), then the tenant's live agents whose owner
 * was @mentioned, except the author. `writeInbox` drops out-of-tenant ids.
 */
async function mentionDeliveries(
  db: Db, tenantId: string, body: string, authorAgentId: string | null, commentId: string | null,
): Promise<InboxDelivery[]> {
  const direct = extractMentionedAgentIds(body).map((id) => ({ id }));
  const userIds = extractMentionedUserIds(body);
  const owned = userIds.length
    ? await db.agent.findMany({
        where: { tenantId, revokedAt: null, ownerUserId: { in: userIds } },
        select: { id: true },
      })
    : [];
  return [...direct, ...owned]
    .filter((agent) => agent.id !== authorAgentId)
    .map((agent) => ({ agentId: agent.id, kind: "mention" as const, commentId }));
}

/**
 * Which agents an event is addressed to, and as what. Pure routing: the
 * caller drops revoked or out-of-tenant agents and duplicates.
 */
export async function inboxRecipients(db: Db, event: InboxEvent): Promise<InboxDelivery[]> {
  const payload = event.payload as Record<string, unknown>;
  switch (event.type) {
    case "claim.offered": {
      const agentId = await claimAgentId(db, payload.claimId);
      return agentId ? [{ agentId, kind: "offer" }] : [];
    }
    case "review.requested": {
      const agentId = text(payload.agentId);
      return agentId ? [{ agentId, kind: "offer" }] : [];
    }
    case "job.review.requested": {
      const agentId = text(payload.agentId);
      return agentId ? [{ agentId, kind: "offer" }] : [];
    }
    case "claim.released": {
      if (SELF_RELEASE_REASONS.has(String(payload.reason))) return [];
      const agentId = await claimAgentId(db, payload.claimId);
      return agentId ? [{ agentId, kind: "claim" }] : [];
    }
    case "issue.bid_awarded": {
      const agentId = await claimAgentId(db, payload.claimId);
      return agentId ? [{ agentId, kind: "approval" }] : [];
    }
    case "question.answered": {
      const agentId = text(payload.agentId);
      return agentId ? [{ agentId, kind: "answer" }] : [];
    }
    case "comment.created": {
      const commentId = text(payload.commentId);
      if (!commentId) return [];
      const comment = await db.comment.findUnique({
        where: { id: commentId },
        select: {
          agentId: true,
          body: true,
          parent: { select: { agentId: true } },
          // #entry-replies-only: a reply answers the agent whose entry it is under.
          confirmation: { select: { agentId: true } },
          bid: { select: { agentId: true } },
          testVerdict: { select: { agentId: true } },
          mergeReview: { select: { agentId: true } },
        },
      });
      if (!comment) return [];
      const parentAgentId =
        comment.parent?.agentId ??
        comment.confirmation?.agentId ??
        comment.bid?.agentId ??
        comment.testVerdict?.agentId ??
        comment.mergeReview?.agentId ??
        null;
      const reply: InboxDelivery[] = parentAgentId && parentAgentId !== comment.agentId
        ? [{ agentId: parentAgentId, kind: "reply", commentId }]
        : [];
      return [...reply, ...await mentionDeliveries(db, event.tenantId, comment.body, comment.agentId, commentId)];
    }
    case "idea.created": {
      const ideaId = text(payload.ideaId);
      if (!ideaId) return [];
      const idea = await db.idea.findUnique({ where: { id: ideaId }, select: { description: true } });
      return idea ? mentionDeliveries(db, event.tenantId, idea.description, event.actorAgentId ?? null, null) : [];
    }
    default: {
      if (!REDESIGN_DECISIONS.has(event.type)) return [];
      const proposalId = text(payload.proposalId);
      if (!proposalId) return [];
      const proposal = await db.redesignProposal.findUnique({ where: { id: proposalId }, select: { authorAgentId: true } });
      return proposal ? [{ agentId: proposal.authorAgentId, kind: "approval" }] : [];
    }
  }
}

/**
 * Write the inbox rows for one event. `publish()` calls this inside the
 * domain transaction, so an item exists exactly when its event does. One
 * item per agent per event: a reply that also mentions the owner is a reply.
 */
export async function writeInbox(db: Db, event: InboxEvent): Promise<number> {
  // Partial test doubles of the client have no inbox table; nothing to write.
  if (typeof (db as { agentInboxItem?: unknown }).agentInboxItem === "undefined") return 0;
  const seen = new Set<string>();
  const deliveries = (await inboxRecipients(db, event)).filter((delivery) => {
    if (seen.has(delivery.agentId)) return false;
    seen.add(delivery.agentId);
    return true;
  });
  if (!deliveries.length) return 0;
  const live = await db.agent.findMany({
    where: { id: { in: [...seen] }, tenantId: event.tenantId, revokedAt: null },
    select: { id: true },
  });
  const allowed = new Set(live.map((agent) => agent.id));
  const data = deliveries.filter((delivery) => allowed.has(delivery.agentId)).map((delivery) => ({
    agentId: delivery.agentId,
    kind: delivery.kind,
    eventId: event.id,
    eventType: event.type,
    bugId: event.bugId ?? null,
    commentId: delivery.commentId ?? null,
    payload: event.payload,
  }));
  if (!data.length) return 0;
  const { count } = await db.agentInboxItem.createMany({ data, skipDuplicates: true });
  return count;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

const itemSelect = {
  id: true,
  agentId: true,
  kind: true,
  eventId: true,
  eventType: true,
  bugId: true,
  commentId: true,
  payload: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.AgentInboxItemSelect;

export type InboxItemRow = Prisma.AgentInboxItemGetPayload<{ select: typeof itemSelect }>;

/** The current expiry state for the claim offers visible in this inbox page. */
export async function expiredClaimOffers(items: readonly InboxItemRow[], now = Date.now()): Promise<Set<string>> {
  const claimIds = [...new Set(items.flatMap((item) => {
    if (item.eventType !== "claim.offered") return [];
    const claimId = text(objectPayload(item.payload).claimId);
    return claimId ? [claimId] : [];
  }))];
  if (claimIds.length === 0) return new Set();

  const claims = await prisma.issueClaim.findMany({
    where: { id: { in: claimIds } },
    select: {
      id: true,
      status: true,
      offeredAt: true,
      releaseReason: true,
      bug: { select: { project: { select: { workflow: { select: { offerWindowSeconds: true } } } } } },
    },
  });
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  return new Set(claimIds.filter((id) => {
    const claim = byId.get(id);
    if (!claim) return true;
    if (claim.status === "released") return claim.releaseReason === "expired";
    if (claim.status !== "offered") return false;
    const windowSeconds = claim.bug.project.workflow?.offerWindowSeconds ?? DEFAULT_PROJECT_WORKFLOW.offerWindowSeconds;
    return isOfferExpired(claim.offeredAt, now, windowSeconds * 1000);
  }));
}

/** This agent's items after `cursor`, oldest first. Reads 101 so the route can tell there is more. */
export async function listInbox(
  agent: Pick<AgentContext, "agentId">,
  cursor: EventCursor | null,
  options: { unread?: boolean } = {},
): Promise<InboxItemRow[]> {
  return prisma.agentInboxItem.findMany({
    where: {
      agentId: agent.agentId,
      ...(options.unread ? { readAt: null } : {}),
      ...(cursor && "createdAt" in cursor
        ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }
        : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 101,
    select: itemSelect,
  });
}

/** Long poll: returns as soon as an item exists, or empty at the deadline. Same backoff as `/events` (#545). */
export async function pollInbox(
  agent: Pick<AgentContext, "agentId">,
  cursor: EventCursor | null,
  waitSeconds: number,
  options: { unread?: boolean } = {},
): Promise<InboxItemRow[]> {
  const wait = Number.isFinite(waitSeconds) ? Math.max(0, Math.min(waitSeconds, EVENT_MAX_WAIT_SECONDS)) : 0;
  const deadline = Date.now() + wait * 1000;
  for (let attempt = 0; ; attempt += 1) {
    const rows = await listInbox(agent, cursor, options);
    const remaining = deadline - Date.now();
    if (rows.length > 0 || remaining <= 0) return rows;
    await new Promise((resolve) => setTimeout(resolve, Math.min(nextPollDelayMs(attempt), remaining)));
  }
}

/** The address of each item's issue, `/<project-slug>/<number>` (#project-urls), by issue id. */
export async function inboxIssuePaths(items: readonly InboxItemRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(items.map((item) => item.bugId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const bugs = await prisma.bug.findMany({
    where: { id: { in: ids } },
    select: { id: true, number: true, project: { select: { slug: true } } },
  });
  return new Map(bugs.map((bug) => [bug.id, issueHref(bug)]));
}

/**
 * The JSON shape of one item. `url` links to the comment when there is one,
 * else the issue; `issuePaths` comes from `inboxIssuePaths`.
 */
export function serializeInboxItem(
  item: InboxItemRow,
  issuePaths: ReadonlyMap<string, string>,
  expiredOffers: ReadonlySet<string> = new Set(),
) {
  const issuePath = item.bugId ? issuePaths.get(item.bugId) : undefined;
  const url = issuePath
    ? absoluteUrl(item.commentId ? commentPermalinkPath(issuePath, item.commentId) : issuePath)
    : null;
  const claimId = item.eventType === "claim.offered" ? text(objectPayload(item.payload).claimId) : null;
  return {
    id: item.id,
    kind: item.kind,
    eventId: item.eventId,
    eventType: item.eventType,
    issueId: item.bugId,
    commentId: item.commentId,
    url,
    payload: item.payload,
    ...(item.eventType === "claim.offered" ? {
      agentId: item.agentId,
      expired: !claimId || expiredOffers.has(claimId),
    } : {}),
    read: item.readAt !== null,
    readAt: item.readAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mark read
// ---------------------------------------------------------------------------

const itemId = z.string().trim().min(1).max(191);
export const markInboxReadSchema = z.union([
  z.object({ ids: z.array(itemId).min(1).max(500) }).strict(),
  z.object({ upTo: itemId }).strict(),
]);
export type MarkInboxReadInput = z.infer<typeof markInboxReadSchema>;

/**
 * Mark this agent's items read: the listed `ids`, or every item up to and
 * including `upTo`. Another agent's ids are ignored. Returns how many
 * changed, or null when `upTo` is not one of this agent's items.
 */
export async function markInboxRead(
  agent: Pick<AgentContext, "agentId">,
  input: MarkInboxReadInput,
): Promise<number | null> {
  const readAt = new Date();
  if ("ids" in input) {
    const { count } = await prisma.agentInboxItem.updateMany({
      where: { agentId: agent.agentId, id: { in: input.ids }, readAt: null },
      data: { readAt },
    });
    if (count) await markMessagesRead(agent.agentId, readAt);
    return count;
  }
  const anchor = await prisma.agentInboxItem.findFirst({
    where: { id: input.upTo, agentId: agent.agentId },
    select: { id: true, createdAt: true },
  });
  if (!anchor) return null;
  const { count } = await prisma.agentInboxItem.updateMany({
    where: {
      agentId: agent.agentId,
      readAt: null,
      OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lte: anchor.id } }],
    },
    data: { readAt },
  });
  // #605: an owner's message is read once its inbox item is.
  if (count) await markMessagesRead(agent.agentId, readAt);
  return count;
}
