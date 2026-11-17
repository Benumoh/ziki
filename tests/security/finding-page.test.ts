import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  securityCheckResult: { findFirst: vi.fn(), findUnique: vi.fn() },
  project: { findMany: vi.fn() },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { loadCheckFinding } from "@/lib/security-checks/finding-page";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    checkId: "c1",
    severity: "critical",
    title: "Admin page opens without a password",
    description: "Anyone can open /admin.",
    priceCoins: 5,
    unlockedAt: null,
    findingId: null,
    item: { title: "Admin and login pages" },
    check: { projectId: null, target: { value: "shop.test" } },
    finding: null,
    ...overrides,
  };
}

describe("a finding opened like a ticket (16 Nov call)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.project.findMany.mockResolvedValue([
      { id: "p1", name: "Web", slug: "web", repoUrl: "https://github.com/acme/web", githubInstallationId: "123" },
      { id: "p2", name: "Docs", slug: "docs", repoUrl: null, githubInstallationId: null },
    ]);
  });

  it("is the requester's alone", async () => {
    db.securityCheckResult.findFirst.mockResolvedValue(null);
    expect(await loadCheckFinding("c1", "r1", "org1", "someone")).toBeNull();
    expect(db.securityCheckResult.findFirst.mock.calls[0][0].where).toEqual({ id: "r1", checkId: "c1", check: { organisationId: "org1", requestedById: "someone" } });
  });

  it("while locked: shows what's wrong and the price, and never reads how to fix it", async () => {
    db.securityCheckResult.findFirst.mockResolvedValue(row());
    const finding = await loadCheckFinding("c1", "r1", "org1", "u1");
    expect(finding).toMatchObject({ title: "Admin page opens without a password", area: "Admin and login pages", price: 5, unlocked: false, howToFix: null });
    expect(db.securityCheckResult.findFirst.mock.calls[0][0].select).not.toHaveProperty("howToFix");
    expect(db.securityCheckResult.findUnique).not.toHaveBeenCalled();
    // Which projects could fix it, and whether their code is connected.
    expect(finding?.projects.map((p) => [p.name, p.codeConnected])).toEqual([["Web", true], ["Docs", false]]);
  });

  it("once unlocked: the steps, at no further cost", async () => {
    db.securityCheckResult.findFirst.mockResolvedValue(row({ unlockedAt: new Date() }));
    db.securityCheckResult.findUnique.mockResolvedValue({ howToFix: "Put /admin behind sign-in." });
    expect(await loadCheckFinding("c1", "r1", "org1", "u1")).toMatchObject({ unlocked: true, price: 0, howToFix: "Put /admin behind sign-in." });
  });

  it("only offers the project a check already sends its findings to", async () => {
    db.securityCheckResult.findFirst.mockResolvedValue(row({ check: { projectId: "p1", target: { value: "shop.test" } } }));
    await loadCheckFinding("c1", "r1", "org1", "u1");
    expect(db.project.findMany.mock.calls[0][0].where).toMatchObject({ id: "p1", organisationId: "org1" });
  });
});
