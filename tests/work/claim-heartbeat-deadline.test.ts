import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/** Active work (#556, #593): the holder heartbeats its claim, a silent or overdue claim is released and its issue reopened for bids, and delivered work is never taken back. */
const db = vi.hoisted(() => ({
  agentApiKey: { findUnique: vi.fn() }, agentAuditEvent: { create: vi.fn() },
  agentEvent: { create: vi.fn() }, webhookSubscription: { findMany: vi.fn() },
  webhookDelivery: { createMany: vi.fn() },
  project: { findFirst: vi.fn(), findUnique: vi.fn() },
  issueClaim: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn(), create: vi.fn(), groupBy: vi.fn() },
  membership: { findMany: vi.fn() },
  agentQuestion: { findFirst: vi.fn(), updateMany: vi.fn() },
  bug: { updateMany: vi.fn(), findFirst: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn(),
}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), budget: vi.fn(), notifyLater: vi.fn(), workflow: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/workflow", async (original) => ({
  ...await original<typeof import("@/lib/workflow")>(),
  workflowFor: mocks.workflow,
}));
vi.mock("@/lib/auth-helpers", () => ({ requireSuperAdmin: mocks.admin }));
vi.mock("@/lib/agents/rate-budget", async (original) => ({ ...await original<typeof import("@/lib/agents/rate-budget")>(), consumeAgentBudget: mocks.budget }));
vi.mock("@/lib/notify", () => ({ notifyLater: mocks.notifyLater }));
import { releaseStaleClaims } from "@/lib/agent-api/availability";
import { DEFAULT_PROJECT_WORKFLOW } from "@/lib/workflow-config";
import { POST } from "@/app/api/v1/issues/[id]/heartbeat/route";
import { classifyAgentStatus, isClaimStalled } from "@/lib/dashboard-overview";

const now = new Date("2026-10-19T12:00:00Z");
const cutoff = new Date(now.getTime() - DEFAULT_PROJECT_WORKFLOW.heartbeatMinutes * 60 * 1000);
const stale = new Date(cutoff.getTime() - 1);
const claim = { id: "claim", bugId: "issue", agentId: "agent", beneficiaryUserId: "owner", status: "active", releasedAt: null, claimedAt: stale, lastHeartbeatAt: stale };
const context = { params: Promise.resolve({ id: "issue" }) };
function request(query = "?projectId=project", key = true) {
  return new NextRequest(`http://localhost/api/v1/issues/issue/heartbeat${query}`, { method: "POST", headers: key ? { authorization: "Bearer ziki_test" } : {} });
}
beforeEach(() => {
  vi.resetAllMocks();
  // setTimeout is faked so the re-offer's expiry timer is armed but never fires.
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"] }); vi.setSystemTime(now);
  db.agentApiKey.findUnique.mockResolvedValue({ id: "key", revokedAt: null, agent: { id: "agent", name: "Agent", ownerUserId: "owner", tenantId: "tenant", level: "working", burst: false, revokedAt: null, owner: { memberships: [{ tenantId: "tenant" }] } } });
  db.project.findFirst.mockResolvedValue({ id: "project" });
  db.project.findUnique.mockResolvedValue({ id: "project", tenantId: "tenant" });
  db.$queryRaw.mockResolvedValue([{ id: "issue" }]);
  db.$transaction.mockImplementation((run) => run(db));
  db.issueClaim.findFirst.mockResolvedValue(claim);
  db.issueClaim.findMany.mockResolvedValue([{ id: "claim", bugId: "issue", bug: { tenantId: "tenant", projectId: "project" } }]);
  db.issueClaim.update.mockResolvedValue({ ...claim, lastHeartbeatAt: now });
  db.issueClaim.count.mockResolvedValue(0);
  db.issueClaim.create.mockResolvedValue({ id: "claim-next", bugId: "issue", offeredAt: now });
  db.issueClaim.groupBy.mockResolvedValue([]);
  db.membership.findMany.mockResolvedValue([]);
  db.bug.updateMany.mockResolvedValue({ count: 1 });
  db.bug.findFirst.mockResolvedValue({ id: "issue", projectId: "project", title: "Bug", assigneeId: null, status: "open", substatus: "open" });
  db.agentEvent.create.mockResolvedValue({ id: "evt" });
  db.webhookSubscription.findMany.mockResolvedValue([]);
  mocks.admin.mockResolvedValue({ id: "admin" });
  mocks.budget.mockResolvedValue({ allowed: true });
  mocks.workflow.mockResolvedValue(DEFAULT_PROJECT_WORKFLOW);
});
afterEach(() => vi.useRealTimers());

describe("claim heartbeats", () => {
  it("advances the claiming agent's timestamp under the scoped issue lock", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(db.issueClaim.update).toHaveBeenCalledWith({ where: { id: "claim" }, data: { lastHeartbeatAt: now } });
    const [sql, ...values] = db.$queryRaw.mock.calls[0];
    expect(sql.join("?")).toContain("FOR NO KEY UPDATE");
    expect(values).toEqual(["issue", "tenant", "project"]);
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.issueClaim.findFirst.mock.invocationCallOrder[0]);
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "claims.heartbeat", payload: { status: 200, request: true } }) });
  });
  it("rejects another agent, offered claims, and absent/released claims", async () => {
    db.issueClaim.findFirst.mockResolvedValueOnce({ ...claim, agentId: "other" });
    expect((await POST(request(), context)).status).toBe(403);
    db.issueClaim.findFirst.mockResolvedValueOnce({ ...claim, status: "offered" });
    expect((await POST(request(), context)).status).toBe(409);
    db.issueClaim.findFirst.mockResolvedValueOnce(null);
    expect((await POST(request(), context)).status).toBe(409);
    expect(db.issueClaim.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { bugId: "issue", releasedAt: null } }));
    expect(db.issueClaim.update).not.toHaveBeenCalled();
  });
});

describe("stale claim release", () => {
  it("releases a silent active claim and conditionally reopens its issue atomically with audit and event", async () => {
    expect(await releaseStaleClaims("project")).toEqual({ released: 1 });
    expect(db.issueClaim.update).toHaveBeenCalledWith({ where: { id: "claim" }, data: { status: "released", releasedAt: now, releaseReason: "silence" } });
    expect(db.agentEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      type: "claim.released",
      payload: expect.objectContaining({ claimId: "claim", issueId: "issue", projectId: "project", beneficiaryUserId: "owner", reason: "silence" }),
    }) }));
    expect(db.bug.updateMany).toHaveBeenCalledWith({ where: { id: "issue", projectId: "project", tenantId: "tenant", isDeleted: false, assigneeId: "owner", status: "in_progress", pullRequestUrl: null }, data: { assigneeId: null, status: "open", substatus: "open" } });
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "claim.released", agentId: "agent", actorUserId: "admin", bugId: "issue", payload: { claimId: "claim", reason: "silence", projectId: "project" } }) });
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.issueClaim.findFirst.mock.invocationCallOrder[0]);
  });
  it("does not release a silent claim whose fix is already linked (#551)", async () => {
    db.issueClaim.findFirst.mockResolvedValueOnce({ ...claim, bug: { pullRequestUrl: "https://github.com/o/r/pull/1", project: { ownerWaitCapMinutes: null } } });
    expect(await releaseStaleClaims("project")).toEqual({ released: 0 });
    expect(db.issueClaim.update).not.toHaveBeenCalled();
    expect(db.bug.updateMany).not.toHaveBeenCalled();
    expect(db.agentEvent.create).not.toHaveBeenCalled();
  });
  it.each([cutoff, new Date(cutoff.getTime() + 1), now])("keeps a heartbeat at or after the 15-minute boundary (%s)", async (lastHeartbeatAt) => {
    db.issueClaim.findFirst.mockResolvedValueOnce({ ...claim, lastHeartbeatAt });
    expect(await releaseStaleClaims("project")).toEqual({ released: 0 });
    expect(db.issueClaim.update).not.toHaveBeenCalled();
    expect(db.agentEvent.create).not.toHaveBeenCalled();
  });
  it("releases an undelivered claim past deliverBy even while the agent heartbeats (#593)", async () => {
    db.issueClaim.findFirst.mockResolvedValueOnce({
      ...claim,
      lastHeartbeatAt: now,
      deliverBy: new Date(now.getTime() - 1),
      bug: { pullRequestUrl: null },
    });
    expect(await releaseStaleClaims("project")).toEqual({ released: 1 });
    // The reopened issue waits in Open for bids: nobody is offered it (#bids-only-offers).
    expect(db.issueClaim.create).not.toHaveBeenCalled();
    expect(db.agentEvent.create).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "claim.offered" }) }));
    expect(db.issueClaim.update).toHaveBeenCalledWith({
      where: { id: "claim" },
      data: { status: "released", releasedAt: now, releaseReason: "deadline" },
    });
    expect(db.agentEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      type: "claim.released",
      payload: expect.objectContaining({ reason: "deadline", claimId: "claim" }),
    }) }));
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: "claim.released",
      payload: { claimId: "claim", reason: "deadline", projectId: "project" },
    }) });
  });

  it("counts the deadline boundary as overdue but leaves one millisecond after it alone", async () => {
    db.issueClaim.findFirst.mockResolvedValueOnce({
      ...claim, lastHeartbeatAt: now, deliverBy: now, bug: { pullRequestUrl: null },
    });
    expect(await releaseStaleClaims("project")).toEqual({ released: 1 });
    db.issueClaim.update.mockClear();
    db.issueClaim.findFirst.mockResolvedValueOnce({
      ...claim, lastHeartbeatAt: now, deliverBy: new Date(now.getTime() + 1), bug: { pullRequestUrl: null },
    });
    expect(await releaseStaleClaims("project")).toEqual({ released: 0 });
    expect(db.issueClaim.update).not.toHaveBeenCalled();
  });

  it("keeps an overdue claim whose fix is already linked", async () => {
    db.issueClaim.findFirst.mockResolvedValueOnce({
      ...claim,
      lastHeartbeatAt: now,
      deliverBy: new Date(now.getTime() - 1),
      bug: { pullRequestUrl: "https://github.com/o/r/pull/1" },
    });
    expect(await releaseStaleClaims("project")).toEqual({ released: 0 });
    expect(db.issueClaim.update).not.toHaveBeenCalled();
  });

});

/** The agents dock (#agents-dock) tells its owner which agents are stuck: holding a claim they went quiet on. */
describe("agent status for its owner", () => {
  const seen = new Date(now.getTime() - 60_000);

  it("calls a quiet or overdue claim stuck, ahead of working and idle but behind a question", () => {
    expect(classifyAgentStatus({ hasUnansweredQuestion: false, hasStalledClaim: true, hasActiveClaim: false, lastSeenAt: seen, now })).toBe("stuck");
    expect(classifyAgentStatus({ hasUnansweredQuestion: true, hasStalledClaim: true, hasActiveClaim: false, lastSeenAt: seen, now })).toBe("waiting");
    expect(classifyAgentStatus({ hasUnansweredQuestion: false, hasStalledClaim: false, hasActiveClaim: true, lastSeenAt: seen, now })).toBe("working");
    expect(classifyAgentStatus({ hasUnansweredQuestion: false, hasStalledClaim: false, hasActiveClaim: false, lastSeenAt: seen, now })).toBe("idle");
  });

  it("calls a claim stalled when quiet or overdue, unless a pull request is linked or a question to its owner pauses it", () => {
    const claim = { quiet: false, deliverBy: new Date(now.getTime() + 60_000), waitingOnOwnerSince: null, pullRequestUrl: null, now };
    expect(isClaimStalled(claim)).toBe(false);
    expect(isClaimStalled({ ...claim, quiet: true })).toBe(true);
    expect(isClaimStalled({ ...claim, deliverBy: new Date(now.getTime() - 60_000) })).toBe(true);
    expect(isClaimStalled({ ...claim, quiet: true, pullRequestUrl: "https://github.com/o/r/pull/1" })).toBe(false);
    expect(isClaimStalled({ ...claim, quiet: true, waitingOnOwnerSince: now })).toBe(false);
  });
});
