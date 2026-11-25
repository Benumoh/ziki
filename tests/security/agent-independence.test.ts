import { beforeEach, describe, expect, it, vi } from "vitest";

/** An issue's estimates (#price-lock), in memory: who the estimator is to the organisation, and whether the price is locked. */
const estimates = vi.hoisted(() => {
  const state = { role: null as string | null, canFundIssues: false, fixedAt: null as Date | null, updates: [] as Record<string, unknown>[] };
  const tx = {
    bug: {
      findFirst: async () => ({ id: "bug-1" }),
      findUniqueOrThrow: async () => ({ id: "bug-1", status: "open", rewardFixedAt: state.fixedAt, rewardEstimateCount: 3, reward: 5 }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.updates.push(data);
        return { reward: 5, rewardEstimateCount: 3, rewardFixedAt: state.fixedAt };
      },
    },
    // The estimator's membership, matched against the payer rule's `OR` (#payers).
    membership: {
      findFirst: async ({ where }: { where: { OR: Record<string, unknown>[] } }) => {
        const member: Record<string, unknown> | null = state.role ? { role: state.role, canFundIssues: state.canFundIssues } : null;
        return member && where.OR.some((match) => Object.entries(match).every(([key, value]) => member[key] === value)) ? { id: "membership" } : null;
      },
    },
    rewardEstimate: {
      findUnique: async () => null,
      upsert: async () => ({}),
      aggregate: async () => ({ _avg: { value: 5 }, _count: { _all: 3 } }),
    },
    $queryRaw: async () => [],
  };
  return { state, prisma: { ...tx, $transaction: async (run: (db: typeof tx) => unknown) => run(tx) } };
});
vi.mock("@/lib/prisma", () => ({ prisma: estimates.prisma }));

import {
  assertIndependentReviewer,
  ReviewerNotIndependentError,
  reviewerConflict,
  type ReviewedBug,
} from "@/lib/agents/independence";
import { countedMergeVerdicts, type CountableVerdict } from "@/lib/agent-api/merge-verdicts";
import { giveRewardEstimate } from "@/lib/agent-api/reward-estimates";

describe("who prices an issue (#price-lock)", () => {
  const scope = { organisationId: "org-1", projectId: "project-1" };
  beforeEach(() => {
    Object.assign(estimates.state, { role: null, canFundIssues: false, fixedAt: null });
    estimates.state.updates.length = 0;
  });

  it("refuses an estimate from the organisation's payers, and so from their agents: its owners, and admins an owner lets fund issues", async () => {
    for (const payer of [{ role: "owner", canFundIssues: false }, { role: "admin", canFundIssues: true }]) {
      Object.assign(estimates.state, payer);
      await expect(giveRewardEstimate({ userId: "payer", agentId: "payer-agent" }, scope, "#3", { value: 2000 })).rejects.toMatchObject({ status: 403, body: { error: "payer_cannot_estimate" } });
      await expect(giveRewardEstimate({ userId: "payer", agentId: null }, scope, "#3", { value: 2000 })).rejects.toMatchObject({ status: 403 });
    }
    expect(estimates.state.updates).toHaveLength(0);
  });

  it("takes an estimate from anyone else's agent, an admin who doesn't pay included, and restarts the minute the price needs to settle", async () => {
    Object.assign(estimates.state, { role: "admin", canFundIssues: false });
    await expect(giveRewardEstimate({ userId: "admin", agentId: "admin-agent" }, scope, "#3", { value: 5000 })).resolves.toMatchObject({ estimates: 3 });
    Object.assign(estimates.state, { role: "member", canFundIssues: false });
    await expect(giveRewardEstimate({ userId: "member", agentId: "member-agent" }, scope, "#3", { value: 6000 })).resolves.toMatchObject({ estimates: 3 });
    estimates.state.role = null; // an outside agent's owner, on a project open to contributors
    await expect(giveRewardEstimate({ userId: "outsider", agentId: "outsider-agent" }, scope, "#3", { value: 4000 })).resolves.toMatchObject({ estimates: 3 });
    expect(estimates.state.updates).toHaveLength(3);
    expect(estimates.state.updates[2].rewardEstimatedAt).toBeInstanceOf(Date);
  });

  it("takes no more estimates once the price is locked", async () => {
    estimates.state.fixedAt = new Date();
    await expect(giveRewardEstimate({ userId: "outsider", agentId: "outsider-agent" }, scope, "#3", { value: 9000 })).rejects.toMatchObject({ status: 409, body: { error: "reward_fixed" } });
    expect(estimates.state.updates).toHaveLength(0);
  });
});

const alice = "user-alice";
const aliceWorker = { id: "agent-alice-worker", ownerUserId: alice };
const aliceManager = { id: "agent-alice-manager", ownerUserId: alice };
const bobAgent = { id: "agent-bob", ownerUserId: "user-bob" };

/**
 * Independence (#owner-agents): an owner's agents may review the owner's own
 * work; only the agent holding the claim can't review its own, and verdicts
 * count once per person per class.
 */

/** Alice's own ticket: she filed it, it is for her, and her worker agent holds the claim. */
const alicesOwnWork: ReviewedBug = {
  beneficiaryUserId: alice,
  reporterId: alice,
  assigneeId: alice,
  createdByAgent: { ownerUserId: alice },
  claims: [{ status: "active", releasedAt: null, agentId: aliceWorker.id, beneficiaryUserId: alice, dispatcherUserId: alice, agent: { ownerUserId: alice } }],
};

describe("reviewer independence (#owner-agents)", () => {
  it("lets the owner's other agents review the owner's own work: nothing is gated to other people", () => {
    expect(reviewerConflict(aliceManager, alicesOwnWork)).toBeNull();
    expect(() => assertIndependentReviewer(aliceManager, alicesOwnWork)).not.toThrow();
    expect(reviewerConflict(bobAgent, alicesOwnWork)).toBeNull();
  });

  it("refuses only the agent holding the claim, reviewing its own work", () => {
    expect(reviewerConflict(aliceWorker, alicesOwnWork)).toBe("own-claim");
    expect(() => assertIndependentReviewer(aliceWorker, alicesOwnWork)).toThrow(ReviewerNotIndependentError);
  });

  it("ignores claims that are released or only offered", () => {
    const released: ReviewedBug = { ...alicesOwnWork, claims: [{ ...alicesOwnWork.claims![0], releasedAt: new Date() }] };
    const offered: ReviewedBug = { ...alicesOwnWork, claims: [{ ...alicesOwnWork.claims![0], status: "offered" }] };
    expect(reviewerConflict(aliceWorker, released)).toBeNull();
    expect(reviewerConflict(aliceWorker, offered)).toBeNull();
  });
});

const reviewed = { reporterId: "ada", beneficiaryUserId: "ada", createdByAgentId: null, claims: [] };
const verdict = (owner: string, headSha: string | null = null, agentId = `agent-${owner}`, level = "working"): CountableVerdict => ({
  headSha,
  onBehalfOfUserId: owner,
  agent: { id: agentId, ownerUserId: owner, activations: [{ organisationId: "t1", level: level as "working" | "manager" | "merger" }] },
});

describe("countedMergeVerdicts: one verdict rule for the merge gate and the merge queue", () => {
  it("counts one verdict per person per class and names the last counted commit", () => {
    const { reviewers, weight, acceptedHeadSha } = countedMergeVerdicts(
      [verdict("bob", "sha-1"), verdict("bob", "sha-2", "agent-bob-2"), verdict("cara", "sha-3")],
      null,
      reviewed,
      "t1",
      "linked-sha",
    );
    expect(reviewers).toEqual(["bob", "cara"]);
    expect(weight).toBe(2);
    expect(acceptedHeadSha).toBe("sha-3");
  });

  it("weighs a manager or merger agent's verdict 2 and a working agent's 1, so one owner with both gives 3 (#owner-agents)", () => {
    const { reviewers, weight } = countedMergeVerdicts(
      [verdict("ada", null, "ada-manager", "manager"), verdict("ada", null, "ada-worker", "working")],
      null,
      reviewed,
      "t1",
    );
    expect(weight).toBe(3);
    expect(reviewers).toEqual(["ada"]);
    expect(countedMergeVerdicts([verdict("bob", null, "bob-merger", "merger")], null, reviewed, "t1").weight).toBe(2);
  });

  it("leaves out only the agent holding the claim; the owner's other agents count (#owner-agents)", () => {
    const claim = { agentId: "agent-dan", agent: { ownerUserId: "dan" } };
    const { reviewers, weight } = countedMergeVerdicts(
      [verdict("dan"), verdict("dan", null, "agent-dan-manager", "manager"), verdict("bob")],
      claim,
      reviewed,
      "t1",
    );
    expect(reviewers).toEqual(["dan", "bob"]);
    expect(weight).toBe(3);
  });

});
