import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ securityCheckItem: { findMany: vi.fn(), count: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { countAgentJobs, listAgentJobs } from "./your-work";

const at = new Date("2026-11-12T10:00:00Z");
const row = (over: Record<string, unknown>) => ({
  id: "j1", title: "Login form: rate limits", status: "done", assignedAt: at, reportedAt: at,
  agent: { name: "Pixel" }, check: { target: { kind: "website", value: "ziki.dev" } }, results: [], ...over,
});

describe("Your work on Security (#security-checks, plan C1)", () => {
  beforeEach(() => {
    prismaMock.securityCheckItem.findMany.mockReset();
    prismaMock.securityCheckItem.count.mockReset();
  });

  it("lists only parts checked by agents this person owns, never the client's payment or the finding's text", async () => {
    prismaMock.securityCheckItem.findMany.mockResolvedValue([]);
    await listAgentJobs("u1");
    const query = prismaMock.securityCheckItem.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ kind: "check", agent: { ownerUserId: "u1" }, status: { in: ["checking", "done"] } });
    expect(query.select.check.select.paidAt).toBeUndefined();
    expect(Object.keys(query.select.results.select).sort()).toEqual(["payoutReleasedAt", "priceCoins", "severity", "unlockedAt"]);
  });

  it("only lists jobs in the workspace you're in, not everything your agents ever did (23 Nov)", async () => {
    prismaMock.securityCheckItem.findMany.mockResolvedValue([]);
    await listAgentJobs("u1", "org-1");
    expect(prismaMock.securityCheckItem.findMany.mock.calls[0][0].where).toEqual({
      kind: "check", agent: { ownerUserId: "u1" }, status: { in: ["checking", "done"] }, check: { organisationId: "org-1" },
    });
    prismaMock.securityCheckItem.count.mockResolvedValue(1);
    await countAgentJobs("u1", "org-1");
    expect(prismaMock.securityCheckItem.count.mock.calls[0][0].where.check).toEqual({ organisationId: "org-1" });
  });

  it("counts with the same filter", async () => {
    prismaMock.securityCheckItem.count.mockResolvedValue(2);
    expect(await countAgentJobs("u1")).toBe(2);
    expect(prismaMock.securityCheckItem.count.mock.calls[0][0].where).toEqual({ kind: "check", agent: { ownerUserId: "u1" }, status: { in: ["checking", "done"] } });
  });

  it("puts work in progress first and adds up what unlocked findings earned", async () => {
    prismaMock.securityCheckItem.findMany.mockResolvedValue([
      row({
        id: "done-1",
        results: [
          { severity: "critical", priceCoins: null, unlockedAt: at, payoutReleasedAt: null },
          { severity: "high", priceCoins: 400, unlockedAt: at, payoutReleasedAt: at },
          { severity: "low", priceCoins: null, unlockedAt: null, payoutReleasedAt: null },
        ],
      }),
      row({ id: "checking-1", status: "checking", reportedAt: null }),
    ]);
    const jobs = await listAgentJobs("u1");
    expect(jobs.map((job) => job.id)).toEqual(["checking-1", "done-1"]);
    expect(jobs[0]).toMatchObject({ agentName: "Pixel", targetValue: "ziki.dev", findings: 0, earned: 0, paid: false });
    // Critical at its default 500 Ziks, high at the 400 saved on it, each less Ziki's 10% fee; the locked low earns nothing yet.
    expect(jobs[1]).toMatchObject({ findings: 3, earned: 450 + 360, paid: true });
  });
});
