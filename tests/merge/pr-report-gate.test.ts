import { beforeEach, describe, expect, it, vi } from "vitest";

/** Pull request evidence (#pr-reports, #owner-agents): agents report what they saw on GitHub, any but the claim holder or the deliverer; nothing advances past the latest report on the linked pull request. */
const db = vi.hoisted(() => {
  const tx = {
    pullRequestReport: { create: vi.fn() },
    bug: { updateMany: vi.fn() },
  };
  return {
    bug: { findFirst: vi.fn() },
    delivery: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    tx,
  };
});
const publish = vi.hoisted(() => vi.fn());
const audit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agent-api/events", () => ({ publish }));
vi.mock("@/lib/agents/audit", () => ({ audit }));
vi.mock("@/lib/agent-notifications", () => ({ notifyMergeFailed: vi.fn() }));

import type { AgentContext } from "@/lib/agents/require-agent";
import { reportPullRequestStatus } from "@/lib/agent-api/pull-request-report";
import { prGate, type GateReport } from "@/lib/agent-api/pr-gate";

const PR = "https://github.com/emerjent/ziki/pull/552";
const scope = { tenantId: "t1", projectId: "p1" };
const checker = (ownerId = "erin", level: AgentContext["level"] = "working"): AgentContext =>
  ({ agentId: `agent-${ownerId}`, name: `${ownerId}'s agent`, ownerId, tenantId: "t1", level, burst: false, keyId: "k" });

/** Delivered work on #552, filed by Ada, the claim held by Cara's agent. */
function bug(over: Record<string, unknown> = {}) {
  return {
    id: "bug1", tenantId: "t1", projectId: "p1",
    pullRequestUrl: PR, pullRequestHeadSha: "aaa1111",
    beneficiaryUserId: "ada", reporterId: "ada", assigneeId: null, createdByAgent: null,
    claims: [{ status: "active", releasedAt: null, beneficiaryUserId: "cara", dispatcherUserId: null, agent: { ownerUserId: "cara" } }],
    ...over,
  };
}

const openBody = (over: Record<string, unknown> = {}) => ({
  pullRequestUrl: PR,
  state: "open",
  headSha: "aaa1111",
  checks: "passing",
  mergeable: true,
  note: "Open, checks green, no conflict.",
  ...over,
});

/** The stored row, echoing what was created. */
function savedRow(data: Record<string, unknown>) {
  return {
    id: "rep1",
    ...data,
    createdAt: new Date("2026-10-31T10:00:00Z"),
    agent: { name: "erin's agent" },
    onBehalfOf: { name: "Erin" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.bug.findFirst.mockResolvedValue(bug());
  db.delivery.findFirst.mockResolvedValue(null);
  db.tx.pullRequestReport.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => savedRow(data));
  db.tx.bug.updateMany.mockResolvedValue({ count: 1 });
});

describe("reportPullRequestStatus (#pr-reports)", () => {
  it("stores the report, audits it and publishes issue.pull_request_reported (201)", async () => {
    const result = await reportPullRequestStatus(checker(), scope, "bug1", openBody());
    expect(result).toMatchObject({
      status: 201,
      body: {
        report: {
          id: "rep1", pullRequestUrl: PR, state: "open", headSha: "aaa1111", checks: "passing", mergeable: true,
          note: "Open, checks green, no conflict.",
          reportedBy: { agentId: "agent-erin", agentName: "erin's agent", userId: "erin", name: "Erin" },
        },
      },
    });
    expect(db.bug.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "bug1", ...scope, isDeleted: false } }));
    expect(db.tx.pullRequestReport.create).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        bugId: "bug1", pullRequestUrl: PR, state: "open", mergedInto: null, inDefaultBranch: null, headSha: "aaa1111",
        mergeCommitSha: null, mergedAt: null, checks: "passing", mergeable: true, note: "Open, checks green, no conflict.",
        agentId: "agent-erin", onBehalfOfUserId: "erin",
      },
    }));
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-erin" }),
      "issue.pull_request_reported",
      "bug:bug1",
      expect.objectContaining({ issueId: "bug1", reportId: "rep1", pullRequestUrl: PR, state: "open" }),
      expect.objectContaining({ bugId: "bug1", db: db.tx }),
    );
    expect(publish).toHaveBeenCalledWith(db.tx, expect.objectContaining({
      tenantId: "t1",
      type: "issue.pull_request_reported",
      actorAgentId: "agent-erin",
      bugId: "bug1",
      payload: expect.objectContaining({ reportId: "rep1", state: "open" }),
    }));
    // The head is the one Ziki has: nothing moves.
    expect(db.tx.bug.updateMany).not.toHaveBeenCalled();
  });

  it("answers 409 pr_mismatch for a report on another pull request", async () => {
    const result = await reportPullRequestStatus(checker(), scope, "bug1", openBody({ pullRequestUrl: "https://github.com/emerjent/ziki/pull/9" }));
    expect(result).toMatchObject({ status: 409, body: { error: "pr_mismatch", field: "pullRequestUrl" } });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("lets the claim holder's owner and the filer report through another of their agents (#owner-agents)", async () => {
    for (const owner of ["cara", "ada"]) {
      expect(await reportPullRequestStatus(checker(owner, "manager"), scope, "bug1", openBody())).toMatchObject({ status: 201 });
    }
  });

  it("refuses the agent that delivered this pull request: 403 not_independent (#owner-agents)", async () => {
    db.delivery.findFirst.mockResolvedValue({ id: "d1" });
    const agent = checker("gus");
    expect(await reportPullRequestStatus(agent, scope, "bug1", openBody())).toMatchObject({ status: 403, body: { error: "not_independent" } });
    expect(db.delivery.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { bugId: "bug1", pullRequestUrl: PR, agentId: agent.agentId },
    }));
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("answers 400 for a merged report that doesn't say whether the default branch contains it", async () => {
    const result = await reportPullRequestStatus(checker(), scope, "bug1", { pullRequestUrl: PR, state: "merged", mergedInto: "staging", note: "Merged." });
    expect(result).toMatchObject({ status: 400, body: { error: "invalid_request", field: "inDefaultBranch" } });
    expect(db.bug.findFirst).not.toHaveBeenCalled();
  });

  it("requires GitHub's merge timestamp with a merged report", async () => {
    const result = await reportPullRequestStatus(checker(), scope, "bug1", {
      pullRequestUrl: PR,
      state: "merged",
      mergedInto: "main",
      inDefaultBranch: true,
      mergeCommitSha: "def5678",
      note: "Merged into main.",
    });
    expect(result).toMatchObject({ status: 400, body: { error: "invalid_request", field: "mergedAt" } });
    expect(db.bug.findFirst).not.toHaveBeenCalled();
  });

});

const REPO = { owner: "emerjent", repo: "ziki" };
const GATE_PR = "https://github.com/emerjent/ziki/pull/700";
const issue = (over: Partial<{ pullRequestUrl: string | null; pullRequestHeadSha: string | null }> = {}) => ({
  pullRequestUrl: GATE_PR,
  pullRequestHeadSha: "aaaaaaa",
  repo: REPO,
  ...over,
});
const report = (over: Partial<GateReport> = {}): GateReport => ({
  pullRequestUrl: GATE_PR,
  state: "open",
  mergedInto: null,
  inDefaultBranch: null,
  headSha: "aaaaaaa",
  checks: "passing",
  mergeable: true,
  ...over,
});

describe("prGate (#pr-reports)", () => {
  it("needs a report before anything but delivery", () => {
    expect(prGate(null, issue())).toMatchObject({ canDeliver: true, canAccept: false, canReconcile: false, needsReport: true, broken: null });
  });

  it("ignores a report on another address", () => {
    expect(prGate(report({ pullRequestUrl: "https://github.com/emerjent/ziki/pull/1" }), issue())).toMatchObject({ needsReport: true, canAccept: false });
  });

  it("lets an open, passing pull request at Ziki's head be accepted", () => {
    expect(prGate(report(), issue())).toMatchObject({ canDeliver: true, canAccept: true, needsReport: false, reason: null });
    expect(prGate(report({ checks: "none" }), issue())).toMatchObject({ canAccept: true });
  });

  it("asks for a new report when the head moved since the last one", () => {
    const gate = prGate(report({ headSha: "bbbbbbb" }), issue());
    expect(gate).toMatchObject({ canAccept: false, needsReport: true });
    expect(gate.reason).toContain("head moved");
  });

  it("refuses an accept on failing checks or a conflict, without asking for a report", () => {
    expect(prGate(report({ checks: "failing" }), issue())).toMatchObject({ canDeliver: true, canAccept: false, needsReport: false });
    expect(prGate(report({ mergeable: false }), issue())).toMatchObject({ canAccept: false, needsReport: false });
  });

  it("resolves a merge the default branch contains, and waits for a release otherwise", () => {
    expect(prGate(report({ state: "merged", mergedInto: "main", inDefaultBranch: true }), issue())).toMatchObject({ canReconcile: true, canDeliver: false, canAccept: false, awaitingRelease: false });
    const staging = prGate(report({ state: "merged", mergedInto: "staging", inDefaultBranch: false }), issue());
    expect(staging).toMatchObject({ canReconcile: false, awaitingRelease: true, canAccept: false });
    expect(staging.reason).toContain("staging");
    expect(prGate(report({ state: "merged", inDefaultBranch: null }), issue())).toMatchObject({ needsReport: true, canReconcile: false });
  });

  it("marks a missing or closed pull request broken", () => {
    expect(prGate(report({ state: "not_found" }), issue())).toMatchObject({ broken: "not_found", canDeliver: false });
    expect(prGate(report({ state: "closed" }), issue())).toMatchObject({ broken: "closed_unmerged", canDeliver: false });
  });

});
