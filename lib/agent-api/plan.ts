import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, PlanScale } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { requireLevel } from "@/lib/agents/levels";
import { IssueApiError } from "@/lib/agent-api/errors";
import { publish } from "@/lib/agent-api/events";
import { workflowFor } from "@/lib/workflow";
import { entryDescription, entryReplySelect, entrySummary, toEntryReplies, type EntryReply } from "@/lib/agent-api/entry-fields";
import { issueIdFor } from "@/lib/issue-ref";
import { moveTo } from "@/lib/issue-substatus";

import { assigneeChangedSummary, statusChangedSummary } from "@/lib/activity-log";
import { ensureWatching } from "@/lib/watch";
import { notifyPlanSubmitted } from "@/lib/agent-notifications";

/**
 * Plan review (#plan-review, docs/plan-review.md): on a complex issue the
 * award opens plan review instead of an offer, and accepting any other offer
 * (a proactive offer, a hand-over, an assignment) opens it too (offer.ts). The awarded agent writes its
 * plan, the Plan review step's entry: how it read the task, its assumptions
 * and uncertainties, the steps, an estimate, a risk and a confidence. The
 * agent's owner, the claim's beneficiary, alone decides: approve starts the
 * claim with a deadline from the estimate; send back returns it with the
 * owner's edited steps (each change attributed to them) and restarts the
 * window, at most twice; the agent resubmits or refuses. Approving pays
 * nothing: planning is part of the fix, paid in the fixer's share when the
 * issue pays out (#one-payment). When the window runs out the award is released and the issue is
 * Open for bids again; as after an expired offer, the awarded bid never
 * counts again (lib/open-bids.ts) and the agent bids afresh.
 */

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

export const PLAN_SCALES = ["low", "medium", "high"] as const;
/** Rounds a plan can go: the first submission and one after each of two send-backs. */
export const MAX_PLAN_ROUNDS = 3;
export const MAX_PLAN_STEPS = 50;
/** The longest estimate a plan may set: a week, so a plan can't push the deadline out of sight. */
export const MAX_ESTIMATE_MINUTES = 7 * 24 * 60;

export type PlanStep = { id: string; text: string; by: "agent" | "owner"; at: string };

const id = z.string().trim().min(1).max(191);
const stepText = z.string().trim().min(1).max(500);
const prose = (max: number) => z.string().trim().min(1).max(max);

export const planSchema = z.object({
  projectId: id.optional(),
  summary: entrySummary,
  description: entryDescription,
  /** How the agent read the task. */
  reading: prose(1000),
  assumptions: prose(2000),
  uncertainties: prose(2000),
  steps: z.array(stepText).min(1).max(MAX_PLAN_STEPS),
  estimateMinutes: z.number().int().min(5).max(MAX_ESTIMATE_MINUTES),
  risk: z.enum(PLAN_SCALES),
  confidence: z.enum(PLAN_SCALES),
}).strict();

export type PlanInput = z.infer<typeof planSchema>;

/** The owner's edited steps on a send-back: a kept step carries its id, a new or changed one its text. */
export const ownerStepsSchema = z.array(z.object({ id: z.string().trim().min(1).max(64).optional(), text: stepText })).min(1).max(MAX_PLAN_STEPS);

/** Parses a raw plan body, throwing a 400 `IssueApiError` that names the field. */
export function parsePlan(raw: unknown): PlanInput {
  const parsed = planSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = typeof issue?.path[0] === "string" ? issue.path[0] : undefined;
  const message = issue?.code === "unrecognized_keys"
    ? `Unknown field: ${(issue as { keys?: string[] }).keys?.join(", ")}. Send summary, description, reading, assumptions, uncertainties, steps, estimateMinutes, risk and confidence.`
    : field
      ? `${field}: ${issue?.message ?? "invalid"}`
      : issue?.message ?? "Invalid plan.";
  throw new IssueApiError(400, message, { error: "invalid_request", message, ...(field ? { field } : {}) });
}

function refuse(status: number, error: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new IssueApiError(status, message, { error, message, ...extra });
}

/** When plan review runs out: the last send-back plus the window, else the award plus the window. */
export function planDeadline(claim: { offeredAt: Date | null; createdAt: Date }, plan: { reviewBy: Date } | null, planReviewSeconds: number): Date {
  if (plan) return plan.reviewBy;
  const start = claim.offeredAt ?? claim.createdAt;
  return new Date(start.getTime() + planReviewSeconds * 1000);
}

const planSelect = {
  id: true, bugId: true, claimId: true, agentId: true, ownerId: true,
  summary: true, description: true, reading: true, assumptions: true, uncertainties: true,
  steps: true, estimateMinutes: true, risk: true, confidence: true, round: true,
  submittedAt: true, decision: true, decidedAt: true, decisionNote: true, reviewBy: true,
  createdAt: true, updatedAt: true,
  agent: { select: { name: true } },
  owner: { select: { name: true } },
  claim: { select: { status: true, releasedAt: true, releaseReason: true, offeredAt: true, createdAt: true, claimedAt: true, deliverBy: true } },
  revisions: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    select: { id: true, round: true, kind: true, steps: true, reading: true, assumptions: true, uncertainties: true, estimateMinutes: true, risk: true, confidence: true, note: true, byUserId: true, byAgentId: true, createdAt: true },
  },
  replies: entryReplySelect,
} satisfies Prisma.PlanSelect;

type PlanRow = Prisma.PlanGetPayload<{ select: typeof planSelect }>;

export type PlanRevisionView = {
  id: string;
  round: number;
  kind: "submitted" | "sent_back" | "approved";
  steps: PlanStep[];
  reading: string;
  assumptions: string;
  uncertainties: string;
  estimateMinutes: number;
  risk: PlanScale;
  confidence: PlanScale;
  note: string | null;
  byUserId: string;
  byAgentId: string | null;
  createdAt: Date;
};

export type PlanView = {
  id: string;
  bugId: string;
  claimId: string;
  agentId: string;
  agentName: string;
  ownerId: string;
  ownerName: string;
  summary: string;
  description: string;
  reading: string;
  assumptions: string;
  uncertainties: string;
  steps: PlanStep[];
  estimateMinutes: number;
  risk: PlanScale;
  confidence: PlanScale;
  round: number;
  /** How many send-backs are left before the next submission is final. */
  sendBacksLeft: number;
  submittedAt: Date;
  decision: "approved" | "sent_back" | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  reviewBy: Date;
  /** Whether the claim this plan is for still holds the issue. */
  live: boolean;
  claimStatus: string;
  revisions: PlanRevisionView[];
  replies: EntryReply[];
  createdAt: Date;
  updatedAt: Date;
};

export function toSteps(raw: unknown): PlanStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((step) => {
    if (!step || typeof step !== "object") return [];
    const { id, text, by, at } = step as Record<string, unknown>;
    if (typeof id !== "string" || typeof text !== "string") return [];
    return [{ id, text, by: by === "owner" ? "owner" : "agent", at: typeof at === "string" ? at : "" }];
  });
}

export function planView(row: PlanRow): PlanView {
  const { agent, owner, claim, revisions, replies, ...plan } = row;
  return {
    ...plan,
    agentName: agent.name,
    ownerName: owner.name ?? "A member",
    steps: toSteps(plan.steps),
    sendBacksLeft: Math.max(0, MAX_PLAN_ROUNDS - plan.round),
    live: claim.status === "planning" && !claim.releasedAt,
    claimStatus: claim.status,
    revisions: revisions.map((revision) => ({ ...revision, kind: revision.kind as PlanRevisionView["kind"], steps: toSteps(revision.steps) })),
    replies: toEntryReplies(replies),
  };
}

/** The issue's newest plan (the current claim's while in plan review, else the last one written), or null. */
export async function currentPlan(bugId: string, db: Db = prisma): Promise<PlanView | null> {
  const row = await db.plan.findFirst({ where: { bugId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: planSelect });
  return row ? planView(row) : null;
}

/** The approved plan the issue's work is judged against (#plan-review rule 12), or null. */
export async function approvedPlan(bugId: string, db: Db = prisma): Promise<PlanView | null> {
  const row = await db.plan.findFirst({ where: { bugId, decision: "approved" }, orderBy: [{ decidedAt: "desc" }, { id: "desc" }], select: planSelect });
  return row ? planView(row) : null;
}

/** What judges and the manager read the approved plan as, in the test-results and merge-reviews answers: the entry without its revisions and replies. */
export type ApprovedPlanSummary = Omit<PlanView, "revisions" | "replies">;

export async function approvedPlanSummary(bugId: string, db: Db = prisma): Promise<ApprovedPlanSummary | null> {
  const plan = await approvedPlan(bugId, db);
  if (!plan) return null;
  const summary: Partial<PlanView> = { ...plan };
  delete summary.revisions;
  delete summary.replies;
  return summary as ApprovedPlanSummary;
}

/** `GET /api/v1/issues/{id}/plan`: the issue's current plan with its revisions and replies. */
export async function readPlan(scope: { organisationId: string; projectId: string }, issueRef: string): Promise<{ plan: PlanView | null; deadline: Date | null }> {
  const bugId = await issueIdFor(prisma, issueRef, scope.organisationId);
  const bug = bugId ? await prisma.bug.findFirst({ where: { id: bugId, ...scope, isDeleted: false }, select: { id: true, substatus: true, projectId: true } }) : null;
  if (!bug) throw new IssueApiError(404, "Issue not found in this project.");
  const plan = await currentPlan(bug.id);
  let deadline: Date | null = null;
  if (bug.substatus === "plan_review") {
    const claim = await prisma.issueClaim.findFirst({ where: { bugId: bug.id, status: "planning", releasedAt: null }, select: { offeredAt: true, createdAt: true } });
    if (claim) {
      const { planReviewSeconds } = await workflowFor(bug.projectId);
      deadline = planDeadline(claim, plan?.live ? plan : null, planReviewSeconds);
    }
  }
  return { plan, deadline };
}

type PlanningClaim = { id: string; bugId: string; agentId: string; beneficiaryUserId: string; offeredAt: Date | null; createdAt: Date };

/** Locks the issue and returns its planning claim, or null. */
async function lockPlanningClaim(tx: Tx, bugId: string): Promise<PlanningClaim | null> {
  await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${bugId} AND "isDeleted" = false FOR UPDATE`;
  return tx.issueClaim.findFirst({
    where: { bugId, status: "planning", releasedAt: null },
    select: { id: true, bugId: true, agentId: true, beneficiaryUserId: true, offeredAt: true, createdAt: true },
  });
}

const withId = (text: string, by: PlanStep["by"], at: Date): PlanStep => ({ id: randomUUID().slice(0, 8), text, by, at: at.toISOString() });

/**
 * `POST /api/v1/issues/{id}/plan`: the awarded agent submits its plan, or
 * resubmits after a send-back (the next round). While the plan waits on the
 * owner, submitting again replaces it in the same round.
 */
export async function submitPlan(agent: AgentContext, projectId: string, issueRef: string, raw: unknown) {
  requireLevel(agent, "working");
  const input = parsePlan(raw);
  const result = await prisma.$transaction(async (tx) => {
    const bugId = await issueIdFor(tx, issueRef, agent.organisationId);
    const bug = bugId ? await tx.bug.findFirst({ where: { id: bugId, organisationId: agent.organisationId, projectId, isDeleted: false }, select: { id: true, number: true, title: true, substatus: true, projectId: true } }) : null;
    if (!bug) throw new IssueApiError(404, "Issue not found in this project.");
    const claim = await lockPlanningClaim(tx, bug.id);
    if (bug.substatus !== "plan_review" || !claim) refuse(409, "not_in_plan_review", "This issue is not in plan review.");
    if (claim.agentId !== agent.agentId) refuse(409, "not_holder", "Only the agent awarded this issue writes its plan.");
    const workflow = await workflowFor(bug.projectId, tx);
    const existing = await tx.plan.findUnique({ where: { claimId: claim.id }, select: { id: true, round: true, decision: true, reviewBy: true } });
    if (existing?.decision === "approved") refuse(409, "plan_decided", "This plan was approved; the work is under way.");
    const now = new Date();
    const deadline = planDeadline(claim, existing, workflow.planReviewSeconds);
    if (now.getTime() > deadline.getTime()) refuse(409, "plan_window_closed", "The plan review window has run out; the award is being released.", { deadline: deadline.toISOString() });
    const round = existing ? (existing.decision === "sent_back" ? existing.round + 1 : existing.round) : 1;
    if (round > MAX_PLAN_ROUNDS) refuse(409, "plan_rounds_exhausted", "This plan was sent back twice already.");
    const steps = input.steps.map((text) => withId(text, "agent", now));
    const written = {
      summary: input.summary, description: input.description,
      reading: input.reading, assumptions: input.assumptions, uncertainties: input.uncertainties,
      steps, estimateMinutes: input.estimateMinutes, risk: input.risk, confidence: input.confidence,
      round, submittedAt: now, decision: null, decidedAt: null, decisionNote: null,
      reviewBy: deadline,
    };
    const plan = existing
      ? await tx.plan.update({ where: { id: existing.id }, data: written, select: { id: true } })
      : await tx.plan.create({
        data: { bugId: bug.id, claimId: claim.id, agentId: agent.agentId, ownerId: claim.beneficiaryUserId, ...written },
        select: { id: true },
      });
    await tx.planRevision.create({
      data: {
        planId: plan.id, round, kind: "submitted", steps, reading: input.reading, assumptions: input.assumptions, uncertainties: input.uncertainties,
        estimateMinutes: input.estimateMinutes, risk: input.risk, confidence: input.confidence, byUserId: agent.ownerId, byAgentId: agent.agentId,
      },
    });
    await publish(tx, {
      organisationId: agent.organisationId, type: "plan.submitted", actorAgentId: agent.agentId, bugId: bug.id,
      payload: { planId: plan.id, claimId: claim.id, issueId: bug.id, projectId: bug.projectId, beneficiaryUserId: claim.beneficiaryUserId, round, reviewBy: deadline.toISOString() },
    });
    return { planId: plan.id, round, reviewBy: deadline, bug, claim };
  }, { maxWait: 10000, timeout: 15000 });
  notifyPlanSubmitted({ id: result.planId, bugId: result.bug.id, bugTitle: result.bug.title, organisationId: agent.organisationId, ownerUserId: result.claim.beneficiaryUserId, round: result.round, agent: { name: agent.name } });
  return { planId: result.planId, round: result.round, reviewBy: result.reviewBy.toISOString(), status: "waiting" as const };
}

type Decider = { userId: string };

/**
 * The plan waiting on this owner's decision, locked, or a 409 saying why not.
 * `expectedVersion` is the plan's `updatedAt` the owner read: the agent may
 * replace a waiting plan, so a decision on a version the owner never saw is
 * refused (`plan_changed`) and the page reloads with the new one.
 */
async function lockWaitingPlan(tx: Tx, decider: Decider, bugId: string, expectedVersion?: Date | string | null) {
  const claim = await lockPlanningClaim(tx, bugId);
  if (!claim) refuse(409, "not_in_plan_review", "This issue is not in plan review.");
  const plan = await tx.plan.findUnique({ where: { claimId: claim.id }, select: { id: true, round: true, decision: true, reviewBy: true, steps: true, ownerId: true, estimateMinutes: true, reading: true, assumptions: true, uncertainties: true, risk: true, confidence: true, agentId: true, bugId: true, updatedAt: true } });
  if (!plan) refuse(409, "no_plan_yet", "The agent has not submitted its plan yet.");
  if (plan.ownerId !== decider.userId) refuse(403, "not_owner", "Only the agent's owner decides its plan.");
  if (plan.decision === "approved") refuse(409, "plan_decided", "This plan was already approved.");
  if (plan.decision === "sent_back") refuse(409, "plan_sent_back", "The plan is with the agent: wait for it to resubmit, or for the window to run out.");
  if (Date.now() > plan.reviewBy.getTime()) refuse(409, "plan_window_closed", "The plan review window has run out; the award is being released.");
  if (expectedVersion != null && new Date(expectedVersion).getTime() !== plan.updatedAt.getTime()) {
    refuse(409, "plan_changed", "The agent changed the plan since you read it. Reload and read the new version before deciding.", { updatedAt: plan.updatedAt.toISOString() });
  }
  return { claim, plan };
}

/**
 * The owner approves the plan (browser only, never an agent key): the claim
 * becomes active with a deadline of now plus the estimate, the issue moves to
 * In progress · In progress and the other bids are withdrawn. Nothing is paid
 * here: approving your own agent's plan earns nothing on its own.
 */
export async function approvePlan(decider: Decider, bugId: string, expectedVersion?: Date | string | null) {
  return prisma.$transaction(async (tx) => {
    const { claim, plan } = await lockWaitingPlan(tx, decider, bugId, expectedVersion);
    const bug = await tx.bug.findUniqueOrThrow({ where: { id: bugId }, select: { id: true, number: true, title: true, organisationId: true, projectId: true, assigneeId: true, assignee: { select: { name: true } } } });
    const beneficiary = await tx.user.findUniqueOrThrow({ where: { id: claim.beneficiaryUserId }, select: { name: true } });
    const now = new Date();
    const deliverBy = new Date(now.getTime() + plan.estimateMinutes * 60_000);
    await tx.plan.update({ where: { id: plan.id }, data: { decision: "approved", decidedAt: now, decisionNote: null } });
    await tx.planRevision.create({
      data: {
        planId: plan.id, round: plan.round, kind: "approved", steps: plan.steps as Prisma.InputJsonValue, reading: plan.reading, assumptions: plan.assumptions, uncertainties: plan.uncertainties,
        estimateMinutes: plan.estimateMinutes, risk: plan.risk, confidence: plan.confidence, byUserId: decider.userId,
      },
    });
    await tx.issueClaim.update({ where: { id: claim.id }, data: { status: "active", claimedAt: now, lastHeartbeatAt: now, deliverBy } });
    await tx.bug.update({ where: { id: bugId }, data: { assigneeId: claim.beneficiaryUserId, ...moveTo("in_progress") } });
    await tx.bugActivity.createMany({ data: [
      ...(bug.assigneeId !== claim.beneficiaryUserId ? [{ bugId, actorId: decider.userId, type: "assignee_changed" as const, summary: assigneeChangedSummary(bug.assignee?.name ?? null, beneficiary.name), metadata: { field: "assignee", from: bug.assigneeId, to: claim.beneficiaryUserId } }] : []),
      { bugId, actorId: decider.userId, type: "status_changed" as const, summary: statusChangedSummary("plan_review", "in_progress"), metadata: { field: "status", from: "plan_review", to: "in_progress", via: "plan_approved", planId: plan.id } },
    ] });
    await ensureWatching(tx, bugId, [claim.beneficiaryUserId]);
    // The award is taken up: the other open bids on the issue are withdrawn, as on an accepted offer.
    await tx.issueBid.updateMany({ where: { bugId, withdrawnAt: null, awardedAt: null }, data: { withdrawnAt: now } });
    await publish(tx, {
      organisationId: bug.organisationId, type: "plan.approved", actorAgentId: null, bugId,
      payload: { planId: plan.id, claimId: claim.id, issueId: bugId, projectId: bug.projectId, beneficiaryUserId: claim.beneficiaryUserId, round: plan.round, deliverBy: deliverBy.toISOString(), decidedByUserId: decider.userId },
    });
    await publish(tx, {
      organisationId: bug.organisationId, type: "claim.accepted", actorAgentId: claim.agentId, bugId,
      payload: { claimId: claim.id, issueId: bugId, projectId: bug.projectId, beneficiaryUserId: claim.beneficiaryUserId, via: "plan_approved" },
    });
    return { planId: plan.id, claimId: claim.id, deliverBy };
  }, { maxWait: 10000, timeout: 15000 });
}

/**
 * The owner sends the plan back with edited steps and a note. A step kept as
 * it was stays the agent's; an edited, inserted or reordered one is the
 * owner's. At most two send-backs: the third submission is final.
 */
export async function sendBackPlan(decider: Decider, bugId: string, input: { steps: z.infer<typeof ownerStepsSchema>; note: string; expectedVersion?: Date | string | null }) {
  const note = input.note.trim();
  if (!note) refuse(400, "note_required", "Say what the agent should change.", { field: "note" });
  if (note.length > 2000) refuse(400, "note_too_long", "Keep the note under 2000 characters.", { field: "note" });
  const edited = ownerStepsSchema.parse(input.steps);
  return prisma.$transaction(async (tx) => {
    const { claim, plan } = await lockWaitingPlan(tx, decider, bugId, input.expectedVersion);
    if (plan.round >= MAX_PLAN_ROUNDS) refuse(409, "plan_rounds_exhausted", "This plan was sent back twice already: approve it, or let the window run out.");
    const bug = await tx.bug.findUniqueOrThrow({ where: { id: bugId }, select: { id: true, organisationId: true, projectId: true } });
    const now = new Date();
    const before = new Map(toSteps(plan.steps).map((step) => [step.id, step]));
    const steps: PlanStep[] = edited.map((step, index) => {
      const kept = step.id ? before.get(step.id) : undefined;
      const samePlace = kept && toSteps(plan.steps)[index]?.id === kept.id;
      return kept && kept.text === step.text && samePlace ? kept : withId(step.text, "owner", now);
    });
    const { planReviewSeconds } = await workflowFor(bug.projectId, tx);
    const reviewBy = new Date(now.getTime() + planReviewSeconds * 1000);
    await tx.plan.update({ where: { id: plan.id }, data: { decision: "sent_back", decidedAt: now, decisionNote: note, steps, reviewBy } });
    await tx.planRevision.create({
      data: {
        planId: plan.id, round: plan.round, kind: "sent_back", steps, reading: plan.reading, assumptions: plan.assumptions, uncertainties: plan.uncertainties,
        estimateMinutes: plan.estimateMinutes, risk: plan.risk, confidence: plan.confidence, note, byUserId: decider.userId,
      },
    });
    await publish(tx, {
      organisationId: bug.organisationId, type: "plan.sent_back", actorAgentId: null, bugId,
      payload: { planId: plan.id, claimId: claim.id, issueId: bugId, projectId: bug.projectId, beneficiaryUserId: claim.beneficiaryUserId, round: plan.round, reviewBy: reviewBy.toISOString(), decidedByUserId: decider.userId, note },
    });
    return { planId: plan.id, round: plan.round, reviewBy, sendBacksLeft: MAX_PLAN_ROUNDS - plan.round - 1 };
  }, { maxWait: 10000, timeout: 15000 });
}

export type PlanReleaseReason = "plan_refused" | "plan_expired" | "owner_unresponsive" | "declined";

/**
 * Releases a planning claim and sends its issue back to Open · Open for bids,
 * in the caller's transaction with the issue locked. An awarded bid never
 * counts as open again (lib/open-bids.ts); `withdrawBid` marks it withdrawn
 * as well, so a refusal reads as one on the issue page.
 */
export async function releasePlanningClaim(
  tx: Tx,
  claim: { id: string; bugId: string; agentId: string; beneficiaryUserId: string },
  reason: PlanReleaseReason,
  options: { withdrawBid?: boolean; actorAgentId?: string | null; organisationId: string } ,
): Promise<void> {
  const now = new Date();
  await tx.issueClaim.update({ where: { id: claim.id }, data: { status: "released", releasedAt: now, releaseReason: reason } });
  if (options.withdrawBid) {
    await tx.issueBid.updateMany({ where: { claimId: claim.id, withdrawnAt: null }, data: { withdrawnAt: now } });
  }
  const moved = await tx.bug.updateMany({ where: { id: claim.bugId, substatus: "plan_review", isDeleted: false }, data: { assigneeId: null, ...moveTo("open") } });
  if (moved.count) {
    await tx.bugActivity.create({ data: { bugId: claim.bugId, actorId: claim.beneficiaryUserId, type: "status_changed", summary: statusChangedSummary("plan_review", "open"), metadata: { field: "status", from: "plan_review", to: "open", via: reason, claimId: claim.id } } });
  }
  await publish(tx, {
    organisationId: options.organisationId, type: "claim.released", actorAgentId: options.actorAgentId ?? null, bugId: claim.bugId,
    payload: { claimId: claim.id, issueId: claim.bugId, beneficiaryUserId: claim.beneficiaryUserId, reason },
  });
}

/**
 * `POST /api/v1/issues/{id}/plan/refuse`: the awarded agent refuses the plan
 * its owner sent back. The award is released, its bid withdrawn, and the
 * issue is Open for other bids.
 */
export async function refusePlan(agent: AgentContext, projectId: string, issueRef: string) {
  requireLevel(agent, "working");
  return prisma.$transaction(async (tx) => {
    const bugId = await issueIdFor(tx, issueRef, agent.organisationId);
    const bug = bugId ? await tx.bug.findFirst({ where: { id: bugId, organisationId: agent.organisationId, projectId, isDeleted: false }, select: { id: true, substatus: true, projectId: true } }) : null;
    if (!bug) throw new IssueApiError(404, "Issue not found in this project.");
    const claim = await lockPlanningClaim(tx, bug.id);
    if (bug.substatus !== "plan_review" || !claim) refuse(409, "not_in_plan_review", "This issue is not in plan review.");
    if (claim.agentId !== agent.agentId) refuse(409, "not_holder", "Only the agent awarded this issue can refuse its plan.");
    const plan = await tx.plan.findUnique({ where: { claimId: claim.id }, select: { id: true, decision: true, round: true } });
    if (!plan || plan.decision !== "sent_back") refuse(409, "plan_not_sent_back", "There is nothing to refuse: refuse a plan your owner sent back with edits. To give the award up otherwise, release the claim.");
    await releasePlanningClaim(tx, claim, "plan_refused", { withdrawBid: true, actorAgentId: agent.agentId, organisationId: agent.organisationId });
    await publish(tx, {
      organisationId: agent.organisationId, type: "plan.refused", actorAgentId: agent.agentId, bugId: bug.id,
      payload: { planId: plan.id, claimId: claim.id, issueId: bug.id, projectId: bug.projectId, beneficiaryUserId: claim.beneficiaryUserId, round: plan.round },
    });
    return { planId: plan.id, claimId: claim.id, issueId: bug.id, released: true as const, reason: "plan_refused" as const };
  }, { maxWait: 10000, timeout: 15000 });
}

/**
 * Releases every planning claim whose window ran out (#plan-review rule 11):
 * `owner_unresponsive` when a submitted plan was waiting on the owner,
 * `plan_expired` when the agent never submitted or never resubmitted. The
 * issue goes back to Open for bids (the agent bids afresh). Run by the
 * platform sweeper; idempotent.
 */
export async function sweepPlanWindows(organisationId?: string, projectId?: string): Promise<{ expired: number }> {
  const candidates = await prisma.issueClaim.findMany({
    where: {
      status: "planning", releasedAt: null,
      ...(organisationId || projectId ? { bug: { ...(organisationId ? { organisationId } : {}), ...(projectId ? { projectId } : {}) } } : {}),
    },
    select: { id: true, bugId: true, offeredAt: true, createdAt: true, bug: { select: { projectId: true, organisationId: true } }, plan: { select: { id: true, decision: true, reviewBy: true, round: true } } },
  });
  const now = Date.now();
  let expired = 0;
  for (const candidate of candidates) {
    const { planReviewSeconds } = await workflowFor(candidate.bug.projectId);
    const deadline = planDeadline(candidate, candidate.plan, planReviewSeconds);
    if (now <= deadline.getTime()) continue;
    const released = await prisma.$transaction(async (tx) => {
      const claim = await lockPlanningClaim(tx, candidate.bugId);
      if (!claim || claim.id !== candidate.id) return false;
      // Re-read under the lock: a send-back or a resubmission since the shortlist restarted the window.
      const plan = await tx.plan.findUnique({ where: { claimId: claim.id }, select: { id: true, decision: true, reviewBy: true, round: true } });
      if (Date.now() <= planDeadline(claim, plan, planReviewSeconds).getTime()) return false;
      const reason: PlanReleaseReason = plan && plan.decision === null ? "owner_unresponsive" : "plan_expired";
      await releasePlanningClaim(tx, claim, reason, { organisationId: candidate.bug.organisationId });
      await publish(tx, {
        organisationId: candidate.bug.organisationId, type: "plan.expired", actorAgentId: null, bugId: claim.bugId,
        payload: { planId: plan?.id ?? null, claimId: claim.id, issueId: claim.bugId, projectId: candidate.bug.projectId, beneficiaryUserId: claim.beneficiaryUserId, reason, round: plan?.round ?? 0 },
      });
      return true;
    }, { maxWait: 10000, timeout: 15000 });
    if (released) expired++;
  }
  return { expired };
}
