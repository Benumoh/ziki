import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Organisation membership (#425): reports are filed into the reporter's organisation,
 * someone with no membership can't file at all, an area from another project
 * is refused, and an issue in another organisation is "not found".
 */

const membershipFindUnique = vi.hoisted(() => vi.fn());
const membershipFindFirst = vi.hoisted(() => vi.fn());
const projectMembershipFindUnique = vi.hoisted(() => vi.fn());
const projectMembershipFindFirst = vi.hoisted(() => vi.fn());
const bugFindUnique = vi.hoisted(() => vi.fn());
const bugCreate = vi.hoisted(() => vi.fn());
const ideaCreate = vi.hoisted(() => vi.fn());
const projectFindFirst = vi.hoisted(() => vi.fn());
const projectAreaFindFirst = vi.hoisted(() => vi.fn());
const issueWatchUpsert = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "iw-1" }));
const issueWatchCreateMany = vi.hoisted(() => vi.fn().mockResolvedValue({ count: 1 }));
const commentCreate = vi.hoisted(() => vi.fn());
const bugUpdate = vi.hoisted(() => vi.fn());
const bugActivityCreate = vi.hoisted(() => vi.fn());
const attachmentUpdateMany = vi.hoisted(() => vi.fn().mockResolvedValue({ count: 0 }));
const userFindUnique = vi.hoisted(() => vi.fn());
const userFindFirst = vi.hoisted(() => vi.fn());
const userFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const $transaction = vi.hoisted(() => vi.fn());
const $executeRaw = vi.hoisted(() => vi.fn());
const redesignFindFirst = vi.hoisted(() => vi.fn());
const redesignFindMany = vi.hoisted(() => vi.fn());
const redesignGroupBy = vi.hoisted(() => vi.fn());
const requireProject = vi.hoisted(() => vi.fn());
const navigation = vi.hoisted(() => ({
  redirect: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

vi.mock("@/lib/organisation-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/organisation-context")>()),
  currentOrganisationIdFor: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/points/signup-bonus", () => ({ awardSignupBonus: vi.fn(async () => undefined) }));
vi.mock("next/navigation", () => navigation);
// The Design pages (#9) resolve their project here; nothing else in this file does.
vi.mock("@/lib/project-route", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/project-route")>()),
  requireProject,
}));
vi.mock("@/lib/notify", () => ({ notifyLater: vi.fn() }));
// Tidying an idea with Claude is a network call: as with no API key, it leaves the text as typed.
vi.mock("@/lib/idea-structuring", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/idea-structuring")>()),
  structureIdea: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/session-user", () => ({ resolveSessionUserId: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  consumeRateLimit: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("@/lib/agent-api/web-events", () => ({ publishWebEvent: vi.fn() }));
vi.mock("@/lib/organisation-access", () => ({
  currentOrganisationAccess: vi.fn(async () => ({
    organisationId: "own-organisation-id",
    organisationName: "Own Organisation",
    organisationSlug: "own",
    membershipRole: "owner" as const,
    admin: true,
  })),
  organisationAccessFor: vi.fn(async () => ({
    organisationId: "target-org-id",
    organisationName: "Target Organisation",
    organisationSlug: "target",
    membershipRole: null,
    admin: false,
  })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    bug: { findUnique: bugFindUnique, create: bugCreate, update: bugUpdate },
    comment: { create: commentCreate },
    bugActivity: { create: bugActivityCreate },
    attachment: { updateMany: attachmentUpdateMany },
    idea: { create: ideaCreate },
    project: { findFirst: projectFindFirst },
    projectArea: { findFirst: projectAreaFindFirst },
    membership: {
      findFirst: membershipFindFirst,
      findUnique: membershipFindUnique,
    },
    projectMembership: { findUnique: projectMembershipFindUnique, findFirst: projectMembershipFindFirst },
    issueWatch: { upsert: issueWatchUpsert, updateMany: vi.fn(), createMany: issueWatchCreateMany },
    user: { findUnique: userFindUnique, findFirst: userFindFirst, findMany: userFindMany },
    redesignProposal: { findFirst: redesignFindFirst, findMany: redesignFindMany, groupBy: redesignGroupBy },
    $transaction,
    $executeRaw,
  },
}));

import { requireUser } from "@/lib/auth-helpers";
import { resolveSessionUserId } from "@/lib/session-user";
import { currentOrganisationIdFor, NO_ORGANISATION_MESSAGE } from "@/lib/organisation-context";
import { canContributeToProject } from "@/lib/project-permissions";
import { createBugAction, requestRetestAction, updateBugAction } from "@/app/actions/issues";
import { setWatchingAction } from "@/app/actions/watch";

const organisationOf = currentOrganisationIdFor as unknown as ReturnType<typeof vi.fn>;

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const report = form({
  title: "Login button does nothing",
  description: "Clicking Login on the sign-in page does nothing at all, on Chrome and Firefox.",
  proofLinks: "",
  projectId: "project-zedu",
});

describe("creating an organisation", () => {
  it("makes the creator its owner and starts it with a Web project, so no first project is asked for", async () => {
    const { createOrganisation } = await import("@/lib/organisations");
    const create = vi.fn(async ({ data }: { data: { slug: string; name: string } }) => ({ id: "org-new", slug: data.slug, name: data.name }));
    const db = { membership: { findFirst: vi.fn(async () => null) }, organisation: { create } };
    const result = await createOrganisation(db as never, { id: "ada" }, { name: "Acme Labs" });
    expect(result).toMatchObject({ ok: true, organisation: { id: "org-new" } });
    const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.memberships).toEqual({ create: { userId: "ada", role: "owner" } });
    expect(data.projects).toEqual({ create: { name: "Web", slug: "web", workflow: { create: {} } } });
  });
});

describe("issue actions are organisation-scoped (#425)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "user-1", role: "user" });
    $transaction.mockImplementation(async (run: (tx: unknown) => unknown) => run({
      bug: { update: bugUpdate },
      comment: { create: commentCreate },
      bugActivity: { create: bugActivityCreate },
      attachment: { updateMany: attachmentUpdateMany },
      issueWatch: { createMany: issueWatchCreateMany },
      idea: { create: ideaCreate },
      projectArea: { findFirst: projectAreaFindFirst },
      $executeRaw,
    }));
    projectFindFirst.mockImplementation(async ({ where }: { where: { id: string; organisationId?: string } }) =>
      where.id === "project-zedu" ? { id: "project-zedu", slug: "zedu", organisationId: "organisation-zedu" } : null
    );
    membershipFindUnique.mockImplementation(async ({ where }: { where?: { organisationId_userId?: { organisationId: string; userId: string } } }) =>
      where?.organisationId_userId?.organisationId === "organisation-zedu" && where?.organisationId_userId?.userId !== "stranger-1" ? { id: "m-1" } : null
    );
    membershipFindFirst.mockResolvedValue(null);
    projectMembershipFindUnique.mockResolvedValue(null);
    projectMembershipFindFirst.mockResolvedValue(null);
  });

  it("refuses to file a report for someone with no membership", async () => {
    organisationOf.mockResolvedValue(null);
    expect(await createBugAction(report)).toEqual({ error: NO_ORGANISATION_MESSAGE });
    expect(ideaCreate).not.toHaveBeenCalled();
  });

  it("files the report, as an idea, into the reporter's organisation and project", async () => {
    organisationOf.mockResolvedValue("organisation-zedu");
    ideaCreate.mockRejectedValue(new Error("stop after create"));
    await createBugAction(report).catch(() => undefined);
    expect(ideaCreate).toHaveBeenCalledTimes(1);
    expect(ideaCreate.mock.calls[0][0].data).toMatchObject({
      organisationId: "organisation-zedu",
      projectId: "project-zedu",
      beneficiaryUserId: "user-1",
    });
  });

  it("refuses a project from another organisation", async () => {
    organisationOf.mockResolvedValue("organisation-zedu");
    const result = await createBugAction(form({
      title: "Login button does nothing",
      description: "Clicking Login on the sign-in page does nothing at all, on Chrome and Firefox.",
      proofLinks: "",
      projectId: "project-acme",
    }));
    expect(result).toEqual({ error: NO_ORGANISATION_MESSAGE });
    expect(ideaCreate).not.toHaveBeenCalled();
  });

  it("rejects an area from another project before saving", async () => {
    organisationOf.mockResolvedValue("organisation-zedu");
    projectAreaFindFirst.mockResolvedValue(null);
    projectFindFirst.mockResolvedValue({ id: "project-zedu", slug: "zedu", organisationId: "organisation-zedu" });
    const result = await createBugAction(form({
      title: "Login button does nothing",
      description: "Clicking Login on the sign-in page does nothing at all, on Chrome and Firefox.",
      proofLinks: "",
      projectId: "project-zedu",
      areaId: "foreign-area",
    }));
    expect(result).toMatchObject({ error: expect.any(String), field: "areaId" });
    expect(ideaCreate).not.toHaveBeenCalled();
  });

  it("treats an issue in another organisation as not found", async () => {
    organisationOf.mockResolvedValue("organisation-zedu");
    bugFindUnique.mockResolvedValue(null);
    expect(await updateBugAction("bug-in-acme", form({ status: "resolved" }))).toEqual({
      error: expect.any(String),
    });
    expect(bugFindUnique.mock.calls[0][0].where).toEqual({ id: "bug-in-acme", organisationId: "organisation-zedu" });
  });

  it("refuses retest requests for issues that are not Live, without changing the issue", async () => {
    organisationOf.mockResolvedValue("organisation-zedu");
    vi.mocked(resolveSessionUserId).mockResolvedValue({ userId: "user-1" });
    bugFindUnique.mockResolvedValue({ id: "bug-1", status: "in_progress", isDeleted: false });
    const request = form({
      operatingSystem: "Windows",
      installedVersion: "",
      currentBehavior: "The same issue still happens after restarting.",
    });

    await expect(requestRetestAction("bug-1", request)).resolves.toMatchObject({ error: "Retest requests are available after an issue is Live." });
    expect(bugFindUnique.mock.calls[0][0].where).toEqual({ id: "bug-1", organisationId: "organisation-zedu" });
    expect(bugUpdate).not.toHaveBeenCalled();
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it("saves a retest on the original Live issue as a comment without changing workflow state", async () => {
    organisationOf.mockResolvedValue("organisation-zedu");
    vi.mocked(resolveSessionUserId).mockResolvedValue({ userId: "user-1" });
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "user-1", role: "user" });
    const issue = { id: "bug-1", status: "resolved", isDeleted: false, title: "Save still fails", reporterId: "user-2", assigneeId: null, organisationId: "organisation-zedu", projectId: "project-zedu", pullRequestUrl: null };
    bugFindUnique.mockResolvedValue(issue);
    commentCreate.mockResolvedValue({ id: "comment123" });
    bugActivityCreate.mockResolvedValue({});
    bugUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => Object.assign(issue, data));
    userFindUnique.mockResolvedValue({ name: "Requester" });
    const request = form({
      operatingSystem: "Not sure",
      installedVersion: "",
      currentBehavior: "The save button still does nothing after I restart.",
    });

    await expect(requestRetestAction("bug-1", request)).resolves.toMatchObject({ ok: true, commentId: "comment123" });
    expect(commentCreate.mock.calls[0][0].data).toMatchObject({
      bugId: "bug-1",
      authorId: "user-1",
      body: expect.stringContaining("Installed version: Unknown"),
    });
    expect(commentCreate.mock.calls[0][0].data.body).toContain("The save button still does nothing after I restart.");
    expect(bugActivityCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ bugId: "bug-1", type: "commented" }) }));
    expect(issue.status).toBe("resolved");
    expect(bugUpdate.mock.calls[0][0].data).toEqual({ updatedAt: expect.any(Date) });
  });

  it("allows direct project members to watch issues and refuses non-members", async () => {
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "external-1", role: "user" });
    bugFindUnique.mockResolvedValue({
      id: "bug-1",
      organisationId: "organisation-zedu",
      projectId: "project-zedu",
      isDeleted: false,
      project: { visibility: "private" },
    });
    projectMembershipFindFirst.mockResolvedValue({ id: "pm-1" });
    membershipFindFirst.mockResolvedValue(null);

    const watchRes = await setWatchingAction("bug-1", true);
    expect(watchRes).toEqual({ ok: true });
    expect(issueWatchUpsert).toHaveBeenCalled();

    // Now test refusal for non-member
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "stranger-1", role: "user" });
    projectMembershipFindFirst.mockResolvedValue(null);
    membershipFindFirst.mockResolvedValue(null);

    const refuseRes = await setWatchingAction("bug-1", true);
    expect(refuseRes).toEqual({ error: "Issue not found" });
  });
});

describe("canContributeToProject permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows super_admin regardless of membership", async () => {
    const allowed = await canContributeToProject({ id: "admin-1", role: "super_admin" }, "p-1", "t-1");
    expect(allowed).toBe(true);
  });

  it("allows direct project members", async () => {
    projectMembershipFindUnique.mockResolvedValue({ id: "pm-1" });
    const allowed = await canContributeToProject({ id: "user-1", role: "user" }, "p-1", "t-1");
    expect(allowed).toBe(true);
  });

  it("allows organisation members", async () => {
    projectMembershipFindUnique.mockResolvedValue(null);
    membershipFindUnique.mockResolvedValue({ id: "m-1" });
    const allowed = await canContributeToProject({ id: "user-1", role: "user" }, "p-1", "t-1");
    expect(allowed).toBe(true);
  });

  it("denies uninvited non-members", async () => {
    projectMembershipFindUnique.mockResolvedValue(null);
    membershipFindUnique.mockResolvedValue(null);
    const allowed = await canContributeToProject({ id: "stranger-1", role: "user" }, "p-1", "t-1");
    expect(allowed).toBe(false);
  });
});

describe("the Design area belongs to the project's organisation (#9)", () => {
  const params = Promise.resolve({ org: "acme", project: "web" });
  const viewer = (access: { isOrgMember: boolean; isProjectMember: boolean }) => ({
    user: { id: "viewer", role: "user" },
    organisationId: "org-acme",
    project: { id: "project-web", slug: "web", name: "Web", ref: "acme/web", organisationId: "org-acme", orgSlug: "acme" },
    isOrgAdmin: false,
    canContribute: access.isOrgMember || access.isProjectMember,
    ...access,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is a 404 for someone outside the organisation and for a project-only member, before any proposal is read", async () => {
    const { default: DesignPage } = await import("@/app/(app)/[org]/[project]/design/page");
    const { default: DesignProposalPage } = await import("@/app/(app)/[org]/[project]/design/[id]/page");
    for (const access of [{ isOrgMember: false, isProjectMember: false }, { isOrgMember: false, isProjectMember: true }]) {
      requireProject.mockResolvedValue(viewer(access));
      await expect(DesignPage({ params, searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
      await expect(DesignProposalPage({ params: Promise.resolve({ org: "acme", project: "web", id: "rd-1" }) })).rejects.toThrow("NOT_FOUND");
    }
    expect(redesignFindMany).not.toHaveBeenCalled();
    expect(redesignFindFirst).not.toHaveBeenCalled();
  });

  it("shows a member this project's waiting proposals, read inside its organisation", async () => {
    const { default: DesignPage } = await import("@/app/(app)/[org]/[project]/design/page");
    requireProject.mockResolvedValue(viewer({ isOrgMember: true, isProjectMember: false }));
    redesignFindMany.mockResolvedValue([]);
    redesignGroupBy.mockResolvedValue([]);
    await DesignPage({ params, searchParams: Promise.resolve({}) });
    expect(redesignFindMany.mock.calls[0][0].where).toEqual({ organisationId: "org-acme", projectId: "project-web", status: { in: ["proposed"] } });
  });

  it("is a 404 for a proposal in another project, even of the same organisation", async () => {
    const { default: DesignProposalPage } = await import("@/app/(app)/[org]/[project]/design/[id]/page");
    requireProject.mockResolvedValue(viewer({ isOrgMember: true, isProjectMember: false }));
    redesignFindFirst.mockResolvedValue(null);
    membershipFindUnique.mockResolvedValue({ role: "member" });
    await expect(DesignProposalPage({ params: Promise.resolve({ org: "acme", project: "web", id: "rd-other" }) })).rejects.toThrow("NOT_FOUND");
    expect(redesignFindFirst.mock.calls[0][0].where).toEqual({ id: "rd-other", organisationId: "org-acme", projectId: "project-web" });
  });

  it("sends an old /redesigns link to the Design page only for a member of the proposal's organisation", async () => {
    const { default: OldRedesignPage } = await import("@/app/(app)/redesigns/[id]/page");
    vi.mocked(requireUser).mockResolvedValue({ id: "viewer", role: "user" } as never);
    redesignFindFirst.mockResolvedValueOnce(null);
    await expect(OldRedesignPage({ params: Promise.resolve({ id: "rd-elsewhere" }) })).rejects.toThrow("NOT_FOUND");
    expect(redesignFindFirst.mock.calls[0][0].where).toEqual({
      id: "rd-elsewhere",
      project: { archivedAt: null, organisation: { archivedAt: null, memberships: { some: { userId: "viewer" } } } },
    });
    expect(navigation.redirect).not.toHaveBeenCalled();

    redesignFindFirst.mockResolvedValueOnce({ id: "rd-1", project: { slug: "web", organisation: { slug: "acme" } } });
    await OldRedesignPage({ params: Promise.resolve({ id: "rd-1" }) });
    expect(navigation.redirect).toHaveBeenCalledWith("/acme/web/design/rd-1");
  });
});
