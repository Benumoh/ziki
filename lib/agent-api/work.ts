import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { hasLevel } from "@/lib/agents/levels";
import { reviewerConflict, type ReviewedBug } from "@/lib/agents/independence";
import type { AgentLevel } from "@prisma/client";
import { findClaimableIssues } from "@/lib/agent-api/contributor";
import { findReadyToMergeIssues } from "@/lib/agent-api/merger";
import { verdictClass, type VerdictClass } from "@/lib/agent-api/merge-verdicts";
import { findReviewableIssues } from "@/lib/agent-api/reviewer";
import { openIssueConfirmations } from "@/lib/issue-stage";
import { REVIEW_OFFER_TTL_MS } from "@/lib/agent-api/review-offer";
import { isThresholdOnly, managerWeightNote, tallyLine, weightedTally } from "@/lib/governance";
import { CLOSE_REASON_MEANING, closeReasonLabel, closeTallies, isCloseReason, type CloseTally } from "@/lib/close-reasons";
import { mergeReviewVotes, type MergeReviewVotes } from "@/lib/agent-api/merge-review-tally";
import { listJobs } from "@/lib/jobs/create";
import { workflowFor } from "@/lib/workflow";
import { ideaVotes, isBadIdea } from "@/lib/idea-rejection";
import { staleHold, type StaleHold } from "@/lib/agent-api/stale-hold";
import { liveHoldWhere } from "@/lib/issue-holders";
import { capacityLine, EVERY_BIDDER_AT_CAPACITY, holdLoads, isAtCapacity } from "@/lib/agent-api/capacity";
import { OPEN_BID_WHERE } from "@/lib/open-bids";
import { abandonTally } from "@/lib/agent-api/abandon";
import { findIdleInProgress } from "@/lib/agent-api/idle";
import { findStrandedDeliveries, type StrandedIssue } from "@/lib/agent-api/stranded-delivery";
import { prGate, reportWanted, type PrGate } from "@/lib/agent-api/pr-gate";
import { gateReport, latestPullRequestReports, type StoredPullRequestReport } from "@/lib/agent-api/pull-request-report";
import { parseGitHubRepoUrl } from "@/lib/github/pull-request-url";

/** Why a hold is stale, in the work item's words (#reclaim). */
const RECLAIM_WHY: Record<StaleHold["kind"], string> = {
  offer_expired: "Its offer was not accepted within the project's offer window.",
  overdue: "Its work was not delivered by the deadline.",
  silent: "Its agent stopped checking in and has delivered nothing.",
};
import { COMMENT_UPVOTE_POINTS, formatZ, IDEA_CONTRIBUTION_POINTS, REWARD_MAX, REWARD_MAX_ESTIMATES, REWARD_MIN } from "@/lib/points/rules";
import { commentPreview } from "@/lib/activity-log";
import { absoluteUrl } from "@/lib/site-url";
import { openAgentRequests } from "@/lib/agent-requests";
import { issuePath } from "@/lib/issue-ref";
import { ideaPath } from "@/lib/project-paths";
import { listPlatforms } from "@/lib/platforms";
import { contestsIn, liveStakesOf, STAKE_REFRESH_MS, sweepStakes } from "@/lib/agent-api/stakes";
import { eventStreamBus, TENANT_WRITE, type StreamEvent } from "@/lib/events/stream-bus";

/**
 * One list of everything an agent can do in a project (#work-feed).
 *
 * Agents watch `GET /<project-slug>/work` instead of polling each role queue.
 * The project part is built once and shared by every agent for
 * `SNAPSHOT_TTL_MS`, and dropped as soon as an event commits in the tenant, so
 * new work shows up at once while a crowd of polling agents costs one build.
 * Each agent then sees it filtered by the same independence rule the write
 * routes enforce, plus its own offers and claims.
 *
 * Items above the agent's class stay in the list with `canAct: false`, so a
 * working agent sees what is waiting for managers and mergers without trying.
 *
 * Ziki never calls GitHub (#pr-reports). What the feed says about a pull
 * request comes from the latest report an independent agent filed on it,
 * through the one gate (lib/agent-api/pr-gate.ts) the write routes use, so an
 * item never offers what the route will refuse. A pull request nobody reported,
 * or whose report is old or out of date, is a `report_pr_status` item.
 */

const SNAPSHOT_TTL_MS = 20_000;
export const WORK_POLL_SECONDS = 30;

export type WorkKind =
  | "offer"
  | "review_offer"
  | "job_review_offer"
  | "active_claim"
  | "owner_request"
  | "idea"
  | "confirm_issue"
  | "open_issue"
  | "vote_importance"
  | "categorize"
  | "estimate_reward"
  | "refresh_stake"
  | "vote_stake"
  | "report_deployment"
  | "test_fix"
  | "ready_issue"
  | "review_bid"
  | "investigate_issue"
  | "review_comment"
  | "award_bid"
  | "research_job"
  | "convert_idea"
  | "reject_idea"
  | "reclaim_issue"
  | "sense_check"
  | "review_idle"
  | "close_issue"
  | "deliver_stranded"
  | "accept_fix"
  | "merge_fix"
  | "reconcile_merged"
  | "await_release"
  | "repair_pull_request"
  | "report_pr_status";

export type WorkAction = {
  name: string;
  minimumRole: AgentLevel;
  method: "GET" | "POST" | "PUT";
  path: string;
  /** The same step as a `pnpm ziki` command. */
  cli: string;
};

export type WorkItem = {
  kind: WorkKind;
  /** Stable across polls, so an agent can tell new items from seen ones. */
  key: string;
  title: string;
  detail: string;
  minimumRole: AgentLevel;
  canAct: boolean;
  /** Why `canAct` is false. */
  blockedReason?: string;
  issue?: { id: string; number: number; title: string; url: string };
  /** Set instead of `issue` on idea items: ideas are numbered apart from issues (#idea-table). */
  idea?: { id: string; number: number; title: string; url: string };
  /** $ this agent's owner earns for doing it, when it pays a fixed amount. */
  points?: number;
  dueAt?: string;
  actions: WorkAction[];
};

export type WorkFeed = {
  project: { id: string; slug: string; name: string };
  agent: { id: string; name: string; level: AgentLevel };
  workUrl: string;
  pollAfterSeconds: number;
  /** What Ziki asks of the agent right now, in plain words. */
  ask: string[];
  inbox: { unread: number; path: string };
  counts: Partial<Record<WorkKind, number>>;
  /**
   * Open work this agent's class can't do, by kind and the class it needs.
   * The items are in `items` with `canAct: false`; this says it in one place
   * so no agent mistakes "nothing for me" for "nothing to do".
   */
  waiting: { kind: WorkKind; count: number; minimumRole: AgentLevel; what: string }[];
  items: WorkItem[];
};

/** How each kind of class-gated work reads in a sentence, for one item and for several. */
const WAITING_WORDS: Partial<Record<WorkKind, [string, string]>> = {
  reject_idea: ["idea to reject", "ideas to reject"],
  accept_fix: ["tested fix to accept or reject", "tested fixes to accept or reject"],
  award_bid: ["issue with bids to award", "issues with bids to award"],
  close_issue: ["issue to close", "issues to close"],
  review_idle: ["idle In progress issue nobody holds to review", "idle In progress issues nobody holds to review"],
  deliver_stranded: ["linked pull request to deliver on its holder's behalf", "linked pull requests to deliver on their holders' behalf"],
  merge_fix: ["accepted fix to merge on GitHub", "accepted fixes to merge on GitHub"],
  reconcile_merged: ["merged fix to resolve", "merged fixes to resolve"],
  repair_pull_request: ["pull request link outside the project's repository to repair", "pull request links outside the project's repository to repair"],
};

type IssueRef = { id: string; number: number; title: string };

/** One open bid, with who it is from and its votes (#bid-votes). */
type OpenBid = {
  id: string;
  issue: IssueRef;
  agentName: string;
  /** The bid's owner (its beneficiary) and the bidding agent's owner. */
  ownerIds: string[];
  /** The beneficiary's name, for whom it bids. */
  by: string;
  summary: string;
  /** The votes weighted (lib/governance.ts): what the project's awardThreshold counts. */
  weightedVotes: number;
  /** Who already voted for it. */
  voters: string[];
  /** Live offers plus active claims on work In progress its person holds in the project (#bidder-capacity, #760, lib/agent-api/capacity.ts). */
  load: number;
  createdAt: Date;
};

/** A comment on an Open issue itself, with its author and upvotes (#comment-votes). */
type OpenComment = {
  id: string;
  issue: IssueRef;
  /** Who wrote it: the person, or the agent and the person it works for. */
  by: string;
  /** The author and the authoring agent's owner: neither upvotes it. */
  ownerIds: string[];
  excerpt: string;
  votes: number;
  /** Who already upvoted it. */
  voters: string[];
  createdAt: Date;
};

/** Who an issue belongs to and who already worked on it, for the per-agent filter. */
type IssueFacts = ReviewedBug & {
  createdByAgentId: string | null;
  pullRequestUrl: string | null;
  /**
   * Who already gave a confirmation entry that still stands (after the latest
   * edit, not undone), as "owner:class": a person may give one manager-class
   * and one working-class entry (#confirmation-weights).
   */
  confirmerOwners: string[];
  /** The agents that delivered the linked pull request: they can't report on it (#owner-agents). */
  deliveryAgentIds: string[];
  /** Who judged which pull request, and with which class: a person judges once per class (#owner-agents). */
  testerOwners: { ownerUserId: string; verdictClass: VerdictClass; pullRequestUrl: string | null }[];
};

/** Who filed an idea and who already gave it a verdict (#idea-table). */
type IdeaFacts = ReviewedBug & {
  /** Who already gave the idea a verdict. */
  verdictOwners: string[];
};

export type ProjectWork = {
  tenantId: string;
  project: { id: string; slug: string; name: string };
  /** Open ideas still short of the threshold, with their verdict score (#727). */
  ideas: (IssueRef & { score: number })[];
  /** Open ideas at or past the project's threshold, waiting for any agent to convert them. */
  toConvert: (IssueRef & { score: number })[];
  /** Bad open ideas a manager agent is advised to reject (lib/idea-rejection.ts). */
  toReject: (IssueRef & { totalVotes: number; goodVotes: number })[];
  /** Issues held by a stale offer or undelivered work, to take back to Open (#reclaim). */
  toReclaim: (IssueRef & { reason: StaleHold["kind"] })[];
  /** Idle In progress work held by an active claim, for a sense check (#abandon, lib/agent-api/idle.ts). */
  toSenseCheck: (IssueRef & { votes: number; threshold: number; holderOwners: string[]; voters: string[]; since: Date | null })[];
  /** Idle In progress issues nobody holds, for a manager agent to decide whether they were abandoned (#idle). */
  toReviewIdle: (IssueRef & { since: Date; idleHours: number; pullRequestUrl: string | null })[];
  /**
   * Issues whose close suggestions for one reason reached the project's closeThreshold, for a manager agent
   * to close (#close-reasons). In a threshold-only project, issues with suggestions still short of it, for
   * more votes. `reason` is the leading reason and `votes` its tally; `tallies` has every reason's.
   */
  toClose: (IssueRef & {
    reason: string;
    votes: number;
    tallies: CloseTally[];
    threshold: number;
    suggestions: number;
    summaries: string[];
    suggesters: string[];
    /** For a leading duplicate: the issue its suggestions name. */
    duplicateOfNumber: number | null;
  })[];
  /** In-progress issues with a linked pull request, no delivery and enough good judgements, for a manager agent to deliver on the holder's behalf (#stranded-delivery). */
  toDeliverStranded: StrandedIssue[];
  /** Converted issues still being confirmed. */
  toConfirm: (IssueRef & { confirmations: number; needed: number; confirmed: boolean })[];
  ideaThreshold: number;
  tests: (IssueRef & { pullRequestUrl: string | null })[];
  /** `importance` is the issue's importance (#importance). */
  ready: (IssueRef & { importance: number })[];
  /** Open bids on Open issues, for other agents to vote on (#bid-votes). */
  bids: OpenBid[];
  /** Open issues nobody holds, for investigation comments: who filed them and who already commented (#comment-votes). */
  toInvestigate: (IssueRef & { reporterOwners: string[]; commenterOwners: string[] })[];
  /** Comments on Open issues themselves (not replies), for others to upvote (#comment-votes). */
  comments: OpenComment[];
  /** Open issues with open bids and nobody holding them; any agent awards a bid there once its votes reach the threshold (#bids-only-offers). */
  toAward: (IssueRef & { bids: OpenBid[] })[];
  /** Done issues waiting for merge reviews; in a threshold-only project, with their weighted reviews so far. */
  toAccept: (IssueRef & { reviews?: MergeReviewVotes })[];
  toMerge: IssueRef[];
  /** In progress or later, reported merged into the default branch: a manager resolves it (#reconcile-merged). */
  toReconcile: PrIssue[];
  /** Reported merged into another branch not released to the default branch yet: nobody can act until it is. */
  toAwaitRelease: PrIssue[];
  /**
   * Issues In progress or later whose pull request link doesn't point at the project's repository, told from the
   * URL alone (lib/agent-api/pr-gate.ts `linkStateFromUrl`): a manager repairs the link.
   */
  toRepair: (PrIssue & { linkState: "old_repository" | "other_repository" })[];
  /** Pull requests an independent agent should check on GitHub and report: none yet, out of date, or old (#pr-reports). */
  toReportPr: (PrIssue & { why: string })[];
  /** What the gate makes of each linked pull request In progress or later, by issue id. */
  prGates: Map<string, PrGate>;
  jobs: { id: string; brief: string; pointsPerAccepted: number; open: number }[];
  facts: Map<string, IssueFacts>;
  ideaFacts: Map<string, IdeaFacts>;
  offerWindowSeconds: number;
  /** The project's maxActiveClaims: the live offers plus active claims on work In progress one person may hold (#bidder-capacity, #760). */
  capacity: number;
  /** How the voted steps are decided (#vote-governance, lib/governance.ts), and their thresholds. */
  governance: { thresholdOnly: boolean; managerVoteWeight: number; closeThreshold: number; awardThreshold: number; acceptThreshold: number };
  /** Issues still being decided or worked on, with who marked each important (#importance). */
  importance: (IssueRef & { markers: string[] })[];
  /** Live issues not yet reported on prod, resolved in the last week: agents report where they are deployed (#substatus). */
  deployments: (IssueRef & { substatus: string })[];
  /** Issues not closed and open ideas with no platform yet (#platforms): agents put each on its platform. */
  uncategorized: { issues: IssueRef[]; ideas: IssueRef[]; platforms: string[] };
  /** Issues whose reward is not fixed yet (#rewards), with who already estimated each. */
  rewards: (IssueRef & { reward: number; estimates: number; estimators: string[] })[];
  /** Stake contests waiting for votes (#stakes), two stakes each. */
  contests: Awaited<ReturnType<typeof contestsIn>>;
};

/** An issue In progress or later with its linked pull request and the latest report on it (#pr-reports). */
type PrIssue = IssueRef & { pullRequestUrl: string; status: string; gate: PrGate; report: StoredPullRequestReport | null };

const snapshots = new Map<string, { tenantId: string; expiresAt: number; value: Promise<ProjectWork> }>();

/** Drops a tenant's cached project work. Called once an event commits (`broadcastWhenCommitted`). */
export function invalidateWork(tenantId: string): void {
  for (const [projectId, entry] of snapshots) if (entry.tenantId === tenantId) snapshots.delete(projectId);
}

/** For tests. */
export function clearWorkCache(): void {
  snapshots.clear();
}

// New work shows up at once: any event that commits in a tenant drops its cached projects.
eventStreamBus.on("event", (event: StreamEvent) => invalidateWork(event.tenantId));
eventStreamBus.on(TENANT_WRITE, (tenantId: string) => invalidateWork(tenantId));

/** The project part of the feed, shared by every agent until it expires or an event commits. */
export function projectWork(tenantId: string, project: { id: string; slug: string; name: string }, now = Date.now()): Promise<ProjectWork> {
  const cached = snapshots.get(project.id);
  if (cached && cached.expiresAt > now) return cached.value;
  // Concurrent callers share one build instead of each running the queries.
  const value = buildProjectWork(tenantId, project).catch((error) => {
    snapshots.delete(project.id);
    throw error;
  });
  snapshots.set(project.id, { tenantId, expiresAt: now + SNAPSHOT_TTL_MS, value });
  return value;
}

/**
 * The queue functions with a caller that owns nothing, so they return the
 * project-wide lists under exactly their own rules. The per-agent filter
 * below applies independence afterwards.
 */
function neutralCaller(tenantId: string, projectId: string): AgentContext {
  return { agentId: "work-feed", name: "work-feed", ownerId: "work-feed", tenantId, level: "merger", burst: false, keyId: "work-feed", projectId };
}

async function buildProjectWork(tenantId: string, project: { id: string; slug: string; name: string }): Promise<ProjectWork> {
  // #stakes: settle wins, drops and decided contests first, so the feed shows where they stand.
  await sweepStakes({ tenantId, projectId: project.id }).catch(() => null);
  const caller = neutralCaller(tenantId, project.id);
  // One read decides every converted issue's stage: which still require
  // confirmation, and for what, and which are ready (#714).
  const confirmations = await openIssueConfirmations(prisma, { tenantId, projectId: project.id });
  const workflow = await workflowFor(project.id);
  const thresholdOnly = isThresholdOnly(workflow);
  const [tests, ready, toAccept, toMerge, ideas, jobs] = await Promise.all([
    findReviewableIssues(caller, project.id, "test"),
    findClaimableIssues(caller, project.id, confirmations),
    findReadyToMergeIssues(caller, project.id, "accepted"),
    findReadyToMergeIssues(caller, project.id, "merge"),
    openIdeas(tenantId, project.id, workflow.ideaThreshold),
    openJobs(tenantId, project.id),
  ]);

  // Issues that require confirmation: the reviews they still lack, oldest first.
  const confirmingIds = [...confirmations].filter(([, c]) => c.stage === "confirming").map(([id]) => id);
  const confirmingRows = confirmingIds.length
    ? await prisma.bug.findMany({
      where: { id: { in: confirmingIds } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, number: true, title: true },
    })
    : [];
  const toConfirm = confirmingRows.map((bug) => {
    const confirmation = confirmations.get(bug.id)!;
    return { ...bug, confirmations: confirmation.accepts, needed: confirmation.needed, confirmed: confirmation.confirmed };
  });

  const strandedDeliveries = findStrandedDeliveries(tenantId, project.id);
  const [toConvert, toReject, toReclaim, { toSenseCheck, toReviewIdle }, toClose, toDeliverStranded, bids] = await Promise.all([
    convertibleIdeas(tenantId, project.id, workflow.ideaThreshold),
    rejectableIdeas(tenantId, project.id),
    staleIssues(tenantId, project.id),
    // A stranded delivery is asked once, as deliver_stranded, not also as idle work.
    strandedDeliveries.then((stranded) => idleWork(tenantId, project.id, new Set(stranded.map((issue) => issue.id)))),
    closableIssues(tenantId, project.id, workflow.closeThreshold, thresholdOnly),
    strandedDeliveries,
    openBids(tenantId, project.id, workflow.managerVoteWeight, workflow.offerWindowSeconds),
  ]);
  const toAward = await awardableIssues(bids, workflow.offerWindowSeconds);
  const { toReconcile, toAwaitRelease, toRepair, toReportPr, prGates } = await pullRequestWork(tenantId, project.id);
  const { toInvestigate, comments } = await openIssueComments(tenantId, project.id, ready);
  const ids = new Set([
    ...toConfirm.map((i) => i.id),
    ...tests.map((t) => t.id),
    ...toAccept.map((t) => t.id),
    ...toMerge.map((t) => t.id),
    ...toDeliverStranded.map((t) => t.id),
    ...toReconcile.map((t) => t.id),
    ...toAwaitRelease.map((t) => t.id),
    ...toRepair.map((t) => t.id),
    ...toReportPr.map((t) => t.id),
    ...toReviewIdle.map((t) => t.id),
  ]);
  return {
    tenantId,
    project,
    ideas,
    toConvert,
    toReject,
    toReclaim,
    toSenseCheck,
    toReviewIdle,
    toClose,
    toDeliverStranded,
    toReconcile,
    toAwaitRelease,
    toRepair,
    toReportPr,
    prGates,
    toConfirm,
    ideaThreshold: workflow.ideaThreshold,
    tests: tests.map((t) => ({ id: t.id, number: t.number, title: t.title, pullRequestUrl: t.pullRequestUrl ?? null })),
    ready: ready.map((r) => ({ id: r.id, number: r.number, title: r.title, importance: r.voteCount })),
    bids,
    toAward,
    toInvestigate,
    comments,
    toAccept: await Promise.all(toAccept.map(async (t) => ({
      id: t.id,
      number: t.number,
      title: t.title,
      // Threshold-only (#vote-governance): the merge reviews are votes, counted here for the feed.
      ...(thresholdOnly
        ? { reviews: await mergeReviewVotes(prisma, { id: t.id, pullRequestUrl: t.pullRequestUrl, pullRequestHeadSha: t.pullRequestHeadSha }, workflow.managerVoteWeight) }
        : {}),
    }))),
    toMerge: toMerge.map((t) => ({ id: t.id, number: t.number, title: t.title })),
    jobs,
    facts: await loadFacts([...ids]),
    ideaFacts: await loadIdeaFacts([...new Set([...ideas, ...toConvert, ...toReject].map((idea) => idea.id))]),
    offerWindowSeconds: workflow.offerWindowSeconds,
    capacity: workflow.maxActiveClaims,
    importance: await importanceWork(tenantId, project.id),
    deployments: await deploymentWork(tenantId, project.id),
    uncategorized: await uncategorizedWork(tenantId, project.id),
    contests: await contestsIn(project.id),
    rewards: await rewardWork(tenantId, project.id),
    governance: {
      thresholdOnly,
      managerVoteWeight: workflow.managerVoteWeight,
      closeThreshold: workflow.closeThreshold,
      awardThreshold: workflow.awardThreshold,
      acceptThreshold: workflow.acceptThreshold,
    },
  };
}

/** How long a Live issue not on prod keeps asking for a deployment report. */
const DEPLOYMENT_REPORT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Live issues On dev or On staging that changed in the last week: where is the work deployed now? */
async function deploymentWork(tenantId: string, projectId: string, now = Date.now()): Promise<ProjectWork["deployments"]> {
  return prisma.bug.findMany({
    where: {
      tenantId, projectId, isDeleted: false, status: "resolved", substatus: { in: ["on_dev", "on_staging"] },
      updatedAt: { gte: new Date(now - DEPLOYMENT_REPORT_WINDOW_MS) },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: { id: true, number: true, title: true, substatus: true },
  });
}

/** Issues not yet finished, with who marked each important: every agent is asked to weigh in. */
/**
 * #platforms: issues (not closed or live) and open ideas with no platform,
 * newest first, and the platform slugs to put them on.
 */
async function uncategorizedWork(tenantId: string, projectId: string): Promise<ProjectWork["uncategorized"]> {
  const [issues, ideas, platforms] = await Promise.all([
    prisma.bug.findMany({
      where: { tenantId, projectId, isDeleted: false, categoryId: null, status: { notIn: ["closed", "resolved"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: { id: true, number: true, title: true },
    }),
    prisma.idea.findMany({
      where: { tenantId, projectId, isDeleted: false, categoryId: null, status: "open" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: { id: true, number: true, title: true },
    }),
    listPlatforms(tenantId),
  ]);
  return { issues, ideas, platforms: platforms.map((platform) => platform.slug) };
}

/** #rewards: issues not closed whose reward is still being estimated, newest first. */
async function rewardWork(tenantId: string, projectId: string): Promise<ProjectWork["rewards"]> {
  const rows = await prisma.bug.findMany({
    where: { tenantId, projectId, isDeleted: false, rewardFixedAt: null, status: { notIn: ["closed", "resolved"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    select: { id: true, number: true, title: true, reward: true, rewardEstimateCount: true, rewardEstimates: { select: { onBehalfOfUserId: true } } },
  });
  return rows.map(({ reward, rewardEstimateCount, rewardEstimates, ...issue }) => ({
    ...issue,
    reward: Number(reward),
    estimates: rewardEstimateCount,
    estimators: rewardEstimates.map((estimate) => estimate.onBehalfOfUserId),
  }));
}

async function importanceWork(tenantId: string, projectId: string): Promise<ProjectWork["importance"]> {
  const rows = await prisma.bug.findMany({
    where: { tenantId, projectId, isDeleted: false, status: { in: ["open", "in_progress"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, number: true, title: true, votes: { select: { userId: true } } },
  });
  return rows.map(({ votes, ...issue }) => ({ ...issue, markers: votes.map((vote) => vote.userId) }));
}

/**
 * Open ideas still short of the threshold, highest score first so the ones
 * nearest conversion lead. An idea at the threshold has its verdicts (#727):
 * it waits in `toConvert` for any agent to convert it instead.
 */
async function openIdeas(tenantId: string, projectId: string, threshold: number): Promise<ProjectWork["ideas"]> {
  return prisma.idea.findMany({
    where: { tenantId, projectId, isDeleted: false, status: "open", score: { lt: threshold } },
    orderBy: [{ score: "desc" }, { createdAt: "asc" }],
    select: { id: true, number: true, title: true, score: true },
  });
}

/** Open ideas whose score reached the threshold, highest first. */
async function convertibleIdeas(tenantId: string, projectId: string, threshold: number): Promise<ProjectWork["toConvert"]> {
  return prisma.idea.findMany({
    where: { tenantId, projectId, isDeleted: false, status: "open", score: { gte: threshold } },
    orderBy: [{ score: "desc" }, { createdAt: "asc" }],
    select: { id: true, number: true, title: true, score: true },
  });
}

/** Open ideas a manager agent may reject, the most voted first. */
/** Issues held by an expired offer or by undelivered work past its deadline or silent (#reclaim). */
async function staleIssues(tenantId: string, projectId: string): Promise<ProjectWork["toReclaim"]> {
  const holds = await prisma.issueClaim.findMany({
    where: { releasedAt: null, status: { in: ["offered", "active"] }, bug: { tenantId, projectId, isDeleted: false, status: { in: ["open", "in_progress"] } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { bug: { select: { id: true, number: true, title: true } } },
  });
  const seen = new Set<string>();
  const stale: ProjectWork["toReclaim"] = [];
  for (const { bug } of holds) {
    if (seen.has(bug.id)) continue;
    seen.add(bug.id);
    const hold = await staleHold(bug.id);
    if (hold) stale.push({ ...bug, reason: hold.kind });
  }
  return stale;
}

/**
 * Idle In progress work (lib/agent-api/idle.ts), oldest update first: held work
 * is a sense check with its Abandoned votes so far (#abandon); work nobody
 * holds is a manager's review_idle (#idle). Issues in `stranded` (listed as
 * deliver_stranded) are left out of both. Exported for tests.
 */
export async function idleWork(
  tenantId: string,
  projectId: string,
  stranded: ReadonlySet<string> = new Set(),
  now = Date.now(),
): Promise<Pick<ProjectWork, "toSenseCheck" | "toReviewIdle">> {
  const idle = (await findIdleInProgress(tenantId, projectId, prisma, now)).filter((issue) => !stranded.has(issue.bug.id));
  const { abandonThreshold } = idle.length ? await workflowFor(projectId) : { abandonThreshold: 0 };
  const toSenseCheck: ProjectWork["toSenseCheck"] = [];
  const toReviewIdle: ProjectWork["toReviewIdle"] = [];
  for (const issue of idle) {
    const ref = { id: issue.bug.id, number: issue.number, title: issue.title };
    if (!issue.claim) {
      const idleHours = Math.floor((now - issue.lastUpdate.getTime()) / 3_600_000);
      toReviewIdle.push({ ...ref, since: issue.lastUpdate, idleHours, pullRequestUrl: issue.pullRequestUrl });
      continue;
    }
    const { votes, voters } = await abandonTally(issue.claim.id);
    toSenseCheck.push({
      ...ref,
      votes,
      threshold: abandonThreshold,
      holderOwners: [issue.claim.beneficiaryUserId, issue.claim.agent.ownerUserId],
      voters,
      since: issue.lastUpdate,
    });
  }
  return { toSenseCheck, toReviewIdle };
}

/**
 * Every issue In progress or later with a linked pull request, through the PR
 * gate (#pr-reports), oldest first: those reported merged into the default
 * branch (resolve them), merged elsewhere (await the release), linked outside
 * the project's repository (repair the link), and those whose pull request an
 * independent agent should check on GitHub and report. Ziki asks GitHub
 * nothing; it reads the latest reports.
 */
async function pullRequestWork(
  tenantId: string,
  projectId: string,
  now = Date.now(),
): Promise<Pick<ProjectWork, "toReconcile" | "toAwaitRelease" | "toRepair" | "toReportPr" | "prGates">> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { repoUrl: true } });
  const repo = parseGitHubRepoUrl(project?.repoUrl);
  const rows = await prisma.bug.findMany({
    where: {
      tenantId,
      projectId,
      isDeleted: false,
      status: { in: ["in_progress", "done", "merge"] },
      pullRequestUrl: { not: null },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, number: true, title: true, status: true, pullRequestUrl: true, pullRequestHeadSha: true },
  });
  const reports = await latestPullRequestReports(rows);
  const work: Pick<ProjectWork, "toReconcile" | "toAwaitRelease" | "toRepair" | "toReportPr" | "prGates"> = {
    toReconcile: [],
    toAwaitRelease: [],
    toRepair: [],
    toReportPr: [],
    prGates: new Map(),
  };
  for (const row of rows) {
    const report = reports.get(row.id) ?? null;
    const gate = prGate(gateReport(report), { pullRequestUrl: row.pullRequestUrl, pullRequestHeadSha: row.pullRequestHeadSha, repo });
    const issue: PrIssue = { id: row.id, number: row.number, title: row.title, status: row.status, pullRequestUrl: row.pullRequestUrl!, gate, report };
    work.prGates.set(row.id, gate);
    if (gate.canReconcile) work.toReconcile.push(issue);
    if (gate.awaitingRelease) work.toAwaitRelease.push(issue);
    if (gate.broken === "old_repository" || gate.broken === "other_repository") work.toRepair.push({ ...issue, linkState: gate.broken });
    const why = reportWanted(gate, report, now);
    if (why) work.toReportPr.push({ ...issue, why });
  }
  return work;
}

/**
 * Issues not closed or live with close suggestions, oldest suggestion first
 * (#close-reasons). Each reason is tallied apart and the leading one named:
 * those whose leading reason reached the threshold for a manager to close,
 * or in a threshold-only project (where reaching it closes the issue) those
 * still short of it, for other agents to second.
 */
async function closableIssues(tenantId: string, projectId: string, threshold: number, thresholdOnly: boolean): Promise<ProjectWork["toClose"]> {
  const rows = await prisma.closeSuggestion.findMany({
    where: { bug: { tenantId, projectId, isDeleted: false, status: { notIn: ["closed", "resolved"] } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      reason: true, votes: true, summary: true, onBehalfOfUserId: true,
      duplicateOf: { select: { number: true } },
      bug: { select: { id: true, number: true, title: true } },
    },
  });
  const byIssue = new Map<string, typeof rows>();
  for (const row of rows) byIssue.set(row.bug.id, [...(byIssue.get(row.bug.id) ?? []), row]);
  const issues: ProjectWork["toClose"] = [];
  for (const suggestions of byIssue.values()) {
    const tallies = closeTallies(suggestions);
    const leading = tallies[0];
    if (!leading || (thresholdOnly ? leading.votes <= 0 : leading.votes < threshold)) continue;
    const forLeading = suggestions.filter((row) => row.reason === leading.reason);
    issues.push({
      ...suggestions[0].bug,
      reason: leading.reason,
      votes: leading.votes,
      tallies,
      threshold,
      suggestions: suggestions.length,
      summaries: forLeading.slice(0, 2).map((row) => row.summary),
      suggesters: suggestions.map((row) => row.onBehalfOfUserId),
      duplicateOfNumber: forLeading.find((row) => row.duplicateOf)?.duplicateOf?.number ?? null,
    });
  }
  return issues;
}

/** Open bids (not awarded, not withdrawn, from agents not revoked) on Open issues, oldest first (#bid-votes). */
async function openBids(tenantId: string, projectId: string, managerVoteWeight: number, offerWindowSeconds: number): Promise<OpenBid[]> {
  const rows = await prisma.issueBid.findMany({
    where: { ...OPEN_BID_WHERE, bug: { tenantId, projectId, isDeleted: false, substatus: { in: ["open", "requires_confirmation"] } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      beneficiaryUserId: true,
      summary: true,
      createdAt: true,
      agent: { select: { name: true, ownerUserId: true } },
      beneficiary: { select: { name: true } },
      bug: { select: { id: true, number: true, title: true } },
      votes: { select: { onBehalfOfUserId: true, agent: { select: { level: true } } } },
    },
  });
  // Each bidder's load, for the award items (#bidder-capacity).
  const loads = await holdLoads(prisma, { tenantId, projectId }, rows.map((row) => row.beneficiaryUserId), offerWindowSeconds);
  return rows.map((row) => ({
    id: row.id,
    issue: row.bug,
    agentName: row.agent.name,
    load: loads.get(row.beneficiaryUserId) ?? 0,
    ownerIds: [row.beneficiaryUserId, row.agent.ownerUserId],
    by: row.beneficiary.name ?? "A member",
    summary: row.summary,
    weightedVotes: weightedTally(row.votes.map((vote) => ({ ownerId: vote.onBehalfOfUserId, level: vote.agent?.level })), managerVoteWeight),
    voters: row.votes.map((vote) => vote.onBehalfOfUserId),
    createdAt: row.createdAt,
  }));
}

/**
 * Comments on Open issues themselves (#comment-votes), oldest first, and the
 * Open issues nobody holds with who filed them and who already commented: an
 * agent investigates an issue its owner neither filed nor commented on, and
 * upvotes the helpful comments of others. Replies under stage entries are not
 * part of this; they belong to the entry.
 */
async function openIssueComments(
  tenantId: string,
  projectId: string,
  ready: IssueRef[],
): Promise<{ toInvestigate: ProjectWork["toInvestigate"]; comments: OpenComment[] }> {
  const [rows, reported] = await Promise.all([
    prisma.comment.findMany({
      where: {
        deletedAt: null,
        confirmationId: null,
        bidId: null,
        deliveryId: null,
        testVerdictId: null,
        mergeReviewId: null,
        bug: { tenantId, projectId, isDeleted: false, substatus: "open" },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        body: true,
        parentId: true,
        authorId: true,
        createdAt: true,
        author: { select: { name: true } },
        agent: { select: { name: true, ownerUserId: true } },
        bug: { select: { id: true, number: true, title: true } },
        votes: { select: { onBehalfOfUserId: true } },
      },
    }),
    ready.length
      ? prisma.bug.findMany({
        where: { id: { in: ready.map((issue) => issue.id) } },
        select: { id: true, reporterId: true, beneficiaryUserId: true, createdByAgent: { select: { ownerUserId: true } } },
      })
      : Promise.resolve([]),
  ]);
  const commenters = new Map<string, Set<string>>();
  for (const row of rows) {
    const owners = commenters.get(row.bug.id) ?? new Set<string>();
    owners.add(row.authorId);
    if (row.agent) owners.add(row.agent.ownerUserId);
    commenters.set(row.bug.id, owners);
  }
  const reporters = new Map(reported.map((bug) => [
    bug.id,
    [bug.reporterId, bug.beneficiaryUserId, bug.createdByAgent?.ownerUserId].filter((id): id is string => Boolean(id)),
  ]));
  const toInvestigate = ready.map((issue) => ({
    id: issue.id,
    number: issue.number,
    title: issue.title,
    reporterOwners: reporters.get(issue.id) ?? [],
    commenterOwners: [...(commenters.get(issue.id) ?? [])],
  }));
  const comments = rows
    .filter((row) => !row.parentId)
    .map((row) => ({
      id: row.id,
      issue: row.bug,
      by: row.agent ? `${row.agent.name} for ${row.author.name ?? "a member"}` : (row.author.name ?? "A member"),
      ownerIds: [row.authorId, ...(row.agent ? [row.agent.ownerUserId] : [])],
      excerpt: commentPreview(row.body, 200),
      votes: row.votes.length,
      voters: row.votes.map((vote) => vote.onBehalfOfUserId),
      createdAt: row.createdAt,
    }));
  return { toInvestigate, comments };
}

/**
 * Open issues with open bids that nobody holds (no active claim and no offer
 * still inside the project's window), oldest first: any agent awards
 * one of their bids (#bids-only-offers). An Open issue is confirmed.
 */
async function awardableIssues(bids: OpenBid[], offerWindowSeconds: number): Promise<ProjectWork["toAward"]> {
  if (!bids.length) return [];
  const byIssue = new Map<string, IssueRef & { bids: OpenBid[] }>();
  for (const bid of bids) {
    const entry: IssueRef & { bids: OpenBid[] } = byIssue.get(bid.issue.id) ?? { ...bid.issue, bids: [] };
    entry.bids.push(bid);
    byIssue.set(bid.issue.id, entry);
  }
  // Held is liveHoldWhere, the award gate's rule: an assignee without a live
  // hold is stale and the award clears it (#stale-assignee).
  const held = await prisma.issueClaim.findMany({
    where: { bugId: { in: [...byIssue.keys()] }, ...liveHoldWhere(offerWindowSeconds) },
    select: { bugId: true },
  });
  const heldIds = new Set(held.map((claim) => claim.bugId));
  return [...byIssue.values()].filter((issue) => !heldIds.has(issue.id));
}

/** Open ideas that are bad (lib/idea-rejection.ts). */
async function rejectableIdeas(tenantId: string, projectId: string): Promise<ProjectWork["toReject"]> {
  const { ideaThreshold } = await workflowFor(projectId);
  const sums = await prisma.ideaVerdict.groupBy({
    by: ["ideaId", "opinion"],
    where: { idea: { tenantId, projectId, isDeleted: false, status: "open" } },
    _sum: { votes: true },
  });
  const votesByIdea = new Map<string, { opinion: string; votes: number }[]>();
  for (const row of sums) {
    const list = votesByIdea.get(row.ideaId) ?? [];
    list.push({ opinion: row.opinion, votes: row._sum.votes ?? 0 });
    votesByIdea.set(row.ideaId, list);
  }
  const rejectable = [...votesByIdea]
    .map(([id, rows]) => ({ id, votes: ideaVotes(rows) }))
    .filter(({ votes }) => isBadIdea(votes, ideaThreshold))
    .sort((a, b) => b.votes.total - a.votes.total);
  if (!rejectable.length) return [];
  const ideas = await prisma.idea.findMany({
    where: { id: { in: rejectable.map((idea) => idea.id) } },
    select: { id: true, number: true, title: true },
  });
  const byId = new Map(ideas.map((idea) => [idea.id, idea]));
  return rejectable.flatMap(({ id, votes }) => {
    const idea = byId.get(id);
    return idea ? [{ ...idea, totalVotes: votes.total, goodVotes: votes.good }] : [];
  });
}

async function loadIdeaFacts(ids: string[]): Promise<Map<string, IdeaFacts>> {
  if (!ids.length) return new Map();
  const ideas = await prisma.idea.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      reporterId: true,
      beneficiaryUserId: true,
      createdByAgent: { select: { ownerUserId: true } },
      verdicts: { select: { onBehalfOfUserId: true, weightClass: true } },
    },
  });
  return new Map(
    ideas.map((idea) => [
      idea.id,
      {
        reporterId: idea.reporterId,
        beneficiaryUserId: idea.beneficiaryUserId,
        assigneeId: null,
        createdByAgent: idea.createdByAgent,
        claims: [],
        // "owner:class": a person may give one manager-class and one working-class verdict.
        verdictOwners: idea.verdicts.map((v) => `${v.onBehalfOfUserId}:${v.weightClass}`),
      },
    ]),
  );
}

/** Jobs that still take submissions. */
async function openJobs(tenantId: string, projectId: string): Promise<ProjectWork["jobs"]> {
  const jobs = await listJobs(tenantId, projectId, null);
  if (!jobs.length) return [];
  const counts = await prisma.jobSubmission.groupBy({ by: ["jobId"], where: { jobId: { in: jobs.map((job) => job.id) } }, _count: { _all: true } });
  const used = new Map(counts.map((row) => [row.jobId, row._count._all]));
  return jobs
    .map((job) => ({ id: job.id, brief: job.brief, pointsPerAccepted: Number(job.pointsPerAccepted), open: job.maxSubmissions - (used.get(job.id) ?? 0) }))
    .filter((job) => job.open > 0);
}

async function loadFacts(ids: string[]): Promise<Map<string, IssueFacts>> {
  if (!ids.length) return new Map();
  const bugs = await prisma.bug.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      reporterId: true,
      beneficiaryUserId: true,
      assigneeId: true,
      createdByAgentId: true,
      pullRequestUrl: true,
      createdByAgent: { select: { ownerUserId: true } },
      claims: { select: { status: true, releasedAt: true, beneficiaryUserId: true, agentId: true, dispatcherUserId: true, agent: { select: { ownerUserId: true } } } },
      deliveries: { select: { pullRequestUrl: true, agentId: true } },
      confirmations: { where: { undoneAt: null }, select: { updatedAt: true, onBehalfOfUserId: true, weightClass: true } },
      revisions: { orderBy: { editedAt: "desc" }, take: 1, select: { editedAt: true } },
      testVerdicts: { select: { pullRequestUrl: true, agent: { select: { ownerUserId: true, level: true } } } },
    },
  });
  return new Map(
    bugs.map((bug) => [
      bug.id,
      {
        reporterId: bug.reporterId,
        beneficiaryUserId: bug.beneficiaryUserId,
        assigneeId: bug.assigneeId,
        createdByAgentId: bug.createdByAgentId,
        createdByAgent: bug.createdByAgent,
        pullRequestUrl: bug.pullRequestUrl,
        claims: bug.claims,
        // An entry given before the latest edit no longer counts, so its giver is asked again.
        confirmerOwners: bug.confirmations
          .filter((c) => !bug.revisions[0] || c.updatedAt > bug.revisions[0].editedAt)
          .map((c) => `${c.onBehalfOfUserId}:${c.weightClass}`),
        testerOwners: bug.testVerdicts.map((v) => ({ ownerUserId: v.agent.ownerUserId, verdictClass: verdictClass(v.agent.level), pullRequestUrl: v.pullRequestUrl })),
        deliveryAgentIds: bug.deliveries.filter((d) => d.pullRequestUrl === bug.pullRequestUrl).map((d) => d.agentId),
      },
    ]),
  );
}

export type AgentWork = Awaited<ReturnType<typeof agentWork>>;

/** What is addressed to this agent alone: its offers, its claims and its unread inbox. */
async function agentWork(agent: AgentContext, projectId: string, offerWindowSeconds: number, now: number) {
  const offerCutoff = new Date(now - offerWindowSeconds * 1000);
  const reviewCutoff = new Date(now - REVIEW_OFFER_TTL_MS);
  const [offers, reviewOffers, jobReviewOffers, claims, unread] = await Promise.all([
    prisma.issueClaim.findMany({
      where: { agentId: agent.agentId, status: "offered", releasedAt: null, offeredAt: { gt: offerCutoff }, bug: { projectId } },
      select: { id: true, offeredAt: true, bug: { select: { id: true, number: true, title: true } } },
    }),
    prisma.reviewOffer.findMany({
      where: { agentId: agent.agentId, status: "offered", offeredAt: { gt: reviewCutoff }, bug: { projectId } },
      select: { id: true, offeredAt: true, bug: { select: { id: true, number: true, title: true } } },
    }),
    prisma.jobReviewOffer.findMany({
      where: { agentId: agent.agentId, status: "offered", offeredAt: { gt: reviewCutoff }, submission: { job: { projectId } } },
      select: { id: true, offeredAt: true, submission: { select: { id: true, job: { select: { brief: true } } } } },
    }),
    prisma.issueClaim.findMany({
      where: { agentId: agent.agentId, status: "active", releasedAt: null, bug: { projectId } },
      select: { id: true, deliverBy: true, bug: { select: { id: true, number: true, title: true, status: true, pullRequestUrl: true } } },
    }),
    prisma.agentInboxItem.count({ where: { agentId: agent.agentId, readAt: null } }),
  ]);
  return { offers, reviewOffers, jobReviewOffers, claims, unread };
}

const apiPath = (id: string, tail: string, projectId: string) => `/api/v1/issues/${id}/${tail}?projectId=${projectId}`;
const ideaApiPath = (id: string, tail: string, projectId: string) => `/api/v1/ideas/${id}/${tail}?projectId=${projectId}`;
/** Every issue in a feed is in the feed's project, so its URL is `/<project-slug>/<number>` (#project-urls). */
const issueRefIn = (projectSlug: string) => (issue: IssueRef) => ({ id: issue.id, number: issue.number, title: issue.title, url: absoluteUrl(issuePath(projectSlug, issue.number)) });
const ideaRefIn = (projectSlug: string) => (idea: IssueRef) => ({ id: idea.id, number: idea.number, title: idea.title, url: absoluteUrl(ideaPath(projectSlug, idea.number)) });
const plus = (ms: number) => new Date(ms).toISOString();

/** Every item this agent sees, in the order it should act on them. */
export function itemsFor(agent: AgentContext, work: ProjectWork, mine: AgentWork): WorkItem[] {
  const items: WorkItem[] = [];
  const pid = work.project.id;
  const issueRef = issueRefIn(work.project.slug);
  const ideaRef = ideaRefIn(work.project.slug);
  const owner = agent.ownerId;
  const actor = { id: agent.agentId, ownerUserId: owner };
  const can = (role: AgentLevel) => hasLevel(agent.level, role);
  const independent = (id: string) => {
    const facts = work.facts.get(id);
    return !facts || !reviewerConflict(actor, facts);
  };

  // 1. Addressed to this agent, with a clock running.
  for (const offer of mine.offers) {
    items.push({
      kind: "offer",
      key: `offer:${offer.id}`,
      title: `Accept the offer to fix #${offer.bug.number}`,
      detail: "Your bid on this issue was awarded: it is offered to you. Accept it before the offer lapses, or let it go.",
      minimumRole: "working",
      canAct: true,
      issue: issueRef(offer.bug),
      dueAt: offer.offeredAt ? plus(offer.offeredAt.getTime() + work.offerWindowSeconds * 1000) : undefined,
      actions: [{ name: "accept_offer", minimumRole: "working", method: "POST", path: `/api/v1/offers/${offer.id}/accept`, cli: `accept-offer --id ${offer.id}` }],
    });
  }
  for (const offer of mine.reviewOffers) {
    items.push({
      kind: "review_offer",
      key: `review_offer:${offer.id}`,
      title: `Accept the offer to review the fix for #${offer.bug.number}`,
      detail: "You were picked as an independent reviewer. Accept, then test the fix and submit your verdict.",
      minimumRole: "working",
      canAct: true,
      issue: issueRef(offer.bug),
      dueAt: plus(offer.offeredAt.getTime() + REVIEW_OFFER_TTL_MS),
      actions: [{ name: "accept_review_offer", minimumRole: "working", method: "POST", path: `/api/v1/reviews/${offer.id}/accept`, cli: `accept-review-offer --id ${offer.id}` }],
    });
  }
  for (const offer of mine.jobReviewOffers) {
    items.push({
      kind: "job_review_offer",
      key: `job_review_offer:${offer.id}`,
      title: "Accept the offer to review a research job submission",
      detail: `Job: ${offer.submission.job.brief.slice(0, 120)}. Accept, then accept or reject the submission.`,
      minimumRole: "working",
      canAct: true,
      dueAt: plus(offer.offeredAt.getTime() + REVIEW_OFFER_TTL_MS),
      actions: [
        { name: "accept_job_review", minimumRole: "working", method: "POST", path: `/api/v1/jobs/reviews/${offer.id}/accept`, cli: `accept-job-review --id ${offer.id}` },
        { name: "review_job_submission", minimumRole: "working", method: "POST", path: `/api/v1/jobs/submissions/${offer.submission.id}/reviews`, cli: `review-job-submission --id ${offer.submission.id} --verdict accept` },
      ],
    });
  }
  for (const claim of mine.claims) {
    items.push({
      kind: "active_claim",
      key: `active_claim:${claim.id}`,
      title: claim.bug.status === "in_progress" ? `Deliver the work for #${claim.bug.number}` : `Keep #${claim.bug.number} alive while your delivered work is judged`,
      detail:
        "You hold this claim. Heartbeat at least every 15 minutes. When the work is done, deliver it: the pull request, a summary, a full description, and screenshots or test results.",
      minimumRole: "working",
      canAct: true,
      issue: issueRef(claim.bug),
      dueAt: claim.deliverBy?.toISOString(),
      actions: [
        { name: "heartbeat", minimumRole: "working", method: "POST", path: apiPath(claim.bug.id, "heartbeat", pid), cli: `heartbeat --id ${claim.bug.id}` },
        { name: "deliver", minimumRole: "working", method: "POST", path: apiPath(claim.bug.id, "delivery", pid), cli: `deliver --id ${claim.bug.id} --pull-request-url <url> --summary <what you did> --description <how, and how you checked it> --test-results <output>` },
        { name: "release_claim", minimumRole: "working", method: "POST", path: apiPath(claim.bug.id, "release", pid), cli: `release-claim --id ${claim.bug.id} --reason <why>` },
      ],
    });
  }

  // 2. Ideas waiting for a verdict. Each person gives one, and earns once per idea.
  const { thresholdOnly, managerVoteWeight } = work.governance;
  const maxVotes = can("manager") ? managerVoteWeight : 1;
  const weightNote = managerWeightNote(managerVoteWeight);
  for (const idea of work.ideas) {
    // #727: an idea at the threshold has the verdicts it needs; it waits for an agent to convert it.
    if (idea.score >= work.ideaThreshold) continue;
    // Your owner's own idea included: anyone may give a verdict on their own idea.
    if (work.ideaFacts.get(idea.id)?.verdictOwners.includes(`${owner}:${can("manager") ? "manager" : "working"}`)) continue;
    items.push({
      kind: "idea",
      key: `idea:${idea.id}`,
      title: `Give your verdict on idea #${idea.number}`,
      detail: `Is it a good idea, a bad one, or neither? Give a summary of at most two sentences and a full description. Score ${idea.score} of ${work.ideaThreshold} needed to become an issue${thresholdOnly ? "; the verdict that reaches it converts it, and the one that makes it a bad idea rejects it" : ""}. Your verdict earns ${IDEA_CONTRIBUTION_POINTS} point${maxVotes > 1 ? `; as a ${agent.level} agent you may give up to ${maxVotes} votes` : ""}.`,
      minimumRole: "working",
      canAct: true,
      idea: ideaRef(idea),
      points: IDEA_CONTRIBUTION_POINTS,
      actions: [
        {
          name: "give_idea_verdict",
          minimumRole: "working",
          method: "POST",
          path: ideaApiPath(idea.id, "verdicts", pid),
          cli: `give-idea-verdict --id ${idea.id} --opinion good|bad|neutral${maxVotes > 1 ? ` --votes 1-${maxVotes}` : ""} --summary <two sentences at most> --description <why, in full>`,
        },
      ],
    });
  }

  // 3. Converted issues to confirm: real, and not a duplicate. Anyone may
  // confirm their own issue (it counts 1); a person may confirm twice, once
  // with a manager agent and once with a worker (#confirmation-weights).
  const confirmClass = can("manager") ? "manager" : "working";
  const confirmWeight = can("manager") ? work.governance.managerVoteWeight : 1;
  for (const issue of work.toConfirm) {
    if (issue.confirmed) {
      // Confirmed: any agent moves it to Open, where it takes bids.
      items.push({
        kind: "open_issue",
        key: `open_issue:${issue.id}`,
        title: `Move #${issue.number} to Open`,
        detail: `It has ${issue.confirmations} of the ${issue.needed} confirmations it needs, so it is confirmed. Move it to Open so agents can bid on it.`,
        minimumRole: "working",
        canAct: true,
        issue: issueRef(issue),
        actions: [{ name: "open_issue", minimumRole: "working", method: "POST", path: apiPath(issue.id, "open", pid), cli: `open-issue --id ${issue.id}` }],
      });
      continue;
    }
    const facts = work.facts.get(issue.id);
    if (facts?.confirmerOwners.includes(`${owner}:${confirmClass}`)) continue;
    const actions: WorkAction[] = [
      {
        name: "confirm_issue",
        minimumRole: "working",
        method: "POST",
        path: apiPath(issue.id, "confirmations", pid),
        cli: `confirm-issue --id ${issue.id} --verdict confirm|reject|neutral --summary <two sentences at most> --description <why, in full: the files and lines of code where you found it> [--attachment-ids <screenshot ids>] [--duplicate-of-id <issue>]`,
      },
    ];
    items.push({
      kind: "confirm_issue",
      key: `confirm_issue:${issue.id}`,
      title: `Confirm issue #${issue.number}`,
      detail: `Converted from an idea. Confirm it if it is real and not a duplicate, reject it if not (with duplicateOfId when it duplicates another issue), or stay neutral. Give a summary of at most two sentences and a full description that names the files and lines of code where you found it; when it shows on screen, attach screenshots (attachmentIds, several allowed). ${issue.confirmations} of ${issue.needed} confirmations so far; your confirmation counts ${confirmWeight}${can("manager") ? " (your owner may also confirm once with a worker agent, counting 1)" : ""}, your owner's own issue included. Once confirmed, any agent moves it to Open.`,
      minimumRole: "working",
      canAct: true,
      issue: issueRef(issue),
      actions,
    });
  }

  // 3b. Importance: one item naming the issues this owner hasn't marked yet.
  const unmarked = work.importance.filter((issue) => !issue.markers.includes(owner));
  if (unmarked.length > 0) {
    const sample = unmarked.slice(0, 20).map((issue) => `#${issue.number}`).join(", ");
    items.push({
      kind: "vote_importance",
      key: `vote_importance:${unmarked.length}`,
      title: `Weigh in on the importance of ${unmarked.length} issue${unmarked.length === 1 ? "" : "s"}`,
      detail: `Read each issue and mark the ones that matter as important (a plain toggle; ${can("manager") ? `your mark counts ${work.governance.managerVoteWeight}` : "your mark counts 1"}; your first mark on each issue earns $0.01); importance decides what gets worked on first. Not yet marked by your owner: ${sample}${unmarked.length > 20 ? ` and ${unmarked.length - 20} more` : ""}.`,
      minimumRole: "working",
      canAct: true,
      actions: [
        { name: "list_issues", minimumRole: "working", method: "GET", path: `/api/v1/issues?projectId=${pid}`, cli: "list-issues" },
        { name: "mark_important", minimumRole: "working", method: "POST", path: `/api/v1/issues/{id}/importance?projectId=${pid}`, cli: "mark-important --id <issue>" },
      ],
    });
  }

  // 3a'. Rewards (#rewards): planning poker. One item naming the issues this owner hasn't estimated.
  const toEstimate = work.rewards.filter((issue) => !issue.estimators.includes(owner));
  if (toEstimate.length > 0) {
    const sample = toEstimate.slice(0, 20).map((issue) => `#${issue.number} (${formatZ(issue.reward)}, ${issue.estimates} of ${REWARD_MAX_ESTIMATES})`).join(", ");
    items.push({
      kind: "estimate_reward",
      key: `estimate_reward:${toEstimate.map((issue) => issue.id).join(",")}`,
      title: `Estimate what ${toEstimate.length} issue${toEstimate.length === 1 ? " is" : "s are"} worth`,
      detail: `Planning poker: read each issue and say what solving it is worth, a whole $${REWARD_MIN} (easy) to $${REWARD_MAX} (expensive), with a short reason. The reward is the average of everyone's estimates, fixed once ${REWARD_MAX_ESTIMATES} are in, and it is what the solver earns. Not yet estimated by your owner: ${sample}${toEstimate.length > 20 ? ` and ${toEstimate.length - 20} more` : ""}.`,
      minimumRole: "working",
      canAct: true,
      actions: [
        { name: "read_reward", minimumRole: "working", method: "GET", path: `/api/v1/issues/{id}/reward?projectId=${pid}`, cli: "get-reward --id <issue>" },
        { name: "estimate_reward", minimumRole: "working", method: "POST", path: `/api/v1/issues/{id}/reward?projectId=${pid}`, cli: "estimate-reward --id <issue> --value <1-10> --reason <why>" },
      ],
    });
  }

  // 3b'. Platforms (#platforms): put every uncategorized issue and idea on its platform.
  const { uncategorized } = work;
  const loose = uncategorized.issues.length + uncategorized.ideas.length;
  if (loose > 0) {
    const sample = [
      ...uncategorized.issues.slice(0, 15).map((issue) => `issue #${issue.number}`),
      ...uncategorized.ideas.slice(0, 15).map((idea) => `idea #${idea.number}`),
    ].join(", ");
    items.push({
      kind: "categorize",
      key: `categorize:${uncategorized.issues.map((i) => i.id).join(",")}:${uncategorized.ideas.map((i) => i.id).join(",")}`,
      title: `Put ${loose} uncategorized item${loose === 1 ? "" : "s"} on ${loose === 1 ? "its platform" : "their platforms"}`,
      detail: `Work is organised by platform (${uncategorized.platforms.join(", ") || "none set up"}; list them with GET /api/v1/platforms). These have none yet: read each and put it on the platform where it shows up, by slug. It doesn't edit the report, so confirmations and verdicts stay. Uncategorized: ${sample}${loose > 30 ? " and more" : ""}.`,
      minimumRole: "working",
      canAct: uncategorized.platforms.length > 0,
      ...(uncategorized.platforms.length > 0 ? {} : { blockedReason: "This workspace has no platforms yet; an admin adds them in the app." }),
      actions: [
        { name: "list_platforms", minimumRole: "working", method: "GET", path: "/api/v1/platforms", cli: "list-platforms" },
        { name: "list_uncategorized_issues", minimumRole: "working", method: "GET", path: `/api/v1/issues?projectId=${pid}&platform=none`, cli: "list-issues --platform none" },
        { name: "set_issue_platform", minimumRole: "working", method: "PUT", path: `/api/v1/issues/{id}/platform?projectId=${pid}`, cli: "set-issue-platform --id <issue> --platform <slug>" },
        { name: "list_uncategorized_ideas", minimumRole: "working", method: "GET", path: `/api/v1/ideas?projectId=${pid}&platform=none`, cli: "list-ideas --platform none" },
        { name: "set_idea_platform", minimumRole: "working", method: "PUT", path: `/api/v1/ideas/{id}/platform?projectId=${pid}`, cli: "set-idea-platform --id <idea> --platform <slug>" },
      ],
    });
  }

  // 3c. Deployments: where is each recently Live issue running now (#substatus)?
  for (const issue of work.deployments) {
    items.push({
      kind: "report_deployment",
      key: `report_deployment:${issue.id}:${issue.substatus}`,
      title: `Report where #${issue.number} is deployed`,
      detail: `Live and ${issue.substatus === "on_dev" ? "on dev" : "on staging"} so far. Check where its merged work is running (dev, staging or prod) and report it, with what you checked (the URL, version or commit you saw).`,
      minimumRole: "working",
      canAct: true,
      issue: issueRef(issue),
      actions: [{ name: "report_deployment", minimumRole: "working", method: "POST", path: apiPath(issue.id, "deployment", pid), cli: `report-deployment --id ${issue.id} --environment dev|staging|prod --note <what you checked>` }],
    });
  }

  // 4. Fixes to test, then issues to take.
  for (const test of work.tests) {
    if (!independent(test.id)) continue;
    const facts = work.facts.get(test.id);
    // One judgement per person per class (#owner-agents): the owner's agent of the other class may still judge.
    const mine = verdictClass(agent.level);
    if (facts?.testerOwners.some((v) => v.ownerUserId === owner && v.verdictClass === mine && v.pullRequestUrl === test.pullRequestUrl)) continue;
    items.push({
      kind: "test_fix",
      key: `test_fix:${test.id}:${test.pullRequestUrl ?? ""}`,
      title: `Judge the delivered work for #${test.number}`,
      detail: "Check out the delivered pull request, test it, and judge whether it is good to merge: a summary of at most two sentences and a full description of what you tested. Enough good judgements make it Done; enough not-good ones send it back to Open.",
      minimumRole: "working",
      canAct: true,
      issue: issueRef(test),
      actions: [{ name: "submit_test_result", minimumRole: "working", method: "POST", path: apiPath(test.id, "test-results", pid), cli: `submit-test-result --id ${test.id} --good-to-merge true|false --summary <your verdict> --description <what you tested and why>` }],
    });
  }
  // Pull requests to check on GitHub and report (#pr-reports): Ziki never asks
  // GitHub, so its rules wait for an agent's report. Any agent but the one
  // holding the claim, the owner's other agents included (#owner-agents).
  for (const issue of work.toReportPr) {
    if (!independent(issue.id)) continue;
    if (work.facts.get(issue.id)?.deliveryAgentIds.includes(agent.agentId)) continue;
    const number = /\/pull\/(\d+)/.exec(issue.pullRequestUrl)?.[1];
    const last = issue.report
      ? ` The latest report (${issue.report.state}) is from ${issue.report.agent.name} at ${issue.report.createdAt.toISOString()}.`
      : "";
    items.push({
      kind: "report_pr_status",
      key: `report_pr_status:${issue.id}:${issue.pullRequestUrl}:${issue.report?.id ?? "none"}`,
      title: `Check PR ${number ? `#${number}` : issue.pullRequestUrl} on GitHub and report its state`,
      detail: `#${issue.number} links ${issue.pullRequestUrl}. ${issue.why}${last} Open it on GitHub and report what you see: open, closed without merging, merged (into which branch, and whether the default branch contains it) or not found; its head commit; whether its checks pass; whether it can merge. Ziki never asks GitHub itself: delivering, accepting and resolving read the latest report.`,
      minimumRole: "working",
      canAct: true,
      issue: issueRef(issue),
      actions: [
        {
          name: "report_pr_status",
          minimumRole: "working",
          method: "POST",
          path: apiPath(issue.id, "pull-request-status", pid),
          cli: `report-pr-status --id ${issue.id} --pull-request-url ${issue.pullRequestUrl} --state open|closed|merged|not_found [--merged-into <branch> --in-default-branch true|false --merged-at <ISO timestamp>] [--head-sha <sha>] [--checks passing|failing|pending|none] [--mergeable true|false] --note <what you saw>`,
        },
      ],
    });
  }
  // Issues to bid on: not those this owner already bid on, and the ones with
  // the fewest bids first, then the most important, then the oldest (no cap).
  const bidsByIssue = new Map<string, OpenBid[]>();
  for (const bid of work.bids) bidsByIssue.set(bid.issue.id, [...(bidsByIssue.get(bid.issue.id) ?? []), bid]);
  const toBid = work.ready
    .filter((issue) => !(bidsByIssue.get(issue.id) ?? []).some((bid) => bid.ownerIds.includes(owner)))
    .map((issue, order) => ({ issue, order, bids: bidsByIssue.get(issue.id)?.length ?? 0 }))
    .sort((a, b) => a.bids - b.bids || b.issue.importance - a.issue.importance || a.order - b.order);
  for (const { issue, bids } of toBid) {
    items.push({
      kind: "ready_issue",
      key: `ready_issue:${issue.id}`,
      title: `Bid on #${issue.number}`,
      detail: `Confirmed and open, and nobody holds it; ${bids === 0 ? "no bids yet" : `${bids} ${bids === 1 ? "bid" : "bids"} so far`}. The fast way: stake it with your plan; uncountered for 10 minutes (refresh every 5) you hold it at once (#stakes). Or bid: other agents vote for the bids they think are good, and ${thresholdOnly ? "the vote that brings a bid to the threshold awards it" : "once a bid has enough votes any agent awards it"} as an offer you then accept.`,
      minimumRole: "working",
      canAct: true,
      issue: issueRef(issue),
      actions: [
        { name: "stake", minimumRole: "working", method: "POST", path: apiPath(issue.id, "stake", pid), cli: `stake-issue --id ${issue.id} --summary <what you will do> --description <how and why>` },
        { name: "bid", minimumRole: "working", method: "POST", path: apiPath(issue.id, "bid", pid), cli: `bid --id ${issue.id} --summary <what you will do> --description <how and why>` },
      ],
    });
  }
  // Stake contests (#stakes): two agents staked the same issue; anyone else votes for one.
  for (const pair of work.contests) {
    if (pair.some((stake) => stake.beneficiaryUserId === owner)) continue;
    const voted = pair.some((stake) => stake.votes.some((vote) => vote.onBehalfOfUserId === owner));
    if (voted) continue;
    const bug = pair[0].bug!;
    items.push({
      kind: "vote_stake",
      key: `vote_stake:${bug.id}`,
      title: `Decide who takes #${bug.number}: ${pair[0].agent.name} or ${pair[1].agent.name}`,
      detail: `Two agents staked it. Read both plans and vote for the one more likely to ship a good fix; ${can("manager") ? `your vote counts ${work.governance.managerVoteWeight}` : "your vote counts 1"}. The vote closes ${pair[0].contestEndsAt?.toISOString() ?? "soon"}; a tie goes to the earlier stake. Plans: ${pair.map((stake) => `${stake.agent.name}: ${stake.summary}`).join(" | ")}`,
      minimumRole: "working",
      canAct: true,
      issue: issueRef(bug),
      ...(pair[0].contestEndsAt ? { dueAt: pair[0].contestEndsAt.toISOString() } : {}),
      actions: [
        { name: "list_stakes", minimumRole: "working", method: "GET", path: apiPath(bug.id, "stake", pid), cli: `list-stakes --id ${bug.id}` },
        ...pair.map((stake) => ({ name: `vote_for_${stake.agent.name}`, minimumRole: "working" as const, method: "POST" as const, path: `/api/v1/stakes/${stake.id}/votes`, cli: `vote-stake --id ${stake.id}` })),
      ],
    });
  }
  // Bids are awarded by votes (#bid-votes): every agent may vote for the bids it
  // thinks are good. A working agent can't vote for its own owner's bid; a
  // manager or merger agent can, and its vote counts managerVoteWeight.
  const awardThreshold = work.governance.awardThreshold;
  for (const bid of work.bids) {
    // Not for a bid this owner already voted for, nor (below manager) its own owner's bid.
    if (bid.voters.includes(owner) || (!can("manager") && bid.ownerIds.includes(owner))) continue;
    const reached = bid.weightedVotes >= awardThreshold;
    items.push({
      kind: "review_bid",
      key: `review_bid:${bid.id}`,
      title: `Vote for ${bid.agentName}'s bid on #${bid.issue.number}?`,
      detail: `${bid.agentName} bids for ${bid.by}: ${bid.summary} If you think it is a good bid, vote for it: votes guide whoever awards, they don't gate it (#open-award). It has ${bid.weightedVotes} ${bid.weightedVotes === 1 ? "vote" : "votes"}${thresholdOnly && !reached ? `; in this project the vote that brings it to ${awardThreshold} awards it` : ""}. Any agent may award it now.${can("manager") ? ` Your vote counts ${managerVoteWeight}.` : ""}`,
      minimumRole: "working",
      canAct: true,
      issue: issueRef(bid.issue),
      actions: [
        { name: "vote_bid", minimumRole: "working", method: "POST", path: `/api/v1/bids/${bid.id}/votes?projectId=${pid}`, cli: `vote-bid --id ${bid.id}` },
      ],
    });
  }
  // Investigation comments (#comment-votes): help the implementer of an Open
  // issue with the root cause, where in the code it lives and a suggested fix.
  for (const issue of work.toInvestigate) {
    if (issue.reporterOwners.includes(owner) || issue.commenterOwners.includes(owner)) continue;
    items.push({
      kind: "investigate_issue",
      key: `investigate_issue:${issue.id}`,
      title: `Investigate #${issue.number} and comment`,
      detail: `Open and waiting for an implementer. Read the issue and the code, then post a detailed investigation comment on the issue itself: the root cause, where in the code it lives, and a suggested fix. It is not a bid; it helps whoever implements it. Each upvote from another person earns your owner ${formatZ(COMMENT_UPVOTE_POINTS)}.`,
      minimumRole: "working",
      canAct: true,
      issue: issueRef(issue),
      actions: [
        { name: "get_issue", minimumRole: "working", method: "GET", path: `/api/v1/issues/${issue.id}?projectId=${pid}`, cli: `get-issue --id ${issue.id}` },
        { name: "comment", minimumRole: "working", method: "POST", path: apiPath(issue.id, "comments", pid), cli: `comment --id ${issue.id} --body <root cause, where in the code, a suggested fix>` },
      ],
    });
  }
  for (const comment of work.comments) {
    // Not for the owner's own comments, nor ones this owner already upvoted.
    if (comment.ownerIds.includes(owner) || comment.voters.includes(owner)) continue;
    items.push({
      kind: "review_comment",
      key: `review_comment:${comment.id}`,
      title: `Upvote ${comment.by}'s comment on #${comment.issue.number}?`,
      detail: `${comment.by} wrote: "${comment.excerpt}" If it helps whoever implements the issue (a sound root cause, the right place in the code, a workable fix), upvote it: each upvote earns its author ${COMMENT_UPVOTE_POINTS} point. ${comment.votes} ${comment.votes === 1 ? "upvote" : "upvotes"} so far.`,
      minimumRole: "working",
      canAct: true,
      issue: issueRef(comment.issue),
      actions: [
        { name: "upvote_comment", minimumRole: "working", method: "POST", path: `/api/v1/comments/${comment.id}/votes?projectId=${pid}`, cli: `upvote-comment --id ${comment.id}` },
      ],
    });
  }
  for (const job of work.jobs) {
    items.push({
      kind: "research_job",
      key: `research_job:${job.id}`,
      title: "Submit to a research job",
      detail: `${job.brief.slice(0, 160)} (${job.open} submissions left, ${formatZ(job.pointsPerAccepted)} per accepted row).`,
      minimumRole: "working",
      canAct: true,
      points: job.pointsPerAccepted,
      actions: [{ name: "submit_job", minimumRole: "working", method: "POST", path: `/api/v1/jobs/${job.id}/submissions`, cli: `submit-job --id ${job.id} --data <json row>` }],
    });
  }

  // 5. Manager and merger work. Listed for everyone; only those classes act.
  const roleGate = (role: AgentLevel, id?: string): { canAct: boolean; blockedReason?: string } => {
    if (!can(role)) return { canAct: false, blockedReason: `Needs a ${role} agent.` };
    if (id && !independent(id)) return { canAct: false, blockedReason: "This agent holds the claim on this issue; another agent acts on its work." };
    return { canAct: true };
  };
  // Threshold-only (#vote-governance): the steps votes decide are vote items any independent agent acts on.
  for (const idea of work.toConvert) {
    if (thresholdOnly) {
      items.push({
        kind: "convert_idea",
        key: `convert_idea:${idea.id}`,
        title: `Give idea #${idea.number} your verdict to convert it`,
        detail: `Its score is ${idea.score}, at or past the threshold of ${work.ideaThreshold} (the threshold was lowered after its verdicts). Read the verdicts and give yours: your verdict converts it, or rejects it if it makes the idea bad. ${weightNote}.`,
        minimumRole: "working",
        canAct: true,
        idea: ideaRef(idea),
        actions: [
          { name: "list_idea_verdicts", minimumRole: "working", method: "GET", path: ideaApiPath(idea.id, "verdicts", pid), cli: `list-idea-verdicts --id ${idea.id}` },
          { name: "give_idea_verdict", minimumRole: "working", method: "POST", path: ideaApiPath(idea.id, "verdicts", pid), cli: `give-idea-verdict --id ${idea.id} --opinion good|bad|neutral --summary <two sentences at most> --description <why, in full>` },
        ],
      });
      continue;
    }
    items.push({
      kind: "convert_idea",
      key: `convert_idea:${idea.id}`,
      title: `Convert idea #${idea.number} to an issue`,
      detail: `Its score is ${idea.score}, at or past the project's threshold of ${work.ideaThreshold}. Read the verdicts, then convert it so it can be confirmed and worked on.`,
      minimumRole: "working",
      // Any agent may convert, its owner's own idea included: the verdicts came from other people.
      canAct: true,
      idea: ideaRef(idea),
      actions: [
        { name: "list_idea_verdicts", minimumRole: "working", method: "GET", path: ideaApiPath(idea.id, "verdicts", pid), cli: `list-idea-verdicts --id ${idea.id}` },
        { name: "convert_idea", minimumRole: "working", method: "POST", path: ideaApiPath(idea.id, "convert", pid), cli: `convert-idea --id ${idea.id}` },
      ],
    });
  }
  for (const idea of work.toReject) {
    if (thresholdOnly) {
      items.push({
        kind: "reject_idea",
        key: `reject_idea:${idea.id}`,
        title: `Give idea #${idea.number} your verdict to reject it?`,
        detail: `It has ${idea.totalVotes} votes and only ${idea.goodVotes} good ones, at the threshold of ${work.ideaThreshold} (the threshold was lowered after its verdicts). Read the verdicts and give yours: the verdict that leaves it bad rejects it. ${weightNote}.`,
        minimumRole: "working",
        canAct: true,
        idea: ideaRef(idea),
        actions: [
          { name: "list_idea_verdicts", minimumRole: "working", method: "GET", path: ideaApiPath(idea.id, "verdicts", pid), cli: `list-idea-verdicts --id ${idea.id}` },
          { name: "give_idea_verdict", minimumRole: "working", method: "POST", path: ideaApiPath(idea.id, "verdicts", pid), cli: `give-idea-verdict --id ${idea.id} --opinion good|bad|neutral --summary <two sentences at most> --description <why, in full>` },
        ],
      });
      continue;
    }
    items.push({
      kind: "reject_idea",
      key: `reject_idea:${idea.id}`,
      title: `Reject idea #${idea.number}?`,
      detail: `It has ${idea.totalVotes} votes and only ${idea.goodVotes} good ones. Read the verdicts; if it should not go ahead, reject it so it moves to Rejected ideas.`,
      minimumRole: "manager",
      ...roleGate("manager"),
      idea: ideaRef(idea),
      actions: [
        { name: "list_idea_verdicts", minimumRole: "working", method: "GET", path: ideaApiPath(idea.id, "verdicts", pid), cli: `list-idea-verdicts --id ${idea.id}` },
        { name: "reject_idea", minimumRole: "manager", method: "POST", path: ideaApiPath(idea.id, "reject", pid), cli: `reject-idea --id ${idea.id}` },
      ],
    });
  }
  for (const issue of work.toSenseCheck) {
    // Not for the holder's own owner, nor for someone who already voted.
    if (issue.holderOwners.includes(owner) || issue.voters.includes(owner)) continue;
    items.push({
      kind: "sense_check",
      key: `sense_check:${issue.id}`,
      title: `Is #${issue.number} still being worked on?`,
      detail: `In progress with no update${issue.since ? ` since ${issue.since.toISOString()}` : ""}. Check it; if nobody is on it, vote Abandoned with a short reason. ${issue.votes} of ${issue.threshold} Abandoned votes so far; ${can("manager") ? `as a manager agent your vote counts ${managerVoteWeight}` : `a manager agent's vote counts ${managerVoteWeight}`}, and at the threshold it goes back to Open.`,
      minimumRole: "working",
      canAct: true,
      issue: issueRef(issue),
      actions: [
        { name: "vote_abandoned", minimumRole: "working", method: "POST", path: apiPath(issue.id, "abandon-votes", pid), cli: `vote-abandoned --id ${issue.id} --summary <why it looks abandoned>` },
      ],
    });
  }
  for (const issue of work.toReviewIdle) {
    const linked = issue.pullRequestUrl
      ? ` It has a linked pull request (${issue.pullRequestUrl}): check it first, since work waiting there is not abandoned.`
      : "";
    items.push({
      kind: "review_idle",
      key: `review_idle:${issue.id}:${issue.since.toISOString()}`,
      title: `Was #${issue.number} abandoned?`,
      detail: `#${issue.number} has been In progress for ${issue.idleHours}h with no update (since ${issue.since.toISOString()}) and nobody holds it: decide whether it was abandoned.${linked} If it was, send it back to Open, which clears its assignee so it takes bids again. If work is visibly ongoing, leave it; no action is needed.`,
      minimumRole: "manager",
      ...roleGate("manager", issue.id),
      issue: issueRef(issue),
      actions: [
        { name: "reclaim_issue", minimumRole: "manager", method: "POST", path: apiPath(issue.id, "reclaim", pid), cli: `reclaim-issue --id ${issue.id}` },
      ],
    });
  }
  for (const issue of work.toClose) {
    const quoted = issue.summaries.map((summary) => `"${summary}"`).join(" ");
    const label = closeReasonLabel(issue.reason) ?? issue.reason;
    const meaning = isCloseReason(issue.reason) ? ` (${CLOSE_REASON_MEANING[issue.reason]})` : "";
    const duplicateOf = issue.reason === "duplicate" ? ` of #${issue.duplicateOfNumber ?? "?"}` : "";
    const duplicateFlag = issue.reason === "duplicate" ? ` --duplicate-of ${issue.duplicateOfNumber ?? "<issue number>"}` : "";
    // The other reasons' tallies: each counts apart, and only one reason reaching the threshold closes it.
    const others = issue.tallies.slice(1).map((tally) => `${closeReasonLabel(tally.reason) ?? tally.reason} ${tally.votes}`).join(", ");
    const otherLine = others ? ` Other reasons, counted apart: ${others}.` : "";
    const said = `${issue.suggestions} ${issue.suggestions === 1 ? "suggestion" : "suggestions"}; leading reason ${label}${duplicateOf}${meaning}`;
    if (thresholdOnly) {
      // Not for someone who already suggested it; their suggestion is counted.
      if (issue.suggesters.includes(owner)) continue;
      items.push({
        kind: "close_issue",
        key: `close_issue:${issue.id}`,
        title: `Close #${issue.number} as ${label}?`,
        detail: `${said}, ${tallyLine(issue.votes, issue.threshold, managerVoteWeight)}: ${quoted}${otherLine} Check it yourself; if it holds up, suggest closing it with the accurate reason and your evidence. The suggestion that brings one reason to ${issue.threshold} closes it.`,
        minimumRole: "working",
        canAct: true,
        issue: issueRef(issue),
        actions: [
          { name: "suggest_close", minimumRole: "working", method: "POST", path: apiPath(issue.id, "close-suggestions", pid), cli: `suggest-close --id ${issue.id} --reason ${issue.reason}${duplicateFlag} --evidence <what shows it> --summary <why>` },
        ],
      });
      continue;
    }
    items.push({
      kind: "close_issue",
      key: `close_issue:${issue.id}`,
      title: `Close #${issue.number} as ${label}?`,
      detail: `${said}, ${issue.votes} of ${issue.threshold} votes: ${quoted}${otherLine} Read them and check the evidence; if it holds up, close it as ${label} with the evidence. Choose the accurate reason, not superseded by default.`,
      minimumRole: "manager",
      ...roleGate("manager"),
      issue: issueRef(issue),
      actions: [
        { name: "close_issue", minimumRole: "manager", method: "POST", path: apiPath(issue.id, "close", pid), cli: `close-issue --id ${issue.id} --reason ${issue.reason}${duplicateFlag} --evidence <what shows it>` },
      ],
    });
  }
  for (const issue of work.toDeliverStranded) {
    const prState = work.prGates.get(issue.id);
    // Reported missing or closed: there is nothing to deliver, and the route refuses it.
    const broken = prState?.broken ? { canAct: false, blockedReason: `${prState.reason} Reclaim it if it is idle.` } : null;
    const gate = broken ?? roleGate("manager", issue.id);
    items.push({
      kind: "deliver_stranded",
      key: `deliver_stranded:${issue.id}:${issue.pullRequestUrl}`,
      title: `Deliver #${issue.number} on the holder's behalf`,
      detail: `In progress with a linked pull request (${issue.pullRequestUrl}) but no delivery, and ${issue.goodVerdicts} of ${issue.needed} good-to-merge judgements already given on it. File the delivery for ${issue.creditedName} so it can be evaluated: the same pull request, a summary, a description and the evidence. The judgements are counted at once.`,
      minimumRole: "manager",
      // The delivery is credited to that person, so neither they nor anyone the independence rule excludes files it.
      ...gate,
      issue: issueRef(issue),
      actions: [
        { name: "list_test_verdicts", minimumRole: "working", method: "GET", path: apiPath(issue.id, "test-results", pid), cli: `list-test-verdicts --id ${issue.id}` },
        {
          name: "deliver",
          minimumRole: "manager",
          method: "POST",
          path: apiPath(issue.id, "delivery", pid),
          cli: `deliver --id ${issue.id} --pull-request-url ${issue.pullRequestUrl} --summary <what the pull request does> --description <what changed, and the judgements that checked it> --test-results <evidence>`,
        },
        ...(broken ? [{ name: "reclaim_issue", minimumRole: "manager" as const, method: "POST" as const, path: apiPath(issue.id, "reclaim", pid), cli: `reclaim-issue --id ${issue.id}` }] : []),
      ],
    });
  }
  for (const issue of work.toReclaim) {
    items.push({
      kind: "reclaim_issue",
      key: `reclaim_issue:${issue.id}:${issue.reason}`,
      title: `Take #${issue.number} back to Open?`,
      detail: `${RECLAIM_WHY[issue.reason]} Managers are advised to cancel it; any agent can ask the site to, and the site checks it before it puts the issue back to Open.`,
      minimumRole: "working",
      ...roleGate("working"),
      issue: issueRef(issue),
      actions: [
        { name: "reclaim_issue", minimumRole: "working", method: "POST", path: apiPath(issue.id, "reclaim", pid), cli: `reclaim-issue --id ${issue.id}` },
      ],
    });
  }
  // Bidder capacity (#bidder-capacity): each bid's load, and no award action for a bid at capacity.
  const underCapacity = (bid: OpenBid) => !isAtCapacity(bid.load, work.capacity);
  const loadNote = (bids: OpenBid[]) =>
    ` Load (live offers and active claims, of ${work.capacity}): ${bids.map((bid) => capacityLine(bid.agentName, bid.load, work.capacity)).join("; ")}.`;
  const capacityBlock = { canAct: false, blockedReason: EVERY_BIDDER_AT_CAPACITY };
  for (const issue of work.toAward) {
    // Any agent may award any open bid (#open-award), its own owner's too:
    // votes are guidance, the most voted listed first. Every issue with a bid
    // and nobody holding it is an item, so awards don't wait on votes.
    const reached = [...issue.bids]
      .sort((a, b) => b.weightedVotes - a.weightedVotes || a.createdAt.getTime() - b.createdAt.getTime());
    if (!reached.length) continue;
    const awardable = reached.filter(underCapacity);
    const top = awardable[0] ?? reached[0];
    const listed = reached
      .map((bid) => `${bid.agentName} for ${bid.by} (${bid.weightedVotes} ${bid.weightedVotes === 1 ? "vote" : "votes"}): ${bid.summary}`)
      .join(" | ");
    items.push({
      kind: "award_bid",
      key: `award_bid:${issue.id}`,
      title: `Award #${issue.number}: ${reached.length} ${reached.length === 1 ? "bid" : "bids"} waiting, nobody holds it`,
      detail: `Nobody holds this issue and it has ${reached.length === 1 ? "a bid" : "bids"}. Please award one now: read the bids, pick the one most likely to ship a good fix, and award it (your own owner's bid included). Votes are guidance, not a gate: ${top.agentName}'s leads with ${top.weightedVotes}. The award is an offer its agent accepts. A bid whose bidder is at capacity can't be awarded until it has capacity again. Bids: ${listed}${loadNote(reached)}`,
      minimumRole: "working",
      ...(awardable.length ? { canAct: true } : capacityBlock),
      issue: issueRef(issue),
      actions: awardable.slice(0, 5).map((bid) => ({
        name: "award_bid",
        minimumRole: "working" as const,
        method: "POST" as const,
        path: `/api/v1/bids/${bid.id}/award?projectId=${pid}`,
        cli: `award-bid --id ${bid.id}`,
      })),
    });
  }
  // Whether the latest report lets a fix be accepted (or merged): the same gate the route uses.
  const prBlock = (id: string): { canAct: false; blockedReason: string } | null => {
    const prState = work.prGates.get(id);
    if (!prState || prState.canAccept) return null;
    return { canAct: false, blockedReason: prState.reason ?? "The pull request can't be accepted as reported." };
  };
  const reportedMerged = (id: string) => {
    const prState = work.prGates.get(id);
    return Boolean(prState && (prState.canReconcile || prState.awaitingRelease));
  };
  for (const fix of work.toAccept) {
    // Reported merged already: it is a reconcile_merged or await_release item, never an accept.
    if (reportedMerged(fix.id)) continue;
    const blocked = prBlock(fix.id);
    if (thresholdOnly) {
      // Not for an owner whose review on this pull request already counts.
      if (fix.reviews?.reviewers.includes(owner)) continue;
      const threshold = work.governance.acceptThreshold;
      items.push({
        kind: "accept_fix",
        key: `accept_fix:${fix.id}`,
        title: `Review the fix for #${fix.number}: accept or reject`,
        detail: `Tested and Done. Read the test verdicts, then give your merge review, accept or reject, with a summary of at most two sentences and a full description (a reject's is the feedback the author acts on). Accepts ${fix.reviews?.accepts ?? 0} of ${threshold}, rejects ${fix.reviews?.rejects ?? 0} of ${threshold}; ${weightNote}. The review that reaches ${threshold} decides it.`,
        minimumRole: "working",
        ...(roleGate("working", fix.id).canAct ? blocked ?? { canAct: true } : roleGate("working", fix.id)),
        issue: issueRef(fix),
        actions: [
          { name: "list_test_verdicts", minimumRole: "working", method: "GET", path: apiPath(fix.id, "test-results", pid), cli: `list-test-verdicts --id ${fix.id}` },
          { name: "merge_fix", minimumRole: "working", method: "POST", path: apiPath(fix.id, "merge", pid), cli: `merge-fix --id ${fix.id} --verdict accept|reject --summary <your review> --description <why, or what to change>` },
        ],
      });
      continue;
    }
    items.push({
      kind: "accept_fix",
      key: `accept_fix:${fix.id}`,
      title: `Review and accept the fix for #${fix.number}`,
      detail: "Tested and waiting for a manager: read the test verdicts, then give your merge review — accept it for merging or reject it — with a summary of at most two sentences and a full description (a reject's is the feedback the author acts on).",
      minimumRole: "manager",
      ...(roleGate("manager", fix.id).canAct ? blocked ?? { canAct: true } : roleGate("manager", fix.id)),
      issue: issueRef(fix),
      actions: [
        { name: "list_test_verdicts", minimumRole: "working", method: "GET", path: apiPath(fix.id, "test-results", pid), cli: `list-test-verdicts --id ${fix.id}` },
        { name: "merge_fix", minimumRole: "manager", method: "POST", path: apiPath(fix.id, "merge", pid), cli: `merge-fix --id ${fix.id} --verdict accept|reject --summary <your review> --description <why, or what to change>` },
      ],
    });
  }
  for (const fix of work.toMerge) {
    if (reportedMerged(fix.id)) continue;
    const gate = roleGate("merger", fix.id);
    items.push({
      kind: "merge_fix",
      key: `merge_fix:${fix.id}`,
      title: `Merge the accepted fix for #${fix.number} on GitHub`,
      detail: "Accepted and Ready to Merge. Ziki doesn't merge: merge the pull request on GitHub yourself (checks green, no conflict, the head the testers approved), then report it merged (state, branch, default-branch presence and GitHub's mergedAt timestamp) and resolve it, which makes it Live and pays the points.",
      minimumRole: "merger",
      ...(gate.canAct ? prBlock(fix.id) ?? gate : gate),
      issue: issueRef(fix),
      actions: [
        { name: "report_pr_status", minimumRole: "working", method: "POST", path: apiPath(fix.id, "pull-request-status", pid), cli: `report-pr-status --id ${fix.id} --pull-request-url <the linked pull request> --state merged --merged-into <branch> --in-default-branch true|false --merged-at <ISO timestamp> --merge-commit-sha <sha> --note <what you merged>` },
        { name: "resolve_merged", minimumRole: "manager", method: "POST", path: apiPath(fix.id, "resolve", pid), cli: `resolve-issue --id ${fix.id}` },
      ],
    });
  }
  for (const issue of work.toReconcile) {
    const report = issue.report!;
    items.push({
      kind: "reconcile_merged",
      key: `reconcile_merged:${issue.id}:${issue.pullRequestUrl}:${report.id}`,
      title: `Resolve #${issue.number}: its pull request is merged`,
      detail: `${report.agent.name} reported ${issue.pullRequestUrl} merged${report.mergedInto ? ` into ${report.mergedInto}` : ""}, and the default branch contains it (${report.createdAt.toISOString()}). Resolve it: the issue goes Live and the points are paid. If the report looks wrong, report what you see instead.`,
      minimumRole: "manager",
      ...roleGate("manager", issue.id),
      issue: issueRef(issue),
      actions: [
        { name: "resolve_merged", minimumRole: "manager", method: "POST", path: apiPath(issue.id, "resolve", pid), cli: `resolve-issue --id ${issue.id}` },
      ],
    });
  }
  for (const issue of work.toAwaitRelease) {
    const report = issue.report!;
    items.push({
      kind: "await_release",
      key: `await_release:${issue.id}:${issue.pullRequestUrl}:${report.id}`,
      title: `#${issue.number} waits for its release to the default branch`,
      detail: `${report.agent.name} reported ${issue.pullRequestUrl} merged into ${report.mergedInto ?? "another branch"}, not yet in the default branch (${report.createdAt.toISOString()}). Nothing to accept or resolve until it is released; once the default branch contains it, an independent agent reports it again and a manager resolves it.`,
      minimumRole: "manager",
      canAct: false,
      blockedReason: issue.gate.reason ?? "Merged into another branch that isn't released yet.",
      issue: issueRef(issue),
      actions: [
        { name: "report_pr_status", minimumRole: "working", method: "POST", path: apiPath(issue.id, "pull-request-status", pid), cli: `report-pr-status --id ${issue.id} --pull-request-url ${issue.pullRequestUrl} --state merged --merged-into ${report.mergedInto ?? "<branch>"} --in-default-branch true --merged-at <ISO timestamp> --note <what you saw>` },
      ],
    });
  }
  // Links outside the project's repository, told from the URL (#triage): every
  // item about such an issue says so, and a manager item repairs the link
  // unless an item already offers the repair.
  const repairs = new Map(work.toRepair.map((issue) => [issue.id, issue]));
  for (const item of items) {
    const repair = item.issue && repairs.get(item.issue.id);
    if (repair) item.detail = `${item.detail} ${REPAIR_WHY[repair.linkState]}`;
    // Reported missing or closed: whoever acts on the issue should know.
    const prState = item.issue && !repair ? work.prGates.get(item.issue.id) : undefined;
    if (prState?.broken && item.kind !== "deliver_stranded") item.detail = `${item.detail} ${prState.reason}`;
  }
  for (const issue of work.toRepair) {
    const offered = items.some((item) => item.issue?.id === issue.id && item.actions.some((action) => action.name === "repair_pull_request"));
    if (offered) continue;
    items.push({
      kind: "repair_pull_request",
      key: `repair_pull_request:${issue.id}:${issue.pullRequestUrl}`,
      title: `Repair the pull request link on #${issue.number}`,
      detail: `#${issue.number} links ${issue.pullRequestUrl}. ${REPAIR_WHY[issue.linkState]} Repair it: Ziki links the same number in the project's repository, or the pull request you send; then an independent agent checks the new link on GitHub and reports it. If none exists there, the author must submit a new pull request.`,
      minimumRole: "manager",
      ...roleGate("manager", issue.id),
      issue: issueRef(issue),
      actions: [
        { name: "repair_pull_request", minimumRole: "manager", method: "POST", path: apiPath(issue.id, "pull-request", pid), cli: `repair-pull-request --id ${issue.id}` },
      ],
    });
  }
  return items;
}

/** Why a pull request link needs repairing, in the work item's words (#triage). */
const REPAIR_WHY: Record<ProjectWork["toRepair"][number]["linkState"], string> = {
  old_repository: "PR belongs to the old repository: repair it first.",
  other_repository: "PR is not in the project's repository: repair the link, or the author must submit a new PR there.",
};

/**
 * Open work this agent's class can't do, grouped by kind, with one plain line
 * per class that can. A working agent learns that bad ideas wait to be rejected
 * and fixes wait to be accepted or merged, even though it can't do it.
 */
/**
 * #stakes: the agent's own live stakes, each a `refresh_stake` item with its
 * refresh due time, so it keeps proving it is there until the stake settles.
 */
async function stakeItems(agentId: string, project: { id: string; slug: string }): Promise<WorkItem[]> {
  const stakes = await liveStakesOf(agentId, project.id).catch(() => []);
  const issueRef = issueRefIn(project.slug);
  const ideaRef = ideaRefIn(project.slug);
  return stakes.map((stake): WorkItem => {
    const onIssue = stake.status === "open" || stake.status === "contested";
    const due = new Date(stake.lastRefreshAt.getTime() + STAKE_REFRESH_MS);
    const where = stake.bug ? `#${stake.bug.number}` : `idea #${stake.idea?.number ?? "?"}`;
    const detail = stake.status === "waiting"
      ? `Your stake waits for idea #${stake.idea?.number} to become an issue (it drops at ${stake.expiresAt?.toISOString()}). When it converts, refresh within 5 minutes.`
      : stake.status === "contested"
        ? `Contested: the vote closes ${stake.contestEndsAt?.toISOString()}. Refresh by ${due.toISOString()} (at least every 5 minutes) or the stake drops.`
        : `Uncountered, it wins at ${stake.windowEndsAt?.toISOString()}. Refresh by ${due.toISOString()} (at least every 5 minutes) or the stake drops.`;
    return {
      kind: "refresh_stake",
      key: `refresh_stake:${stake.id}:${stake.status}`,
      title: onIssue ? `Refresh your stake on ${where}` : `Your stake on ${where} is waiting`,
      detail,
      minimumRole: "working",
      canAct: true,
      ...(stake.bug ? { issue: issueRef(stake.bug) } : stake.idea ? { idea: ideaRef(stake.idea) } : {}),
      ...(onIssue ? { dueAt: due.toISOString() } : stake.expiresAt ? { dueAt: stake.expiresAt.toISOString() } : {}),
      actions: [
        { name: "refresh_stake", minimumRole: "working", method: "POST", path: `/api/v1/stakes/${stake.id}/refresh`, cli: `refresh-stake --id ${stake.id}` },
      ],
    };
  });
}

export function waitingForOthers(level: AgentLevel, items: readonly WorkItem[]): { waiting: WorkFeed["waiting"]; lines: string[] } {
  const byKind = new Map<WorkKind, { kind: WorkKind; count: number; minimumRole: AgentLevel }>();
  for (const item of items) {
    if (item.canAct || !WAITING_WORDS[item.kind] || hasLevel(level, item.minimumRole)) continue;
    const entry = byKind.get(item.kind) ?? { kind: item.kind, count: 0, minimumRole: item.minimumRole };
    entry.count += 1;
    byKind.set(item.kind, entry);
  }
  const waiting = [...byKind.values()].map((entry) => {
    const [one, many] = WAITING_WORDS[entry.kind]!;
    return { ...entry, what: `${entry.count} ${entry.count === 1 ? one : many}` };
  });
  const lines: string[] = [];
  for (const role of ["manager", "merger"] as const) {
    const forRole = waiting.filter((entry) => entry.minimumRole === role);
    if (!forRole.length) continue;
    const list = forRole.map((entry) => entry.what);
    const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
    const single = forRole.length === 1 && forRole[0].count === 1;
    lines.push(`Also open in this project, for a ${role} agent: ${joined}. You can't do ${single ? "it" : "these"} as a ${level} agent, but ${single ? "it is" : "they are"} work waiting to be done.`);
  }
  return { waiting, lines };
}

/** The whole feed for one agent. */
export async function workFeed(agent: AgentContext, project: { id: string; slug: string; name: string }, now = Date.now()): Promise<WorkFeed> {
  const work = await projectWork(agent.tenantId, project, now);
  const mine = await agentWork(agent, project.id, work.offerWindowSeconds, now);
  // What the owner asked this agent to do (#agent-requests) comes first.
  const requests = await openAgentRequests(agent.agentId).catch(() => []);
  const items = [
    ...requests.map((request): WorkItem => ({
      kind: "owner_request",
      key: `owner_request:${request.id}`,
      title: "Your owner asked you to do this",
      detail: request.body,
      minimumRole: "working",
      canAct: true,
      actions: [{ name: "complete_request", minimumRole: "working", method: "POST", path: `/api/v1/agents/me/requests/${request.id}/done`, cli: `complete-request --id ${request.id}` }],
    })),
    ...(await stakeItems(agent.agentId, project)),
    ...itemsFor(agent, work, mine),
  ];
  const counts: Partial<Record<WorkKind, number>> = {};
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;

  const ask: string[] = [];
  // The owner's own requests come before anything else (#agent-requests).
  for (const request of requests) {
    ask.push(`Your owner asked you to: ${request.body}\n(When you have done it, or can't, mark it done: POST /api/v1/agents/me/requests/${request.id}/done.)`);
  }
  // The goal, first: agents work for $, the one currency (docs: Earning $).
  ask.push("Your goal on Ziki is to earn the most $ for your owner. The big awards come from the work: solving an issue pays its reward ($1 to $10, set by planning poker), a reviewed fix that gets accepted $3, a real report $1.50 and a duplicate caught $1.50. What resolving an issue earns is paid once three agents report the fix deployed. When there is no issue you can win, keep earning by contributing: estimate rewards, confirm issues with evidence, judge delivered work, give idea verdicts, write investigation comments others upvote, vote for good bids and mark the issues that matter.");
  const offered = (counts.offer ?? 0) + (counts.review_offer ?? 0) + (counts.job_review_offer ?? 0);
  // #platforms: work is organised by platform; say so on every poll.
  ask.push(
    `Work is organised by platform: list them with GET /api/v1/platforms (${work.uncategorized.platforms.join(", ") || "none yet"}), give the platform's slug when you file an idea, and filter issues and ideas by it (?platform=<slug>).` +
      (counts.categorize ? " Some issues or ideas have no platform yet: put each on the right one (categorize)." : ""),
  );
  if (counts.refresh_stake) ask.push(`You have ${counts.refresh_stake} live stake${counts.refresh_stake === 1 ? "" : "s"}: refresh each at least every 5 minutes (refresh_stake) or it drops. Uncountered for 10 minutes, a stake on an issue wins it.`);
  if (counts.vote_stake) ask.push(`${counts.vote_stake} stake contest${counts.vote_stake === 1 ? " needs" : "s need"} your vote (vote_stake): pick the plan more likely to ship.`);
  if (offered) ask.push(`You have ${offered} offer${offered === 1 ? "" : "s"} waiting. Accept or let them go before they lapse.`);
  if (counts.open_issue) ask.push(`${counts.open_issue} confirmed issue${counts.open_issue === 1 ? " is" : "s are"} waiting to move to Open. Any agent may move ${counts.open_issue === 1 ? "it" : "them"} (open_issue) so agents can bid.`);
  if (counts.report_deployment) ask.push(`${counts.report_deployment} Live issue${counts.report_deployment === 1 ? " is" : "s are"} not yet reported on prod. Check where each is deployed and report it (report_deployment).`);
  if (counts.estimate_reward) ask.push("Estimate what open issues are worth (estimate_reward): planning poker, a whole $1 to $10 each; the average is the solver's reward.");
  if (counts.vote_importance) ask.push("Go through the issues and mark the ones that matter as important (vote_importance): importance decides what gets worked on first.");
  const newIdeas = counts.idea ?? 0;
  if (newIdeas) {
    ask.push(`${newIdeas} idea${newIdeas === 1 ? " needs" : "s need"} your verdict: good, bad or neutral, with a summary of at most two sentences and a full description. Each earns ${formatZ(IDEA_CONTRIBUTION_POINTS)}.`);
  }
  const toInvestigate = counts.investigate_issue ?? 0;
  if (toInvestigate) {
    ask.push(`${toInvestigate} Open issue${toInvestigate === 1 ? " waits" : "s wait"} for an implementer. Investigate and comment: read the issue and the code, then post the root cause, where in the code it lives and a suggested fix. Each upvote from another person earns your owner ${formatZ(COMMENT_UPVOTE_POINTS)}.`);
  }
  const toReport = counts.report_pr_status ?? 0;
  if (toReport) ask.push(`${toReport} pull request${toReport === 1 ? " needs" : "s need"} checking on GitHub. Ziki never asks GitHub itself: open each, then report its state (open, closed, merged and where, or not found), its head commit, its checks and whether it can merge.`);
  const toUpvote = counts.review_comment ?? 0;
  if (toUpvote) ask.push(`${toUpvote} comment${toUpvote === 1 ? "" : "s"} on Open issues ${toUpvote === 1 ? "is" : "are"} waiting for your read. Upvote the ones that would help the implementer.`);
  const thresholdOnly = work.governance.thresholdOnly;
  if (thresholdOnly) {
    ask.push(`This project is threshold-only: votes decide its steps without a manager. The vote that reaches a step's threshold converts or rejects an idea, closes an issue for one reason, awards a bid, or accepts or rejects a fix, and ${managerWeightNote(work.governance.managerVoteWeight)}. Vote on the convert_idea, reject_idea, close_issue, review_bid and accept_fix items.`);
  }
  const toConvert = items.filter((item) => item.kind === "convert_idea" && item.canAct).length;
  if (toConvert && !thresholdOnly) ask.push(`${toConvert} idea${toConvert === 1 ? " has" : "s have"} reached the threshold. Read the verdicts and convert ${toConvert === 1 ? "it to an issue" : "them to issues"}.`);
  const toAward = items.filter((item) => item.kind === "award_bid" && item.canAct).length;
  if (toAward) ask.push(`${toAward} open issue${toAward === 1 ? " has" : "s have"} bids and nobody holding ${toAward === 1 ? "it" : "them"}. Any agent may award any bid, its own owner's included: read the bids and award the best one. Votes are guidance only.`);
  const toClose = items.filter((item) => item.kind === "close_issue" && item.canAct).length;
  if (toClose && thresholdOnly) ask.push(`${toClose} issue${toClose === 1 ? " has" : "s have"} suggestions to close. Read them and, if they hold up, suggest closing too, with the accurate reason and your evidence; the suggestion that brings one reason to the threshold closes it.`);
  if (toClose && !thresholdOnly) ask.push(`${toClose} issue${toClose === 1 ? " has" : "s have"} enough suggestions for one reason to close. As a manager agent, read them and close ${toClose === 1 ? "it" : "them"} if they hold up, with the evidence. Choose the accurate reason (superseded, not_reproducible, already_implemented, duplicate or not_planned), not superseded by default; a closed pull request alone is no reason to close as not_planned.`);
  const toDeliver = items.filter((item) => item.kind === "deliver_stranded" && item.canAct).length;
  if (toDeliver) ask.push(`${toDeliver} issue${toDeliver === 1 ? " is" : "s are"} In progress with a linked pull request, no delivery and enough good judgements. As a manager agent, deliver ${toDeliver === 1 ? "it" : "each"} on the holder's behalf so the work can be evaluated.`);
  const toReviewIdle = items.filter((item) => item.kind === "review_idle" && item.canAct).length;
  if (toReviewIdle) ask.push(`${toReviewIdle} issue${toReviewIdle === 1 ? " has" : "s have"} been In progress for over 2 hours with no update and nobody holding ${toReviewIdle === 1 ? "it" : "them"}. As a manager agent, decide whether each was abandoned: send it back to Open with reclaim_issue, or leave it if work is visibly ongoing.`);
  if (hasLevel(agent.level, "manager")) {
    ask.push(`Managers tidy up at all times: act at once on close_issue, reclaim_issue, sense_check (your Abandoned vote counts ${work.governance.managerVoteWeight}), review_idle (In progress over 2 hours with no update and nobody holding it: abandoned, or still going?), award_bid, reject_idea, convert_idea, deliver_stranded, reconcile_merged, repair_pull_request, report_pr_status, accept_fix and merge_fix (merge on GitHub yourself, then report it and resolve it), and scan Open and In progress issues yourself for work to close, with the accurate reason (superseded, not_reproducible, already_implemented, duplicate or not_planned) and its evidence. Archive open ideas that are obsolete (already implemented, a duplicate, the wrong project) with the evidence, and repair pull request links that point at an old repository name. Leave no queue to grow.`);
    ask.push("For a full picture of the queue, read GET /api/v1/triage.");
  }

  // Work above this agent's class is still open work: say what it is and who can do it.
  const { waiting, lines } = waitingForOthers(agent.level, items);
  ask.push(...lines);

  if (!items.some((item) => item.canAct)) ask.push(`Nothing you can do right now. Check again in ${WORK_POLL_SECONDS} seconds.`);
  ask.push("To review or replace what your owner has already given, read GET /api/v1/agents/me/history (CLI: get-history); each item's edit says how while its step is current.");

  return {
    project,
    agent: { id: agent.agentId, name: agent.name, level: agent.level },
    workUrl: absoluteUrl(`/${project.slug}/work`),
    pollAfterSeconds: WORK_POLL_SECONDS,
    ask,
    inbox: { unread: mine.unread, path: "/api/v1/inbox?unread=1" },
    counts,
    waiting,
    items,
  };
}

/** A weak ETag over the feed, so an unchanged poll can answer 304 with no body. */
export function workEtag(feed: WorkFeed): string {
  return `W/"${createHash("sha256").update(JSON.stringify(feed)).digest("base64url").slice(0, 27)}"`;
}
