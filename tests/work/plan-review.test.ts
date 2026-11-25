import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "@/lib/agents/require-agent";

/**
 * Plan review (#plan-review, docs/plan-review.md): on a complex issue the
 * awarded agent alone writes the plan, its owner alone decides it, approval
 * starts the claim with a deadline from the estimate and pays once, a
 * send-back attributes the owner's edited steps and restarts the window (at
 * most twice), a refusal and a lapsed window send the issue back to Open.
 */
const db = vi.hoisted(() => {
  const mock = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    bug: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    bugActivity: { create: vi.fn(), createMany: vi.fn() },
    issueClaim: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    plan: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    planRevision: { create: vi.fn() },
    issueBid: { updateMany: vi.fn() },
    user: { findUniqueOrThrow: vi.fn() },
    organisation: { findUnique: vi.fn() },
  };
  mock.$transaction.mockImplementation((run: (tx: typeof mock) => unknown) => run(mock));
  return mock;
});
const publish = vi.hoisted(() => vi.fn(async () => ({ id: "evt" })));
const notifyPlanSubmitted = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agent-api/events", () => ({ publish }));
vi.mock("@/lib/watch", () => ({ ensureWatching: vi.fn(async () => undefined) }));
vi.mock("@/lib/agent-notifications", () => ({ notifyPlanSubmitted }));
vi.mock("@/lib/workflow", async (original) => {
  const { DEFAULT_PROJECT_WORKFLOW } = await import("@/lib/workflow-config");
  return { ...await original<typeof import("@/lib/workflow")>(), workflowFor: vi.fn(async () => ({ ...DEFAULT_PROJECT_WORKFLOW })) };
});

import { approvePlan, MAX_PLAN_ROUNDS, planDeadline, refusePlan, sendBackPlan, submitPlan, sweepPlanWindows } from "@/lib/agent-api/plan";

const bob: AgentContext = { agentId: "agent-bob", name: "Bob's agent", ownerId: "bob", organisationId: "t1", level: "working", burst: false, keyId: "k1" };
const cara: AgentContext = { ...bob, agentId: "agent-cara", name: "Cara's agent", ownerId: "cara" };

const HOUR = 60 * 60_000;
const awardedAt = new Date(Date.now() - HOUR);
const claim = { id: "claim1", bugId: "bug1", agentId: "agent-bob", beneficiaryUserId: "bob", offeredAt: awardedAt, createdAt: awardedAt };
const planning = { id: "bug1", number: 5, title: "Learners drop off", substatus: "plan_review", projectId: "p1", organisationId: "t1", assigneeId: null, assignee: null };

const input = {
  summary: "Measure the drop-off, then fix the biggest friction point.",
  description: "Funnel first, then the smallest change behind a flag.",
  reading: "Learners who sign up but don't finish the first lesson within 24 hours.",
  assumptions: "The funnel data exists.",
  uncertainties: "Copy fix or redesign.",
  steps: ["Measure", "Pick the worst step", "Ship the smallest change"],
  estimateMinutes: 240,
  risk: "medium",
  confidence: "high",
};

const steps = (by: ("agent" | "owner")[] = ["agent", "agent", "agent"]) => input.steps.map((text, index) => ({ id: `s${index + 1}`, text, by: by[index], at: "" }));
const storedPlan = (overrides: Record<string, unknown> = {}) => ({
  id: "plan1", round: 1, decision: null, reviewBy: new Date(Date.now() + HOUR), steps: steps(), ownerId: "bob", updatedAt: new Date("2026-11-05T10:00:00Z"),
  estimateMinutes: 240, reading: input.reading, assumptions: input.assumptions, uncertainties: input.uncertainties, risk: "medium", confidence: "high", agentId: "agent-bob", bugId: "bug1",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) => run(db));
  db.$queryRaw.mockResolvedValue([{ id: "bug1" }]);
  db.bug.findFirst.mockResolvedValue(planning);
  db.bug.findUniqueOrThrow.mockResolvedValue(planning);
  db.bug.updateMany.mockResolvedValue({ count: 1 });
  db.issueClaim.findFirst.mockResolvedValue(claim);
  db.plan.findUnique.mockResolvedValue(null);
  db.plan.create.mockResolvedValue({ id: "plan1" });
  db.plan.update.mockResolvedValue({ id: "plan1" });
  db.user.findUniqueOrThrow.mockResolvedValue({ name: "Bob" });
  db.organisation.findUnique.mockResolvedValue(null);
  db.issueBid.updateMany.mockResolvedValue({ count: 1 });
});

describe("submitPlan", () => {
  it("takes the awarded agent's plan, with the window counted from the award, and tells the owner", async () => {
    const result = await submitPlan(bob, "p1", "bug1", input);
    expect(result).toMatchObject({ planId: "plan1", round: 1, status: "waiting" });
    const written = db.plan.create.mock.calls[0][0].data;
    expect(written).toMatchObject({ bugId: "bug1", claimId: "claim1", agentId: "agent-bob", ownerId: "bob", round: 1, decision: null, estimateMinutes: 240 });
    expect(written.steps.map((step: { by: string }) => step.by)).toEqual(["agent", "agent", "agent"]);
    expect(new Date(result.reviewBy).getTime()).toBe(awardedAt.getTime() + 2 * HOUR);
    expect(db.planRevision.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "submitted", round: 1, byUserId: "bob", byAgentId: "agent-bob" }) }));
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({ type: "plan.submitted", payload: expect.objectContaining({ planId: "plan1", round: 1 }) }));
    expect(notifyPlanSubmitted).toHaveBeenCalledWith(expect.objectContaining({ id: "plan1", ownerUserId: "bob", round: 1 }));
  });

  it("is the awarded agent's alone, and only while the issue is at Plan review", async () => {
    await expect(submitPlan(cara, "p1", "bug1", input)).rejects.toMatchObject({ status: 409, body: { error: "not_holder" } });
    db.bug.findFirst.mockResolvedValue({ ...planning, substatus: "open" });
    await expect(submitPlan(bob, "p1", "bug1", input)).rejects.toMatchObject({ status: 409, body: { error: "not_in_plan_review" } });
    expect(db.plan.create).not.toHaveBeenCalled();
  });

  it("refuses a plan after the window ran out, an approved one, and a fourth round", async () => {
    db.issueClaim.findFirst.mockResolvedValue({ ...claim, offeredAt: new Date(Date.now() - 3 * HOUR), createdAt: new Date(Date.now() - 3 * HOUR) });
    await expect(submitPlan(bob, "p1", "bug1", input)).rejects.toMatchObject({ status: 409, body: { error: "plan_window_closed" } });
    db.issueClaim.findFirst.mockResolvedValue(claim);
    db.plan.findUnique.mockResolvedValue(storedPlan({ decision: "approved" }));
    await expect(submitPlan(bob, "p1", "bug1", input)).rejects.toMatchObject({ status: 409, body: { error: "plan_decided" } });
    db.plan.findUnique.mockResolvedValue(storedPlan({ decision: "sent_back", round: MAX_PLAN_ROUNDS }));
    await expect(submitPlan(bob, "p1", "bug1", input)).rejects.toMatchObject({ status: 409, body: { error: "plan_rounds_exhausted" } });
  });

  it("resubmits after a send-back as the next round, keeping the restarted window", async () => {
    const reviewBy = new Date(Date.now() + 90 * 60_000);
    db.plan.findUnique.mockResolvedValue(storedPlan({ decision: "sent_back", round: 1, reviewBy }));
    const result = await submitPlan(bob, "p1", "bug1", input);
    expect(result).toMatchObject({ round: 2, reviewBy: reviewBy.toISOString() });
    expect(db.plan.update.mock.calls[0][0].data).toMatchObject({ round: 2, decision: null, decisionNote: null, reviewBy });
  });

  it("names the field a bad plan is missing", async () => {
    await expect(submitPlan(bob, "p1", "bug1", { ...input, steps: [] })).rejects.toMatchObject({ status: 400, body: { error: "invalid_request", field: "steps" } });
    await expect(submitPlan(bob, "p1", "bug1", { ...input, risk: "none" })).rejects.toMatchObject({ status: 400, body: { field: "risk" } });
  });
});

describe("approvePlan", () => {
  it("is the owner's decision: starts the claim with the deadline from the estimate, assigns the issue, withdraws the other bids, and pays nothing", async () => {
    db.plan.findUnique.mockResolvedValue(storedPlan());
    const before = Date.now();
    const result = await approvePlan({ userId: "bob" }, "bug1");
    expect(result).toMatchObject({ planId: "plan1", claimId: "claim1" });
    expect(result.deliverBy.getTime()).toBeGreaterThanOrEqual(before + 240 * 60_000);
    expect(db.issueClaim.update).toHaveBeenCalledWith({ where: { id: "claim1" }, data: expect.objectContaining({ status: "active", claimedAt: expect.any(Date), deliverBy: result.deliverBy }) });
    expect(db.bug.update).toHaveBeenCalledWith({ where: { id: "bug1" }, data: { assigneeId: "bob", status: "in_progress", substatus: "in_progress" } });
    expect(db.plan.update).toHaveBeenCalledWith({ where: { id: "plan1" }, data: expect.objectContaining({ decision: "approved" }) });
    expect(db.issueBid.updateMany).toHaveBeenCalledWith({ where: { bugId: "bug1", withdrawnAt: null, awardedAt: null }, data: { withdrawnAt: expect.any(Date) } });
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({ type: "plan.approved" }));
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({ type: "claim.accepted", payload: expect.objectContaining({ via: "plan_approved" }) }));
  });

  it("refuses a decision on a plan the agent changed since the owner read it", async () => {
    db.plan.findUnique.mockResolvedValue(storedPlan({ updatedAt: new Date("2026-11-05T10:05:00Z") }));
    await expect(approvePlan({ userId: "bob" }, "bug1", "2026-11-05T10:00:00.000Z")).rejects.toMatchObject({ status: 409, body: { error: "plan_changed", updatedAt: "2026-11-05T10:05:00.000Z" } });
    await expect(sendBackPlan({ userId: "bob" }, "bug1", { steps: [{ id: "s1", text: "Measure" }], note: "Again.", expectedVersion: "2026-11-05T10:00:00.000Z" })).rejects.toMatchObject({ status: 409, body: { error: "plan_changed" } });
    expect(db.issueClaim.update).not.toHaveBeenCalled();
    expect(db.plan.update).not.toHaveBeenCalled();
    // The version the owner read matches: the decision goes through.
    await expect(approvePlan({ userId: "bob" }, "bug1", "2026-11-05T10:05:00.000Z")).resolves.toMatchObject({ planId: "plan1" });
  });

  it("refuses anyone but the owner, a plan not yet written, and one already decided", async () => {
    db.plan.findUnique.mockResolvedValue(storedPlan());
    await expect(approvePlan({ userId: "cara" }, "bug1")).rejects.toMatchObject({ status: 403, body: { error: "not_owner" } });
    db.plan.findUnique.mockResolvedValue(null);
    await expect(approvePlan({ userId: "bob" }, "bug1")).rejects.toMatchObject({ status: 409, body: { error: "no_plan_yet" } });
    db.plan.findUnique.mockResolvedValue(storedPlan({ decision: "sent_back" }));
    await expect(approvePlan({ userId: "bob" }, "bug1")).rejects.toMatchObject({ status: 409, body: { error: "plan_sent_back" } });
    db.plan.findUnique.mockResolvedValue(storedPlan({ reviewBy: new Date(Date.now() - 1000) }));
    await expect(approvePlan({ userId: "bob" }, "bug1")).rejects.toMatchObject({ status: 409, body: { error: "plan_window_closed" } });
    expect(db.issueClaim.update).not.toHaveBeenCalled();
  });
});

describe("sendBackPlan", () => {
  it("attributes edited, inserted and moved steps to the owner, keeps the rest the agent's, and restarts the window", async () => {
    db.plan.findUnique.mockResolvedValue(storedPlan());
    const before = Date.now();
    const result = await sendBackPlan({ userId: "bob" }, "bug1", {
      steps: [{ id: "s1", text: "Measure" }, { text: "Talk to three learners first" }, { id: "s2", text: "Pick the worst step, and say which" }, { id: "s3", text: "Ship the smallest change" }],
      note: "Talk to learners before you pick.",
    });
    expect(result).toMatchObject({ round: 1, sendBacksLeft: 1 });
    expect(result.reviewBy.getTime()).toBeGreaterThanOrEqual(before + 2 * HOUR);
    const data = db.plan.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ decision: "sent_back", decisionNote: "Talk to learners before you pick." });
    expect(data.steps.map((step: { text: string; by: string }) => [step.text, step.by])).toEqual([
      ["Measure", "agent"],
      ["Talk to three learners first", "owner"],
      ["Pick the worst step, and say which", "owner"],
      // The same text, but moved: the owner's.
      ["Ship the smallest change", "owner"],
    ]);
    expect(db.planRevision.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "sent_back", byUserId: "bob", note: "Talk to learners before you pick." }) }));
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({ type: "plan.sent_back" }));
  });

  it("needs a note, and allows at most two send-backs", async () => {
    db.plan.findUnique.mockResolvedValue(storedPlan());
    await expect(sendBackPlan({ userId: "bob" }, "bug1", { steps: [{ id: "s1", text: "Measure" }], note: "  " })).rejects.toMatchObject({ status: 400, body: { error: "note_required" } });
    db.plan.findUnique.mockResolvedValue(storedPlan({ round: MAX_PLAN_ROUNDS }));
    await expect(sendBackPlan({ userId: "bob" }, "bug1", { steps: [{ id: "s1", text: "Measure" }], note: "Again." })).rejects.toMatchObject({ status: 409, body: { error: "plan_rounds_exhausted" } });
    expect(db.plan.update).not.toHaveBeenCalled();
  });
});

describe("refusePlan", () => {
  it("releases the award, withdraws the bid and sends the issue back to Open, only after a send-back", async () => {
    db.plan.findUnique.mockResolvedValue(storedPlan({ decision: "sent_back" }));
    await expect(refusePlan(bob, "p1", "bug1")).resolves.toMatchObject({ released: true, reason: "plan_refused" });
    expect(db.issueClaim.update).toHaveBeenCalledWith({ where: { id: "claim1" }, data: expect.objectContaining({ status: "released", releaseReason: "plan_refused" }) });
    expect(db.issueBid.updateMany).toHaveBeenCalledWith({ where: { claimId: "claim1", withdrawnAt: null }, data: { withdrawnAt: expect.any(Date) } });
    expect(db.bug.updateMany).toHaveBeenCalledWith({ where: { id: "bug1", substatus: "plan_review", isDeleted: false }, data: { assigneeId: null, status: "open", substatus: "open" } });
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({ type: "claim.released", payload: expect.objectContaining({ reason: "plan_refused" }) }));
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({ type: "plan.refused" }));
  });

  it("has nothing to refuse while the plan waits on the owner, and is the holder's alone", async () => {
    db.plan.findUnique.mockResolvedValue(storedPlan());
    await expect(refusePlan(bob, "p1", "bug1")).rejects.toMatchObject({ status: 409, body: { error: "plan_not_sent_back" } });
    await expect(refusePlan(cara, "p1", "bug1")).rejects.toMatchObject({ status: 409, body: { error: "not_holder" } });
    expect(db.issueClaim.update).not.toHaveBeenCalled();
  });
});

describe("the plan window", () => {
  it("runs from the award until the last send-back moved it", () => {
    expect(planDeadline(claim, null, 7200).getTime()).toBe(awardedAt.getTime() + 2 * HOUR);
    const moved = new Date(Date.now() + 5 * HOUR);
    expect(planDeadline(claim, { reviewBy: moved }, 7200)).toBe(moved);
  });

  it("releases a lapsed award: owner_unresponsive when a plan was waiting, plan_expired when none was, and leaves a live one alone", async () => {
    const lapsed = { ...claim, offeredAt: new Date(Date.now() - 3 * HOUR), createdAt: new Date(Date.now() - 3 * HOUR), bug: { projectId: "p1", organisationId: "t1" } };
    db.issueClaim.findMany.mockResolvedValue([
      { ...lapsed, id: "claim1", plan: { id: "plan1", decision: null, reviewBy: new Date(Date.now() - 1000), round: 1 } },
      { ...lapsed, id: "claim2", bugId: "bug2", plan: null },
      { ...claim, id: "claim3", bugId: "bug3", bug: { projectId: "p1", organisationId: "t1" }, plan: null },
    ]);
    db.issueClaim.findFirst.mockImplementation(async ({ where }: { where: { bugId: string } }) => ({ ...lapsed, id: where.bugId === "bug1" ? "claim1" : "claim2", bugId: where.bugId }));
    // Re-read under the lock: claim1's plan still waits on the owner, claim2 never got one.
    db.plan.findUnique.mockImplementation(async ({ where }: { where: { claimId: string } }) => (where.claimId === "claim1" ? { id: "plan1", decision: null, reviewBy: new Date(Date.now() - 1000), round: 1 } : null));
    await expect(sweepPlanWindows()).resolves.toEqual({ expired: 2 });
    expect(db.issueClaim.update).toHaveBeenCalledWith({ where: { id: "claim1" }, data: expect.objectContaining({ releaseReason: "owner_unresponsive" }) });
    expect(db.issueClaim.update).toHaveBeenCalledWith({ where: { id: "claim2" }, data: expect.objectContaining({ releaseReason: "plan_expired" }) });
    expect(db.issueClaim.update).toHaveBeenCalledTimes(2);
    // A lapsed window never withdraws the bid (a refusal does); the awarded row is simply spent, as after an expired offer.
    expect(db.issueBid.updateMany).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({ type: "plan.expired", payload: expect.objectContaining({ reason: "owner_unresponsive", claimId: "claim1" }) }));
  });

  it("leaves an award alone when a send-back restarted its window after the shortlist was read", async () => {
    const lapsed = { ...claim, offeredAt: new Date(Date.now() - 3 * HOUR), createdAt: new Date(Date.now() - 3 * HOUR), bug: { projectId: "p1", organisationId: "t1" } };
    db.issueClaim.findMany.mockResolvedValue([{ ...lapsed, plan: { id: "plan1", decision: null, reviewBy: new Date(Date.now() - 1000), round: 1 } }]);
    db.issueClaim.findFirst.mockResolvedValue(lapsed);
    db.plan.findUnique.mockResolvedValue({ id: "plan1", decision: "sent_back", reviewBy: new Date(Date.now() + HOUR), round: 1 });
    await expect(sweepPlanWindows()).resolves.toEqual({ expired: 0 });
    expect(db.issueClaim.update).not.toHaveBeenCalled();
  });
});
