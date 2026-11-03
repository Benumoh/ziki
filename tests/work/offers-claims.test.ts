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
  issueClaim: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
  reviewOffer: { findUnique: vi.fn(), update: vi.fn() },
  jobReviewOffer: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  issueBid: { findFirst: vi.fn(), updateMany: vi.fn() },
  bug: { update: vi.fn() },
  bugActivity: { createMany: vi.fn() },
}));
const publish = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agent-api/events", () => ({ publish }));
vi.mock("@/lib/watch", () => ({ ensureWatching: vi.fn(async () => undefined) }));
vi.mock("@/lib/agent-notifications", () => ({ notifyClaimOffered: vi.fn() }));
vi.mock("@/lib/workflow", async (original) => {
  const { DEFAULT_PROJECT_WORKFLOW } = await import("@/lib/workflow-config");
  return { ...await original<typeof import("@/lib/workflow")>(), workflowFor: vi.fn(async () => ({ ...DEFAULT_PROJECT_WORKFLOW })) };
});

import { acceptOffer, isOfferExpired, OFFER_TTL_MS } from "@/lib/agent-api/offer";
import { acceptReviewOffer } from "@/lib/agent-api/review-offer";
import { acceptJobReviewOffer } from "@/lib/jobs/review";
import { AgentProjectError } from "@/lib/agents/require-agent";
import { DEFAULT_PROJECT_WORKFLOW } from "@/lib/workflow-config";
import type { AgentContext } from "@/lib/agents/require-agent";

const agent = { agentId: "agent-1", name: "Ada's Claude", ownerId: "ada", tenantId: "t1", level: "working", burst: false, keyId: "k1" } as AgentContext;
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
  bug: { id: "bug-1", title: "Bug 1", substatus: "open", assigneeId: null, tenantId: "t1", projectId: "p1", areaId: null, voteCount: 0, assignee: null },
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
});

describe("accepting an offer", () => {
  it("starts the claim, moves the issue In progress and withdraws the other bids", async () => {
    db.issueBid.findFirst.mockResolvedValue({ id: "bid-1" });
    const result = await acceptOffer(agent, "claim-1");
    expect(result).toMatchObject({ expired: false, claim: { id: "claim-1", status: "active" } });
    expect(db.bug.update).toHaveBeenCalledWith(expect.objectContaining({ data: { assigneeId: "ada", status: "in_progress", substatus: "in_progress" } }));
    expect(db.issueBid.updateMany).toHaveBeenCalledWith({ where: { bugId: "bug-1", withdrawnAt: null, awardedAt: null }, data: { withdrawnAt: expect.any(Date) } });
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({ type: "claim.accepted" }));
  });

  it("is only for the agent it was offered to, and not from another tenant", async () => {
    await expect(acceptOffer({ ...agent, agentId: "agent-2" }, "claim-1")).rejects.toMatchObject({ status: 409 });
    await expect(acceptOffer({ ...agent, tenantId: "t2" }, "claim-1")).rejects.toMatchObject({ status: 404 });
    expect(db.bug.update).not.toHaveBeenCalled();
  });

  it("does not let a project-scoped key accept an offer in another project", async () => {
    await expect(acceptOffer({ ...agent, projectId: "p2" }, "claim-1")).rejects.toBeInstanceOf(AgentProjectError);
    expect(db.issueClaim.update).not.toHaveBeenCalled();
    expect(db.bug.update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("rechecks the locked issue project before activating a claim", async () => {
    db.issueClaim.findUnique
      .mockResolvedValueOnce(offered())
      .mockResolvedValueOnce(offered({ bug: { ...offered().bug, projectId: "p2" } }));
    await expect(acceptOffer({ ...agent, projectId: "p1" }, "claim-1")).rejects.toBeInstanceOf(AgentProjectError);
    expect(db.issueClaim.update).not.toHaveBeenCalled();
    expect(db.bug.update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects PR review offers from another project before changing their status", async () => {
    db.reviewOffer.findUnique.mockResolvedValue({
      id: "review-offer-1", agentId: agent.agentId, status: "offered", offeredAt: new Date(),
      bugId: "bug-1", pullRequestUrl: "https://github.com/emerjent/ziki/pull/1", headSha: null,
      bug: { tenantId: "t1", projectId: "p1" },
    });
    await expect(acceptReviewOffer({ ...agent, projectId: "p2" }, "review-offer-1")).rejects.toBeInstanceOf(AgentProjectError);
    expect(db.reviewOffer.update).not.toHaveBeenCalled();
  });

  it("rejects job review offers from another project before changing their status", async () => {
    db.jobReviewOffer.findUnique.mockResolvedValue({
      id: "job-review-offer-1", agentId: agent.agentId, status: "offered", offeredAt: new Date(),
      submission: { id: "submission-1", job: { tenantId: "t1", projectId: "p1" } },
    });
    await expect(acceptJobReviewOffer({ ...agent, projectId: "p2" }, "job-review-offer-1")).rejects.toBeInstanceOf(AgentProjectError);
    expect(db.jobReviewOffer.update).not.toHaveBeenCalled();
    expect(db.jobReviewOffer.updateMany).not.toHaveBeenCalled();
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
  });

  it("releases it when the person already holds their limit of work In progress", async () => {
    db.issueClaim.count.mockResolvedValue(DEFAULT_PROJECT_WORKFLOW.maxActiveClaims);
    await expect(acceptOffer(agent, "claim-1")).rejects.toMatchObject({ status: 409 });
    expect(db.issueClaim.count.mock.calls[0][0].where.bug).toMatchObject({ status: "in_progress" });
    expect(db.issueClaim.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ releaseReason: "capacity" }) }));
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
