import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { hasLevel } from "@/lib/agents/levels";
import { IssueApiError } from "@/lib/agent-api/errors";
import { publish } from "@/lib/agent-api/events";
import { MANAGER_VOTE_WEIGHT, reconcileVoteCount, tallyVoteGroups } from "@/lib/voting";

const id = z.string().trim().min(1).max(191);

/**
 * #importance: marking an issue important is a plain toggle, for people and
 * agents alike: no reason, no comment. `projectId` may also arrive as a query
 * parameter.
 */
export const importanceSchema = z.object({ projectId: id.optional() }).strict();

type Tx = Prisma.TransactionClient;

export type AgentVoteResult = {
  /** The owner has a mark on the issue after the call. */
  important: boolean;
  /** The issue's importance after the call. */
  importance: number;
  /** True when this call changed the owner's vote. A repeat is false. */
  changed: boolean;
  /** How many upvotes the owner's vote counts as; 0 when there is none. */
  weight: number;
};

type LockedIssue = { id: string; reporterId?: string | null; beneficiaryUserId?: string | null };

async function lockedIssue(tx: Tx, caller: AgentContext, projectId: string, bugId: string): Promise<LockedIssue> {
  const locked = await tx.$queryRaw<LockedIssue[]>`
    SELECT "id", "reporterId", "beneficiaryUserId" FROM "Bug"
    WHERE "id" = ${bugId}
      AND "organisationId" = ${caller.organisationId}
      AND "projectId" = ${projectId}
      AND "isDeleted" = false
    FOR NO KEY UPDATE
  `;
  if (!locked.length) throw new IssueApiError(404, "Issue not found in this project.");
  return locked[0];
}

/**
 * A manager or merger agent's importance mark counts as MANAGER_VOTE_WEIGHT, except on
 * its owner's own report: independence is by owner, so nobody can push their
 * own idea past the upvote gate.
 */
export function upvoteWeight(caller: Pick<AgentContext, "level" | "ownerId">, issue: LockedIssue): number {
  if (!hasLevel(caller.level, "manager")) return 1;
  if (issue.reporterId === caller.ownerId || issue.beneficiaryUserId === caller.ownerId) return 1;
  return MANAGER_VOTE_WEIGHT;
}

async function recount(tx: Tx, bugId: string): Promise<number> {
  const groups = await tx.vote.groupBy({
    by: ["value"],
    where: { bugId },
    _count: { _all: true },
  });
  const { likeCount, dislikeCount } = tallyVoteGroups(groups);
  const voteCount = reconcileVoteCount(likeCount, dislikeCount);
  await tx.bug.update({ where: { id: bugId }, data: { voteCount } });
  return voteCount;
}

/**
 * Marks the issue important for the agent's owner. One person, one mark:
 * another agent of the same owner does not add a second one. A manager
 * agent's mark counts as MANAGER_VOTE_WEIGHT (see `upvoteWeight`). Marking
 * again changes nothing unless the weight changed.
 */
export async function upvoteIssue(caller: AgentContext, projectId: string, bugId: string): Promise<AgentVoteResult> {
  return prisma.$transaction(async (tx) => {
    const issue = await lockedIssue(tx, caller, projectId, bugId);
    const weight = upvoteWeight(caller, issue);
    const existing = await tx.vote.findUnique({
      where: { userId_bugId: { userId: caller.ownerId, bugId } },
    });
    if (existing?.value === weight) {
      const current = await tx.bug.findUnique({ where: { id: bugId }, select: { voteCount: true } });
      return { important: true, importance: current?.voteCount ?? 0, changed: false, weight };
    }
    const data = { value: weight, agentId: caller.agentId };
    if (existing) {
      await tx.vote.update({ where: { id: existing.id }, data });
    } else {
      await tx.vote.create({ data: { userId: caller.ownerId, bugId, ...data } });
    }
    const importance = await recount(tx, bugId);
    await publish(tx, {
      organisationId: caller.organisationId,
      type: "issue.importance",
      actorAgentId: caller.agentId,
      bugId,
      payload: { issueId: bugId, projectId, userId: caller.ownerId, importance, important: true, weight },
    });
    return { important: true, importance, changed: true, weight };
  });
}

/** Removes the owner's importance mark. Repeating the call when there is none is a no-op. */
export async function removeUpvote(
  caller: AgentContext,
  projectId: string,
  bugId: string,
): Promise<AgentVoteResult> {
  return prisma.$transaction(async (tx) => {
    await lockedIssue(tx, caller, projectId, bugId);
    const existing = await tx.vote.findUnique({
      where: { userId_bugId: { userId: caller.ownerId, bugId } },
    });
    if (!existing) {
      const issue = await tx.bug.findUnique({ where: { id: bugId }, select: { voteCount: true } });
      const count = issue?.voteCount ?? 0;
      return { important: false, importance: count, changed: false, weight: 0 };
    }
    await tx.vote.delete({ where: { id: existing.id } });
    const importance = await recount(tx, bugId);
    await publish(tx, {
      organisationId: caller.organisationId,
      type: "issue.importance",
      actorAgentId: caller.agentId,
      bugId,
      payload: { issueId: bugId, projectId, userId: caller.ownerId, importance, important: false },
    });
    return { important: false, importance, changed: true, weight: 0 };
  });
}
