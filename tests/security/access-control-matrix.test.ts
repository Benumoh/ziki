import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The access-control matrix (#access-control): who can open a public or private project's pages, and who can
 * read its files. Each role in the work split's audit is tried against the two gates every request goes
 * through: `requireProject` (every page under /<org>/<project>) and GET /api/attachments/{id} (every file).
 *
 * The database is a small in-memory one that applies the same filters as the real queries, so each case
 * shows what that person actually reaches, not just which query was sent.
 */

class Redirect extends Error {
  constructor(public readonly to: string) {
    super(`redirect ${to}`);
  }
}
class NotFound extends Error {
  constructor() {
    super("not found");
  }
}

const nav = vi.hoisted(() => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: nav.redirect, notFound: nav.notFound }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: auth.requireUser }));

const current = vi.hoisted(() => ({ organisationId: vi.fn() }));
vi.mock("@/lib/organisation-context", () => ({ currentOrganisationIdFor: current.organisationId }));

type Visibility = "public" | "private";
type Project = { id: string; slug: string; name: string; goal: null; organisationId: string; visibility: Visibility; isOpenForContributors: boolean };
type Membership = { organisationId: string; userId: string; role: "owner" | "admin" | "member" };

const db = vi.hoisted(() => ({
  projects: [] as Project[],
  memberships: [] as Membership[],
  projectMemberships: [] as Array<{ projectId: string; userId: string }>,
  attachments: new Map<string, unknown>(),
}));

const ORGS: Record<string, string> = { "org-acme": "acme", "org-other": "other" };

function matches(project: Project, where: Record<string, unknown>): boolean {
  if (where.slug !== undefined && where.slug !== project.slug) return false;
  const org = where.organisation as { slug?: string } | undefined;
  if (org?.slug !== undefined && ORGS[project.organisationId] !== org.slug) return false;
  const or = where.OR as Array<Record<string, unknown>> | undefined;
  if (!or) return true;
  return or.some((clause) => {
    if (clause.visibility !== undefined) return clause.visibility === project.visibility;
    if (clause.id !== undefined) return (clause.id as { in: string[] }).in.includes(project.id);
    if (clause.organisationId !== undefined) return (clause.organisationId as { in: string[] }).in.includes(project.organisationId);
    return false;
  });
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => db.projects.find((p) => matches(p, where)) ?? null),
    },
    membership: {
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
        db.memberships.filter((m) => m.userId === where.userId).map((m) => ({ organisationId: m.organisationId }))),
      findFirst: vi.fn(async ({ where }: { where: { organisationId: string; userId: string; role?: { in: string[] } } }) =>
        db.memberships.find((m) => m.organisationId === where.organisationId && m.userId === where.userId && (!where.role || where.role.in.includes(m.role))) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { organisationId_userId: { organisationId: string; userId: string } } }) => {
        const key = where.organisationId_userId;
        const row = db.memberships.find((m) => m.organisationId === key.organisationId && m.userId === key.userId);
        return row ? { userId: row.userId } : null;
      }),
    },
    projectMembership: {
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
        db.projectMemberships.filter((m) => m.userId === where.userId).map((m) => ({ projectId: m.projectId }))),
      findUnique: vi.fn(async ({ where }: { where: { projectId_userId: { projectId: string; userId: string } } }) => {
        const key = where.projectId_userId;
        return db.projectMemberships.some((m) => m.projectId === key.projectId && m.userId === key.userId) ? { id: "pm" } : null;
      }),
    },
    attachment: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.attachments.get(where.id) ?? null) },
  },
}));

vi.mock("@/lib/organisation-access", () => ({
  organisationAccessFor: vi.fn(async (userId: string, organisationId: string, role?: string) => {
    const row = db.memberships.find((m) => m.organisationId === organisationId && m.userId === userId);
    return { membershipRole: row?.role ?? null, admin: role === "super_admin" || row?.role === "owner" || row?.role === "admin" };
  }),
}));
vi.mock("@/lib/attachments", () => ({ attachmentResponseHeaders: () => ({ "Content-Type": "application/octet-stream" }) }));

import { requireProject } from "@/lib/project-route";
import { GET as getAttachment } from "@/app/api/attachments/[id]/route";

type Person = { id: string; role: "user" | "admin" | "super_admin" } | null;

/** The audit's roles, plus the site super admin. Each is set up in `beforeEach`. */
const PEOPLE: Record<string, Person> = {
  "signed-out visitor": null,
  "newly registered user": { id: "u-new", role: "user" },
  "signed-in non-member (in another organisation)": { id: "u-outsider", role: "user" },
  "accepted contributor (project member only)": { id: "u-contributor", role: "user" },
  "organisation member": { id: "u-member", role: "user" },
  "organisation owner": { id: "u-owner", role: "user" },
  "site super admin": { id: "u-super", role: "super_admin" },
};

let signedIn: Person = null;

beforeEach(() => {
  vi.clearAllMocks();
  nav.redirect.mockImplementation((to: string) => {
    throw new Redirect(to);
  });
  nav.notFound.mockImplementation(() => {
    throw new NotFound();
  });
  auth.requireUser.mockImplementation(async () => {
    if (!signedIn) nav.redirect("/login");
    return signedIn;
  });
  // The project's organisation is already the current one, so no organisation switch gets in the way.
  current.organisationId.mockResolvedValue("org-acme");

  const project = (id: string, slug: string, visibility: Visibility): Project => ({
    id, slug, name: slug, goal: null, organisationId: "org-acme", visibility, isOpenForContributors: false,
  });
  db.projects = [project("p-public", "web", "public"), project("p-private", "vault", "private")];
  db.memberships = [
    { organisationId: "org-other", userId: "u-outsider", role: "owner" },
    { organisationId: "org-acme", userId: "u-member", role: "member" },
    { organisationId: "org-acme", userId: "u-owner", role: "owner" },
  ];
  // Accepted into both. The private one stands for a project that was public when they joined and later went private.
  db.projectMemberships = [
    { projectId: "p-public", userId: "u-contributor" },
    { projectId: "p-private", userId: "u-contributor" },
  ];
  db.attachments = new Map();
});

async function open(person: Person, slug: string) {
  signedIn = person;
  try {
    const context = await requireProject("acme", slug);
    return { outcome: "opens" as const, canContribute: context.canContribute, isOrgMember: context.isOrgMember, isOrgAdmin: context.isOrgAdmin };
  } catch (error) {
    if (error instanceof NotFound) return { outcome: "404" as const };
    if (error instanceof Redirect) return { outcome: `redirect ${error.to}` as const };
    throw error;
  }
}

describe("project pages: requireProject, for each role", () => {
  // [role, public project, private project, can contribute on the public one]
  const expected: Array<[string, string, string, boolean | null]> = [
    ["signed-out visitor", "redirect /login", "redirect /login", null],
    ["newly registered user", "opens", "404", false],
    ["signed-in non-member (in another organisation)", "opens", "404", false],
    ["accepted contributor (project member only)", "opens", "opens", true],
    ["organisation member", "opens", "opens", true],
    ["organisation owner", "opens", "opens", true],
    ["site super admin", "opens", "opens", true],
  ];

  it.each(expected)("%s: public %s, private %s", async (role, onPublic, onPrivate, contributes) => {
    const person = PEOPLE[role];
    const publicResult = await open(person, "web");
    const privateResult = await open(person, "vault");
    expect(publicResult.outcome).toBe(onPublic);
    expect(privateResult.outcome).toBe(onPrivate);
    if (contributes !== null && "canContribute" in publicResult) expect(publicResult.canContribute).toBe(contributes);
  });

  it("answers a private project someone can't see exactly like one that doesn't exist", async () => {
    const hidden = await open(PEOPLE["newly registered user"], "vault");
    const missing = await open(PEOPLE["newly registered user"], "no-such-project");
    expect(hidden).toEqual(missing);
  });

  it("does not treat a project member as an organisation member or admin", async () => {
    const result = await open(PEOPLE["accepted contributor (project member only)"], "vault");
    expect(result).toMatchObject({ outcome: "opens", isOrgMember: false, isOrgAdmin: false });
  });

  it("does not let a project membership in one project open another private project", async () => {
    db.projectMemberships = [{ projectId: "p-public", userId: "u-contributor" }];
    const result = await open(PEOPLE["accepted contributor (project member only)"], "vault");
    expect(result.outcome).toBe("404");
  });

  it("does not let an owner of another organisation open this one's private project", async () => {
    const result = await open(PEOPLE["signed-in non-member (in another organisation)"], "vault");
    expect(result.outcome).toBe("404");
  });

  it("switches only people who belong to the organisation, so the super admin never loops", async () => {
    // Someone whose current organisation is another one. The current organisation ignores a pick they aren't a
    // member of, so a switch for the super admin (not a member of org-acme) would come straight back here.
    current.organisationId.mockResolvedValue("org-other");
    const member = await open(PEOPLE["organisation member"], "vault");
    expect(member.outcome).toMatch(/^redirect \/projects\/vault\/open\?organisation=org-acme/);
    const superAdmin = await open(PEOPLE["site super admin"], "vault");
    expect(superAdmin).toMatchObject({ outcome: "opens", isOrgAdmin: true });
  });
});

function issueFile(projectId: string, visibility: Visibility, extra: Record<string, unknown> = {}) {
  return {
    uploaderId: "u-owner",
    filename: "screenshot.png",
    contentType: "image/png",
    size: 3,
    data: Buffer.from("png"),
    bug: { isDeleted: false, organisationId: "org-acme", projectId, project: { visibility } },
    idea: null,
    comment: null,
    redesignProposal: null,
    securityFinding: null,
    ...extra,
  };
}

async function download(person: Person, id: string): Promise<number | string> {
  signedIn = person;
  try {
    const response = await getAttachment(new Request(`http://localhost/api/attachments/${id}`) as never, { params: Promise.resolve({ id }) });
    return response.status;
  } catch (error) {
    if (error instanceof Redirect) return `redirect ${error.to}`;
    throw error;
  }
}

describe("files: GET /api/attachments/{id}, for each role", () => {
  beforeEach(() => {
    db.attachments.set("f-public", issueFile("p-public", "public"));
    db.attachments.set("f-private", issueFile("p-private", "private"));
  });

  const expected: Array<[string, number | string, number | string]> = [
    ["signed-out visitor", "redirect /login", "redirect /login"],
    ["newly registered user", 200, 404],
    ["signed-in non-member (in another organisation)", 200, 404],
    ["accepted contributor (project member only)", 200, 200],
    ["organisation member", 200, 200],
    ["organisation owner", 200, 200],
    ["site super admin", 200, 200],
  ];

  it.each(expected)("%s: file on a public issue %s, on a private issue %s", async (role, onPublic, onPrivate) => {
    expect(await download(PEOPLE[role], "f-public")).toBe(onPublic);
    expect(await download(PEOPLE[role], "f-private")).toBe(onPrivate);
  });

  it("answers a private file exactly like a missing one", async () => {
    expect(await download(PEOPLE["newly registered user"], "f-private")).toBe(404);
    expect(await download(PEOPLE["newly registered user"], "no-such-file")).toBe(404);
  });

  it("keeps a file on an idea in a public project to the project's people", async () => {
    db.attachments.set("f-idea", { ...issueFile("p-public", "public"), bug: null, idea: { isDeleted: false, organisationId: "org-acme", projectId: "p-public", project: { visibility: "public" } } });
    expect(await download(PEOPLE["newly registered user"], "f-idea")).toBe(404);
    expect(await download(PEOPLE["accepted contributor (project member only)"], "f-idea")).toBe(200);
    expect(await download(PEOPLE["organisation member"], "f-idea")).toBe(200);
  });

  it("keeps a file on a deleted issue to the organisation's admins", async () => {
    db.attachments.set("f-deleted", issueFile("p-public", "public", { bug: { isDeleted: true, organisationId: "org-acme", projectId: "p-public", project: { visibility: "public" } } }));
    expect(await download(PEOPLE["newly registered user"], "f-deleted")).toBe(404);
    expect(await download(PEOPLE["accepted contributor (project member only)"], "f-deleted")).toBe(404);
    expect(await download(PEOPLE["organisation member"], "f-deleted")).toBe(404);
    expect(await download(PEOPLE["organisation owner"], "f-deleted")).toBe(200);
  });

  it("keeps an upload not yet attached to anything to the person who uploaded it", async () => {
    db.attachments.set("f-draft", { ...issueFile("p-public", "public"), uploaderId: "u-member", bug: null });
    expect(await download(PEOPLE["organisation member"], "f-draft")).toBe(200);
    expect(await download(PEOPLE["organisation owner"], "f-draft")).toBe(404);
  });

  it("keeps evidence on a private security finding to its reporter and the organisation's admins, even in a public project", async () => {
    db.attachments.set("f-finding", {
      ...issueFile("p-public", "public"),
      bug: null,
      securityFinding: { organisationId: "org-acme", reporterId: "u-contributor", disclosedAt: null },
    });
    expect(await download(PEOPLE["newly registered user"], "f-finding")).toBe(404);
    expect(await download(PEOPLE["organisation member"], "f-finding")).toBe(404);
    expect(await download(PEOPLE["organisation owner"], "f-finding")).toBe(200);
  });

  it("follows the issue's rules once a finding is disclosed (disclosure moves its evidence onto the issue)", async () => {
    const disclosed = { organisationId: "org-acme", reporterId: "u-contributor", disclosedAt: new Date("2026-11-01") };
    db.attachments.set("f-disclosed-public", { ...issueFile("p-public", "public"), securityFinding: disclosed });
    db.attachments.set("f-disclosed-private", { ...issueFile("p-private", "private"), securityFinding: disclosed });
    expect(await download(PEOPLE["newly registered user"], "f-disclosed-public")).toBe(200);
    expect(await download(PEOPLE["newly registered user"], "f-disclosed-private")).toBe(404);
  });
});
