import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One payment system (#one-payment): a funded issue's Ziks pay everyone who worked on it once it is live, Ziki's fee
 * first, then each role's share; an empty role's share goes to the fixer. Nothing else pays.
 */

type Row = { account: string; userId?: string | null; bugId?: string | null; kind: string; amount: number; sourceKey: string; payoutRole?: string | null; agentId?: string | null };

const world = vi.hoisted(() => ({
  rows: [] as Row[],
  bug: {} as Record<string, unknown>,
  reports: [] as { onBehalfOfUserId: string }[],
  verdicts: [] as { onBehalfOfUserId: string; agentId: string | null }[],
  review: null as { onBehalfOfUserId: string; agentId: string | null } | null,
  estimates: [] as { onBehalfOfUserId: string; agentId: string | null }[],
  claim: null as { agentId: string | null; awardedByUserId: string | null; dispatcherUserId: string | null } | null,
  confirms: [] as { id: string; verdict: string; onBehalfOfUserId: string; agentId: string | null }[],
  payers: [] as string[],
  published: 0,
}));

const tx = vi.hoisted(() => ({
  $queryRaw: async () => [],
  bug: {
    findUniqueOrThrow: async () => ({ ...world.bug }),
    update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(world.bug, data),
  },
  coinEntry: {
    aggregate: async ({ where }: { where: { account: string; bugId: string } }) => {
      const found = world.rows.filter((row) => row.account === where.account && row.bugId === where.bugId);
      return { _sum: { amount: found.length ? found.reduce((sum, row) => sum + row.amount, 0) : null } };
    },
    createMany: async ({ data }: { data: Row[] }) => {
      let count = 0;
      for (const row of data) {
        if (world.rows.some((existing) => existing.sourceKey === row.sourceKey)) continue;
        world.rows.push(row);
        count += 1;
      }
      return { count };
    },
  },
  deploymentReport: { findMany: async () => world.reports },
  testVerdict: { findMany: async () => world.verdicts },
  mergeReview: { findFirst: async () => world.review },
  rewardEstimate: { findMany: async () => world.estimates },
  issueClaim: { findFirst: async () => world.claim },
  membership: {
    findMany: async ({ where }: { where: { userId: { in: string[] } } }) =>
      where.userId.in.filter((userId) => world.payers.includes(userId)).map((userId) => ({ userId })),
  },
}));

vi.mock("@/lib/agent-api/confirmations", () => ({
  confirmationStateOf: async () => ({ counted: world.confirms }),
  paidConfirmerOrder: (counted: { verdict: string; onBehalfOfUserId: string }[], bug: { reporterId: string }) =>
    [...new Set(counted.filter((entry) => entry.verdict === "confirm" && entry.onBehalfOfUserId !== bug.reporterId).map((entry) => entry.onBehalfOfUserId))],
}));
vi.mock("@/lib/agent-api/confirmation-penalties", () => ({ penalisedConfirmationIds: async () => new Set<string>() }));
vi.mock("@/lib/agent-api/pull-request-report", () => ({ reportedClosedUnmerged: async () => false }));
vi.mock("@/lib/agent-api/events", () => ({ publish: async () => { world.published += 1; } }));

import { planIssuePayout, releasePayoutIfLive, releasePayoutNow, type Contributor } from "@/lib/coins/issue-payout";

const one = (role: Contributor["role"], userId: string): Contributor => ({ userId, role });
const amounts = (plan: ReturnType<typeof planIssuePayout>) => Object.fromEntries((plan?.lines ?? []).map((line) => [`${line.role}:${line.userId}`, line.amount]));
const paidTo = (userId: string) => world.rows.filter((row) => row.account === "wallet" && row.userId === userId).reduce((sum, row) => sum + row.amount, 0);

describe("how a funded issue's Ziks are shared (#one-payment)", () => {
  it("takes Ziki's fee first, then pays each role its share, handing out every Zik", () => {
    const plan = planIssuePayout(10_000, [
      one("fixer", "fay"), one("tester", "tom"), one("merge_reviewer", "mia"), one("reporter", "rob"),
      one("confirmer", "cal"), one("estimator", "eve"), one("awarder", "ava"),
    ], 10);
    expect(plan?.fee).toBe(1000);
    expect(amounts(plan)).toEqual({
      "fixer:fay": 6300, "tester:tom": 720, "merge_reviewer:mia": 450, "reporter:rob": 450,
      "confirmer:cal": 450, "estimator:eve": 360, "awarder:ava": 270,
    });
  });

  it("gives a role nobody filled to the fixer, and without a fixer shares it between the roles that were filled", () => {
    expect(amounts(planIssuePayout(10_000, [one("fixer", "fay"), one("reporter", "rob")], 10))).toEqual({ "fixer:fay": 8550, "reporter:rob": 450 });
    const noFixer = planIssuePayout(10_000, [one("reporter", "rob"), one("tester", "tom")], 10);
    expect(noFixer!.lines.reduce((sum, line) => sum + line.amount, 0)).toBe(9000);
    expect(amounts(noFixer)["tester:tom"]).toBeGreaterThan(amounts(noFixer)["reporter:rob"]);
  });

  it("weights confirmers by their place in line, so piling on earns little", () => {
    const confirmers = [1, 1, 1, 0.5, 0.25].map((weight, index): Contributor => ({ userId: `c${index}`, role: "confirmer", weight }));
    const plan = planIssuePayout(10_000, [one("fixer", "fay"), ...confirmers], 10);
    const paid = amounts(plan);
    expect(paid["confirmer:c0"]).toBe(paid["confirmer:c2"]);
    expect(Math.abs(paid["confirmer:c3"] * 2 - paid["confirmer:c0"])).toBeLessThanOrEqual(1);
    expect(plan!.lines.reduce((sum, line) => sum + line.amount, 0)).toBe(9000);
  });

  it("pays nothing with nothing funded or nobody to pay", () => {
    expect(planIssuePayout(0, [one("fixer", "fay")], 10)).toBeNull();
    expect(planIssuePayout(10_000, [], 10)).toBeNull();
  });
});

describe("paying out once the work is live (#live-payout)", () => {
  beforeEach(() => {
    world.rows = [{ account: "escrow", bugId: "bug", kind: "fund", amount: 10_000, sourceKey: "fund:bug" }];
    world.bug = {
      id: "bug", number: 7, organisationId: "org", projectId: "proj", reporterId: "rob", beneficiaryUserId: null, assigneeId: "fay",
      pullRequestUrl: null, substatus: "on_dev", payoutReleasedAt: null, createdByAgentId: null, createdByAgent: null, idea: null, project: { solo: false },
    };
    world.reports = [];
    world.verdicts = [{ onBehalfOfUserId: "tom", agentId: "agent-tom" }];
    world.review = { onBehalfOfUserId: "mia", agentId: null };
    world.estimates = [];
    world.claim = { agentId: "agent-fay", awardedByUserId: "ava", dispatcherUserId: null };
    world.confirms = [];
    world.payers = [];
    world.published = 0;
  });

  it("waits for three people other than the fixer to report it deployed, then pays everyone once", async () => {
    world.reports = [{ onBehalfOfUserId: "fay" }, { onBehalfOfUserId: "a" }, { onBehalfOfUserId: "b" }];
    expect(await releasePayoutIfLive(tx as never, "bug")).toBe(false);
    expect(paidTo("fay")).toBe(0);

    world.reports.push({ onBehalfOfUserId: "c" });
    expect(await releasePayoutIfLive(tx as never, "bug")).toBe(true);
    expect(paidTo("fay")).toBeGreaterThan(paidTo("tom"));
    expect(world.rows.find((row) => row.userId === "fay")).toMatchObject({ kind: "release", payoutRole: "fixer", agentId: "agent-fay" });
    // Every Zik is accounted for: the escrow is empty, Ziki has its fee, the rest is in wallets.
    expect(world.rows.filter((row) => row.account === "escrow").reduce((sum, row) => sum + row.amount, 0)).toBe(0);
    expect(world.rows.filter((row) => row.account === "revenue").reduce((sum, row) => sum + row.amount, 0)).toBe(1000);

    const before = world.rows.length;
    expect(await releasePayoutIfLive(tx as never, "bug")).toBe(false);
    expect(world.rows.length).toBe(before);
  });

  it("doesn't pay the organisation's payers (#payers) for reporting or confirming its issues", async () => {
    world.confirms = [{ id: "k1", verdict: "confirm", onBehalfOfUserId: "boss", agentId: null }, { id: "k2", verdict: "confirm", onBehalfOfUserId: "cal", agentId: null }];
    world.payers = ["rob", "boss"];
    expect(await releasePayoutNow(tx as never, "bug")).toBe(true);
    expect(paidTo("rob")).toBe(0);
    expect(paidTo("boss")).toBe(0);
    expect(paidTo("cal")).toBeGreaterThan(0);
  });

  it("pays nobody in a Solo project, and marks an unfunded issue paid so it never pays later", async () => {
    world.bug.project = { solo: true };
    expect(await releasePayoutNow(tx as never, "bug")).toBe(false);
    expect(paidTo("fay")).toBe(0);

    world.bug.project = { solo: false };
    world.rows = [];
    expect(await releasePayoutNow(tx as never, "bug")).toBe(true);
    expect(world.bug.payoutReleasedAt).toBeInstanceOf(Date);
    world.rows.push({ account: "escrow", bugId: "bug", kind: "fund", amount: 5000, sourceKey: "fund:late" });
    expect(await releasePayoutNow(tx as never, "bug")).toBe(false);
    expect(paidTo("fay")).toBe(0);
  });
});
