import { beforeEach, describe, expect, it, vi } from "vitest";

/** Awarding a bid (#bid-votes, #bidder-capacity, #stale-assignee, #760): weighted votes reach the threshold, one award at a time, capacity counts only work In progress. */
const db = vi.hoisted(() => {
  const mock = {
    bug: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    bugActivity: { createMany: vi.fn(), create: vi.fn() },
    issueBid: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    issueClaim: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
    bidVote: { findMany: vi.fn(), deleteMany: vi.fn() },
    issueStake: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    agent: { findFirst: vi.fn(), findUnique: vi.fn() },
    projectWorkflow: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  mock.$transaction.mockImplementation((fn: (tx: typeof mock) => unknown) => fn(mock));
  return mock;
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
// #project-budget: the budget rules are proven in tests/merge/coin-ledger.test.ts; here, that an award obeys them.
const budget = vi.hoisted(() => ({ budgetBlock: vi.fn(async () => null as { code: string; message: string } | null), reserveForIssue: vi.fn(async () => 0), unaffordableIssueIds: vi.fn(async () => new Set<string>()) }));
vi.mock("@/lib/coins/budget", () => budget);
vi.mock("@/lib/agent-api/confirmations", () => ({ isConfirmed: vi.fn(async () => true) }));
vi.mock("@/lib/redesigns", () => ({ assertRedesignOpen: vi.fn(async () => undefined) }));
vi.mock("@/lib/agent-api/events", () => ({ publish: vi.fn(async () => ({ id: "evt" })) }));
vi.mock("@/lib/watch", () => ({ ensureWatching: vi.fn(async () => undefined) }));
vi.mock("@/lib/agents/membership", () => ({ isAdminOfOrganisation: vi.fn(async () => false) }));
vi.mock("@/lib/agent-notifications", () => ({ notifyClaimOffered: vi.fn() }));
vi.mock("@/lib/agent-api/offer", async (original) => ({
  ...await original<typeof import("@/lib/agent-api/offer")>(),
  scheduleOfferExpiry: vi.fn(),
}));

import { isConfirmed } from "@/lib/agent-api/confirmations";
import { publish } from "@/lib/agent-api/events";
import { notifyClaimOffered } from "@/lib/agent-notifications";
import { scheduleOfferExpiry } from "@/lib/agent-api/offer";
import { awardBid } from "@/lib/agent-api/bid";
import { resetWorkflowCache } from "@/lib/workflow";
import { holdLoad } from "@/lib/agent-api/capacity";

const caller = {
  agentId: "agent1",
  name: "Ada's Claude",
  ownerId: "ada",
  organisationId: "organisation",
  level: "working" as const,
  burst: false,
  keyId: "key1",
};

const plan = { summary: "I can fix the login.", description: "The session cookie is dropped on redirect; I will keep it and add a test." };

const openBug = {
  id: "issue1",
  title: "Broken login",
  projectId: "project",
  status: "open", substatus: "open" as const,
  assigneeId: null,
  organisationId: "organisation",
  reporterId: "reporter",
  isDeleted: false,
  voteCount: 3,
  convertedToIssueAt: new Date("2026-10-01T00:00:00Z"),
  assignee: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkflowCache();
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
  db.$queryRaw.mockResolvedValue([{ id: "issue1" }]);
  db.bug.findFirst.mockResolvedValue({ id: "issue1", projectId: "project", status: "open", substatus: "open", voteCount: 3, convertedToIssueAt: new Date("2026-10-01T00:00:00Z") });
  db.issueClaim.findFirst.mockResolvedValue(null);
  db.issueClaim.count.mockResolvedValue(0);
  db.projectWorkflow.findUnique.mockResolvedValue(null);
  db.agent.findFirst.mockResolvedValue(null);
  db.agent.findUnique.mockResolvedValue({ pausedAt: null });
  db.issueBid.updateMany.mockResolvedValue({ count: 1 });
  db.bug.updateMany.mockResolvedValue({ count: 1 });
  db.issueBid.findUnique.mockResolvedValue(null);
  db.issueBid.create.mockResolvedValue({ id: "bid1", beneficiaryUserId: "ada", summary: plan.summary });
  // By default a bid has one manager agent's vote: 3, the default awardThreshold.
  db.bidVote.findMany.mockResolvedValue([{ onBehalfOfUserId: "eve", agent: { activations: [{ organisationId: "organisation", level: "manager" }] } }]);
  vi.mocked(isConfirmed).mockResolvedValue(true);
});

describe("awardBid", () => {
  const stored = {
    id: "bid1",
    bugId: "issue1",
    agentId: "agent1",
    beneficiaryUserId: "ada",
    withdrawnAt: null,
    awardedAt: null,
    beneficiary: { name: "Ada" },
    agent: { ownerUserId: "ada" },
    bug: openBug,
  };
  const manager = { ...caller, agentId: "dana-agent", name: "Dana's Claude", ownerId: "dana", level: "manager" as const };

  it("opens plan review instead of an offer on a complex issue (#plan-review): a planning claim, the issue at In progress · Plan review, no offer to accept", async () => {
    db.issueBid.findUnique.mockResolvedValue({ ...stored, bug: { ...openBug, difficulty: "complex" } });
    db.issueClaim.create.mockResolvedValue({ id: "claim1" });
    const result = await awardBid(manager, "bid1");
    expect(result).toMatchObject({ bidId: "bid1", claimId: "claim1", status: "planning" });
    expect(new Date(result.planBy!).getTime()).toBeGreaterThan(Date.now() + 7000 * 1000);
    expect(db.issueClaim.create.mock.calls[0][0].data).toMatchObject({ status: "planning", offeredAt: expect.any(Date), agentId: "agent1" });
    expect(db.bug.update).toHaveBeenCalledWith({ where: { id: "issue1" }, data: { status: "in_progress", substatus: "plan_review" } });
    expect(publish).not.toHaveBeenCalledWith(db, expect.objectContaining({ type: "claim.offered" }));
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({ type: "issue.bid_awarded", payload: expect.objectContaining({ planning: true, offered: false }) }));
    // Nothing to accept and nothing to expire: the plan window sweeper handles a planning award.
    expect(notifyClaimOffered).not.toHaveBeenCalled();
    expect(scheduleOfferExpiry).not.toHaveBeenCalled();
  });

  it("refuses to award an issue its project's budget can't pay for, and writes nothing (#project-budget)", async () => {
    db.issueBid.findUnique.mockResolvedValue(stored);
    budget.budgetBlock.mockResolvedValueOnce({ code: "out_of_funds", message: "This project has no funds left for this issue." });
    await expect(awardBid(manager, "bid1")).rejects.toMatchObject({ status: 409, message: "This project has no funds left for this issue." });
    expect(db.issueClaim.create).not.toHaveBeenCalled();
    expect(db.issueBid.updateMany).not.toHaveBeenCalled();
  });

  it("reserves the price at once only when the award opens plan review, since nothing is accepted later (#project-budget)", async () => {
    db.issueClaim.create.mockResolvedValue({ id: "claim1" });
    db.issueBid.findUnique.mockResolvedValue({ ...stored, bug: { ...openBug, difficulty: "complex" } });
    await awardBid(manager, "bid1");
    expect(budget.reserveForIssue).toHaveBeenCalledWith(db, "issue1");
    budget.reserveForIssue.mockClear();
    db.issueBid.findUnique.mockResolvedValue(stored);
    await awardBid(manager, "bid1");
    expect(budget.reserveForIssue).not.toHaveBeenCalled();
  });

  it("awards a bid at the threshold as an offered claim to the bidding agent, attributed to the awarding agent", async () => {
    db.issueBid.findUnique.mockResolvedValue(stored);
    db.issueClaim.create.mockResolvedValue({ id: "claim1" });
    await expect(awardBid(manager, "bid1")).resolves.toEqual({
      bidId: "bid1",
      claimId: "claim1",
      bugId: "issue1",
      bugTitle: "Broken login",
      beneficiaryUserId: "ada",
      status: "offered",
    });
    expect(db.issueClaim.create.mock.calls[0][0].data).toMatchObject({
      status: "offered",
      offeredAt: expect.any(Date),
      agentId: "agent1",
      beneficiaryUserId: "ada",
    });
    // Picking a bid is not dispatching: whoever awarded it is not recorded as dispatcher.
    expect(db.issueClaim.create.mock.calls[0][0].data).not.toHaveProperty("dispatcherUserId");
    // An offer: the issue stays Open with no assignee, and the other bids stay open.
    expect(db.bug.update).not.toHaveBeenCalled();
    expect(db.issueBid.updateMany).toHaveBeenCalledTimes(1);
    expect(db.issueBid.updateMany).toHaveBeenCalledWith({
      where: { id: "bid1", awardedAt: null, withdrawnAt: null },
      data: expect.objectContaining({ awardedAt: expect.any(Date), claimId: "claim1" }),
    });
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({
      type: "claim.offered",
      payload: expect.objectContaining({ claimId: "claim1", bidId: "bid1", expiresAt: expect.any(String) }),
    }));
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({
      type: "issue.bid_awarded",
      payload: expect.objectContaining({ bidId: "bid1", claimId: "claim1", offered: true, awardedByAgentId: "dana-agent" }),
    }));
    expect(notifyClaimOffered).toHaveBeenCalledWith({ id: "claim1", bugId: "issue1", bugTitle: "Broken login", beneficiaryUserId: "ada" });
    expect(scheduleOfferExpiry).toHaveBeenCalledWith("claim1");
  });

  it("lets any agent award a bid at the threshold, a working agent too (#bid-votes)", async () => {
    db.issueBid.findUnique.mockResolvedValue({ ...stored, beneficiaryUserId: "bob", agent: { ownerUserId: "bob" } });
    db.issueClaim.create.mockResolvedValue({ id: "claim1" });
    const working = { ...caller, agentId: "cara-agent", ownerId: "cara" };
    await expect(awardBid(working, "bid1")).resolves.toMatchObject({ claimId: "claim1", beneficiaryUserId: "bob" });
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({
      type: "issue.bid_awarded",
      payload: expect.objectContaining({ awardedByAgentId: "cara-agent" }),
    }));
  });

  it("awards any open bid whatever its votes, none at all included: votes are guidance (#open-award)", async () => {
    db.issueBid.findUnique.mockResolvedValue(stored);
    db.issueClaim.create.mockResolvedValue({ id: "claim1" });
    db.bidVote.findMany.mockResolvedValue([]);
    // A working agent, with no votes on the bid.
    await expect(awardBid({ ...caller, agentId: "cara-agent", ownerId: "cara" }, "bid1")).resolves.toMatchObject({ claimId: "claim1" });
    expect(db.issueClaim.create).toHaveBeenCalledTimes(1);
  });

  it("lets an agent award its own owner's bid: an offer to oneself (#open-award)", async () => {
    db.issueBid.findUnique.mockResolvedValue(stored);
    db.issueClaim.create.mockResolvedValue({ id: "claim1" });
    db.bidVote.findMany.mockResolvedValue([]);
    // Ada's agent awards Ada's bid.
    await expect(awardBid(caller, "bid1")).resolves.toMatchObject({ claimId: "claim1", beneficiaryUserId: "ada" });
  });

  it("awards while the issue still awaits confirmation (#open-award)", async () => {
    db.issueBid.findUnique.mockResolvedValue({ ...stored, bug: { ...openBug, substatus: "requires_confirmation" } });
    db.issueClaim.create.mockResolvedValue({ id: "claim1" });
    vi.mocked(isConfirmed).mockResolvedValue(false);
    await expect(awardBid(manager, "bid1")).resolves.toMatchObject({ claimId: "claim1" });
  });

  it("refuses a bid from another organisation as not found", async () => {
    db.issueBid.findUnique.mockResolvedValue(stored);
    await expect(awardBid({ ...manager, organisationId: "another-organisation" }, "bid1")).rejects.toMatchObject({ status: 404 });
    expect(db.issueClaim.create).not.toHaveBeenCalled();
  });

  it("refuses a bid that is no longer open, or an issue with a pending offer", async () => {
    db.issueBid.findUnique.mockResolvedValue({ ...stored, withdrawnAt: new Date() });
    await expect(awardBid(manager, "bid1")).rejects.toMatchObject({ status: 409, message: "This bid is no longer open." });
    db.issueBid.findUnique.mockResolvedValue(stored);
    db.issueClaim.findFirst.mockImplementation(async ({ where }: { where: { status?: string } }) =>
      where.status === "active" ? null : { id: "offer", status: "offered", offeredAt: new Date(), agentId: "x", beneficiaryUserId: "x", bug: { organisationId: "organisation", projectId: "project" } });
    await expect(awardBid(manager, "bid1")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("pending offer") });
    expect(db.issueClaim.create).not.toHaveBeenCalled();
  });
});

describe("awardBid and bidder capacity (#bidder-capacity)", () => {
  const manager = { ...caller, agentId: "dana-agent", name: "Dana's Claude", ownerId: "dana", level: "manager" as const };
  const stored = {
    id: "bid1",
    bugId: "issue1",
    agentId: "agent1",
    beneficiaryUserId: "ada",
    withdrawnAt: null,
    awardedAt: null,
    beneficiary: { name: "Ada" },
    agent: { ownerUserId: "ada" },
    bug: openBug,
  };

  it("refuses with 409 at_capacity when the bidder already holds the project's limit of live offers and active claims", async () => {
    db.issueBid.findUnique.mockResolvedValue(stored);
    db.projectWorkflow.findUnique.mockResolvedValue({ maxActiveClaims: 2 });
    db.issueClaim.count.mockResolvedValue(2);
    await expect(awardBid(manager, "bid1")).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ error: "at_capacity", load: 2, capacity: 2 }),
    });
    // Counted over the bidder's person in this project: offers inside the window, and active claims on work In progress (#760).
    expect(db.issueClaim.count).toHaveBeenCalledWith({ where: expect.objectContaining({
      beneficiaryUserId: "ada",
      bug: { organisationId: "organisation", projectId: "project", isDeleted: false },
      releasedAt: null,
      OR: expect.arrayContaining([{ status: "active", bug: { status: "in_progress" } }]),
    }) });
    expect(db.issueClaim.create).not.toHaveBeenCalled();
    expect(db.bug.updateMany).not.toHaveBeenCalled();
    expect(notifyClaimOffered).not.toHaveBeenCalled();
  });

});

describe("awardBid and a stale assignee (#stale-assignee)", () => {
  const manager = { ...caller, agentId: "dana-agent", name: "Dana's Claude", ownerId: "dana", level: "manager" as const };
  const assignedBug = { ...openBug, assigneeId: "carl", assignee: { name: "Carl" } };
  const stored = {
    id: "bid1",
    bugId: "issue1",
    agentId: "agent1",
    beneficiaryUserId: "ada",
    withdrawnAt: null,
    awardedAt: null,
    beneficiary: { name: "Ada" },
    agent: { ownerUserId: "ada" },
    bug: assignedBug,
  };

  it("clears an assignee with no active claim and no live offer, records it, then awards", async () => {
    db.issueBid.findUnique.mockResolvedValue(stored);
    db.issueClaim.create.mockResolvedValue({ id: "claim1" });
    await expect(awardBid(manager, "bid1")).resolves.toMatchObject({ claimId: "claim1", bugId: "issue1" });
    expect(db.bug.updateMany).toHaveBeenCalledWith({
      where: { id: "issue1", assigneeId: "carl", substatus: "open" },
      data: { assigneeId: null },
    });
    expect(db.bugActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      bugId: "issue1",
      actorId: "dana",
      type: "assignee_changed",
      metadata: expect.objectContaining({ field: "assignee", from: "carl", to: null }),
    }) });
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({
      type: "issue.updated",
      payload: expect.objectContaining({ values: { assigneeId: null }, reason: "stale_assignee" }),
    }));
    expect(db.issueClaim.create).toHaveBeenCalledTimes(1);
  });

  it("still refuses when the assignee holds an active claim", async () => {
    db.issueBid.findUnique.mockResolvedValue(stored);
    db.issueClaim.findFirst.mockImplementation(async ({ where }: { where: { OR?: unknown } }) =>
      where.OR ? { id: "held", status: "active", beneficiaryUserId: "carl" } : null);
    await expect(awardBid(manager, "bid1")).rejects.toMatchObject({ status: 409, message: "This issue is already assigned to someone else." });
    expect(db.bug.updateMany).not.toHaveBeenCalled();
    expect(db.bugActivity.create).not.toHaveBeenCalled();
    expect(db.issueClaim.create).not.toHaveBeenCalled();
  });

});

describe("what takes a claim slot (#760)", () => {
  it("counts live offers and active claims on issues In progress, not delivered work", async () => {
    const count = vi.fn(async () => 2);
    expect(await holdLoad({ issueClaim: { count } } as never, { organisationId: "t", projectId: "p", userId: "u" }, 1800)).toBe(2);
    const where = (count.mock.calls[0] as unknown as [{ where: { OR: unknown[] } }])[0].where;
    expect(where.OR).toEqual([
      { status: "active", bug: { status: "in_progress" } },
      // #plan-review: an award under plan review holds a slot too.
      { status: "planning" },
      { status: "offered", offeredAt: { gt: expect.any(Date) } },
    ]);
  });
});
