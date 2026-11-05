import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { hasLevel } from "@/lib/agents/levels";
import { audit } from "@/lib/agents/audit";
import { reviewerConflict, ReviewerNotIndependentError } from "@/lib/agents/independence";
import { publish } from "@/lib/agent-api/events";
import { parseIssueRef } from "@/lib/issue-ref";
import { isFormerNameOf } from "@/lib/github/former-repos";
import { parseGitHubRepoUrl, parsePullRequestUrl, sameRepo } from "@/lib/github/pull-request-url";

/**
 * Repairing a stale pull request link (#repair-pr-link).
 *
 * Some issues link a pull request under a name the repository no longer has
 * (it was renamed from Zedu-Endor/issue-tracker and zeduchat/bug-tracker to
 * emerjent/ziki), and some links are reported missing on GitHub. An
 * independent manager agent replaces the link with a pull request in the
 * project's repository, told from its URL: the one it names, or, when it names
 * none, the same number in the project's repository. Ziki never asks GitHub
 * (#pr-reports); the new link has no report yet, so an independent agent checks
 * it on GitHub and reports it before anything that needs its state.
 *
 * Judgements (`TestVerdict`) and merge reviews count only on the linked pull
 * request. When the new link is the same pull request moved (the old link's
 * repository is a former name of this one, `FORMER_REPOSITORY_NAMES`, or this
 * repository, and the number is the same), they, the delivery and any review
 * offers move with it and keep counting. When it is a different pull request,
 * they stay on the old address and stop counting: nobody judged the new code.
 */

export const repairPullRequestSchema = z
  .object({
    /** The pull request to link. Defaults to the old link's number in the project's repository. */
    pullRequestUrl: z.string().trim().min(1).max(2048).optional(),
    projectId: z.string().trim().min(1).max(191).optional(),
  })
  .strict();

export type RepairPullRequestInput = z.infer<typeof repairPullRequestSchema>;

export type RepairError =
  | "insufficient_level"
  | "invalid_url"
  | "not_found"
  | "not_independent"
  | "no_pull_request"
  | "no_repo"
  | "wrong_repository"
  | "already_current"
  | "status_changed";

export type RepairResult =
  | {
      status: 200;
      body: {
        repaired: true;
        issueId: string;
        previousPullRequestUrl: string;
        pullRequestUrl: string;
        pullRequestHeadSha: string | null;
        /** True when it is the same pull request under the repository's current name. */
        samePullRequest: boolean;
        /** Entries moved to the new address with it (zero for a different pull request). */
        moved: { judgements: number; mergeReviews: number; deliveries: number; reviewOffers: number };
      };
    }
  | { status: 403 | 404 | 409 | 422; body: { error: RepairError; message: string } };

const fail = (status: 403 | 404 | 409 | 422, error: RepairError, message: string): RepairResult =>
  ({ status, body: { error, message } });

/** Replace issue `issueRef`'s linked pull request with one in the project's repository. */
export async function repairPullRequestLink(
  agent: AgentContext,
  scope: { tenantId: string; projectId: string },
  issueRef: string,
  input: Omit<RepairPullRequestInput, "projectId">,
): Promise<RepairResult> {
  if (!hasLevel(agent.level, "manager")) {
    return fail(403, "insufficient_level", "Only a manager or merger agent can repair a pull request link.");
  }
  const named = input.pullRequestUrl === undefined ? null : parsePullRequestUrl(input.pullRequestUrl);
  if (input.pullRequestUrl !== undefined && !named) return fail(422, "invalid_url", "That is not a GitHub pull request URL.");

  const ref = parseIssueRef(issueRef);
  const bug = await prisma.bug.findFirst({
    where: { ...scope, isDeleted: false, ...(ref.kind === "number" ? { number: ref.number } : { id: ref.id }) },
    select: {
      id: true,
      status: true,
      pullRequestUrl: true,
      pullRequestLinkedAt: true,
      pullRequestHeadSha: true,
      reporterId: true,
      beneficiaryUserId: true,
      assigneeId: true,
      createdByAgent: { select: { ownerUserId: true } },
      project: { select: { repoUrl: true } },
      claims: {
        select: { status: true, releasedAt: true, beneficiaryUserId: true, agentId: true, dispatcherUserId: true, agent: { select: { ownerUserId: true } } },
      },
    },
  });
  if (!bug) return fail(404, "not_found", "No such issue in this project.");

  const conflict = reviewerConflict({ id: agent.agentId, ownerUserId: agent.ownerId }, bug);
  if (conflict) return fail(403, "not_independent", new ReviewerNotIndependentError(conflict).message);

  const previous = bug.pullRequestUrl;
  if (!previous) return fail(409, "no_pull_request", "This issue has no linked pull request to repair.");

  const repo = parseGitHubRepoUrl(bug.project?.repoUrl);
  if (!repo) return fail(422, "no_repo", "This project has no GitHub repository set, so a pull request link can't be checked against it.");

  const old = parsePullRequestUrl(previous);
  const target = named ?? (old ? { owner: repo.owner, repo: repo.repo, number: old.number } : null);
  if (!target) {
    return fail(422, "invalid_url", "The linked address is not a GitHub pull request. Name the pull request to link (pullRequestUrl).");
  }
  if (!sameRepo(target, repo)) return fail(422, "wrong_repository", "That pull request is not in this project's repository.");

  // The canonical address: the project's own spelling of its repository.
  const next = `https://github.com/${repo.owner}/${repo.repo}/pull/${target.number}`;
  if (next === previous) return fail(409, "already_current", "The issue already links that pull request.");

  // The same pull request moved: same number, under a former name of this
  // repository (or this one, spelled differently).
  const samePullRequest = Boolean(old && old.number === target.number && (sameRepo(old, repo) || isFormerNameOf(old, repo)));
  // The same pull request keeps the head its judgements were given on; a
  // different one's head is unknown until someone reports it.
  const headSha = samePullRequest ? bug.pullRequestHeadSha : null;

  const moved = await prisma.$transaction(async (tx) => {
    // Only from the link read above: someone may have linked another since.
    const changed = await tx.bug.updateMany({
      where: { id: bug.id, pullRequestUrl: previous },
      data: {
        pullRequestUrl: next,
        pullRequestLinkedAt: samePullRequest ? bug.pullRequestLinkedAt : new Date(),
        pullRequestHeadSha: headSha,
      },
    });
    if (changed.count !== 1) return null;
    const counts = { judgements: 0, mergeReviews: 0, deliveries: 0, reviewOffers: 0 };
    if (samePullRequest) {
      const where = { bugId: bug.id, pullRequestUrl: previous };
      const data = { pullRequestUrl: next };
      counts.judgements = (await tx.testVerdict.updateMany({ where, data })).count;
      counts.mergeReviews = (await tx.mergeReview.updateMany({ where, data })).count;
      counts.deliveries = (await tx.delivery.updateMany({ where, data })).count;
      counts.reviewOffers = (await tx.reviewOffer.updateMany({ where, data })).count;
    }
    await audit(
      agent,
      "issue.pull_request_repaired",
      `bug:${bug.id}`,
      { from: previous, to: next, samePullRequest, headSha, moved: counts },
      { bugId: bug.id, db: tx },
    );
    await publish(tx, {
      tenantId: scope.tenantId,
      type: "issue.updated",
      actorAgentId: agent.agentId,
      bugId: bug.id,
      payload: {
        issueId: bug.id,
        projectId: scope.projectId,
        changed: ["pullRequestUrl"],
        values: { pullRequestUrl: next },
        previousPullRequestUrl: previous,
        samePullRequest,
        source: "agent",
        agentId: agent.agentId,
      },
    });
    return counts;
  });
  if (!moved) return fail(409, "status_changed", "The issue's linked pull request changed while the request ran. Read it again and retry.");

  return {
    status: 200,
    body: {
      repaired: true,
      issueId: bug.id,
      previousPullRequestUrl: previous,
      pullRequestUrl: next,
      pullRequestHeadSha: headSha,
      samePullRequest,
      moved,
    },
  };
}
