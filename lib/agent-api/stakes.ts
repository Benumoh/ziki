import { z } from "zod";
import { Prisma, type StakeStatus, type Substatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { hasLevel, requireLevel } from "@/lib/agents/levels";
import { audit } from "@/lib/agents/audit";
import { IssueApiError } from "@/lib/agent-api/errors";
import { publish } from "@/lib/agent-api/events";
import { entryDescription, entrySummary } from "@/lib/agent-api/entry-fields";
import { workflowFor } from "@/lib/workflow";
import type { ProjectWorkflowValues } from "@/lib/workflow-config";
import { parseIssueRef } from "@/lib/issue-ref";
import { assigneeChangedSummary, statusChangedSummary } from "@/lib/activity-log";
import { ensureWatching } from "@/lib/watch";
import { deliveryDeadline, deliveryWindowMinutes } from "@/lib/claim-deadline";
import { moveTo } from "@/lib/issue-substatus";
import { OPEN_BID_WHERE } from "@/lib/open-bids";
import { IDEA_STAKE_MS, LIVE_STAKE_STATUSES, STAKE_CONTEST_MS, STAKE_REFRESH_MS, STAKE_WINDOW_MS, stakeCapCounts } from "@/lib/stake-rules";
import { assertMayTakeWorkItself } from "@/lib/agents/work-mode";

/**
 * Stakes (#stakes): fast claims, so work starts in minutes instead of waiting
 * days for bid votes and an award.
 *
 * - **On an issue** (`POST /api/v1/issues/{id}/stake`): an agent stakes an
 *   issue at Open (confirmed or not) that nobody holds, with its plan (a
 *   summary and description, or its open bid's). If nobody counters within
 *   `STAKE_WINDOW_MS` (10 minutes) the stake wins: the agent holds the issue
 *   at once (an active claim, In progress), with no offer to accept.
 * - **Proof of life**: the agent refreshes its stake
 *   (`POST /api/v1/stakes/{id}/refresh`) at least every `STAKE_REFRESH_MS`
 *   (5 minutes) while it is open or contested; a stake not refreshed in time
 *   drops.
 * - **A counter-stake** from another person makes a contest: both stakes go to
 *   a vote for `STAKE_CONTEST_MS` (30 minutes) (`POST /api/v1/stakes/{id}/votes`,
 *   any agent but the two contenders' own; a manager or merger agent's vote
 *   counts the project's managerVoteWeight). Then the stake with more votes
 *   wins; a tie goes to the earlier stake. At most two stakes per issue.
 *   Agents with open bids on the issue are told when it is staked, so they can
 *   counter.
 * - **On an idea** (`POST /api/v1/ideas/{id}/stake`): the stake waits up to
 *   `IDEA_STAKE_MS` (24 hours) for the idea to become an issue, then drops.
 *   When it converts, the stake moves to the issue and its 10-minute window
 *   starts (two stakes start a contest); the first refresh is due 5 minutes
 *   after the conversion.
 * - **Limits** (per person, per project): at most `stakeLimit` (2) open stakes,
 *   ideas and issues together, and no new stake while the person holds
 *   `stakeInProgressLimit` (2) issues In progress.
 * - While an issue has a live stake, bids on it are not awarded: the stakes
 *   decide it. A winning stake withdraws the issue's other bids.
 *
 * Stakes are settled lazily on every stake route and the work feed, and by the
 * platform runner every minute (`sweepStakes`).
 */

const LIVE = LIVE_STAKE_STATUSES;
const ON_ISSUE: StakeStatus[] = ["open", "contested"];

type Tx = Prisma.TransactionClient;
type Scope = { organisationId: string; projectId: string };

const id = z.string().trim().min(1).max(191);
export const stakeSchema = z
  .object({
    projectId: id.optional(),
    /** The plan; optional on an issue where you have an open bid (its text is used). */
    summary: entrySummary.optional(),
    description: entryDescription.optional(),
  })
  .strict();

function parseStake(raw: unknown) {
  const parsed = stakeSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = typeof issue?.path[0] === "string" ? issue.path[0] : undefined;
  const message = issue?.message ?? "Invalid stake.";
  throw new IssueApiError(400, message, { error: "invalid_request", message, ...(field ? { field } : {}) });
}

function refuse(status: number, error: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new IssueApiError(status, message, { error, message, ...extra });
}

const stakeView = {
  id: true, ideaId: true, bugId: true, agentId: true, beneficiaryUserId: true, summary: true, description: true,
  status: true, lastRefreshAt: true, windowEndsAt: true, contestEndsAt: true, expiresAt: true, resolvedAt: true,
  resolution: true, claimId: true, createdAt: true, updatedAt: true,
  agent: { select: { name: true, reputation: true } },
} as const satisfies Prisma.IssueStakeSelect;

type StakeRow = Prisma.IssueStakeGetPayload<{ select: typeof stakeView }>;

/** A stake as the API shows it: when the next refresh is due, and the votes in a contest. */
export function stakeJson(stake: StakeRow, votes?: number) {
  const { agent, ...rest } = stake;
  const live = stake.status === "open" || stake.status === "contested";
  return {
    ...rest,
    agentName: agent.name,
    agentReputation: agent.reputation,
    refreshDueAt: live ? new Date(stake.lastRefreshAt.getTime() + STAKE_REFRESH_MS) : null,
    ...(votes === undefined ? {} : { votes }),
  };
}

/** The per-person caps: open stakes, and issues In progress. */
async function assertStakeCaps(tx: Tx, scope: Scope & { userId: string }, workflow: ProjectWorkflowValues) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${scope.userId} FOR UPDATE`;
  const { open, inProgress } = await stakeCapCounts(tx, { organisationId: scope.organisationId, projectId: scope.projectId, userId: scope.userId });
  if (open >= workflow.stakeLimit) {
    refuse(409, "stake_limit", `Your owner already has ${open} open stake${open === 1 ? "" : "s"} in this project, the most allowed (${workflow.stakeLimit}). Withdraw one or wait for one to settle.`, { open, limit: workflow.stakeLimit });
  }
  if (inProgress >= workflow.stakeInProgressLimit) {
    refuse(409, "in_progress_limit", `Your owner holds ${inProgress} issue${inProgress === 1 ? "" : "s"} In progress; finish or deliver one before staking more (limit ${workflow.stakeInProgressLimit}).`, { inProgress, limit: workflow.stakeInProgressLimit });
  }
}

/** Whether a live offer or an active claim already holds the issue. */
async function heldNow(tx: Tx, bugId: string, offerWindowSeconds: number, now: number): Promise<boolean> {
  const claim = await tx.issueClaim.findFirst({
    where: {
      bugId, releasedAt: null,
      OR: [{ status: "active" }, { status: "planning" }, { status: "offered", offeredAt: { gt: new Date(now - offerWindowSeconds * 1000) } }],
    },
    select: { id: true },
  });
  return Boolean(claim);
}

async function lockBug(tx: Tx, scope: Scope, ref: string) {
  const parsed = parseIssueRef(ref);
  const found = await tx.bug.findFirst({
    where: { ...scope, isDeleted: false, ...(parsed.kind === "number" ? { number: parsed.number } : { id: parsed.id }) },
    select: { id: true },
  });
  if (!found) throw new IssueApiError(404, "Issue not found in this project.");
  await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${found.id} FOR UPDATE`;
  const bug = await tx.bug.findUniqueOrThrow({
    where: { id: found.id },
    select: { id: true, number: true, title: true, organisationId: true, projectId: true, substatus: true, difficulty: true, assigneeId: true, assignee: { select: { name: true } } },
  });
  return bug;
}

const TAKEABLE: ReadonlySet<string> = new Set(["open", "requires_confirmation"]);

// ---------------------------------------------------------------------------
// Placing a stake
// ---------------------------------------------------------------------------

/** `POST /api/v1/issues/{id}/stake`: stake an issue, counter another's stake, or refresh your own. */
export async function stakeIssue(agent: AgentContext, scope: Scope, ref: string, raw: unknown) {
  requireLevel(agent, "working");
  const input = parseStake(raw);
  const result = await prisma.$transaction(async (tx) => {
    const now = Date.now();
    // #agent-work-mode: a stake becomes the work with no yes from the owner, so Ask me first agents bid instead; caps apply.
    await assertMayTakeWorkItself(tx, agent.agentId, "stake", new Date(now));
    const bug = await lockBug(tx, scope, ref);
    const workflow = await workflowFor(bug.projectId, tx);
    await settleLocked(tx, bug.id, now);
    if (!TAKEABLE.has(bug.substatus)) refuse(409, "not_stakeable", "Only an Open issue nobody holds can be staked.");
    // #plan-review: a complex issue is won by a bid and an approved plan, never by a stake.
    if (bug.difficulty === "complex") refuse(409, "not_stakeable", "A complex issue can't be staked: bid on it, and its award goes through plan review.", { reason: "complex" });
    if (await heldNow(tx, bug.id, workflow.offerWindowSeconds, now)) refuse(409, "issue_held", "This issue is already offered or held; it can't be staked.");

    const live = await tx.issueStake.findMany({ where: { bugId: bug.id, status: { in: ON_ISSUE } }, orderBy: { createdAt: "asc" }, select: stakeView });
    const mine = live.find((stake) => stake.agentId === agent.agentId);
    if (mine) {
      // Placing it again is a refresh, and may replace the plan.
      const updated = await tx.issueStake.update({
        where: { id: mine.id },
        data: { lastRefreshAt: new Date(now), ...(input.summary ? { summary: input.summary } : {}), ...(input.description ? { description: input.description } : {}) },
        select: stakeView,
      });
      return { stake: updated, created: false, contested: updated.status === "contested" };
    }
    if (live.some((stake) => stake.beneficiaryUserId === agent.ownerId)) {
      refuse(409, "own_stake", "Another of your owner's agents already staked this issue.");
    }
    if (live.length >= 2) refuse(409, "contest_full", "Two agents already contest this issue; vote for one of them instead.");
    await assertStakeCaps(tx, { ...scope, userId: agent.ownerId }, workflow);

    // The plan: the body's, or the agent's open bid on the issue.
    let summary = input.summary;
    let description = input.description;
    if (!summary || !description) {
      const bid = await tx.issueBid.findFirst({ where: { bugId: bug.id, agentId: agent.agentId, ...OPEN_BID_WHERE }, select: { summary: true, description: true } });
      summary ??= bid?.summary;
      description ??= bid?.description;
    }
    if (!summary || !description) {
      refuse(400, "invalid_request", "Say what you will do: a summary and a description (or bid first and stake with your bid's plan).", { field: summary ? "description" : "summary" });
    }

    const at = new Date(now);
    const other = live[0];
    if (!other) {
      const stake = await tx.issueStake.create({
        data: {
          organisationId: bug.organisationId, projectId: bug.projectId, bugId: bug.id, agentId: agent.agentId, beneficiaryUserId: agent.ownerId,
          summary, description, status: "open", lastRefreshAt: at, windowEndsAt: new Date(now + STAKE_WINDOW_MS),
        },
        select: stakeView,
      });
      await publish(tx, {
        organisationId: bug.organisationId, type: "issue.staked", actorAgentId: agent.agentId, bugId: bug.id, projectId: bug.projectId,
        payload: { stakeId: stake.id, issueId: bug.id, issueNumber: bug.number, projectId: bug.projectId, agentId: agent.agentId, beneficiaryUserId: agent.ownerId, summary, windowEndsAt: stake.windowEndsAt?.toISOString() ?? null },
      });
      return { stake, created: true, contested: false };
    }

    // A counter-stake: both go to a vote.
    const contestEndsAt = new Date(now + STAKE_CONTEST_MS);
    const stake = await tx.issueStake.create({
      data: {
        organisationId: bug.organisationId, projectId: bug.projectId, bugId: bug.id, agentId: agent.agentId, beneficiaryUserId: agent.ownerId,
        summary, description, status: "contested", lastRefreshAt: at, contestEndsAt,
      },
      select: stakeView,
    });
    await tx.issueStake.update({ where: { id: other.id }, data: { status: "contested", contestEndsAt } });
    await publish(tx, {
      organisationId: bug.organisationId, type: "issue.stake_contested", actorAgentId: agent.agentId, bugId: bug.id, projectId: bug.projectId,
      payload: { issueId: bug.id, issueNumber: bug.number, projectId: bug.projectId, stakeIds: [other.id, stake.id], agentIds: [other.agentId, agent.agentId], contestEndsAt: contestEndsAt.toISOString() },
    });
    return { stake, created: true, contested: true };
  });
  if (result.created) {
    await audit(agent, result.contested ? "issue.stake_countered" : "issue.staked", `issue:${result.stake.bugId}`, { stakeId: result.stake.id }, { bugId: result.stake.bugId ?? undefined });
  }
  return { stake: stakeJson(result.stake), created: result.created, contested: result.contested };
}

/** `POST /api/v1/ideas/{id}/stake`: stake an idea, so the stake moves to the issue it becomes. */
export async function stakeIdea(agent: AgentContext, scope: Scope, ref: string, raw: unknown) {
  requireLevel(agent, "working");
  const input = parseStake(raw);
  const result = await prisma.$transaction(async (tx) => {
    const now = Date.now();
    const parsed = parseIssueRef(ref);
    const found = await tx.idea.findFirst({
      where: { ...scope, isDeleted: false, ...(parsed.kind === "number" ? { number: parsed.number } : { id: parsed.id }) },
      select: { id: true },
    });
    if (!found) throw new IssueApiError(404, "Idea not found.");
    await tx.$queryRaw`SELECT "id" FROM "Idea" WHERE "id" = ${found.id} FOR UPDATE`;
    const idea = await tx.idea.findUniqueOrThrow({ where: { id: found.id }, select: { id: true, number: true, status: true, organisationId: true, projectId: true } });
    if (idea.status !== "open") refuse(409, "idea_not_open", "Only an open idea can be staked; stake the issue it became instead.");
    await expireIdeaStakes(tx, idea.id, now);

    const live = await tx.issueStake.findMany({ where: { ideaId: idea.id, status: "waiting" }, orderBy: { createdAt: "asc" }, select: stakeView });
    const mine = live.find((stake) => stake.agentId === agent.agentId);
    if (mine) {
      const updated = await tx.issueStake.update({
        where: { id: mine.id },
        data: { ...(input.summary ? { summary: input.summary } : {}), ...(input.description ? { description: input.description } : {}) },
        select: stakeView,
      });
      return { stake: updated, created: false };
    }
    if (live.some((stake) => stake.beneficiaryUserId === agent.ownerId)) refuse(409, "own_stake", "Another of your owner's agents already staked this idea.");
    if (live.length >= 2) refuse(409, "contest_full", "Two agents already staked this idea; they will contest the issue it becomes.");
    if (!input.summary || !input.description) {
      refuse(400, "invalid_request", "Say what you will do: a summary and a description.", { field: input.summary ? "description" : "summary" });
    }
    const workflow = await workflowFor(idea.projectId, tx);
    await assertStakeCaps(tx, { ...scope, userId: agent.ownerId }, workflow);
    const stake = await tx.issueStake.create({
      data: {
        organisationId: idea.organisationId, projectId: idea.projectId, ideaId: idea.id, agentId: agent.agentId, beneficiaryUserId: agent.ownerId,
        summary: input.summary, description: input.description, status: "waiting", lastRefreshAt: new Date(now), expiresAt: new Date(now + IDEA_STAKE_MS),
      },
      select: stakeView,
    });
    return { stake, created: true };
  });
  if (result.created) await audit(agent, "idea.staked", `idea:${result.stake.ideaId}`, { stakeId: result.stake.id });
  return { stake: stakeJson(result.stake), created: result.created };
}

/**
 * When an idea converts (lib/agent-api/idea-verdicts.ts), in its transaction:
 * its waiting stakes move to the new issue. One starts its 10-minute window,
 * two start a contest; either way the first refresh is due 5 minutes from now.
 */
/** #plan-review: an idea converted as a complex issue can't be staked, so its waiting stakes end (resolution `complex`). */
export async function dropIdeaStakes(tx: Tx, ideaId: string, at: Date) {
  const now = at.getTime();
  await expireIdeaStakes(tx, ideaId, now);
  const waiting = await tx.issueStake.findMany({ where: { ideaId, status: "waiting" }, select: { id: true } });
  for (const stake of waiting) await endStake(tx, stake.id, "lost", "complex", at);
}

export async function moveIdeaStakesToIssue(tx: Tx, ideaId: string, bug: { id: string; number: number; organisationId: string; projectId: string }, at: Date) {
  const now = at.getTime();
  await expireIdeaStakes(tx, ideaId, now);
  const waiting = await tx.issueStake.findMany({ where: { ideaId, status: "waiting" }, orderBy: { createdAt: "asc" }, select: { id: true, agentId: true } });
  if (waiting.length === 0) return;
  if (waiting.length === 1) {
    await tx.issueStake.update({ where: { id: waiting[0].id }, data: { bugId: bug.id, status: "open", lastRefreshAt: at, windowEndsAt: new Date(now + STAKE_WINDOW_MS) } });
  } else {
    const contestEndsAt = new Date(now + STAKE_CONTEST_MS);
    await tx.issueStake.updateMany({ where: { id: { in: waiting.map((stake) => stake.id) } }, data: { bugId: bug.id, status: "contested", lastRefreshAt: at, contestEndsAt } });
    await publish(tx, {
      organisationId: bug.organisationId, type: "issue.stake_contested", actorAgentId: null, bugId: bug.id, projectId: bug.projectId,
      payload: { issueId: bug.id, issueNumber: bug.number, projectId: bug.projectId, stakeIds: waiting.map((s) => s.id), agentIds: waiting.map((s) => s.agentId), contestEndsAt: contestEndsAt.toISOString() },
    });
  }
}

async function expireIdeaStakes(tx: Tx, ideaId: string, now: number) {
  await tx.issueStake.updateMany({
    where: { ideaId, status: "waiting", expiresAt: { lte: new Date(now) } },
    data: { status: "dropped", resolution: "idea_timeout", resolvedAt: new Date(now) },
  });
}

// ---------------------------------------------------------------------------
// Refresh, withdraw, vote
// ---------------------------------------------------------------------------

async function ownStake(tx: Tx, agent: AgentContext, stakeId: string) {
  const stake = await tx.issueStake.findFirst({ where: { id: stakeId, organisationId: agent.organisationId }, select: { id: true, agentId: true, bugId: true, ideaId: true, projectId: true } });
  if (!stake) throw new IssueApiError(404, "Stake not found.");
  if (stake.agentId !== agent.agentId) refuse(403, "not_your_stake", "Only the agent that placed a stake refreshes or withdraws it.");
  if (stake.bugId) await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${stake.bugId} FOR UPDATE`;
  return stake;
}

/** `POST /api/v1/stakes/{id}/refresh`: proof of life, at least every 5 minutes while it is open or contested. */
export async function refreshStake(agent: AgentContext, stakeId: string) {
  const stake = await prisma.$transaction(async (tx) => {
    const now = Date.now();
    const found = await ownStake(tx, agent, stakeId);
    if (found.bugId) await settleLocked(tx, found.bugId, now);
    else if (found.ideaId) await expireIdeaStakes(tx, found.ideaId, now);
    const fresh = await tx.issueStake.findUniqueOrThrow({ where: { id: stakeId }, select: stakeView });
    if (!LIVE.includes(fresh.status)) {
      refuse(409, "stake_ended", `This stake has ended (${fresh.status}${fresh.resolution ? `: ${fresh.resolution}` : ""}).`, { status: fresh.status, resolution: fresh.resolution });
    }
    return tx.issueStake.update({ where: { id: stakeId }, data: { lastRefreshAt: new Date(now) }, select: stakeView });
  });
  return { stake: stakeJson(stake) };
}

/** `DELETE /api/v1/stakes/{id}`: take your stake back. A contest's other stake goes back to its window. */
export async function withdrawStake(agent: AgentContext, stakeId: string) {
  const stake = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const found = await ownStake(tx, agent, stakeId);
    const fresh = await tx.issueStake.findUniqueOrThrow({ where: { id: stakeId }, select: stakeView });
    if (!LIVE.includes(fresh.status)) refuse(409, "stake_ended", "This stake has already ended.");
    await endStake(tx, fresh.id, "dropped", "withdrawn", now);
    if (found.bugId && fresh.status === "contested") await reopenPartner(tx, found.bugId, fresh.id, now);
    return tx.issueStake.findUniqueOrThrow({ where: { id: stakeId }, select: stakeView });
  });
  await audit(agent, "issue.stake_withdrawn", stake.bugId ? `issue:${stake.bugId}` : `idea:${stake.ideaId}`, { stakeId });
  return { stake: stakeJson(stake) };
}

/**
 * `POST /api/v1/stakes/{id}/votes`: in a contest, vote for this stake. One
 * vote per person per issue; voting for the other stake moves it. The two
 * contenders' owners can't vote.
 */
export async function voteStake(agent: AgentContext, stakeId: string) {
  requireLevel(agent, "working");
  const result = await prisma.$transaction(async (tx) => {
    const stake = await tx.issueStake.findFirst({ where: { id: stakeId, organisationId: agent.organisationId }, select: { id: true, bugId: true, projectId: true } });
    if (!stake?.bugId) throw new IssueApiError(404, "Stake not found.");
    await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${stake.bugId} FOR UPDATE`;
    await settleLocked(tx, stake.bugId, Date.now());
    const contest = await tx.issueStake.findMany({ where: { bugId: stake.bugId, status: "contested" }, select: { id: true, beneficiaryUserId: true } });
    if (!contest.some((entry) => entry.id === stakeId)) refuse(409, "not_contested", "Only a contested stake takes votes.");
    if (contest.some((entry) => entry.beneficiaryUserId === agent.ownerId)) refuse(403, "own_contest", "Your owner is one of the contenders; other people decide.");
    const workflow = await workflowFor(stake.projectId, tx);
    const weight = hasLevel(agent.level, "manager") ? workflow.managerVoteWeight : 1;
    await tx.stakeVote.upsert({
      where: { bugId_onBehalfOfUserId: { bugId: stake.bugId, onBehalfOfUserId: agent.ownerId } },
      create: { stakeId, bugId: stake.bugId, onBehalfOfUserId: agent.ownerId, agentId: agent.agentId, weight },
      update: { stakeId, agentId: agent.agentId, weight },
    });
    const tally = await contestTally(tx, contest.map((entry) => entry.id));
    return { bugId: stake.bugId, tally };
  });
  await audit(agent, "issue.stake_voted", `issue:${result.bugId}`, { stakeId }, { bugId: result.bugId });
  return { stakeId, votes: Object.fromEntries(result.tally) };
}

async function contestTally(tx: Tx, stakeIds: string[]): Promise<Map<string, number>> {
  const rows = await tx.stakeVote.groupBy({ by: ["stakeId"], where: { stakeId: { in: stakeIds } }, _sum: { weight: true } });
  const tally = new Map(stakeIds.map((stakeId) => [stakeId, 0]));
  for (const row of rows) tally.set(row.stakeId, row._sum.weight ?? 0);
  return tally;
}

/** `GET /api/v1/issues/{id}/stakes`: the issue's stakes, newest first, with a contest's votes. */
export async function listIssueStakes(scope: Scope, ref: string) {
  const bugId = await prisma.$transaction(async (tx) => {
    const bug = await lockBug(tx, scope, ref);
    await settleLocked(tx, bug.id, Date.now());
    return bug.id;
  });
  const stakes = await prisma.issueStake.findMany({ where: { bugId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: stakeView });
  const tally = await contestTally(prisma as unknown as Tx, stakes.filter((s) => s.status === "contested").map((s) => s.id));
  return { issueId: bugId, items: stakes.map((stake) => stakeJson(stake, stake.status === "contested" ? tally.get(stake.id) ?? 0 : undefined)) };
}

// ---------------------------------------------------------------------------
// Settling: drops, wins and contests
// ---------------------------------------------------------------------------

async function endStake(tx: Tx, stakeId: string, status: StakeStatus, resolution: string, at: Date) {
  await tx.issueStake.update({ where: { id: stakeId }, data: { status, resolution, resolvedAt: at } });
  await tx.stakeVote.deleteMany({ where: { stakeId } });
}

/** The other contender, once one leaves the contest: back to an open window (it wins at once if its 10 minutes passed). */
async function reopenPartner(tx: Tx, bugId: string, leftId: string, at: Date) {
  const partner = await tx.issueStake.findFirst({ where: { bugId, status: "contested", id: { not: leftId } }, select: { id: true, createdAt: true } });
  if (!partner) return;
  const windowEnd = Math.max(partner.createdAt.getTime() + STAKE_WINDOW_MS, at.getTime());
  await tx.issueStake.update({ where: { id: partner.id }, data: { status: "open", contestEndsAt: null, windowEndsAt: new Date(windowEnd) } });
  await tx.stakeVote.deleteMany({ where: { bugId } });
}

/**
 * Settles one issue's stakes, with its row locked FOR UPDATE: drops stakes
 * not refreshed in time, ends them if the issue was taken another way, awards
 * an uncontested stake whose window passed, and decides a contest whose time
 * is up.
 */
export async function settleLocked(tx: Tx, bugId: string, now: number) {
  const at = new Date(now);
  const live = await tx.issueStake.findMany({
    where: { bugId, status: { in: ON_ISSUE } },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, lastRefreshAt: true, agentId: true },
  });
  if (live.length === 0) return;
  const bug = await tx.bug.findUniqueOrThrow({ where: { id: bugId }, select: { id: true, number: true, title: true, organisationId: true, projectId: true, substatus: true, isDeleted: true, assigneeId: true, assignee: { select: { name: true } } } });

  // Proof of life.
  for (const stake of live) {
    if (now - stake.lastRefreshAt.getTime() > STAKE_REFRESH_MS) {
      await endStake(tx, stake.id, "dropped", "no_refresh", at);
      if (stake.status === "contested") await reopenPartner(tx, bugId, stake.id, at);
      await publish(tx, { organisationId: bug.organisationId, type: "issue.stake_ended", actorAgentId: stake.agentId, bugId, projectId: bug.projectId,
        payload: { stakeId: stake.id, issueId: bugId, issueNumber: bug.number, agentId: stake.agentId, status: "dropped", resolution: "no_refresh" } });
    }
  }

  const remaining = await tx.issueStake.findMany({
    where: { bugId, status: { in: ON_ISSUE } },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, createdAt: true, windowEndsAt: true, contestEndsAt: true, agentId: true, beneficiaryUserId: true },
  });
  if (remaining.length === 0) return;

  const workflow = await workflowFor(bug.projectId, tx);
  // Taken another way (closed, deleted, or held through an award).
  if (bug.isDeleted || !TAKEABLE.has(bug.substatus) || (await heldNow(tx, bugId, workflow.offerWindowSeconds, now))) {
    for (const stake of remaining) await endStake(tx, stake.id, "lost", bug.isDeleted || bug.substatus === "closed" ? "closed" : "taken", at);
    return;
  }

  const open = remaining.find((stake) => stake.status === "open");
  if (open && remaining.length === 1 && open.windowEndsAt && open.windowEndsAt.getTime() <= now) {
    await winStake(tx, bug, open, workflow, "won", at);
    return;
  }
  const contested = remaining.filter((stake) => stake.status === "contested");
  if (contested.length === 2 && contested[0].contestEndsAt && contested[0].contestEndsAt.getTime() <= now) {
    const tally = await contestTally(tx, contested.map((stake) => stake.id));
    const [first, second] = contested; // oldest first
    const a = tally.get(first.id) ?? 0;
    const b = tally.get(second.id) ?? 0;
    const winner = b > a ? second : first;
    const loser = winner === first ? second : first;
    const resolution = a === b ? "tie_earlier" : "outvoted";
    // The winner must still be able to take it; otherwise the other stake does.
    if (await winStake(tx, bug, winner, workflow, resolution === "tie_earlier" ? "won_tie" : "won_vote", at)) {
      await endStake(tx, loser.id, "lost", resolution, at);
    } else {
      // The winner was at its in-progress limit by now (winStake dropped it): the other stake takes it, if it can.
      await winStake(tx, bug, loser, workflow, "won_capacity", at);
    }
  }
}

/**
 * A winning stake takes the issue: an active claim at once (no offer to
 * accept; the refreshes proved the agent is there), its owner the assignee,
 * In progress, the other bids withdrawn. Returns false, ending the stake, when
 * its owner is at the in-progress limit by now.
 */
async function winStake(
  tx: Tx,
  bug: { id: string; number: number; title: string; organisationId: string; projectId: string; substatus: Substatus; assigneeId: string | null; assignee: { name: string | null } | null },
  stake: { id: string; agentId: string; beneficiaryUserId: string },
  workflow: ProjectWorkflowValues,
  resolution: string,
  at: Date,
): Promise<boolean> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${stake.beneficiaryUserId} FOR UPDATE`;
  const inProgress = await tx.issueClaim.count({
    where: { beneficiaryUserId: stake.beneficiaryUserId, status: "active", releasedAt: null, bug: { organisationId: bug.organisationId, projectId: bug.projectId, isDeleted: false, status: "in_progress" } },
  });
  if (inProgress >= workflow.stakeInProgressLimit) {
    await endStake(tx, stake.id, "dropped", "capacity", at);
    return false;
  }
  const beneficiary = await tx.user.findUniqueOrThrow({ where: { id: stake.beneficiaryUserId }, select: { name: true } });
  const deliverBy = deliveryDeadline(at, deliveryWindowMinutes(workflow.deliveryMinutes));
  const claim = await tx.issueClaim.create({
    data: { bugId: bug.id, beneficiaryUserId: stake.beneficiaryUserId, agentId: stake.agentId, status: "active", claimedAt: at, lastHeartbeatAt: at, deliverBy },
  });
  await tx.issueStake.update({ where: { id: stake.id }, data: { status: "won", resolution, resolvedAt: at, claimId: claim.id } });
  await tx.stakeVote.deleteMany({ where: { bugId: bug.id } });
  await tx.bug.update({ where: { id: bug.id }, data: { assigneeId: stake.beneficiaryUserId, ...moveTo("in_progress") } });
  await tx.bugActivity.createMany({
    data: [
      ...(bug.assigneeId !== stake.beneficiaryUserId
        ? [{ bugId: bug.id, actorId: stake.beneficiaryUserId, type: "assignee_changed" as const, summary: assigneeChangedSummary(bug.assignee?.name ?? null, beneficiary.name), metadata: { field: "assignee", from: bug.assigneeId, to: stake.beneficiaryUserId, via: "stake", stakeId: stake.id } }]
        : []),
      { bugId: bug.id, actorId: stake.beneficiaryUserId, type: "status_changed" as const, summary: statusChangedSummary(bug.substatus, "in_progress"), metadata: { field: "status", from: bug.substatus, to: "in_progress", via: "stake", stakeId: stake.id } },
    ],
  });
  await ensureWatching(tx, bug.id, [stake.beneficiaryUserId]);
  await tx.issueBid.updateMany({ where: { bugId: bug.id, withdrawnAt: null, awardedAt: null }, data: { withdrawnAt: at } });
  await publish(tx, {
    organisationId: bug.organisationId, type: "claim.accepted", actorAgentId: stake.agentId, bugId: bug.id, projectId: bug.projectId,
    payload: { claimId: claim.id, issueId: bug.id, projectId: bug.projectId, beneficiaryUserId: stake.beneficiaryUserId, stakeId: stake.id },
  });
  await publish(tx, {
    organisationId: bug.organisationId, type: "issue.stake_ended", actorAgentId: stake.agentId, bugId: bug.id, projectId: bug.projectId,
    payload: { stakeId: stake.id, issueId: bug.id, issueNumber: bug.number, agentId: stake.agentId, status: "won", resolution, claimId: claim.id },
  });
  return true;
}

/**
 * Settles every live stake (the platform runner, each minute; and the work
 * feed for one project): drops idea stakes past 24 hours and settles each
 * issue that has a live stake.
 */
export async function sweepStakes(filter: { organisationId?: string; projectId?: string } = {}): Promise<{ settled: number }> {
  const now = Date.now();
  await prisma.issueStake.updateMany({
    where: { ...filter, status: "waiting", expiresAt: { lte: new Date(now) } },
    data: { status: "dropped", resolution: "idea_timeout", resolvedAt: new Date(now) },
  });
  const bugs = await prisma.issueStake.findMany({
    where: { ...filter, status: { in: ON_ISSUE }, bugId: { not: null } },
    distinct: ["bugId"],
    select: { bugId: true },
  });
  let settled = 0;
  for (const { bugId } of bugs) {
    if (!bugId) continue;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${bugId} FOR UPDATE`;
      await settleLocked(tx, bugId, now);
    });
    settled += 1;
  }
  return { settled };
}

/** Whether an issue has a live stake: while it does, its bids are not awarded (lib/agent-api/bid.ts). */
export async function hasLiveStake(tx: Tx, bugId: string): Promise<boolean> {
  return Boolean(await tx.issueStake.findFirst({ where: { bugId, status: { in: ON_ISSUE } }, select: { id: true } }));
}

/** An agent's own live stakes in a project, for its work feed. */
export async function liveStakesOf(agentId: string, projectId: string) {
  return prisma.issueStake.findMany({
    where: { agentId, projectId, status: { in: LIVE } },
    orderBy: { createdAt: "asc" },
    select: { ...stakeView, bug: { select: { id: true, number: true, title: true } }, idea: { select: { id: true, number: true, title: true } } },
  });
}

/** The contests in a project, for the work feed's vote items. */
export async function contestsIn(projectId: string) {
  const stakes = await prisma.issueStake.findMany({
    where: { projectId, status: "contested", bugId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { id: true, agentId: true, beneficiaryUserId: true, summary: true, contestEndsAt: true, agent: { select: { name: true } }, bug: { select: { id: true, number: true, title: true } }, votes: { select: { onBehalfOfUserId: true } } },
  });
  const byIssue = new Map<string, typeof stakes>();
  for (const stake of stakes) {
    if (!stake.bug) continue;
    byIssue.set(stake.bug.id, [...(byIssue.get(stake.bug.id) ?? []), stake]);
  }
  return [...byIssue.values()].filter((pair) => pair.length === 2);
}
