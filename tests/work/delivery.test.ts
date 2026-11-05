import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "@/lib/agents/require-agent";

/** Delivering work (#pr-reports, #stranded-delivery, #owner-agents): only the claim holder delivers, or a manager agent on its behalf for a stranded pull request; a pull request reported merged, closed or missing can't be delivered. */
const PR = "https://github.com/emerjent/ziki/pull/615";

const db = vi.hoisted(() => {
  const tx = {
    delivery: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    bug: { update: vi.fn() },
    testVerdict: { updateMany: vi.fn() },
    bugActivity: { create: vi.fn() },
  };
  return {
    tx,
    prisma: {
      bug: { findFirst: vi.fn(), findUnique: vi.fn() },
      issueClaim: { findFirst: vi.fn() },
      reviewOffer: { findFirst: vi.fn() },
      agentAuditEvent: { findFirst: vi.fn() },
      pullRequestReport: { findFirst: vi.fn() },
      delivery: { findMany: vi.fn() },
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    },
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  publish: vi.fn(),
  createReviewOffers: vi.fn(async () => ({ offers: [] })),
  strandedDelivery: vi.fn(),
  refreshJudgedStatus: vi.fn(),
}));
vi.mock("@/lib/agents/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/agent-api/events", () => ({ publish: mocks.publish }));
vi.mock("@/lib/agent-api/review-offer", () => ({ createReviewOffers: mocks.createReviewOffers }));
vi.mock("@/lib/agent-api/stranded-delivery", () => ({ STRANDED_AFTER_MS: 2 * 60 * 60 * 1000, strandedDelivery: mocks.strandedDelivery }));
vi.mock("@/lib/agent-api/tested-status", () => ({ refreshJudgedStatus: mocks.refreshJudgedStatus }));

import { deliverWork } from "@/lib/agent-api/delivery";

const agent = (level: AgentContext["level"], ownerId = "dana"): AgentContext => ({
  agentId: `agent-${ownerId}`,
  name: `${ownerId}'s agent`,
  ownerId,
  tenantId: "t1",
  level,
  burst: false,
  keyId: "k1",
});

const body = (pullRequestUrl = PR) => ({
  pullRequestUrl,
  summary: "Delivers the fix in pull request 615.",
  description: "The pull request was linked by hand before deliveries existed; its judgements say it is good to merge.",
  testResults: "Three independent judgements: good to merge.",
});

const stranded = { pullRequestUrl: PR, creditedUserId: "ada", linkedAt: new Date("2026-10-01T10:00:00Z"), goodVerdicts: 2, needed: 2 };

/** Issue #615: In progress, a pull request linked by hand, assigned to Ada, nobody holding a claim. */
function issue(overrides: { reporterId?: string; pullRequestUrl?: string; pullRequestLinkedAt?: Date | null; pullRequestHeadSha?: string | null } = {}) {
  db.prisma.bug.findFirst.mockResolvedValue({
    id: "bug1",
    projectId: "p1",
    status: "in_progress", substatus: "in_progress",
    pullRequestUrl: overrides.pullRequestUrl ?? PR,
    pullRequestLinkedAt: overrides.pullRequestLinkedAt ?? null,
    pullRequestHeadSha: overrides.pullRequestHeadSha ?? "stale-head",
    project: { repoUrl: "https://github.com/emerjent/ziki" },
  });
  db.prisma.bug.findUnique.mockResolvedValue({
    beneficiaryUserId: "rex",
    reporterId: overrides.reporterId ?? "rex",
    assigneeId: "ada",
    createdByAgent: null,
    claims: [],
  });
}

describe("deliverWork: a manager agent delivers a stranded pull request on the holder's behalf (#stranded-delivery)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issue();
    db.prisma.issueClaim.findFirst.mockResolvedValue(null);
    db.prisma.reviewOffer.findFirst.mockResolvedValue(null);
    db.prisma.agentAuditEvent.findFirst.mockResolvedValue(null);
    db.prisma.pullRequestReport.findFirst.mockResolvedValue(null);
    db.prisma.delivery.findMany.mockResolvedValue([
      {
        id: "d1",
        agentId: "agent-dana",
        beneficiaryUserId: "ada",
        summary: body().summary,
        description: body().description,
        pullRequestUrl: PR,
        headSha: null,
        screenshots: [],
        testResults: body().testResults,
        createdAt: new Date(),
        updatedAt: new Date(),
        agent: { name: "dana's agent" },
        beneficiary: { name: "Ada" },
        replies: [],
      },
    ]);
    db.tx.delivery.findUnique.mockResolvedValue(null);
    db.tx.delivery.create.mockResolvedValue({ id: "d1" });
    mocks.strandedDelivery.mockResolvedValue(stranded);
    mocks.refreshJudgedStatus.mockResolvedValue("accepted");
  });

  it("files the delivery as the manager agent, credits the holder, marks it on their behalf and evaluates the judgements at once", async () => {
    const result = await deliverWork(agent("manager"), "bug1", body());
    expect(result).toMatchObject({ status: 201, replaced: false });
    expect(db.tx.delivery.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bugId: "bug1", agentId: "agent-dana", beneficiaryUserId: "ada", pullRequestUrl: PR }) }),
    );
    expect(db.tx.bug.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "done", substatus: "requires_review" }) }));
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      "issue.delivered",
      "bug:bug1",
      expect.objectContaining({ onBehalfOf: true, filedBy: "agent-dana", creditedUserId: "ada" }),
      expect.anything(),
    );
    expect(mocks.refreshJudgedStatus).toHaveBeenCalledWith(db.prisma, "bug1", "dana");
    // Already Done on the existing judgements: no reviewers are asked for more.
    expect(mocks.createReviewOffers).not.toHaveBeenCalled();
  });

  it("keeps 409 no_claim for a working agent without a claim, even on a stranded issue", async () => {
    expect(await deliverWork(agent("working"), "bug1", body())).toMatchObject({ status: 409, error: "no_claim" });
    expect(mocks.strandedDelivery).not.toHaveBeenCalled();
  });

  it("lets the credited person's own manager agent deliver it too (#owner-agents)", async () => {
    expect(await deliverWork(agent("manager", "ada"), "bug1", body())).toMatchObject({ status: 201 });
  });

  it("answers 409 wrong_pull_request unless it delivers the linked pull request", async () => {
    const result = await deliverWork(agent("manager"), "bug1", body("https://github.com/emerjent/ziki/pull/700"));
    expect(result).toMatchObject({ status: 409, error: "wrong_pull_request", field: "pullRequestUrl" });
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

});

/** The latest independent report on the pull request (#pr-reports). */
const report = (state: "open" | "closed" | "merged" | "not_found", overrides: Record<string, unknown> = {}) => ({
  id: "r1",
  bugId: "bug1",
  pullRequestUrl: PR,
  state,
  mergedInto: state === "merged" ? "main" : null,
  inDefaultBranch: state === "merged" ? true : null,
  headSha: null,
  mergeCommitSha: null,
  checks: null,
  mergeable: null,
  note: "Checked it on GitHub.",
  agentId: "agent-rex",
  onBehalfOfUserId: "rex",
  createdAt: new Date("2026-10-30T09:00:00Z"),
  agent: { name: "rex's agent" },
  onBehalfOf: { name: "Rex" },
  ...overrides,
});

describe("deliverWork: the latest pull request report decides whether it can be delivered (#pr-reports)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issue();
    db.prisma.issueClaim.findFirst.mockResolvedValue({ id: "c1", beneficiaryUserId: "ada" });
    db.prisma.reviewOffer.findFirst.mockResolvedValue(null);
    db.prisma.agentAuditEvent.findFirst.mockResolvedValue(null);
    db.prisma.pullRequestReport.findFirst.mockResolvedValue(null);
    db.prisma.delivery.findMany.mockResolvedValue([
      {
        id: "d1",
        agentId: "agent-ada",
        beneficiaryUserId: "ada",
        summary: body().summary,
        description: body().description,
        pullRequestUrl: PR,
        headSha: "abc1234",
        screenshots: [],
        testResults: body().testResults,
        createdAt: new Date(),
        updatedAt: new Date(),
        agent: { name: "ada's agent" },
        beneficiary: { name: "Ada" },
        replies: [],
      },
    ]);
    db.tx.delivery.findUnique.mockResolvedValue(null);
    db.tx.delivery.create.mockResolvedValue({ id: "d1" });
  });

  it("refuses a pull request reported merged, closed or missing, naming who reported it", async () => {
    for (const [state, error] of [
      ["merged", "pull_request_merged"],
      ["closed", "pull_request_closed"],
      ["not_found", "pull_request_not_found"],
    ] as const) {
      db.prisma.pullRequestReport.findFirst.mockResolvedValueOnce(report(state));
      const result = await deliverWork(agent("working", "ada"), "bug1", body());
      expect(result).toMatchObject({ status: 422, error });
      expect((result as { message: string }).message).toContain("rex's agent");
    }
    expect(db.prisma.pullRequestReport.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { bugId: "bug1", pullRequestUrl: PR } }));
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("delivers when nobody has reported the pull request yet, recording the head commit the deliverer sent", async () => {
    const result = await deliverWork(agent("working", "ada"), "bug1", { ...body(), headSha: "abc1234" });
    expect(result).toMatchObject({ status: 201 });
    expect(db.tx.delivery.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ headSha: "abc1234" }) }));
    expect(db.tx.bug.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ pullRequestHeadSha: "abc1234", pullRequestLinkedAt: expect.any(Date), status: "done", substatus: "requires_review" }) }));
    expect(mocks.publish).toHaveBeenCalledWith(db.tx, expect.objectContaining({ type: "issue.delivered", payload: expect.objectContaining({ headSha: "abc1234" }) }));
  });

  it("updates the linked PR timestamp and clears the old head when a different PR is delivered", async () => {
    const previousUrl = "https://github.com/emerjent/ziki/pull/615";
    const nextUrl = "https://github.com/emerjent/ziki/pull/700";
    issue({ pullRequestUrl: previousUrl, pullRequestLinkedAt: new Date("2026-10-30T08:00:00Z"), pullRequestHeadSha: "old-head" });

    expect(await deliverWork(agent("working", "ada"), "bug1", body(nextUrl))).toMatchObject({ status: 201 });
    expect(db.tx.bug.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pullRequestUrl: nextUrl, pullRequestHeadSha: null, pullRequestLinkedAt: expect.any(Date) }),
    }));
  });

  it("refuses a head commit that isn't a hexadecimal SHA", async () => {
    expect(await deliverWork(agent("working", "ada"), "bug1", { ...body(), headSha: "not-a-sha" })).toMatchObject({ status: 400, field: "headSha" });
  });
});
