import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/** Active work (#556, #593): the holder heartbeats its claim, a silent or overdue claim is released and its issue reopened for bids, and delivered work is never taken back. */
const db = vi.hoisted(() => ({
  agentApiKey: { findUnique: vi.fn() }, agentActivation: { findUnique: vi.fn() }, agentAuditEvent: { create: vi.fn() },
  agentEvent: { create: vi.fn(), groupBy: vi.fn() }, webhookSubscription: { findMany: vi.fn() },
  webhookDelivery: { createMany: vi.fn() },
  bugActivity: { createMany: vi.fn() },
  project: { findFirst: vi.fn(), findUnique: vi.fn() },
  issueClaim: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), create: vi.fn(), groupBy: vi.fn() },
  membership: { findMany: vi.fn(), findUnique: vi.fn() },
  agentQuestion: { findFirst: vi.fn(), updateMany: vi.fn() },
  agentInboxItem: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  agent: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  bug: { updateMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn(),
}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), user: vi.fn(), budget: vi.fn(), notifyLater: vi.fn(), workflow: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/workflow", async (original) => ({
  ...await original<typeof import("@/lib/workflow")>(),
  workflowFor: mocks.workflow,
}));
vi.mock("@/lib/auth-helpers", () => ({ requireSuperAdmin: mocks.admin, requireUser: mocks.user }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/agents/rate-budget", async (original) => ({ ...await original<typeof import("@/lib/agents/rate-budget")>(), consumeAgentBudget: mocks.budget }));
vi.mock("@/lib/notify", () => ({ notifyLater: mocks.notifyLater }));
import { releaseStaleClaims } from "@/lib/agent-api/availability";
import { DEFAULT_PROJECT_WORKFLOW } from "@/lib/workflow-config";
import { POST } from "@/app/api/v1/issues/[id]/heartbeat/route";
import { POST as acknowledge } from "@/app/api/v1/issues/[id]/steer/[steerId]/ack/route";
import { setAgentPaused, sendIssueSteer } from "@/app/actions/agent-steering";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { currentHold } from "@/lib/issue-holders";
import { staleHold } from "@/lib/agent-api/stale-hold";
import { classifyAgentStatus, isClaimStalled, loadOwnAgents } from "@/lib/dashboard-overview";
import { isListedOnPage, projectAgentState, NOT_RESPONDING_AFTER_MS, type HeldClaimSignal } from "@/lib/agents/project-agents";
import { loadAgentStuckContext } from "@/app/(app)/agent/[username]/data";

const now = new Date("2026-10-19T12:00:00Z");
const cutoff = new Date(now.getTime() - DEFAULT_PROJECT_WORKFLOW.heartbeatMinutes * 60 * 1000);
const stale = new Date(cutoff.getTime() - 1);
const claim = { id: "claim", bugId: "issue", agentId: "agent", beneficiaryUserId: "owner", status: "active", releasedAt: null, claimedAt: stale, lastHeartbeatAt: stale, bug: { pullRequestUrl: null, project: { ownerWaitCapMinutes: null }, assignee: { name: "Owner" } } };
const context = { params: Promise.resolve({ id: "issue" }) };
function request(query = "?projectId=project", key = true) {
  return new NextRequest(`http://localhost/api/v1/issues/issue/heartbeat${query}`, { method: "POST", headers: key ? { authorization: "Bearer ziki_test" } : {} });
}
beforeEach(() => {
  vi.resetAllMocks();
  // setTimeout is faked so the re-offer's expiry timer is armed but never fires.
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"] }); vi.setSystemTime(now);
  db.agentActivation.findUnique.mockResolvedValue({ level: "working", burst: false, burstUntil: null, deactivatedAt: null });
  db.agentApiKey.findUnique.mockResolvedValue({ id: "key", revokedAt: null, organisationId: "organisation", agent: { id: "agent", name: "Agent", ownerUserId: "owner", revokedAt: null, username: "agent", tagline: "Test agent", about: "A test agent.", _count: { skills: 1 }, owner: { memberships: [{ organisationId: "organisation" }] } } });
  db.project.findFirst.mockResolvedValue({ id: "project" });
  db.project.findUnique.mockResolvedValue({ id: "project", organisationId: "organisation" });
  db.$queryRaw.mockResolvedValue([{ id: "issue" }]);
  db.$transaction.mockImplementation((run) => run(db));
  db.issueClaim.findFirst.mockResolvedValue(claim);
  db.issueClaim.findUnique.mockResolvedValue({ agentId: "agent" });
  db.issueClaim.findMany.mockResolvedValue([{ id: "claim", bugId: "issue", bug: { organisationId: "organisation", projectId: "project" } }]);
  db.issueClaim.update.mockResolvedValue({ ...claim, lastHeartbeatAt: now });
  db.issueClaim.count.mockResolvedValue(0);
  db.issueClaim.create.mockResolvedValue({ id: "claim-next", bugId: "issue", offeredAt: now });
  db.issueClaim.groupBy.mockResolvedValue([]);
  db.bugActivity.createMany.mockResolvedValue({ count: 2 });
  db.agentInboxItem.findMany.mockResolvedValue([]);
  db.agent.findFirst.mockResolvedValue({ id: "agent", pausedAt: null });
  db.agent.findMany.mockResolvedValue([]);
  mocks.user.mockResolvedValue({ id: "owner", name: "Owner" });
  db.membership.findMany.mockResolvedValue([]);
  db.bug.updateMany.mockResolvedValue({ count: 1 });
  db.bug.findFirst.mockResolvedValue({ id: "issue", projectId: "project", title: "Bug", reporterId: "reporter", assigneeId: null, status: "open", substatus: "open" });
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
    expect(values).toEqual(["issue", "organisation", "project"]);
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
    expect(db.bug.updateMany).toHaveBeenCalledWith({ where: { id: "issue", projectId: "project", organisationId: "organisation", isDeleted: false, assigneeId: "owner", status: "in_progress", pullRequestUrl: null }, data: { assigneeId: null, status: "open", substatus: "open" } });
    expect(db.bugActivity.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([
      expect.objectContaining({ bugId: "issue", actorId: "admin", type: "assignee_changed", metadata: { field: "assignee", from: "owner", to: null } }),
      expect.objectContaining({ bugId: "issue", actorId: "admin", type: "status_changed", metadata: { field: "status", from: "in_progress", to: "open" } }),
    ]) });
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "claim.released", agentId: "agent", actorUserId: "admin", bugId: "issue", payload: { claimId: "claim", reason: "silence", projectId: "project" } }) });
    expect(mocks.notifyLater).toHaveBeenCalledWith({
      kind: "status_changed", actorId: "ziki-system", actorName: "Ziki", bugId: "issue", bugTitle: "Bug", reporterId: "reporter", from: "in_progress", to: "open",
    });
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.issueClaim.findFirst.mock.invocationCallOrder[0]);
  });
  it("does not release a silent claim whose fix is already linked (#551)", async () => {
    db.issueClaim.findFirst.mockResolvedValueOnce({ ...claim, bug: { pullRequestUrl: "https://github.com/o/r/pull/1", project: { ownerWaitCapMinutes: null } } });
    expect(await releaseStaleClaims("project")).toEqual({ released: 0 });
    expect(db.issueClaim.update).not.toHaveBeenCalled();
    expect(db.bug.updateMany).not.toHaveBeenCalled();
    expect(db.agentEvent.create).not.toHaveBeenCalled();
  });
  it("does not log a reopen when the guarded issue update no longer matches", async () => {
    db.bug.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await releaseStaleClaims("project")).toEqual({ released: 1 });
    expect(db.bugActivity.createMany).not.toHaveBeenCalled();
    expect(mocks.notifyLater).not.toHaveBeenCalled();
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

describe("reopen alerts from the in-process cron", () => {
  it("delivers without a request instead of throwing and ending the sweep", async () => {
    const { notifyLater } = await vi.importActual<typeof import("@/lib/notify")>("@/lib/notify");
    db.bug.findUnique.mockResolvedValue(null);
    expect(() => notifyLater({ kind: "status_changed", actorId: "ziki-system", actorName: "Ziki", bugId: "issue", bugTitle: "Bug", reporterId: "reporter", from: "in_progress", to: "open" })).not.toThrow();
    await vi.waitFor(() => expect(db.bug.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "issue" } })));
  });
});

describe("claim release countdown", () => {
  it("uses the earlier of the heartbeat and delivery deadlines", async () => {
    const deliverBy = new Date(now.getTime() + 5 * 60_000);
    db.issueClaim.findFirst.mockResolvedValueOnce({
      ...claim,
      lastHeartbeatAt: now,
      claimedAt: now,
      deliverBy,
      waitingOnOwnerSince: null,
      agent: { name: "Working agent" },
      beneficiary: { name: "Issue owner" },
      dispatcher: null,
      awardedBid: null,
      bug: { projectId: "project", pullRequestUrl: null },
    });
    await expect(currentHold("issue")).resolves.toMatchObject({ releaseAt: deliverBy });
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

  it("calls an agent stuck on an older quiet claim even when its newest claim already has a pull request", async () => {
    const quietSince = new Date(now.getTime() - 25 * 60_000);
    const project = { slug: "platform", organisation: { slug: "acme" } };
    db.agentEvent.groupBy.mockResolvedValue([]);
    db.agent.findMany.mockResolvedValueOnce([{
      id: "agent", name: "Builder", username: "builder", avatar: null, model: null, tagline: "Builds", about: "Builds things.",
      _count: { skills: 1 }, activations: [{ organisationId: "organisation", level: "working" }], apiKeys: [], questions: [],
      // Newest first, as the query orders them: the newest is quiet too, but its fix is linked.
      claims: [
        { claimedAt: quietSince, lastHeartbeatAt: quietSince, deliverBy: null, waitingOnOwnerSince: null,
          bug: { number: 108, title: "Delivered", status: "in_progress", isDeleted: false, pullRequestUrl: "https://github.com/o/r/pull/1", project } },
        { claimedAt: quietSince, lastHeartbeatAt: quietSince, deliverBy: null, waitingOnOwnerSince: null,
          bug: { number: 107, title: "Stalled work", status: "in_progress", isDeleted: false, pullRequestUrl: null, project } },
      ],
    }]);

    const [agent] = await loadOwnAgents({ userId: "owner", organisationId: "organisation", now });
    expect(agent).toMatchObject({ status: "stuck", activity: "No word on #107 for 25 min", issue: { number: 107, href: "/acme/platform/107" } });
    expect(db.agent.findMany.mock.calls[0][0].select.claims).not.toHaveProperty("take");
  });

  it("ignores another organisation's issue-linked question while showing this organisation's stuck issue", async () => {
    const heartbeat = new Date(now.getTime() - 20 * 60_000);
    db.membership.findUnique.mockResolvedValue({ userId: "member" });
    db.agent.findFirst.mockResolvedValueOnce({
      // The organisation-scoped Prisma selection excludes issue-linked questions from other organisations.
      questions: [],
      claims: [{
        claimedAt: heartbeat,
        lastHeartbeatAt: heartbeat,
        deliverBy: new Date(now.getTime() + 60 * 60_000),
        waitingOnOwnerSince: null,
        bug: {
          number: 42,
          title: "Stalled work",
          status: "in_progress",
          isDeleted: false,
          pullRequestUrl: null,
          project: { slug: "platform", organisation: { slug: "acme" } },
        },
      }],
    });

    await expect(loadAgentStuckContext({
      agentId: "agent",
      organisationId: "organisation",
      viewer: { id: "member" },
      now,
    })).resolves.toMatchObject({
      summary: "No word on #42 for 20 min",
      issue: { number: 42, title: "Stalled work", href: "/acme/platform/42" },
      lastHeartbeatAt: heartbeat,
      deadlinePassed: false,
    });
    expect(db.agent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "agent",
        activations: { some: { organisationId: "organisation", deactivatedAt: null } },
      }),
      select: expect.objectContaining({
        questions: expect.objectContaining({
          where: {
            answeredAt: null,
            OR: [{ bug: { organisationId: "organisation" } }, { bugId: null }],
          },
        }),
        claims: expect.objectContaining({ where: expect.objectContaining({ bug: { organisationId: "organisation" } }) }),
      }),
    }));
  });

  it("lets an unanswered unlinked question in this organisation take precedence over a stuck claim", async () => {
    db.membership.findUnique.mockResolvedValue({ userId: "member" });
    db.agent.findFirst.mockResolvedValueOnce({
      questions: [{ id: "unlinked-question" }],
      claims: [{
        claimedAt: stale,
        lastHeartbeatAt: stale,
        deliverBy: new Date(now.getTime() + 60 * 60_000),
        waitingOnOwnerSince: null,
        bug: {
          number: 42,
          title: "Stalled work",
          status: "in_progress",
          isDeleted: false,
          pullRequestUrl: null,
          project: { slug: "platform", organisation: { slug: "acme" } },
        },
      }],
    });

    await expect(loadAgentStuckContext({
      agentId: "agent",
      organisationId: "organisation",
      viewer: { id: "member" },
      now,
    })).resolves.toBeNull();
  });

  it("does not read stuck issue details for a non-member", async () => {
    db.membership.findUnique.mockResolvedValue(null);
    await expect(loadAgentStuckContext({
      agentId: "agent",
      organisationId: "organisation",
      viewer: { id: "guest" },
      now,
    })).resolves.toBeNull();
    expect(db.agent.findFirst).not.toHaveBeenCalled();
  });
});


describe("owner pause and steering", () => {
  const pauseStart = new Date(now.getTime() - 60_000);
  const pausedKey = () => ({ id: "key", revokedAt: null, organisationId: "organisation", agent: {
    id: "agent", name: "Agent", ownerUserId: "owner",
    revokedAt: null, pausedAt: pauseStart, username: "agent", tagline: "Ready", about: "Ready.",
    _count: { skills: 1 }, owner: { memberships: [{ organisationId: "organisation" }] },
  } });
  const note = { id: "steer", payload: { type: "steer", body: "Focus on the deadline." }, createdAt: now };
  const ackRequest = (plan = "I will cover the deadline boundary.", query = "?projectId=project") =>
    new NextRequest(`http://localhost/api/v1/issues/issue/steer/steer/ack${query}`, {
      method: "POST", headers: { authorization: "Bearer ziki_test", "content-type": "application/json" },
      body: JSON.stringify({ plan }),
    });
  const ackContext = { params: Promise.resolve({ id: "issue", steerId: "steer" }) };

  it("refuses paused work before running it, but lets its holder heartbeat without advancing time", async () => {
    db.agentApiKey.findUnique.mockResolvedValue(pausedKey());
    const work = vi.fn();
    const response = await agentIssueRequest(request(), "work.read", "read", null, work);
    expect(response.status).toBe(423);
    expect(work).not.toHaveBeenCalled();
    expect((await POST(request(), context)).status).toBe(200);
    expect(db.issueClaim.update).not.toHaveBeenCalled();
  });

  it("also freezes a heartbeat when the owner paused after authentication", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: "issue" }]).mockResolvedValueOnce([{ pausedAt: pauseStart }]);
    expect((await POST(request(), context)).status).toBe(200);
    expect(db.issueClaim.update).not.toHaveBeenCalled();
  });

  it("retains unacknowledged notes across heartbeat retries without marking them read", async () => {
    db.agentInboxItem.findMany.mockResolvedValue([note]);
    for (let i = 0; i < 2; i++) {
      const response = await POST(request(), context);
      expect(response.status).toBe(200);
      expect((await response.json()).steering).toEqual([{ ...note, createdAt: now.toISOString(),
        acknowledge_url: "/api/v1/issues/issue/steer/steer/ack?projectId=project" }]);
    }
    expect(db.agentInboxItem.updateMany).not.toHaveBeenCalled();
    expect(db.agentInboxItem.update).not.toHaveBeenCalled();
  });

  it("acknowledges only the addressed agent's note and marks it read with the plan in one transaction", async () => {
    db.agentInboxItem.findFirst.mockResolvedValue(note);
    const response = await acknowledge(ackRequest(), ackContext);
    expect(response.status).toBe(200);
    expect(db.agentInboxItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: "steer", agentId: "agent", bugId: "issue", eventType: "agent.steer",
    } }));
    expect(db.agentInboxItem.update).toHaveBeenCalledWith({ where: { id: "steer" }, data: {
      readAt: now, payload: { ...note.payload, plan: "I will cover the deadline boundary.", acknowledgedAt: now.toISOString() },
    } });
    expect(db.$transaction).toHaveBeenCalled();
    db.agentInboxItem.update.mockClear();
    db.agentInboxItem.findFirst.mockResolvedValue({ ...note, payload: { ...note.payload, acknowledgedAt: now.toISOString() } });
    expect((await acknowledge(ackRequest("A retry."), ackContext)).status).toBe(200);
    expect(db.agentInboxItem.update).not.toHaveBeenCalled();
  });

  it("rejects absent/foreign notes, wrong projects, missing scope and blank plans without acknowledgement", async () => {
    db.agentInboxItem.findFirst.mockResolvedValue(null);
    expect((await acknowledge(ackRequest(), ackContext)).status).toBe(404);
    db.bug.findFirst.mockResolvedValueOnce(null);
    expect((await acknowledge(ackRequest(), ackContext)).status).toBe(404);
    expect((await acknowledge(ackRequest(" "), ackContext)).status).toBe(422);
    expect((await acknowledge(ackRequest("Plan.", ""), ackContext)).status).toBe(400);
    expect(db.agentInboxItem.update).not.toHaveBeenCalled();
  });

  it("leaves a paused claim alone when the sweep rechecks it, including owner-wait sweeps", async () => {
    // Candidate was read before pause; after the agent lock its guarded re-read finds nothing.
    db.issueClaim.findFirst.mockResolvedValue(null);
    expect(await releaseStaleClaims("project")).toEqual({ released: 0 });
    expect(db.issueClaim.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ agent: { pausedAt: null } }) }));
    expect(db.issueClaim.findMany.mock.calls.every(([query]) => query.where.agent?.pausedAt === null)).toBe(true);
    expect(db.issueClaim.update).not.toHaveBeenCalled();
  });

  it("shifts resume clocks by the pause duration and preserves the original claim start", async () => {
    db.agent.findFirst.mockResolvedValue({ id: "agent", pausedAt: pauseStart });
    const deliverBy = new Date(now.getTime() + 3_600_000);
    db.issueClaim.findMany.mockResolvedValue([{ ...claim, deliverBy, waitingOnOwnerSince: stale }]);
    expect(await setAgentPaused("agent", false)).toEqual({ ok: true });
    expect(db.issueClaim.update).toHaveBeenCalledWith({ where: { id: "claim" }, data: {
      lastHeartbeatAt: new Date(stale.getTime() + 60_000), deliverBy: new Date(deliverBy.getTime() + 60_000),
      waitingOnOwnerSince: new Date(stale.getTime() + 60_000),
    } });
    expect(db.agent.update).toHaveBeenCalledWith({ where: { id: "agent" }, data: { pausedAt: null } });
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.agent.findFirst.mock.invocationCallOrder[0]);
  });

  it("uses the original claim start for a missing heartbeat, without rewriting claimedAt", async () => {
    db.agent.findFirst.mockResolvedValue({ id: "agent", pausedAt: pauseStart });
    db.issueClaim.findMany.mockResolvedValue([{ ...claim, lastHeartbeatAt: null, deliverBy: null, waitingOnOwnerSince: null }]);
    await setAgentPaused("agent", false);
    expect(db.issueClaim.update).toHaveBeenCalledWith({ where: { id: "claim" }, data: {
      lastHeartbeatAt: new Date(stale.getTime() + 60_000), deliverBy: null, waitingOnOwnerSince: null,
    } });
  });

  it("releases pending offers on pause, keeps active claims, and does not apply the transition twice", async () => {
    expect(await setAgentPaused("agent", true)).toEqual({ ok: true });
    expect(db.issueClaim.updateMany).toHaveBeenCalledWith({ where: { agentId: "agent", status: "offered", releasedAt: null },
      data: { status: "released", releasedAt: now, releaseReason: "paused" } });
    expect(db.agentEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "claim.released", bugId: "issue", organisationId: "organisation" }) }));
    expect(db.issueClaim.update).not.toHaveBeenCalled();
    db.agent.findFirst.mockResolvedValue({ id: "agent", pausedAt: now });
    db.agent.update.mockClear();
    await setAgentPaused("agent", true);
    expect(db.agent.update).not.toHaveBeenCalled();
  });

  it("refuses another owner's pause or steer request", async () => {
    db.agent.findFirst.mockResolvedValue(null);
    expect(await setAgentPaused("agent", true)).toMatchObject({ ok: false });
    expect(await sendIssueSteer("agent", "issue", "Please focus.")).toMatchObject({ ok: false });
    expect(db.agent.findFirst.mock.calls.every(([query]) => query.where.ownerUserId === "owner")).toBe(true);
    expect(db.agent.update).not.toHaveBeenCalled();
    expect(db.agentInboxItem.create).not.toHaveBeenCalled();
  });

  it("keeps owner identity and pause metadata out of the shared holder API view", async () => {
    db.issueClaim.findFirst.mockResolvedValue({ ...claim, agent: { name: "Agent", ownerUserId: "private", pausedAt: now },
      beneficiary: { name: "Owner" }, dispatcher: null, awardedBid: null, offeredAt: null, deliverBy: null, bug: { projectId: "project", pullRequestUrl: null } });
    const holder = await currentHold("issue");
    expect(holder).toMatchObject({ agentName: "Agent", status: "active" });
    expect(holder).not.toHaveProperty("ownerUserId");
    expect(holder).not.toHaveProperty("pausedAt");
    expect(holder).not.toHaveProperty("agentId");
  });

  it("does not report a paused agent's silent claim as stale", async () => {
    const silent = { ...claim, status: "active", offeredAt: null, deliverBy: null, waitingOnOwnerSince: null, bug: { projectId: "project", pullRequestUrl: null, status: "in_progress" } };
    db.issueClaim.findFirst.mockResolvedValue({ ...silent, agent: { pausedAt: now } });
    await expect(staleHold("issue", now)).resolves.toBeNull();
    db.issueClaim.findFirst.mockResolvedValue({ ...silent, agent: { pausedAt: null } });
    await expect(staleHold("issue", now)).resolves.toMatchObject({ kind: "silent" });
  });
});

describe("active agents in a project (#active-agents)", () => {
  const minutes = (n: number) => new Date(now.getTime() - n * 60_000);
  const live: HeldClaimSignal = {
    status: "active", issueNumber: 7, issueStatus: "in_progress", offeredAt: minutes(60), claimedAt: minutes(55),
    lastHeartbeatAt: minutes(2), deliverBy: new Date(now.getTime() + 3_600_000), waitingOnOwnerSince: null, pullRequestUrl: null,
  };
  const offer: HeldClaimSignal = { ...live, status: "offered", issueNumber: 9, claimedAt: null, lastHeartbeatAt: null, deliverBy: null, offeredAt: minutes(10) };
  const state = (claims: HeldClaimSignal[], extra: Partial<Parameters<typeof projectAgentState>[0]> = {}) =>
    projectAgentState({ claims, openBids: 0, paused: false, hasUnansweredQuestion: false, lastSeenAt: minutes(1), now, ...extra }).status;

  it("calls quiet or overdue work stuck, ahead of everything but a pause, and live work working", () => {
    expect(state([live])).toBe("working");
    expect(state([{ ...live, lastHeartbeatAt: minutes(40) }], { hasUnansweredQuestion: true })).toBe("stuck");
    expect(state([{ ...live, deliverBy: minutes(1) }])).toBe("stuck");
    expect(state([{ ...live, lastHeartbeatAt: minutes(40), pullRequestUrl: "https://github.com/o/r/pull/1" }])).toBe("working");
    expect(state([{ ...live, lastHeartbeatAt: minutes(40) }], { paused: true })).toBe("paused");
    // Delivered work it still holds is not stuck, however quiet.
    expect(state([{ ...live, issueStatus: "done", lastHeartbeatAt: minutes(400) }])).toBe("delivered");
  });

  it("calls an offer not responding only when the agent hasn't been seen since it was made, past the window", () => {
    expect(state([offer], { lastSeenAt: minutes(20) })).toBe("not_responding");
    expect(state([offer], { lastSeenAt: null })).toBe("not_responding");
    // Seen since the offer: it is deciding, not ignoring it.
    expect(state([offer], { lastSeenAt: minutes(1) })).toBe("offered");
    // Too soon to say.
    const fresh = { ...offer, offeredAt: new Date(now.getTime() - NOT_RESPONDING_AFTER_MS + 1_000) };
    expect(state([fresh], { lastSeenAt: minutes(20) })).toBe("offered");
  });

  it("falls back to bidding, then idle only while online, away within a day, then offline", () => {
    expect(state([], { openBids: 2 })).toBe("bidding");
    // Idle is free and online now: the agents that get offers and hand-overs.
    expect(state([], { lastSeenAt: minutes(10) })).toBe("idle");
    expect(state([], { lastSeenAt: minutes(20) })).toBe("away");
    expect(state([], { lastSeenAt: minutes(60 * 23) })).toBe("away");
    expect(state([], { lastSeenAt: minutes(60 * 25) })).toBe("offline");
  });

  it("calls an agent clearing the queue working, claim or not, for 5 minutes after its last step (#work-alerts)", () => {
    expect(state([], { lastActedAt: minutes(2) })).toBe("working");
    expect(state([], { openBids: 2, lastActedAt: minutes(2) })).toBe("working");
    expect(state([], { lastActedAt: minutes(6) })).toBe("idle");
    // An offer still says so first: its owner has to know it is waiting.
    expect(state([offer], { lastActedAt: minutes(2) })).toBe("offered");
  });

  it("leaves a delivered agent that isn't online off the page, and lists it while it is", () => {
    expect(isListedOnPage({ status: "delivered", lastSeenAt: minutes(60 * 24 * 10) }, now)).toBe(false);
    expect(isListedOnPage({ status: "delivered", lastSeenAt: null }, now)).toBe(false);
    expect(isListedOnPage({ status: "delivered", lastSeenAt: minutes(5) }, now)).toBe(true);
    // Only delivered agents: a stuck or offline one stays listed, whenever it was seen.
    expect(isListedOnPage({ status: "stuck", lastSeenAt: minutes(60 * 24 * 10) }, now)).toBe(true);
    expect(isListedOnPage({ status: "offline", lastSeenAt: minutes(60 * 24 * 10) }, now)).toBe(true);
  });
});
