import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Offers and claims (#award-bids, #662, #760): only the agent offered the work
 * can accept it, once, inside the offer window and under the person's
 * capacity; accepting starts the claim and withdraws the other bids.
 */
const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
  issueClaim: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
  issueBid: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  bug: { update: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
  bugActivity: { createMany: vi.fn() },
  agent: { findUnique: vi.fn() },
}));
const publish = vi.hoisted(() => vi.fn());
const notifyLater = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notify", () => ({ notifyLater }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
// #project-budget: the budget rules are proven in tests/merge/coin-ledger.test.ts; here, that accepting obeys them.
const budget = vi.hoisted(() => ({ budgetBlock: vi.fn(async () => null), reserveForIssue: vi.fn(async () => 0), unaffordableIssueIds: vi.fn(async () => new Set<string>()) }));
vi.mock("@/lib/coins/budget", () => budget);
vi.mock("@/lib/agent-api/events", () => ({ publish }));
vi.mock("@/lib/watch", () => ({ ensureWatching: vi.fn(async () => undefined) }));
vi.mock("@/lib/agent-notifications", () => ({ notifyClaimOffered: vi.fn() }));
// The hand-over's award and idle-agent steps are proven where they live (bids, proactive offers); here, who it goes to.
const hand = vi.hoisted(() => ({ awardInTransaction: vi.fn(), bidTally: vi.fn(), afterAward: vi.fn(), idleAgentsIn: vi.fn(), offerIssue: vi.fn() }));
vi.mock("@/lib/agent-api/bid", async (original) => ({
  ...await original<typeof import("@/lib/agent-api/bid")>(),
  awardInTransaction: hand.awardInTransaction, bidTally: hand.bidTally, afterAward: hand.afterAward,
}));
vi.mock("@/lib/agents/proactive-offers", async (original) => ({
  ...await original<typeof import("@/lib/agents/proactive-offers")>(),
  idleAgentsIn: hand.idleAgentsIn, offerIssue: hand.offerIssue,
}));
vi.mock("@/lib/workflow", async (original) => {
  const { DEFAULT_PROJECT_WORKFLOW } = await import("@/lib/workflow-config");
  return { ...await original<typeof import("@/lib/workflow")>(), workflowFor: vi.fn(async () => ({ ...DEFAULT_PROJECT_WORKFLOW })) };
});

import { acceptOffer, isOfferExpired, OFFER_TTL_MS, releaseClaim } from "@/lib/agent-api/offer";
import { autoAcceptAward } from "@/lib/agent-api/auto-accept";
import { DEFAULT_PROJECT_WORKFLOW } from "@/lib/workflow-config";
import type { AgentContext } from "@/lib/agents/require-agent";
import { yourOpenBidsWhere, yourWorkWhere } from "@/lib/my-work-filter";
import { whatsNext } from "@/lib/whats-next";
import { offerableWhere, pickAgent } from "@/lib/agents/proactive-offers";
import { STALE_AFTER_MS } from "@/lib/agents/last-seen";
import { priorityNow } from "@/lib/priority-now";
import { handOverLapsedOffer } from "@/lib/agent-api/hand-over";
import { IssueApiError } from "@/lib/agent-api/errors";
import { CoinError } from "@/lib/coins/ledger";

const agent = { agentId: "agent-1", name: "Ada's Claude", ownerId: "ada", organisationId: "t1", level: "working", burst: false, keyId: "k1" } as AgentContext;
const offered = (overrides: Record<string, unknown> = {}) => ({
  id: "claim-1",
  bugId: "bug-1",
  agentId: "agent-1",
  beneficiaryUserId: "ada",
  status: "offered",
  offeredAt: new Date(),
  releasedAt: null,
  releaseReason: null,
  beneficiary: { name: "Ada" },
  bug: { id: "bug-1", title: "Bug 1", substatus: "open", assigneeId: null, organisationId: "t1", projectId: "p1", areaId: null, voteCount: 0, assignee: null },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((run: (tx: unknown) => unknown) => run(db));
  db.$queryRaw.mockResolvedValue([{ id: "bug-1" }]);
  db.issueClaim.findUnique.mockResolvedValue(offered());
  db.issueClaim.findFirst.mockResolvedValue(null);
  db.issueClaim.count.mockResolvedValue(0);
  db.bug.update.mockResolvedValue({ id: "bug-1", assigneeId: "ada", status: "in_progress", substatus: "in_progress" });
  db.issueBid.updateMany.mockResolvedValue({ count: 2 });
  // No work mode chosen: the agent accepts its own offers, as before (#agent-work-mode).
  db.agent.findUnique.mockResolvedValue(null);
  // A lapsed offer's hand-over finds no issue unless a test gives it one.
  db.bug.findFirst.mockResolvedValue(null);
});

describe("accepting an offer", () => {
  it("refuses a paused agent before accepting or changing the offer", async () => {
    await expect(acceptOffer({ ...agent, pausedAt: new Date() }, "claim-1")).rejects.toMatchObject({ status: 423 });
    expect(db.issueClaim.update).not.toHaveBeenCalled();
    expect(db.bug.update).not.toHaveBeenCalled();
  });

  it("rechecks pause under the agent lock when the owner pauses after authentication", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: "bug-1" }]).mockResolvedValueOnce([{ pausedAt: new Date() }]);
    await expect(acceptOffer(agent, "claim-1")).rejects.toMatchObject({ status: 423 });
    expect(db.issueClaim.update).not.toHaveBeenCalled();
    expect(db.bug.update).not.toHaveBeenCalled();
  });

  it("starts the claim, moves the issue In progress and withdraws the other bids", async () => {
    db.issueBid.findFirst.mockResolvedValue({ id: "bid-1" });
    const result = await acceptOffer(agent, "claim-1");
    expect(result).toMatchObject({ expired: false, claim: { id: "claim-1", status: "active" } });
    expect(db.bug.update).toHaveBeenCalledWith(expect.objectContaining({ data: { assigneeId: "ada", status: "in_progress", substatus: "in_progress" } }));
    expect(db.issueBid.updateMany).toHaveBeenCalledWith({ where: { bugId: "bug-1", withdrawnAt: null, awardedAt: null }, data: { withdrawnAt: expect.any(Date) } });
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({ type: "claim.accepted" }));
    // #project-budget: taking the work reserves its price from the project's budget.
    expect(budget.reserveForIssue).toHaveBeenCalledWith(db, "bug-1");
  });

  it("releases the offer and starts nothing when the project's budget can no longer cover the price (#project-budget)", async () => {
    budget.reserveForIssue.mockRejectedValueOnce(new CoinError("out_of_funds", "This project has no funds left for this issue."));
    await expect(acceptOffer(agent, "claim-1")).rejects.toMatchObject({ status: 409, message: "This project has no funds left for this issue." });
    expect(db.issueClaim.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "released", releaseReason: "unavailable" }) }));
    expect(db.bug.update).not.toHaveBeenCalled();
  });

  it("is only for the agent it was offered to, and not from another organisation", async () => {
    await expect(acceptOffer({ ...agent, agentId: "agent-2" }, "claim-1")).rejects.toMatchObject({ status: 409 });
    await expect(acceptOffer({ ...agent, organisationId: "t2" }, "claim-1")).rejects.toMatchObject({ status: 404 });
    expect(db.bug.update).not.toHaveBeenCalled();
  });

  it("refuses when the issue already has an active claim, including a race lost on the unique index", async () => {
    db.issueClaim.findFirst.mockResolvedValue({ id: "claim-active", status: "active", releasedAt: null });
    await expect(acceptOffer(agent, "claim-1")).rejects.toMatchObject({ status: 409 });
    db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6" }));
    await expect(acceptOffer(agent, "claim-1")).rejects.toMatchObject({ status: 409 });
    expect(db.bug.update).not.toHaveBeenCalled();
  });

  it("releases an expired offer instead of starting it", async () => {
    db.issueClaim.findUnique.mockResolvedValue(offered({ offeredAt: new Date(Date.now() - DEFAULT_PROJECT_WORKFLOW.offerWindowSeconds * 1000 - 1000) }));
    await expect(acceptOffer(agent, "claim-1")).rejects.toMatchObject({ status: 410 });
    expect(db.issueClaim.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "released", releaseReason: "expired" }) }));
    // ...and hands the issue on (#offer-hand-over).
    expect(db.bug.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "bug-1", isDeleted: false } }));
  });

  it("opens plan review instead of starting the work when the issue is complex (#plan-review)", async () => {
    db.issueClaim.findUnique.mockResolvedValue(offered({ bug: { ...offered().bug, difficulty: "complex" } }));
    const result = await acceptOffer(agent, "claim-1");
    expect(result).toMatchObject({ claim: { status: "planning" }, planBy: expect.any(String) });
    expect(db.issueClaim.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "planning", offeredAt: expect.any(Date) } }));
    expect(db.bug.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ substatus: "plan_review" }) }));
    // No delivery clock, and the other bids stay until the plan is approved.
    expect(db.issueClaim.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "active" }) }));
    expect(db.issueBid.updateMany).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({ type: "claim.accepted", payload: expect.objectContaining({ planning: true }) }));
  });

  it("releases it when the person already holds their limit of work In progress", async () => {
    db.issueClaim.count.mockResolvedValue(DEFAULT_PROJECT_WORKFLOW.maxActiveClaims);
    await expect(acceptOffer(agent, "claim-1")).rejects.toMatchObject({ status: 409 });
    expect(db.issueClaim.count.mock.calls[0][0].where.bug).toMatchObject({ status: "in_progress" });
    expect(db.issueClaim.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ releaseReason: "capacity" }) }));
  });
});

describe("work mode and caps (#agent-work-mode)", () => {
  const workRow = (overrides: Record<string, unknown> = {}) => ({
    username: "ada-claude", workMode: "automatic", maxActiveTasks: null, dailyTaskLimit: null, creditCeilingUsd: null, ...overrides,
  });

  it("refuses an Ask me first agent's own accept, and the owner's one-tap yes takes it", async () => {
    db.agent.findUnique.mockResolvedValue(workRow({ workMode: "ask_first" }));
    await expect(acceptOffer(agent, "claim-1")).rejects.toMatchObject({ status: 403, body: { error: "owner_approval_required" } });
    expect(db.issueClaim.update).not.toHaveBeenCalled();
    expect(db.bug.update).not.toHaveBeenCalled();

    await expect(acceptOffer(agent, "claim-1", { byOwner: true })).resolves.toMatchObject({ claim: { status: "active" } });
    expect(db.bug.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ substatus: "in_progress" }) }));
  });

  it("saves the person's first choice from terminal setup, and never lets the agent change it after", async () => {
    const { chooseWorkModeAtSetup } = await import("@/lib/agents/work-mode-setup");
    const setup = {
      agent: { updateMany: vi.fn(), findUnique: vi.fn() },
      agentAuditEvent: { create: vi.fn() },
    };
    const me = { agentId: "agent-1", organisationId: "t1" };
    const choose = (body: unknown) => chooseWorkModeAtSetup(setup as never, me, body);

    await expect(choose({ workMode: "never" })).resolves.toMatchObject({ ok: false, status: 400, error: "invalid_work_mode" });
    expect(setup.agent.updateMany).not.toHaveBeenCalled();

    setup.agent.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(choose({ workMode: "ask_first" })).resolves.toEqual({ ok: true, workMode: "ask_first" });
    // Only an unset mode is filled; the caps are left to the owner.
    expect(setup.agent.updateMany).toHaveBeenCalledWith({
      where: { id: "agent-1", workMode: null },
      data: { workMode: "ask_first", workModeSetAt: expect.any(Date) },
    });
    expect(setup.agentAuditEvent.create).toHaveBeenCalledTimes(1);

    setup.agent.updateMany.mockResolvedValueOnce({ count: 0 });
    setup.agent.findUnique.mockResolvedValueOnce({ username: "ada-claude", workMode: "ask_first" });
    await expect(choose({ workMode: "automatic" })).resolves.toMatchObject({ ok: false, status: 409, error: "work_mode_already_set" });
    expect(setup.agentAuditEvent.create).toHaveBeenCalledTimes(1);
  });

  it("saves how much it takes on once, from the terminal or its page, as its task caps (#agent-get-started)", async () => {
    const { chooseWorkModeAtSetup } = await import("@/lib/agents/work-mode-setup");
    const setup = {
      agent: { updateMany: vi.fn(), findUnique: vi.fn() },
      agentAuditEvent: { create: vi.fn() },
    };
    const me = { agentId: "agent-1", organisationId: "t1" };

    await expect(chooseWorkModeAtSetup(setup as never, me, {})).resolves.toMatchObject({ ok: false, status: 400 });
    await expect(chooseWorkModeAtSetup(setup as never, me, { pace: "unlimited" })).resolves.toMatchObject({ ok: false, status: 400 });
    expect(setup.agent.updateMany).not.toHaveBeenCalled();

    setup.agent.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(chooseWorkModeAtSetup(setup as never, me, { pace: "light" }, new Date(), "website")).resolves.toEqual({ ok: true, pace: "light" });
    // Only an unanswered pace is filled, and it sets the caps it names.
    expect(setup.agent.updateMany).toHaveBeenCalledWith({
      where: { id: "agent-1", paceSetAt: null },
      data: { maxActiveTasks: 1, dailyTaskLimit: 2, paceSetAt: expect.any(Date) },
    });

    // Answered in the other place first: refused, saying what was chosen.
    setup.agent.updateMany.mockResolvedValueOnce({ count: 0 });
    setup.agent.findUnique.mockResolvedValueOnce({ username: "ada-claude", workMode: "ask_first", maxActiveTasks: 1, dailyTaskLimit: 2 });
    await expect(chooseWorkModeAtSetup(setup as never, me, { pace: "busy" })).resolves.toMatchObject({
      ok: false,
      status: 409,
      error: "pace_already_set",
      message: expect.stringContaining("Light"),
    });
    expect(setup.agentAuditEvent.create).toHaveBeenCalledTimes(1);
  });

  it("refuses at the owner's caps without giving the offer up", async () => {
    db.agent.findUnique.mockResolvedValue(workRow({ maxActiveTasks: 1 }));
    db.issueClaim.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    await expect(acceptOffer(agent, "claim-1")).rejects.toMatchObject({ status: 409, body: { error: "work_cap_reached", cap: "max_active_tasks" } });

    db.agent.findUnique.mockResolvedValue(workRow({ dailyTaskLimit: 3 }));
    db.issueClaim.count.mockResolvedValueOnce(0).mockResolvedValueOnce(3);
    await expect(acceptOffer(agent, "claim-1")).rejects.toMatchObject({ status: 409, body: { cap: "daily_task_limit" } });
    expect(db.issueClaim.update).not.toHaveBeenCalled();
  });

  it("accepts a Work automatically agent's award for it, and leaves an Ask me first agent's waiting", async () => {
    const award = (workMode: string) => ({
      status: "offered", releasedAt: null, bug: { organisationId: "t1" },
      agent: { id: "agent-1", name: "Ada's Claude", ownerUserId: "ada", pausedAt: null, revokedAt: null, workMode, activations: [{ organisationId: "t1", level: "working" }] },
    });
    db.issueClaim.findUnique.mockResolvedValueOnce(award("ask_first"));
    await expect(autoAcceptAward("claim-1")).resolves.toBe(false);
    expect(db.issueClaim.update).not.toHaveBeenCalled();

    db.issueClaim.findUnique.mockResolvedValueOnce(award("automatic"));
    db.agent.findUnique.mockResolvedValue(workRow());
    await expect(autoAcceptAward("claim-1")).resolves.toBe(true);
    expect(db.issueClaim.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "active" }) }));
  });
});

describe("the offer window", () => {
  it("expires an offer at its window, but not before", () => {
    const offeredAt = new Date("2026-10-19T12:00:00.000Z");
    expect(isOfferExpired(offeredAt, offeredAt.getTime() + OFFER_TTL_MS - 1)).toBe(false);
    expect(isOfferExpired(offeredAt, offeredAt.getTime() + OFFER_TTL_MS)).toBe(true);
    expect(isOfferExpired(null, offeredAt.getTime())).toBe(true);
  });
});

/**
 * Your work on Project Overview (#your-work): what is yours to move, and which
 * kind it is. Claims held or offered for you are listed; open bids are only
 * counted; finished work and importance marks don't count.
 */
describe("your work", () => {
  it("lists your claims, not your bids, and nothing finished", () => {
    const where = yourWorkWhere("u1");
    expect(where.status).toEqual({ notIn: ["resolved", "closed"] });
    // #plan-review: an award under plan review is yours too.
    expect(where.claims).toEqual({ some: { beneficiaryUserId: "u1", status: { in: ["offered", "planning", "active"] }, releasedAt: null } });
    expect(yourOpenBidsWhere("u1")).toEqual({ status: "open", bids: { some: { beneficiaryUserId: "u1", withdrawnAt: null, awardedAt: null } } });
  });

  it("tags each kind: a bid waits, an offer is yours to accept, late work is overdue", () => {
    const now = Date.parse("2026-11-05T12:00:00Z");
    expect(whatsNext("open", [], true, now)).toMatchObject({ tag: "Your bid", yours: false });
    expect(whatsNext("open", [{ status: "offered" }], true, now)).toMatchObject({ tag: "Offered to you", yours: true });
    expect(whatsNext("in_progress", [{ status: "active", deliverBy: new Date(now + 3_600_000 * 5) }], false, now)).toMatchObject({ tag: "Assigned to you", yours: true });
    expect(whatsNext("in_progress", [{ status: "active", deliverBy: new Date(now - 1) }], false, now)).toMatchObject({ tag: "Overdue", late: true });
    expect(whatsNext("error", [{ status: "active" }], false, now)).toMatchObject({ tag: "Can't merge", yours: true });
  });
});

describe("releasing a claim", () => {
  const issueId = "clreleaseissue0000000000000";
  const release = (status: string, pullRequestUrl: string | null = null) => {
    db.$queryRaw.mockResolvedValue([{ id: issueId }]);
    db.issueClaim.findFirst.mockResolvedValue(offered({ bugId: issueId, status }));
    db.issueClaim.count.mockResolvedValue(0);
    db.bug.findFirstOrThrow.mockResolvedValue({ id: issueId, title: "Bug 1", reporterId: "reporter", status: "in_progress", assigneeId: "ada", projectId: "p1", areaId: null, pullRequestUrl });
    return releaseClaim(agent, "p1", issueId);
  };

  it("alerts watchers when letting go of active work reopens bidding", async () => {
    await expect(release("active")).resolves.toMatchObject({ reopened: true });
    expect(notifyLater).toHaveBeenCalledWith({ kind: "status_changed", actorId: "ada", actorName: agent.name, bugId: issueId, bugTitle: "Bug 1", reporterId: "reporter", from: "in_progress", to: "open" });
  });

  it("sends no alert when bidding does not reopen", async () => {
    await expect(release("offered")).resolves.toMatchObject({ reopened: false });
    await expect(release("active", "https://github.com/emerjent/ziki/pull/1")).resolves.toMatchObject({ reopened: false });
    expect(notifyLater).not.toHaveBeenCalled();
  });
});

/**
 * Priority now and proactive offers (#priority-now, #proactive-offers): the
 * site offers a project's top-priority unheld issues to idle agents. The
 * order decides what is offered first; the gates keep it from taking work
 * someone asked for or holds.
 */

describe("priority now and proactive offers (#proactive-offers)", () => {
  const row = (number: number, priority: string) => ({ id: `b${number}`, number, title: `#${number}`, priority, areaId: null, difficulty: "medium", _count: { bids: 0 }, claims: [] });

  it("ranks urgent, then high, then medium, then low, and stops at the limit", async () => {
    const byPriority: Record<string, ReturnType<typeof row>[]> = {
      urgent: [row(7, "urgent")],
      high: [row(3, "high"), row(4, "high")],
      medium: [row(1, "medium"), row(2, "medium")],
      low: [row(9, "low")],
    };
    const findMany = vi.fn(async ({ where, take }: { where: { priority: string | { notIn: string[] } }; take: number }) =>
      (typeof where.priority === "string" ? byPriority[where.priority]! : byPriority.medium!).slice(0, take));
    const top = await priorityNow({ organisationId: "t1", projectId: "p1", offerWindowSeconds: 1800 }, 4, { bug: { findMany } } as never);
    expect(top.map((issue) => issue.number)).toEqual([7, 3, 4, 1]);
    // Low was never read: the limit was reached first.
    expect(findMany).toHaveBeenCalledTimes(3);
  });

  it("reads only issues it may offer, so those below an unofferable one are reached, and a stale bidder's bid doesn't hold one back", async () => {
    const now = new Date("2026-11-16T12:00:00Z");
    const since = new Date(now.getTime() - STALE_AFTER_MS);
    const only = offerableWhere(1800, now);
    // Complex issues too (accepting opens plan review); nobody holds it or has a live offer on it, no live stake.
    expect(only).not.toHaveProperty("difficulty");
    expect(only.claims).toEqual({ none: { releasedAt: null, OR: [{ status: "active" }, { status: "planning" }, { status: "offered", offeredAt: { gt: new Date(now.getTime() - 1800_000) } }] } });
    expect(only.stakes).toEqual({ none: { status: { in: ["open", "contested"] } } });
    // Only an open bid from an agent seen within the stale window blocks it.
    expect(only.bids).toEqual({
      none: {
        withdrawnAt: null,
        awardedAt: null,
        agent: {
          revokedAt: null,
          OR: [{ apiKeys: { some: { revokedAt: null, lastUsedAt: { gte: since } } } }, { claims: { some: { releasedAt: null, lastHeartbeatAt: { gte: since } } } }],
        },
      },
    });
    // The rule narrows the ranked query itself, at every priority level, rather than filtering its top five afterwards.
    const findMany = vi.fn<(args: { where: object }) => Promise<ReturnType<typeof row>[]>>(async () => [row(6, "urgent")]);
    const top = await priorityNow({ organisationId: "t1", projectId: "p1", offerWindowSeconds: 1800 }, 25, { bug: { findMany } } as never, only);
    expect(top.map((issue) => issue.number)).toEqual([6, 6, 6, 6]);
    for (const [args] of findMany.mock.calls) expect(args.where).toMatchObject({ ...only, projectId: "p1", substatus: "open" });
  });

  it("picks an area match first, then the agent seen most recently, whatever its work mode, never one offered the issue before", () => {
    const now = Date.now();
    const idle = [
      { id: "recent", ownerUserId: "u1", areaIds: new Set<string>(), lastSeenAt: new Date(now - 1_000), workMode: "ask_first" as const },
      { id: "area", ownerUserId: "u2", areaIds: new Set(["checkout"]), lastSeenAt: new Date(now - 600_000), workMode: "automatic" as const },
      { id: "older", ownerUserId: "u3", areaIds: new Set<string>(), lastSeenAt: new Date(now - 300_000), workMode: "automatic" as const },
    ];
    expect(pickAgent({ areaId: "checkout" }, idle, new Set())?.id).toBe("area");
    expect(pickAgent({ areaId: null }, idle, new Set())?.id).toBe("recent");
    expect(pickAgent({ areaId: "checkout" }, idle, new Set(["area"]))?.id).toBe("recent");
    expect(pickAgent({ areaId: null }, idle, new Set(["recent", "area", "older"]))).toBeNull();
  });
});

describe("the lapsed-offer hand-over (#offer-hand-over)", () => {
  const issue = { id: "bug-1", organisationId: "t1", projectId: "p1", priority: "high", areaId: null, substatus: "open" };
  const bid = (id: string, agentId: string, owner: string, minutesAgo: number) => ({ id, agentId, beneficiaryUserId: owner, createdAt: new Date(Date.now() - minutesAgo * 60_000) });
  const idle = (id: string, workMode: "automatic" | "ask_first", seenMsAgo: number) => ({ id, ownerUserId: id + "-owner", areaIds: new Set<string>(), lastSeenAt: new Date(Date.now() - seenMsAgo), workMode });
  beforeEach(() => {
    db.bug.findFirst.mockResolvedValue(issue);
    // agent-1 let its offer lapse.
    db.issueClaim.findMany.mockResolvedValue([{ agentId: "agent-1" }]);
    db.issueBid.findMany.mockResolvedValue([]);
    hand.idleAgentsIn.mockResolvedValue([]);
  });

  it("awards the most-voted bid from an agent still checking in, the next one when that bidder can't take it, never the agent that let it lapse", async () => {
    db.issueBid.findMany.mockResolvedValue([bid("bid-old", "agent-2", "bo", 30), bid("bid-top", "agent-3", "cy", 5), bid("bid-new", "agent-4", "di", 1)]);
    const votes: Record<string, number> = { "bid-old": 1, "bid-top": 3, "bid-new": 1 };
    hand.bidTally.mockImplementation(async (id: string) => votes[id]);
    hand.awardInTransaction
      .mockRejectedValueOnce(new IssueApiError(409, "At capacity.", { error: "at_capacity" }))
      .mockImplementationOnce(async (_tx: unknown, bidId: string) => ({ bidId, claimId: "claim-2", bugId: "bug-1", bugTitle: "Bug 1", beneficiaryUserId: "bo", status: "offered" }));
    await expect(handOverLapsedOffer("bug-1")).resolves.toEqual({ to: "bid", bidId: "bid-old", agentId: "agent-2", claimId: "claim-2" });
    // Most votes first; a tie goes to the earlier bid. Ziki awards it, in the bidder's owner's name.
    expect(hand.awardInTransaction.mock.calls.map((call) => call[1])).toEqual(["bid-top", "bid-old"]);
    expect(hand.awardInTransaction.mock.calls[1][2]).toEqual({ userId: "bo", agentId: null });
    expect(hand.afterAward).toHaveBeenCalledWith(expect.objectContaining({ claimId: "claim-2" }));
    // Only open bids from agents still around, and never from one that held or was offered it.
    const where = db.issueBid.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ bugId: "bug-1", withdrawnAt: null, awardedAt: null, agentId: { notIn: ["agent-1"] } });
    expect(where.agent).toMatchObject({ revokedAt: null, pausedAt: null, OR: expect.any(Array) });
    expect(hand.offerIssue).not.toHaveBeenCalled();
  });

  it("with no bidder around, offers it to a Work automatically agent online now and accepts it for that agent", async () => {
    hand.idleAgentsIn.mockResolvedValue([idle("asker", "ask_first", 1_000), idle("agent-1", "automatic", 2_000), idle("auto", "automatic", 60_000)]);
    hand.offerIssue.mockResolvedValue("claim-9");
    db.issueClaim.findUnique
      .mockResolvedValueOnce({ status: "offered", releasedAt: null, bug: { organisationId: "t1" }, agent: { id: "auto", name: "Auto", ownerUserId: "ada", pausedAt: null, revokedAt: null, workMode: "automatic", activations: [{ organisationId: "t1", level: "working" }] } })
      .mockResolvedValue(offered({ id: "claim-9", agentId: "auto" }));
    db.agent.findUnique.mockResolvedValue({ username: "auto", workMode: "automatic", maxActiveTasks: null, dailyTaskLimit: null, creditCeilingUsd: null });
    await expect(handOverLapsedOffer("bug-1")).resolves.toEqual({ to: "automatic_agent", agentId: "auto", claimId: "claim-9", accepted: true });
    // Not the Ask me first agent (it would only wait again), nor the one that let it lapse.
    expect(hand.offerIssue).toHaveBeenCalledWith(issue, expect.objectContaining({ id: "auto" }), { organisationId: "t1", projectId: "p1" }, expect.any(Date), { handedOver: true });
    expect(db.issueClaim.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "active" }) }));
  });

  it("leaves the issue Open when nobody can take it", async () => {
    hand.idleAgentsIn.mockResolvedValue([idle("asker", "ask_first", 1_000)]);
    await expect(handOverLapsedOffer("bug-1")).resolves.toEqual({ to: null });
    expect(hand.awardInTransaction).not.toHaveBeenCalled();
    expect(hand.offerIssue).not.toHaveBeenCalled();
  });
});
