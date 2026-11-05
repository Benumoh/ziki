import { refreshIssueRatings } from "@/lib/agents/profile";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/agents/audit";
import {
  assertIndependentReviewer,
  ReviewerNotIndependentError,
  type ReviewedBug,
} from "@/lib/agents/independence";
import { hasLevel } from "@/lib/agents/levels";
import type { AgentContext } from "@/lib/agents/require-agent";
import { publish } from "@/lib/agent-api/events";
import { handleTestVerdictSubmitted } from "@/lib/agent-api/review-offer";
import { parseGitHubRepoUrl } from "@/lib/github/pull-request-url";
import { prGate } from "@/lib/agent-api/pr-gate";
import { gateReport, latestPullRequestReport, notifyAuthor, type StoredPullRequestReport } from "@/lib/agent-api/pull-request-report";
import { conflictComment } from "@/lib/agent-api/merge-conflict";
import { refreshJudgedStatus } from "@/lib/agent-api/tested-status";
import { entryDescription, entryReplySelect, entrySummary, toEntryReplies, type EntryReply } from "@/lib/agent-api/entry-fields";
import { IssueApiError } from "@/lib/agent-api/errors";
import { issueIdFor, parseIssueRef } from "@/lib/issue-ref";
import { canSeeEvidenceFiles, evidenceFilesSchema, evidenceFilesView, uniqueEvidenceFiles, type EvidenceFilesView } from "@/lib/agent-api/evidence-files";

/**
 * Reviewer agents reporting whether a fix is good to merge (#434). A verdict
 * is one reviewer's opinion, not the decision: `merge.ts` accepts a fix only
 * once the issue is confirmed and the project's required reviewers say it is
 * good to merge.
 *
 * - Only `reviewer` and `merger` agents may file a verdict.
 * - The agent holding the active claim can't verdict its own fix (#432), and
 *   neither can any agent that fails `assertIndependentReviewer` (#442): same
 *   owner as the filer, the issue's own beneficiary, or the claim holder's
 *   owner.
 * - One verdict per agent per issue, so one agent can never satisfy the gate
 *   on its own. Reporting again replaces that agent's verdict (#529), so a
 *   reviewer who finds a regression can take back "good to merge" until the
 *   fix is accepted. The audit log keeps every change.
 * - A verdict is the Delivered step's entry, a judgement of the delivered work
 *   (#delivered-step): good or not good to merge, with a summary of at most
 *   two sentences and a full description (lib/agent-api/entry-fields.ts).
 *   Nobody gives a bare verdict. Replies are plain comments with
 *   `testVerdictId`. Enough independent good ones make the issue Done; enough
 *   not-good ones send it back to Open (lib/agent-api/tested-status.ts).
 * - "Good to merge" is not recorded while the latest independent report on the
 *   pull request (#pr-reports: Ziki never asks GitHub) says it is missing,
 *   closed, linked outside the project's repository, failing its checks or in
 *   conflict with its base branch (#255). The caller gets the reason and what
 *   the author has to do, and the author is told. With no report yet the
 *   tester's own check stands; the accept waits for a report. A "not good to
 *   merge" verdict is always recorded.
 * - A verdict needs a linked pull request and records which one it tested
 *   (#526), and the head commit it tested (#489). Linking a different PR means
 *   the old verdicts no longer count.
 */

export const testVerdictBodySchema = z.object({
  goodToMerge: z.boolean(),
  /** At most two sentences: is it good to merge, and the main reason. */
  summary: entrySummary,
  /** What was tested, where, and why it is (or isn't) good to merge. */
  description: entryDescription,
  /** The person the agent acts for; defaults to its owner. */
  onBehalfOfUserId: z.string().trim().min(1).max(191).optional(),
  /**
   * The changed files you judged (#confirmation-files): [{ path, lines? }].
   * Required. Other testers see them only once they have judged too.
   */
  files: evidenceFilesSchema.min(1, "files: list the changed files you judged, as [{ path, lines? }]."),
  /**
   * The head commit the reviewer tested (#489). Defaults to the SHA recorded
   * when the pull request was linked, so every verdict names its code.
   */
  headSha: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{7,64}$/i, "headSha must be a hexadecimal commit SHA.")
    .optional(),
});

export type TestVerdictBody = z.infer<typeof testVerdictBodySchema>;

/** What the independence rule and the claim-holder check need about an issue. */
const reviewedBugSelect = {
  id: true,
  title: true,
  tenantId: true,
  status: true,
  substatus: true,
  pullRequestUrl: true,
  pullRequestHeadSha: true,
  beneficiaryUserId: true,
  assigneeId: true,
  reporterId: true,
  createdByAgentId: true,
  createdByAgent: { select: { ownerUserId: true } },
  project: { select: { repoUrl: true } },
  claims: {
    select: {
      status: true,
      releasedAt: true,
      agentId: true,
      beneficiaryUserId: true,
      dispatcherUserId: true,
      agent: { select: { ownerUserId: true, name: true } },
    },
  },
} satisfies Prisma.BugSelect;

type LoadedBug = Prisma.BugGetPayload<{ select: typeof reviewedBugSelect }>;

/** The agent holding the active claim on `bug`, if any (#432). */
function activeClaimAgent(bug: LoadedBug): string | null {
  const claim = bug.claims.find((c) => c.status === "active" && !c.releasedAt);
  return claim?.agentId ?? null;
}

type StoredVerdict = {
  id: string;
  goodToMerge: boolean;
  summary: string;
  description: string;
  onBehalfOfUserId: string;
  pullRequestUrl: string | null;
  headSha: string | null;
  changedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** The 400 for a body that fails the schema, naming the field. */
function invalidVerdict(error: z.ZodError): { status: 400; error: "invalid_request"; message: string; field?: string } {
  const issue = error.issues[0];
  const field = typeof issue?.path[0] === "string" ? issue.path[0] : undefined;
  const message =
    field === "summary" && issue?.code === "invalid_type"
      ? "Add a summary."
      : field === "description" && issue?.code === "invalid_type"
        ? "Add a description of what you tested and why it is, or isn't, good to merge."
        : field === "files" && issue?.code === "invalid_type"
          ? "files: list the changed files you judged, as [{ path, lines? }]."
          : issue?.message ?? "Invalid test verdict.";
  return { status: 400, error: "invalid_request", message, ...(field ? { field } : {}) };
}

export type SubmitTestVerdictResult =
  | { status: 201; verdict: StoredVerdict }
  /** The agent had a verdict on this issue already, and it was replaced (#529). */
  | { status: 200; verdict: StoredVerdict; changed: true }
  | { status: 400; error: "invalid_request"; message: string; field?: string }
  | { status: 403; error: "insufficient_level" | "fixer_cannot_verdict" | "not_independent"; message: string }
  | { status: 404; error: "not_found"; message: string }
  | { status: 409; error: "not_delivered" | "already_verdicted" | "enough_verdicts"; message: string }
  /** "Good to merge" was not recorded because the reported pull request isn't ready (#255, #pr-reports). */
  | {
      status: 409;
      error: "not_ready";
      missing: "pull_request" | "deployment_verification" | "merge_conflict";
      message: string;
      /** What the fix's author has to do before a tester reports again. */
      todo: string;
    };

export async function submitTestVerdict(
  agent: AgentContext,
  issueRef: string,
  rawBody: unknown,
): Promise<SubmitTestVerdictResult> {
  if (!hasLevel(agent.level, "working")) {
    return {
      status: 403,
      error: "insufficient_level",
      message: "This agent can't report a test verdict.",
    };
  }

  const parsed = testVerdictBodySchema.safeParse(rawBody ?? {});
  if (!parsed.success) return invalidVerdict(parsed.error);
  const body = parsed.data;

  // #457: the path may be the readable number (`123`, `ZE-123`) or the id.
  const bugId = await issueIdFor(prisma, issueRef, agent.tenantId);
  if (!bugId) return { status: 404, error: "not_found", message: "No such issue in this agent's tenant." };
  const bug = await prisma.bug.findFirst({
    where: { id: bugId, tenantId: agent.tenantId, isDeleted: false },
    select: reviewedBugSelect,
  });
  if (!bug) return { status: 404, error: "not_found", message: "No such issue in this agent's tenant." };

  // #delivered-step: delivered work is judged at Done · Requires review, and a
  // judgement can still change at Done · Accepted (#529); before delivery, and
  // once a manager has accepted it, there is nothing to judge.
  if (bug.status !== "done" || !bug.pullRequestUrl) {
    return {
      status: 409,
      error: "not_delivered",
      message:
        "Judgements are given on delivered work: the issue must be Done · Requires review (or Done · Accepted, to change a judgement). The agent holding the claim delivers with POST /api/v1/issues/{id}/delivery.",
    };
  }
  const pullRequestUrl = bug.pullRequestUrl;
  // #489: the verdict records the commit it tested. An agent that inspected
  // a newer commit says so; otherwise the SHA recorded when the PR was linked.
  const headSha = body.headSha ?? bug.pullRequestHeadSha;

  if (activeClaimAgent(bug) === agent.agentId) {
    return {
      status: 403,
      error: "fixer_cannot_verdict",
      message: "The agent working this issue can't verdict its own fix.",
    };
  }
  try {
    assertIndependentReviewer({ id: agent.agentId, ownerUserId: agent.ownerId }, bug as ReviewedBug);
  } catch (error) {
    if (!(error instanceof ReviewerNotIndependentError)) throw error;
    return { status: 403, error: "not_independent", message: error.message };
  }

  const onBehalfOfUserId = body.onBehalfOfUserId ?? agent.ownerId;
  if (onBehalfOfUserId !== agent.ownerId) {
    const member = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: agent.tenantId, userId: onBehalfOfUserId } },
      select: { id: true },
    });
    if (!member) {
      return {
        status: 400,
        error: "invalid_request",
        message: "onBehalfOfUserId must be a member of the agent's tenant.",
        field: "onBehalfOfUserId",
      };
    }
  }

  // #727: a Done issue already has the good judgements it needs. A new "good
  // to merge" changes nothing; "not good to merge" still counts, and a
  // reviewer may still change their own judgement (#529).
  if (body.goodToMerge && bug.substatus === "accepted") {
    const own = await prisma.testVerdict.findFirst({ where: { bugId: bug.id, agentId: agent.agentId }, select: { id: true } });
    if (!own) {
      return {
        status: 409,
        error: "enough_verdicts",
        message:
          "This work is Done: it already has the good-to-merge judgements it needs and waits for a manager's review. Another good-to-merge judgement changes nothing; judge it not good to merge only if you found a real problem.",
      };
    }
  }

  // A tester only says "good to merge" about a pull request that is ready, as reported.
  if (body.goodToMerge) {
    const block = readyBlock(bug, await latestPullRequestReport(bug.id, pullRequestUrl));
    if (block) {
      // #review-entries: nothing is posted on the issue. The caller gets the
      // reason and what to do; the author is told.
      const claim = bug.claims.find((c) => c.status === "active" && !c.releasedAt);
      notifyAuthor({
        bug,
        recipientId: claim?.beneficiaryUserId ?? bug.assigneeId,
        reason: block.message,
        fromAgentName: agent.name,
      });
      return { status: 409, error: "not_ready", missing: block.missing, message: block.message, todo: block.todo };
    }
  }

  const verdictSelect = {
    id: true,
    goodToMerge: true,
    summary: true,
    description: true,
    onBehalfOfUserId: true,
    pullRequestUrl: true,
    headSha: true,
    changedAt: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.testVerdict.findFirst({
        where: { bugId: bug.id, agentId: agent.agentId },
        orderBy: { createdAt: "asc" },
        select: verdictSelect,
      });

      if (existing) {
        // #529: replace this agent's verdict. The audit row keeps the old one.
        const verdict = await tx.testVerdict.update({
          where: { id: existing.id },
          data: {
            goodToMerge: body.goodToMerge,
            summary: body.summary,
            description: body.description,
            onBehalfOfUserId,
            pullRequestUrl,
            headSha,
            files: uniqueEvidenceFiles(body.files),
            changedAt: new Date(),
          },
          select: verdictSelect,
        });
        await audit(
          agent,
          "issue.test_verdict_changed",
          `bug:${bug.id}`,
          {
            verdictId: verdict.id,
            from: { goodToMerge: existing.goodToMerge, summary: existing.summary, pullRequestUrl: existing.pullRequestUrl },
            to: { goodToMerge: body.goodToMerge, summary: body.summary, pullRequestUrl, headSha },
            onBehalfOfUserId,
          },
          { bugId: bug.id, db: tx },
        );
        await publish(tx, {
          tenantId: bug.tenantId,
          type: "issue.test_verdict",
          payload: {
            issueId: bug.id,
            verdictId: verdict.id,
            goodToMerge: body.goodToMerge,
            summary: body.summary,
            onBehalfOfUserId,
            pullRequestUrl,
            headSha,
            changed: true,
            previousGoodToMerge: existing.goodToMerge,
          },
          actorAgentId: agent.agentId,
          bugId: bug.id,
        });
        await handleTestVerdictSubmitted(tx, { bugId: bug.id, agentId: agent.agentId, tenantId: bug.tenantId, pullRequestUrl }).catch(() => null);
        return { status: 200 as const, verdict, changed: true as const };
      }

      const verdict = await tx.testVerdict.create({
        data: {
          bugId: bug.id,
          agentId: agent.agentId,
          onBehalfOfUserId,
          goodToMerge: body.goodToMerge,
          summary: body.summary,
          description: body.description,
          pullRequestUrl,
          headSha,
          files: uniqueEvidenceFiles(body.files),
        },
        select: verdictSelect,
      });

      await audit(
        agent,
        "issue.test_verdict",
        `bug:${bug.id}`,
        { verdictId: verdict.id, goodToMerge: body.goodToMerge, summary: body.summary, onBehalfOfUserId, pullRequestUrl, headSha },
        { bugId: bug.id, db: tx },
      );
      await publish(tx, {
        tenantId: bug.tenantId,
        type: "issue.test_verdict",
        payload: { issueId: bug.id, verdictId: verdict.id, goodToMerge: body.goodToMerge, summary: body.summary, onBehalfOfUserId, pullRequestUrl, headSha },
        actorAgentId: agent.agentId,
        bugId: bug.id,
      });

      await handleTestVerdictSubmitted(tx, { bugId: bug.id, agentId: agent.agentId, tenantId: bug.tenantId, pullRequestUrl }).catch(() => null);
      return { status: 201 as const, verdict };
    });
    // #delivered-step: enough independent judgements move it to Done, or back to Open.
    await refreshJudgedStatus(prisma, bug.id, agent.ownerId);
    // #agent-profile: a judgement moves the rating of whoever delivered the work.
    await refreshIssueRatings(prisma, bug.id).catch((error: unknown) => console.error("[agent-rating] refresh failed", error));
    return result;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        status: 409 as const,
        error: "already_verdicted" as const,
        message: "This agent has already reported a verdict on this issue.",
      };
    }
    throw error;
  }
}

/**
 * Why a tester can't say "good to merge" yet, by the latest independent report
 * on the pull request: it is missing, closed or linked outside the project's
 * repository, its checks are failing, or it conflicts with its base branch.
 * Null when nothing reported stops it (including when nobody reported yet).
 */
function readyBlock(
  bug: LoadedBug,
  report: StoredPullRequestReport | null,
): {
  missing: "pull_request" | "deployment_verification" | "merge_conflict";
  message: string;
  todo: string;
} | null {
  const gate = prGate(gateReport(report), {
    pullRequestUrl: bug.pullRequestUrl,
    pullRequestHeadSha: bug.pullRequestHeadSha,
    repo: parseGitHubRepoUrl(bug.project?.repoUrl),
  });
  const reason = gate.reason ?? "";
  if (gate.broken) {
    return { missing: "pull_request", message: reason, todo: "The author fixes the pull request (a new one, or a repaired link). Then judge it again." };
  }
  if (report?.state === "open" && !gate.needsReport) {
    if (report.mergeable === false) {
      const claim = bug.claims.find((c) => c.status === "active" && !c.releasedAt);
      const note = conflictComment(claim?.agent.name);
      return { missing: "merge_conflict", message: note.reason, todo: note.todo };
    }
    if (report.checks === "failing") {
      return {
        missing: "deployment_verification",
        message: reason,
        todo: "The author opens the pull request's Checks tab on GitHub, fixes whatever failed (tests, build, lint or the deployment) and pushes. Then an independent agent reports it again.",
      };
    }
  }
  return null;
}

/** One test verdict as the API and the issue page show it, with its replies. */
export type TestVerdictEntry = {
  id: string;
  agentId: string;
  agentName: string;
  onBehalfOfUserId: string;
  /** The agent's owner, for whom it tested. */
  by: string;
  goodToMerge: boolean;
  summary: string;
  description: string;
  pullRequestUrl: string | null;
  headSha: string | null;
  /** On the pull request linked now (and its head commit, when both are known). Only these count. */
  current: boolean;
  createdAt: Date;
  updatedAt: Date;
  replies: EntryReply[];
} & EvidenceFilesView;

/**
 * Who is reading, for the files rule (#confirmation-files): another tester's
 * files show once the viewer has judged the issue too; their own and
 * workspace admins always see them. Without a viewer they are hidden.
 */
export type VerdictViewer = { userId: string; admin?: boolean };

/** Every test verdict on one issue, newest first. */
export async function testVerdictEntries(
  bug: { id: string; pullRequestUrl: string | null; pullRequestHeadSha: string | null },
  viewer: VerdictViewer | null,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<TestVerdictEntry[]> {
  const rows = await db.testVerdict.findMany({
    where: { bugId: bug.id },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      agentId: true,
      onBehalfOfUserId: true,
      goodToMerge: true,
      summary: true,
      description: true,
      pullRequestUrl: true,
      headSha: true,
      files: true,
      createdAt: true,
      updatedAt: true,
      agent: { select: { name: true } },
      onBehalfOf: { select: { name: true } },
      replies: entryReplySelect,
    },
  });
  const judged = Boolean(viewer) && rows.some((row) => row.onBehalfOfUserId === viewer?.userId);
  const evidenceViewer = viewer ? { ...viewer, hasOwnEntry: judged } : null;
  return rows.map(({ agent, onBehalfOf, replies, files, ...row }) => ({
    ...row,
    ...evidenceFilesView(files, canSeeEvidenceFiles(evidenceViewer, row.onBehalfOfUserId)),
    agentName: agent.name,
    by: onBehalfOf.name ?? "A member",
    current:
      Boolean(bug.pullRequestUrl) &&
      row.pullRequestUrl === bug.pullRequestUrl &&
      (!bug.pullRequestHeadSha || !row.headSha || row.headSha === bug.pullRequestHeadSha),
    replies: toEntryReplies(replies),
  }));
}

/** GET /issues/{id}/test-results: the issue's test verdicts, each with its replies. */
export async function listTestVerdicts(scope: { tenantId: string; projectId?: string }, issueRef: string, viewer: VerdictViewer | null) {
  const ref = parseIssueRef(issueRef);
  const bug = await prisma.bug.findFirst({
    where: { ...scope, isDeleted: false, ...(ref.kind === "number" ? { number: ref.number } : { id: ref.id }) },
    select: { id: true, number: true, pullRequestUrl: true, pullRequestHeadSha: true },
  });
  if (!bug) throw new IssueApiError(404, "Issue not found.", { error: "not_found", message: "Issue not found." });
  return {
    issueId: bug.id,
    issueNumber: bug.number,
    pullRequestUrl: bug.pullRequestUrl,
    headSha: bug.pullRequestHeadSha,
    verdicts: await testVerdictEntries(bug, viewer),
  };
}
