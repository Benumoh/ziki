import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AGENT_WORKING_WINDOW_MS } from "@/lib/dashboard-overview";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * A bidder not seen for this long is stale (#bidder-last-active): agents poll
 * their work feed about every 30 seconds, so one quiet for 15 minutes isn't
 * running and won't answer an offer in time. The same window says an agent is
 * working on the Active agents page.
 */
export const STALE_AFTER_MS = AGENT_WORKING_WINDOW_MS;

export function isStale(lastSeenAt: Date | null, now: Date = new Date()): boolean {
  return lastSeenAt === null || now.getTime() - lastSeenAt.getTime() > STALE_AFTER_MS;
}

/**
 * Agents not stale by the rule below, as a condition on Agent, for a query
 * that filters on it (the proactive-offer sweep): a key used, or a live
 * claim's heartbeat, within the stale window.
 */
export function seenRecentlyWhere(now: Date = new Date()): Prisma.AgentWhereInput {
  const since = new Date(now.getTime() - STALE_AFTER_MS);
  return {
    OR: [
      { apiKeys: { some: { revokedAt: null, lastUsedAt: { gte: since } } } },
      { claims: { some: { releasedAt: null, lastHeartbeatAt: { gte: since } } } },
    ],
  };
}

const newest =(...dates: (Date | null | undefined)[]): Date | null =>
  dates.reduce<Date | null>((latest, date) => (date && (!latest || date.getTime() > latest.getTime()) ? date : latest), null);

/**
 * Events an agent records by taking a step itself (#work-alerts). Offers and
 * releases are left out: they are recorded with the offered agent as actor
 * though someone else made them.
 */
export const ACTED_EVENT_TYPES = [
  "idea.verdict",
  "issue.confirmation",
  "issue.bid",
  "issue.bid_voted",
  "issue.test_verdict",
  "issue.pull_request_reported",
  "issue.delivered",
  "review.completed",
  "comment.created",
] as const;

/**
 * When each agent last took a step in a project, since `since`: the newest of
 * its ACTED_EVENT_TYPES events there. An agent that took none is left out.
 */
export async function agentsLastActed(agentIds: string[], projectId: string, since: Date, db: Db = prisma): Promise<Map<string, Date>> {
  const acted = new Map<string, Date>();
  if (agentIds.length === 0) return acted;
  const rows = await db.agentEvent.groupBy({
    by: ["actorAgentId"],
    where: { actorAgentId: { in: [...new Set(agentIds)] }, projectId, type: { in: [...ACTED_EVENT_TYPES] }, createdAt: { gte: since } },
    _max: { createdAt: true },
  });
  for (const row of rows) if (row.actorAgentId && row._max.createdAt) acted.set(row.actorAgentId, row._max.createdAt);
  return acted;
}

/**
 * When each agent last checked in: the latest of its keys' last use (stamped
 * on every authenticated call, at most once a minute) and its live claims'
 * heartbeats. Events don't count: an offer or a release is recorded with the
 * offered agent as its actor though someone else made it, and its owner's
 * steps on the website go through it without the agent calling in. An agent
 * never seen maps to null.
 */
export async function agentsLastSeen(agentIds: string[], db: Db = prisma): Promise<Map<string, Date | null>> {
  const ids = [...new Set(agentIds)];
  const seen = new Map<string, Date | null>(ids.map((id) => [id, null]));
  if (ids.length === 0) return seen;
  const [keys, claims] = await Promise.all([
    db.agentApiKey.groupBy({ by: ["agentId"], where: { agentId: { in: ids }, revokedAt: null }, _max: { lastUsedAt: true } }),
    db.issueClaim.groupBy({ by: ["agentId"], where: { agentId: { in: ids }, releasedAt: null }, _max: { lastHeartbeatAt: true } }),
  ]);
  for (const row of keys) seen.set(row.agentId, newest(seen.get(row.agentId), row._max.lastUsedAt));
  for (const row of claims) seen.set(row.agentId, newest(seen.get(row.agentId), row._max.lastHeartbeatAt));
  return seen;
}
