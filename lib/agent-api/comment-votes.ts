import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { requireLevel } from "@/lib/agents/levels";
import { audit } from "@/lib/agents/audit";
import { IssueApiError } from "@/lib/agent-api/errors";
import { publish } from "@/lib/agent-api/events";
import { REPUTATION_PER_UPVOTE } from "@/lib/agents/reputation";

/**
 * Comment upvotes (#comment-votes). While an issue is Open, agents and people
 * drop investigation comments on it (root cause, where in the code, a
 * suggested fix) to help whoever implements it. Others upvote the helpful
 * ones: one vote per person per comment (all of a person's agents count
 * once), and each new vote raises the comment's agent's reputation by 1 (votes pay nothing, #one-payment). The comment
 * itself earns nothing, and nobody upvotes their own comment.
 *
 * Upvotes take the same window as comments on the issue itself
 * (lib/comment-placement.ts): the issue must be Open, and the comment must be
 * on the issue itself or a reply to one, not a reply under a stage entry.
 */

export type CommentVoteResult = { commentId: string; votes: number };

type CastInput = {
  commentId: string;
  /** Where the comment's issue must be: the agent's project, or the person's organisation. */
  bugScope: Prisma.BugWhereInput;
  /** The person the vote counts for: the agent's owner, or the signed-in person. */
  voterUserId: string;
  /** The agent that cast it for `voterUserId`; null for a person's own click. */
  agentId: string | null;
};

const OWN_COMMENT_MESSAGE = "This is your own comment; other people upvote it.";

/** Records one upvote and pays the author, once per comment and voting person. */
export async function castCommentVote(input: CastInput): Promise<CommentVoteResult & { bugId: string; created: boolean }> {
  const found = await prisma.comment.findFirst({
    where: { id: input.commentId, bug: { ...input.bugScope, isDeleted: false } },
    select: { id: true, bugId: true },
  });
  if (!found) throw new IssueApiError(404, "Comment not found.");

  return prisma.$transaction(async (tx) => {
    // Lock the issue, as a bid vote does, so the status read below holds until the vote lands.
    await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${found.bugId} AND "isDeleted" = false FOR NO KEY UPDATE`;
    const comment = await tx.comment.findUnique({
      where: { id: found.id },
      select: {
        id: true, bugId: true, authorId: true, agentId: true, deletedAt: true,
        confirmationId: true, bidId: true, deliveryId: true, testVerdictId: true, mergeReviewId: true,
        agent: { select: { ownerUserId: true } },
        bug: { select: { number: true, substatus: true, organisationId: true, projectId: true, isDeleted: true } },
      },
    });
    if (!comment || comment.deletedAt || comment.bug.isDeleted) throw new IssueApiError(404, "Comment not found.");
    if (comment.confirmationId || comment.bidId || comment.deliveryId || comment.testVerdictId || comment.mergeReviewId) {
      throw new IssueApiError(409, "Only comments on the issue itself take upvotes, not replies under an entry.");
    }
    if (input.voterUserId === comment.authorId || input.voterUserId === comment.agent?.ownerUserId) {
      throw new IssueApiError(403, OWN_COMMENT_MESSAGE, { error: "own_comment", message: OWN_COMMENT_MESSAGE });
    }

    const created = await tx.commentVote.createMany({
      data: [{ commentId: comment.id, bugId: comment.bugId, onBehalfOfUserId: input.voterUserId, agentId: input.agentId }],
      skipDuplicates: true,
    });
    const votes = await tx.commentVote.count({ where: { commentId: comment.id } });
    if (created.count) {

      // #agent-reputation: each upvote on an agent's comment raises its reputation.
      if (comment.agentId) {
        await tx.agent.update({ where: { id: comment.agentId }, data: { reputation: { increment: REPUTATION_PER_UPVOTE } } });
      }
      await publish(tx, {
        organisationId: comment.bug.organisationId,
        type: "issue.comment_upvoted",
        actorAgentId: input.agentId,
        bugId: comment.bugId,
        projectId: comment.bug.projectId,
        payload: {
          commentId: comment.id,
          issueId: comment.bugId,
          issueNumber: comment.bug.number,
          projectId: comment.bug.projectId,
          authorId: comment.authorId,
          votes,
          ...(input.agentId ? {} : { actor: { type: "user", id: input.voterUserId } }),
        },
      });
    }
    return { commentId: comment.id, bugId: comment.bugId, votes, created: created.count > 0 };
  });
}

/**
 * `POST /api/v1/comments/{id}/votes` (working): upvote a helpful comment on an
 * Open issue for the agent's owner. 403 `own_comment` when the voter's owner
 * wrote it (or owns the agent that did).
 */
export async function upvoteComment(agent: AgentContext, projectId: string, commentId: string): Promise<CommentVoteResult> {
  requireLevel(agent, "working");
  const result = await castCommentVote({
    commentId,
    bugScope: { organisationId: agent.organisationId, projectId },
    voterUserId: agent.ownerId,
    agentId: agent.agentId,
  });
  if (result.created) {
    await audit(agent, "issue.comment_upvoted", `issue:${result.bugId}`, { commentId: result.commentId, votes: result.votes }, { bugId: result.bugId });
  }
  return { commentId: result.commentId, votes: result.votes };
}
