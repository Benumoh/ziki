import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import SecurityPage from "./page";

vi.mock("@/app/actions/security-assistant", () => ({ talkToSecurityAssistant: vi.fn() }));
// The page reads the session to tell a signed-in person from a visitor (the public page); the real auth cannot load here.
vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "user_test" } })) }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-helpers", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user_test_admin", role: "admin" }),
}));

vi.mock("@/lib/organisation-access", () => ({
  currentOrganisationAccess: vi.fn().mockResolvedValue({
    organisationId: "org_123",
    admin: true,
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    securityCheck: { findMany: vi.fn().mockResolvedValue([]) },
    membership: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    securityCheckItem: { count: vi.fn().mockResolvedValue(0) },
    agentActivation: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "act_1",
          level: "senior",
          securityCleared: true,
          agent: { id: "ag_1", name: "SecurityAgent", owner: { name: "Alice" } },
        },
      ]),
    },
  },
}));

vi.mock("@/lib/security-dashboard", () => ({
  loadSecurityDashboard: vi.fn().mockResolvedValue({
    open: [
      {
        id: "find_1",
        ref: "#2828",
        title: "Confidential RCE Vulnerability",
        severity: "critical",
        stage: "In progress",
        days: 2,
        href: "/issues/2828",
        project: "Web",
      },
      {
        id: "find_2",
        ref: "#2829",
        title: "Information Disclosure Bug",
        severity: "low",
        stage: "Open",
        days: 5,
        href: "/issues/2829",
        project: "Desktop",
      },
    ],
    openBySeverity: {
      critical: 1,
      high: 0,
      medium: 0,
      low: 1,
    },
    disclosed: [
      {
        id: "find_3",
        ref: "#2800",
        title: "SQL Injection in User Search",
        severity: "critical",
        stage: "Live",
        days: 3,
        href: "/issues/2800",
        project: "Web",
        disclosedAt: new Date("2026-11-01"),
        fixedLive: true,
      },
    ],
    medianDaysToDisclosure: 3,
    projects: [{ name: "Web", ref: "web" }],
  }),
}));

vi.mock("@/components/security-finding-panel", () => ({
  SeverityChip: ({ severity }: { severity: string }) => (
    <span>{severity.charAt(0).toUpperCase() + severity.slice(1)}</span>
  ),
}));

vi.mock("@/components/security-finding-controls", () => ({
  AgentClearanceToggle: () => <button>Clearance Toggle</button>,
}));

vi.mock("@/components/local-time", () => ({
  LocalTime: ({ date }: { date?: Date | string | null }) => <time>{String(date)}</time>,
}));

describe("SecurityPage (/security)", () => {
  it("renders the security dashboard with posture metrics and stats", async () => {
    const page = await SecurityPage({});
    expect(page).toBeDefined();
    expect(React.isValidElement(page)).toBe(true);
  });

  it("filters findings when severity query parameter is provided", async () => {
    const pageWithFilter = await SecurityPage({
      searchParams: Promise.resolve({ severity: "critical" }),
    });
    expect(pageWithFilter).toBeDefined();
    expect(React.isValidElement(pageWithFilter)).toBe(true);
  });

  it("shows matching open and disclosed findings while filtering out other severities", async () => {
    const page = await SecurityPage({
      searchParams: Promise.resolve({ severity: "critical" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('href="/issues/2828"');
    expect(html).toContain('href="/issues/2800"');
    expect(html).not.toContain('href="/issues/2829"');
  });

  it("opens on the box with no tabs and no Findings link (Your work is left off the page for now, 16 Nov)", async () => {
    const markup = renderToStaticMarkup(await SecurityPage({}));

    expect(markup).toContain("What do you want to secure?");
    expect(markup).toContain('name="target"');
    expect(markup).not.toContain('href="/security?view=findings"');
    expect(markup).not.toContain('href="/security/work"');
    expect(markup).not.toContain('href="/security/activity"');
    expect(markup).not.toContain(">Assets<");
    expect(markup).not.toContain("Open findings");
    expect(markup).not.toContain("Apply filters");
  });

  it("shows the findings dashboard on the Findings view, without the box", async () => {
    const markup = renderToStaticMarkup(await SecurityPage({ searchParams: Promise.resolve({ view: "findings" }) }));

    expect(markup).toContain("Open findings");
    expect(markup).toContain("Apply filters");
    expect(markup).toContain('name="view" value="findings"');
    expect(markup).not.toContain("Add asset");
  });

  it("sends a member who owns no workspace straight to creating one, instead of to Your work", async () => {
    vi.mocked(currentOrganisationAccess).mockResolvedValueOnce({
      organisationId: "org_123",
      organisationName: "Workspace",
      organisationSlug: "workspace",
      membershipRole: "member",
      admin: false,
    });

    // With a scanned site, straight to creating a workspace; it comes back here with the site.
    await expect(SecurityPage({ searchParams: Promise.resolve({ target: "yourshop.com" }) })).rejects.toMatchObject({
      digest: expect.stringContaining(`/organisations?next=${encodeURIComponent("/security?target=yourshop.com")}`),
    });
  });

  it("asks which workspace a scanned site goes in when you own or run more than one", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.membership.findMany).mockResolvedValueOnce([
      { organisation: { id: "org_a", name: "Shop A" } },
      { organisation: { id: "org_b", name: "Shop B" } },
    ] as never);
    const markup = renderToStaticMarkup(await SecurityPage({ searchParams: Promise.resolve({ target: "yourshop.com" }) }));
    expect(markup).toContain("Which workspace should yourshop.com go in?");
    expect(markup).toContain("Shop A");
    expect(markup).toContain("Shop B");
    expect(markup).toContain(encodeURIComponent("/security?target=yourshop.com&picked=1"));
    expect(markup).toContain("Create a new workspace");
  });

  it("sends a plain member with no scanned site to Your work, as before", async () => {
    vi.mocked(currentOrganisationAccess).mockResolvedValueOnce({
      organisationId: "org_123",
      organisationName: "Workspace",
      organisationSlug: "workspace",
      membershipRole: "member",
      admin: false,
    });

    await expect(SecurityPage({})).rejects.toMatchObject({ digest: expect.stringContaining("/security/work") });
  });

  it("keeps a scanned repo's full GitHub address through the redirect, so its scan starts after", async () => {
    vi.mocked(currentOrganisationAccess).mockResolvedValueOnce({
      organisationId: "org_123",
      organisationName: "Workspace",
      organisationSlug: "workspace",
      membershipRole: "member",
      admin: false,
    });

    await expect(SecurityPage({ searchParams: Promise.resolve({ target: "github.com/settle/app" }) })).rejects.toMatchObject({
      digest: expect.stringContaining(`/organisations?next=${encodeURIComponent(`/security?target=${encodeURIComponent("github.com/settle/app")}`)}`),
    });
  });

  it("opens the workspace a member owns elsewhere, keeping the scanned site", async () => {
    vi.mocked(currentOrganisationAccess).mockResolvedValueOnce({
      organisationId: "org_123",
      organisationName: "Workspace",
      organisationSlug: "workspace",
      membershipRole: "member",
      admin: false,
    });
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.membership.findFirst).mockResolvedValueOnce({ organisationId: "org_own" } as never);

    await expect(SecurityPage({ searchParams: Promise.resolve({ target: "yourshop.com" }) })).rejects.toMatchObject({
      digest: expect.stringContaining(`/organisations/open?organisation=org_own&next=${encodeURIComponent("/security?target=yourshop.com")}`),
    });
  });

  it("keeps a member who owns a workspace elsewhere in this one when no site is scanned: Your work, no switching (15 Nov call)", async () => {
    vi.mocked(currentOrganisationAccess).mockResolvedValueOnce({
      organisationId: "org_123",
      organisationName: "Workspace",
      organisationSlug: "workspace",
      membershipRole: "member",
      admin: false,
    });
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.membership.findFirst).mockClear();
    vi.mocked(prisma.membership.findFirst).mockResolvedValueOnce({ organisationId: "org_own" } as never);

    await expect(SecurityPage({})).rejects.toMatchObject({ digest: expect.stringContaining("/security/work") });
    // Not even asked where they own a workspace: they stay where they are.
    expect(prisma.membership.findFirst).not.toHaveBeenCalled();
    vi.mocked(prisma.membership.findFirst).mockReset().mockResolvedValue(null);
  });

  it("lists the workspaces a member owns or runs, not the one they are in, for the switch line on Your work", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { listOwnWorkspaces } = await import("@/lib/security-checks/your-work");
    vi.mocked(prisma.membership.findMany).mockResolvedValueOnce([{ organisation: { id: "org_own", name: "My shop" } }] as never);

    expect(await listOwnWorkspaces("user_test", "org_123")).toEqual([{ id: "org_own", name: "My shop" }]);
    expect(prisma.membership.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "user_test", role: { in: ["owner", "admin"] }, organisationId: { not: "org_123" } }) }),
    );
  });
});
