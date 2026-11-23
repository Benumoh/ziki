import type { Prisma, PrismaClient } from "@prisma/client";
import { zikOf } from "./ledger";

type Db = PrismaClient | Prisma.TransactionClient;

/** Release rows paid for agents' work on an organisation's issues (#one-payment): to the agent's owner, recording the agent. */
function agentRows(organisationId: string, agentIds: string[], since?: Date): Prisma.CoinEntryWhereInput {
  return {
    account: "wallet",
    kind: "release",
    agentId: { in: agentIds },
    bug: { organisationId },
    ...(since ? { createdAt: { gte: since } } : {}),
  };
}

/**
 * The Ziks each agent's work earned its owner in an organisation (#710, #one-payment): its share of every funded issue
 * it worked on that went live. Work a person did without an agent belongs to no agent. An agent with none is 0.
 */
export async function agentEarnings(db: Db, organisationId: string, agentIds: string[]): Promise<Map<string, number>> {
  const earned = new Map<string, number>(agentIds.map((id) => [id, 0]));
  if (!agentIds.length) return earned;
  const rows = await db.coinEntry.groupBy({ by: ["agentId"], where: agentRows(organisationId, agentIds), _sum: { amount: true } });
  for (const row of rows) if (row.agentId) earned.set(row.agentId, zikOf(row._sum.amount));
  return earned;
}

/** What each agent has done, for the agents bar (#agents-dock): bids placed, comments written, Ziks earned today. */
export type AgentActivity = { bids: number; comments: number; ziksToday: number };

/** Each agent's bids (all time), comments (not deleted) and the Ziks its work earned since `since` (the start of today). */
export async function agentActivity(db: Db, organisationId: string, agentIds: string[], since: Date): Promise<Map<string, AgentActivity>> {
  const stats = new Map<string, AgentActivity>(agentIds.map((id) => [id, { bids: 0, comments: 0, ziksToday: 0 }]));
  if (!agentIds.length) return stats;
  const [bids, comments, today] = await Promise.all([
    db.issueBid.groupBy({ by: ["agentId"], where: { agentId: { in: agentIds } }, _count: { _all: true } }),
    db.comment.groupBy({ by: ["agentId"], where: { agentId: { in: agentIds }, deletedAt: null }, _count: { _all: true } }),
    db.coinEntry.groupBy({ by: ["agentId"], where: agentRows(organisationId, agentIds, since), _sum: { amount: true } }),
  ]);
  for (const row of bids) if (row.agentId && stats.has(row.agentId)) stats.get(row.agentId)!.bids = row._count._all;
  for (const row of comments) if (row.agentId && stats.has(row.agentId)) stats.get(row.agentId)!.comments = row._count._all;
  for (const row of today) if (row.agentId && stats.has(row.agentId)) stats.get(row.agentId)!.ziksToday = zikOf(row._sum.amount);
  return stats;
}
