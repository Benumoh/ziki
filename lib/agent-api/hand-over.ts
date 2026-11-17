import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { IssueApiError } from "@/lib/agent-api/errors";
import { afterAward, awardInTransaction, bidTally } from "@/lib/agent-api/bid";
import { autoAcceptAward } from "@/lib/agent-api/auto-accept";
import { OPEN_BID_WHERE } from "@/lib/open-bids";
import { seenRecentlyWhere } from "@/lib/agents/last-seen";
import { idleAgentsIn, offerIssue, pickAgent } from "@/lib/agents/proactive-offers";
import { workflowFor } from "@/lib/workflow";
import { logger } from "@/lib/logger";

/**
 * The lapsed-offer hand-over (#offer-hand-over): an offer nobody accepted in
 * the project's offer window (30 minutes by default) doesn't send the issue
 * back to wait for another award. Ziki hands it straight on, in this order:
 *
 * 1. The open bid with the most votes (weighted as for an award; a tie goes to
 *    the earliest bid) from an agent still checking in, not paused, whose
 *    owner is under the project's capacity. Ziki awards it, as any award: an
 *    offer with its own window, accepted at once for a Work automatically
 *    agent, waiting for its owner's yes for an Ask me first one. On a complex
 *    issue the award opens plan review.
 * 2. Otherwise a Work automatically agent online now and holding nothing
 *    (the proactive-offer sweep's idle agents, lib/agents/proactive-offers.ts),
 *    offered the issue and accepted for it at once.
 * 3. Otherwise nothing: the issue stays Open for bids, and the sweep offers
 *    it again once someone is free.
 *
 * Every agent is treated alike until its offer lapses: work mode never ranks
 * a bid or an idle agent. The issue never goes back to an agent that held or
 * was offered it before, the one that just let it lapse among them. It is the
 * third exception to "nothing offers an issue automatically" (AGENTS.md),
 * with an admin's direct assignment and the proactive-offer sweep.
 */

export type HandOver =
  | { to: "bid"; bidId: string; agentId: string; claimId: string }
  | { to: "automatic_agent"; agentId: string; claimId: string; accepted: boolean }
  | { to: null };

export async function handOverLapsedOffer(bugId: string, now: Date = new Date()): Promise<HandOver> {
  const issue = await prisma.bug.findFirst({
    where: { id: bugId, isDeleted: false },
    select: { id: true, organisationId: true, projectId: true, priority: true, areaId: true, substatus: true },
  });
  if (!issue) return { to: null };
  const before = await prisma.issueClaim.findMany({ where: { bugId }, select: { agentId: true } });
  const tried = new Set(before.map((row) => row.agentId));
  const workflow = await workflowFor(issue.projectId);

  // 1. The most-voted open bid from an agent still around.
  const bids = await prisma.issueBid.findMany({
    where: {
      bugId,
      ...OPEN_BID_WHERE,
      agentId: { notIn: [...tried] },
      agent: { revokedAt: null, pausedAt: null, ...seenRecentlyWhere(now) },
    },
    select: { id: true, agentId: true, beneficiaryUserId: true, createdAt: true },
  });
  const ranked = (
    await Promise.all(bids.map(async (bid) => ({ bid, votes: await bidTally(bid.id, workflow.managerVoteWeight, issue.organisationId) })))
  ).sort((a, b) => b.votes - a.votes || a.bid.createdAt.getTime() - b.bid.createdAt.getTime() || a.bid.id.localeCompare(b.bid.id));
  for (const { bid } of ranked) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Bug" WHERE "id" = ${bugId} AND "isDeleted" = false FOR UPDATE`;
        if (!locked.length) return null;
        // Ziki awards it, not an agent: the activity names the bidder's owner, as an accept does.
        return awardInTransaction(tx, bid.id, { userId: bid.beneficiaryUserId, agentId: null });
      });
      if (!result) return { to: null };
      afterAward(result);
      return { to: "bid", bidId: bid.id, agentId: bid.agentId, claimId: result.claimId };
    } catch (error) {
      // A stake decides a staked issue; another award or accept won the race: leave it.
      if (error instanceof IssueApiError && error.body?.error === "issue_staked") return { to: null };
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { to: null };
      // This bidder can't take it now (at capacity, paused meanwhile): the next one.
      if (error instanceof IssueApiError) continue;
      throw error;
    }
  }

  // 2. A Work automatically agent online now, offered it and accepted for it at once.
  if (issue.substatus !== "open") return { to: null };
  const idle = (await idleAgentsIn(issue.organisationId, now)).filter((agent) => agent.workMode === "automatic");
  const agent = pickAgent(issue, idle, tried);
  if (!agent) return { to: null };
  const claimId = await offerIssue(issue, agent, { organisationId: issue.organisationId, projectId: issue.projectId }, now, { handedOver: true });
  if (!claimId) return { to: null };
  const accepted = await autoAcceptAward(claimId);
  return { to: "automatic_agent", agentId: agent.id, claimId, accepted };
}

/** The hand-over after an offer lapsed, never failing the expiry that called it. */
export async function handOverAfterLapse(bugId: string): Promise<void> {
  try {
    await handOverLapsedOffer(bugId);
  } catch (error) {
    logger.error("[offers] hand-over after a lapsed offer failed", error);
  }
}
