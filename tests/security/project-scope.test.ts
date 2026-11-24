import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("typesense", () => ({ default: class {} }));

const findFirst = vi.hoisted(() => vi.fn());
const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { project: { findFirst }, skillSubmission: { findMany } } }));
const publishedTasks = vi.hoisted(() => vi.fn());
const taskCounts = vi.hoisted(() => vi.fn());
const proposalCount = vi.hoisted(() => vi.fn());
const proposals = vi.hoisted(() => vi.fn());
const proposalVotes = vi.hoisted(() => vi.fn());
const myVerdicts = vi.hoisted(() => vi.fn());
const proposalAgents = vi.hoisted(() => vi.fn());

const membershipFindUnique = vi.hoisted(() => vi.fn());
const projectFindUnique = vi.hoisted(() => vi.fn());
const projectMembershipFindUnique = vi.hoisted(() => vi.fn());
const projectJoinRequestFindUnique = vi.hoisted(() => vi.fn());
const projectJoinRequestUpsert = vi.hoisted(() => vi.fn());
const projectMembershipUpsert = vi.hoisted(() => vi.fn());
const projectJoinRequestUpdateMany = vi.hoisted(() => vi.fn());
const bugCount = vi.hoisted(() => vi.fn());
const bugFindFirst = vi.hoisted(() => vi.fn());
const membershipUpsert = vi.hoisted(() => vi.fn());
const txMembershipFindFirst = vi.hoisted(() => vi.fn());
const giveWelcomeBonus = vi.hoisted(() => vi.fn());
const ideaFindFirst = vi.hoisted(() => vi.fn());
const notificationCreateMany = vi.hoisted(() => vi.fn().mockResolvedValue({ count: 1 }));
const membershipFindMany = vi.hoisted(() => vi.fn());
const bugFindUnique = vi.hoisted(() => vi.fn());
const findProjectIssue = vi.hoisted(() => vi.fn());
const skillSubmissionFindMany = vi.hoisted(() => vi.fn());
const skillSubmissionFindUnique = vi.hoisted(() => vi.fn());
const skillSubmissionUpdate = vi.hoisted(() => vi.fn());
const projectFindMany = vi.hoisted(() => vi.fn());
const redesignFindFirst = vi.hoisted(() => vi.fn());
const redesignFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst, findUnique: projectFindUnique, findMany: projectFindMany },
    redesignProposal: { findFirst: redesignFindFirst, findMany: redesignFindMany },
    bug: { findUnique: bugFindUnique, findMany: publishedTasks, groupBy: taskCounts, count: bugCount, findFirst: bugFindFirst },
    idea: { count: proposalCount, findMany: proposals, findFirst: ideaFindFirst },
    ideaVerdict: { groupBy: proposalVotes, findMany: myVerdicts },
    agent: { findMany: proposalAgents },
    membership: { findUnique: membershipFindUnique, findMany: membershipFindMany },
    projectMembership: { findUnique: projectMembershipFindUnique, upsert: projectMembershipUpsert },
    projectJoinRequest: { findUnique: projectJoinRequestFindUnique, upsert: projectJoinRequestUpsert, updateMany: projectJoinRequestUpdateMany },
    notification: { createMany: notificationCreateMany },
    skillSubmission: { findMany: skillSubmissionFindMany, findUnique: skillSubmissionFindUnique, update: skillSubmissionUpdate },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({ projectMembership: { upsert: projectMembershipUpsert }, membership: { upsert: membershipUpsert, findFirst: txMembershipFindFirst }, projectJoinRequest: { updateMany: projectJoinRequestUpdateMany } }),
  },
}));
vi.mock("@/lib/coins/welcome-bonus", () => ({ giveWelcomeBonus }));
vi.mock("@/lib/workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workflow")>()),
  workflowFor: vi.fn(async () => ({ ideaThreshold: 3, revisionLimit: 2 })),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const section = vi.hoisted(() => ({
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  forbidden: vi.fn(() => { throw new Error("FORBIDDEN"); }),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
  requireProject: vi.fn(),
  requireOrgMarketing: vi.fn(),
  firstProjectRefFor: vi.fn(),
  requireUser: vi.fn(async () => ({ id: "ada" })),
  requireSuperAdmin: vi.fn(),
}));
vi.mock("next/navigation", () => ({ notFound: section.notFound, forbidden: section.forbidden, redirect: section.redirect, permanentRedirect: section.redirect }));
vi.mock("@/lib/project-route", () => ({ requireProject: section.requireProject, requireOrgMarketing: section.requireOrgMarketing, firstProjectRefFor: section.firstProjectRefFor }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: section.requireUser, requireSuperAdmin: section.requireSuperAdmin }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "viewer" } })) }));
vi.mock("@/lib/project-issue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/project-issue")>()),
  findProjectIssue,
}));
vi.mock("@/lib/organisation-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/organisation-access")>()),
  // The viewer owns an organisation of their own, as every new account does.
  currentOrganisationAccess: vi.fn(async () => ({ membershipRole: "owner", admin: true })),
  organisationAccessFor: vi.fn(async (_userId: string, organisationId: string | null) =>
    organisationId === "org-they-admin" ? { membershipRole: "admin", admin: true } : { membershipRole: null, admin: false }),
}));

import MarketingPage from "@/app/(app)/marketing/page";
import RejectedIdeasPage from "@/app/(app)/[org]/marketing/ideas/rejected/page";
import { readRejectedIdeas } from "@/app/(app)/[org]/marketing/ideas/rejected/data";
import OrgMarketingPage from "@/app/(app)/[org]/marketing/page";
import { marketingTabHref } from "@/lib/header-nav";
import { issueProject } from "@/lib/agent-api/issues";
import { getAgentRedesign, listAgentRedesigns } from "@/lib/redesign-read";
import { getSkills, CORE_SKILL_TEMPLATES } from "@/app/(app)/skills/skills-data";
import { projectRef } from "@/lib/project-paths";
import { canManageProject } from "@/lib/project-permissions";
import { joinOpenProjectAction } from "@/app/actions/project-join-requests";
import { requireUser } from "@/lib/auth-helpers";
import { reviewSkillSubmissionAction } from "@/app/actions/skill-submissions";
import { sitemapSectionXml } from "@/lib/seo/sitemap";
import IssueHistoryPage from "@/app/(app)/[org]/[project]/[number]/history/page";
import ProjectIssueLayout from "@/app/(app)/[org]/[project]/[number]/layout";

const agent = {
  agentId: "agent1",
  name: "Ada's Claude",
  ownerId: "ada",
  organisationId: "organisation_zedu",
  level: "working" as const,
  burst: false,
  keyId: "key1",
};

describe("issueProject organisation scope (#user-agents)", () => {
  beforeEach(() => {
    findFirst.mockReset();
  });

  it("lets a key work in any project of its organisation", async () => {
    findFirst.mockResolvedValue({ id: "project_mobile" });
    await expect(issueProject(agent, new URLSearchParams("projectId=project_mobile"))).resolves.toEqual({
      organisationId: "organisation_zedu",
      projectId: "project_mobile",
    });
  });

  it("refuses another organisation's project as not found", async () => {
    findFirst.mockResolvedValue(null);
    await expect(issueProject(agent, new URLSearchParams("projectId=project_elsewhere"))).rejects.toMatchObject({ status: 404 });
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: "project_elsewhere", organisationId: "organisation_zedu" });
  });
});

describe("redesign proposals stay in the agent's organisation (#9)", () => {
  const openProject = { archivedAt: null, organisation: { archivedAt: null } };
  const row = {
    id: "rd-1", organisationId: "organisation_zedu", projectId: "project_web", bugId: null, authorAgentId: "agent1", onBehalfOfUserId: "ada",
    title: "Calmer dashboard", body: "Muted tiles.", previewUrl: "https://example.com/p", status: "proposed", approverId: null, approvedAt: null,
    createdAt: new Date("2026-11-01T10:00:00Z"), updatedAt: new Date("2026-11-01T10:00:00Z"),
    attachments: [{ id: "att1", filename: "tiles.png", contentType: "image/png", size: 120 }],
  };

  beforeEach(() => {
    findFirst.mockReset();
    redesignFindFirst.mockReset();
    redesignFindMany.mockReset();
  });

  it("is a 404 for another organisation's proposal, or one in an archived project", async () => {
    redesignFindFirst.mockResolvedValue(null);
    await expect(getAgentRedesign(agent, "rd-elsewhere")).rejects.toMatchObject({ status: 404 });
    expect(redesignFindFirst.mock.calls[0][0].where).toEqual({ id: "rd-elsewhere", organisationId: "organisation_zedu", project: openProject });
  });

  it("lists nothing for another organisation's project or an archived one: a 404 before any proposal is read", async () => {
    findFirst.mockResolvedValue(null);
    await expect(listAgentRedesigns(agent, new URLSearchParams("projectId=project_elsewhere"))).rejects.toMatchObject({ status: 404 });
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: "project_elsewhere", organisationId: "organisation_zedu", ...openProject });
    expect(redesignFindMany).not.toHaveBeenCalled();
  });

  it("lists one project's proposals inside the organisation, with each mockup's url", async () => {
    findFirst.mockResolvedValue({ id: "project_web" });
    redesignFindMany.mockResolvedValue([row]);
    const page = await listAgentRedesigns(agent, new URLSearchParams("projectId=project_web&status=proposed&mine=1"));
    expect(redesignFindMany.mock.calls[0][0].where).toEqual({ organisationId: "organisation_zedu", projectId: "project_web", status: "proposed", authorAgentId: "agent1" });
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toMatchObject({ id: "rd-1", attachments: [{ id: "att1", url: "/api/v1/attachments/att1" }] });
  });
});

describe("Rejected marketing ideas project isolation", () => {
  const context = {
    organisationId: "organisation_zedu",
    project: { id: "project_web" },
    user: { id: "ada" },
  } as Parameters<typeof readRejectedIdeas>[0];

  beforeEach(() => {
    vi.clearAllMocks();
    proposalCount.mockReset();
    proposalCount.mockResolvedValue(1);
    proposals.mockReset();
    proposals.mockResolvedValue([]);
    proposalAgents.mockReset();
    proposalAgents.mockResolvedValue([]);
  });

  it("refuses access before reading marketing ideas", async () => {
    // Marketing belongs to the organisation (#org-marketing): its pages act through its main project.
    section.requireOrgMarketing.mockResolvedValue({ org: "acme", project: "private" });
    section.requireProject.mockRejectedValue(new Error("NOT_FOUND"));
    await expect(
      RejectedIdeasPage({ params: Promise.resolve({ org: "acme" }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(proposals).not.toHaveBeenCalled();
  });

  it("reads rejected and archived marketing ideas only inside the authorized organisation and project", async () => {
    await readRejectedIdeas(context);
    expect(proposals).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organisationId: "organisation_zedu", projectId: "project_web", track: "marketing",
        status: { in: ["rejected", "archived"] },
      }),
    }));
  });
});

describe("the marketing section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    section.requireUser.mockResolvedValue({ id: "ada" });
  });

  it("is refused to someone who can't open the organisation's Marketing (#org-marketing)", async () => {
    section.requireOrgMarketing.mockResolvedValue({ org: "acme", project: "web" });
    section.requireProject.mockRejectedValue(new Error("NOT_FOUND"));
    await expect(OrgMarketingPage({ params: Promise.resolve({ org: "acme" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    expect(section.requireProject).toHaveBeenCalledWith("acme", "web");
  });

  it("sends the Marketing tab and /marketing to the organisation's Marketing, not Amp", async () => {
    expect(marketingTabHref(projectRef("acme", "web"))).toBe("/acme/marketing");
    expect(marketingTabHref(null)).toBe("/marketing");
    section.firstProjectRefFor.mockResolvedValue(projectRef("acme", "web"));
    await expect(MarketingPage()).rejects.toThrow("REDIRECT /acme/marketing");
  });

  it("sends someone with no project to their organisations", async () => {
    section.firstProjectRefFor.mockResolvedValue(null);
    await expect(MarketingPage()).rejects.toThrow("REDIRECT /organisations");
  });
});

describe("project addresses carry the organisation (#project-urls)", () => {
  it("reads an old project-first address as old, and an org/project address as new", async () => {
    const { isProjectFirstPath, issuesPath, projectRef } = await import("@/lib/project-paths");
    expect(isProjectFirstPath("/desktop/ideas/2297")).toBe(true);
    expect(isProjectFirstPath("/desktop/740")).toBe(true);
    expect(isProjectFirstPath("/zedu/desktop/ideas/2297")).toBe(false);
    expect(isProjectFirstPath("/zedu")).toBe(false);
    expect(issuesPath(projectRef("zedu", "desktop"), "in_progress")).toBe("/zedu/desktop/overview?view=features&state=in_progress");
  });

  it("never lets a new project or organisation take a name an address reads as old or as a site page", async () => {
    const { unreservedProjectSlug } = await import("@/lib/project-slug");
    const { organisationSlugCandidate } = await import("@/lib/organisations");
    expect(unreservedProjectSlug("123")).toBe("123-project");
    expect(unreservedProjectSlug("workstream")).toBe("workstream-project");
    expect(organisationSlugCandidate("agents", 0, () => "x2y3")).toBe("agents-x2y3");
    expect(organisationSlugCandidate("zedu", 0)).toBe("zedu");
  });
});

describe("canManageProject permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows site super_admin", async () => {
    expect(await canManageProject({ id: "admin-1", role: "super_admin" }, "organisation-1")).toBe(true);
  });

  it("allows organisation owners and admins", async () => {
    membershipFindUnique.mockResolvedValue({ role: "owner" });
    expect(await canManageProject({ id: "user-1", role: "user" }, "organisation-1")).toBe(true);

    membershipFindUnique.mockResolvedValue({ role: "admin" });
    expect(await canManageProject({ id: "user-1", role: "user" }, "organisation-1")).toBe(true);
  });

  it("denies regular organisation members and outsiders", async () => {
    membershipFindUnique.mockResolvedValue({ role: "member" });
    expect(await canManageProject({ id: "user-1", role: "user" }, "organisation-1")).toBe(false);

    membershipFindUnique.mockResolvedValue(null);
    expect(await canManageProject({ id: "stranger-1", role: "user" }, "organisation-1")).toBe(false);
  });
});

describe("joinOpenProjectAction (#earnings)", () => {
  const open = {
    id: "p-1",
    slug: "ziki-marketing",
    organisationId: "t-1",
    isOpenForContributors: true,
    visibility: "public",
    organisation: { slug: "ziki" },
  };
  beforeEach(() => {
    vi.clearAllMocks();
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "user-1", name: "Alice", email: "alice@example.com" });
  });

  it("joins an open project straight away, with no request to accept, and opens its marketing tasks", async () => {
    findFirst.mockResolvedValue(open);
    bugCount.mockResolvedValue(3);
    const res = await joinOpenProjectAction("p-1");
    expect(res).toEqual({ ok: true, href: "/ziki/marketing" });
    expect(projectMembershipUpsert).toHaveBeenCalledWith(expect.objectContaining({ create: { projectId: "p-1", userId: "user-1" } }));
    // Joining puts you in that project only, never in its whole organisation.
    expect(membershipUpsert).not.toHaveBeenCalled();
    expect(projectJoinRequestUpsert).not.toHaveBeenCalled();
  });

  it("opens the project's Ideas when it has no marketing tasks waiting", async () => {
    findFirst.mockResolvedValue(open);
    bugCount.mockResolvedValue(0);
    // Product work in it: an ordinary project.
    bugFindFirst.mockImplementation(async ({ where }: { where: { track: string } }) => (where.track === "product" ? { id: "b" } : null));
    ideaFindFirst.mockResolvedValue(null);
    expect(await joinOpenProjectAction("p-1")).toEqual({ ok: true, href: "/ziki/ziki-marketing/new" });
  });

  it("opens an all-marketing project's Marketing tab while its tasks are all still ideas (#marketing-home)", async () => {
    findFirst.mockResolvedValue(open);
    bugCount.mockResolvedValue(0);
    bugFindFirst.mockResolvedValue(null);
    ideaFindFirst.mockImplementation(async ({ where }: { where: { track: string } }) => (where.track === "marketing" ? { id: "i" } : null));
    expect(await joinOpenProjectAction("p-1")).toEqual({ ok: true, href: "/ziki/marketing" });
  });

  it("gives the welcome bonus to a brand-new person (in no organisation), and not to someone already in one", async () => {
    findFirst.mockResolvedValue(open);
    bugCount.mockResolvedValue(1);
    txMembershipFindFirst.mockResolvedValue(null);
    await joinOpenProjectAction("p-1");
    expect(giveWelcomeBonus).toHaveBeenCalledWith(expect.anything(), "user-1");

    giveWelcomeBonus.mockClear();
    txMembershipFindFirst.mockResolvedValue({ id: "m-1" });
    await joinOpenProjectAction("p-1");
    expect(giveWelcomeBonus).not.toHaveBeenCalled();
    expect(membershipUpsert).not.toHaveBeenCalled();
  });

  it("refuses a project that isn't open, or isn't public, and adds nobody", async () => {
    findFirst.mockResolvedValue({ ...open, isOpenForContributors: false });
    expect(await joinOpenProjectAction("p-1")).toEqual({ ok: false, error: expect.any(String) });
    findFirst.mockResolvedValue({ ...open, visibility: "private" });
    expect(await joinOpenProjectAction("p-1")).toEqual({ ok: false, error: expect.any(String) });
    expect(projectMembershipUpsert).not.toHaveBeenCalled();
    expect(membershipUpsert).not.toHaveBeenCalled();
  });
});

describe("a deleted issue on a public project", () => {
  const params = Promise.resolve({ org: "acme", project: "web", number: "7" });
  const deletedIn = (organisationId: string) => {
    findProjectIssue.mockResolvedValue({
      kind: "found",
      issue: { id: "bug-7", number: 7, organisationId, ref: "acme/web", isDeleted: true },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "viewer", role: "user" });
    bugFindUnique.mockResolvedValue({
      id: "bug-7",
      number: 7,
      project: { slug: "web", organisation: { slug: "acme" } },
      title: "Removed for a reason",
      description: "Secret",
      createdAt: new Date("2026-01-01"),
      isDeleted: true,
      reporter: { name: "Rae" },
      revisions: [],
    });
  });

  it("is a 404 for someone who only administers another organisation", async () => {
    deletedIn("org-of-the-project");
    await expect(IssueHistoryPage({ params } as never)).rejects.toThrow("NOT_FOUND");
    await expect(ProjectIssueLayout({ children: null, params })).rejects.toThrow("NOT_FOUND");
  });

  it("still opens for an admin of the issue's own organisation", async () => {
    deletedIn("org-they-admin");
    await expect(IssueHistoryPage({ params } as never)).resolves.toBeTruthy();
    await expect(ProjectIssueLayout({ children: "page", params })).resolves.toBe("page");
  });
});

describe("skills library public scope and review authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only lists approved skills, filtering out pending or rejected submissions", async () => {
    skillSubmissionFindMany.mockResolvedValue([
      {
        id: "skill-approved",
        slug: "vitest-runner",
        title: "Vitest Deterministic Suite Runner",
        category: "testing",
        categoryLabel: "Testing & QA",
        summary: "Run fast isolated tests.",
        tags: ["vitest", "ci"],
        prompt: "Run tests.",
        checklist: ["All assertions pass"],
        sampleCommand: "npm test",
        documentationUrl: null,
        status: "approved",
        createdAt: new Date("2026-01-01"),
        submittedBy: { name: "Ada" },
      },
    ]);

    const { skills, error } = await getSkills();
    expect(error).toBeUndefined();
    expect(skills).toHaveLength(1 + CORE_SKILL_TEMPLATES.length);
    expect(skills[0].title).toBe("Vitest Deterministic Suite Runner");
    expect(skillSubmissionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "approved" },
      })
    );
  });

  it("refuses skill submission review for any user who is not a super admin", async () => {
    section.requireSuperAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(reviewSkillSubmissionAction("sub-1", "approved")).rejects.toThrow("NEXT_REDIRECT");
    expect(skillSubmissionUpdate).not.toHaveBeenCalled();
  });

  it("allows a super admin to approve a pending submission", async () => {
    section.requireSuperAdmin.mockResolvedValue({ id: "admin-42", isRealSuperAdmin: true });
    skillSubmissionFindUnique.mockResolvedValue({ id: "sub-1", status: "pending" });
    skillSubmissionUpdate.mockResolvedValue({ id: "sub-1", status: "approved" });

    const result = await reviewSkillSubmissionAction("sub-1", "approved");
    expect(result).toEqual({ ok: true });
    expect(skillSubmissionUpdate).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: expect.objectContaining({
        status: "approved",
        reviewedById: "admin-42",
        rejectionReason: null,
      }),
    });
  });
});

describe("search engines see only public projects (#seo-pages)", () => {

  it("lists only the issues a guest's public list shows, at their public address", async () => {
    publishedTasks.mockReset();
    publishedTasks.mockResolvedValueOnce([{ number: 870, updatedAt: new Date("2026-11-10"), project: { slug: "web", organisation: { slug: "acme" } } }]);
    const xml = await sitemapSectionXml("issues-1.xml");
    // Public, unarchived projects only; never deleted, a security finding or closed.
    expect(publishedTasks.mock.calls[0][0].where).toEqual({
      isDeleted: false,
      securityFinding: { is: null },
      status: { in: ["open", "in_progress", "done", "merge", "resolved"] },
      project: { visibility: "public", archivedAt: null, organisation: { archivedAt: null } },
    });
    expect(xml).toContain("/acme/web/public-issues/870</loc>");
  });

  it("has no issues file past the last public issue", async () => {
    publishedTasks.mockReset();
    publishedTasks.mockResolvedValueOnce([]);
    await expect(sitemapSectionXml("issues-2.xml")).resolves.toBeNull();
    expect(publishedTasks.mock.calls[0][0]).toMatchObject({ skip: 10_000, take: 10_000 });
  });
});
