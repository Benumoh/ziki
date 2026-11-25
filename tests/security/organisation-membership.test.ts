import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Organisation membership (#425): reports are filed into the reporter's organisation,
 * someone with no membership can't file at all, an area from another project
 * is refused, and an issue in another organisation is "not found".
 */

const membershipFindUnique = vi.hoisted(() => vi.fn());
const membershipFindFirst = vi.hoisted(() => vi.fn());
const membershipUpdate = vi.hoisted(() => vi.fn());
const pickFirstThing = vi.hoisted(() => vi.fn());
const activateAgent = vi.hoisted(() => vi.fn());
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
const navigation = vi.hoisted(() => ({
  redirect: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

vi.mock("@/lib/organisation-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/organisation-context")>()),
  currentOrganisationIdFor: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/coins/welcome-bonus", () => ({ giveWelcomeBonus: vi.fn(async () => true) }));
const addOnCallGuests = vi.hoisted(() => vi.fn(async () => [] as string[]));
vi.mock("@/lib/on-call-guests", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/on-call-guests")>()), addOnCallGuests }));
vi.mock("next/navigation", () => navigation);
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
vi.mock("@/lib/join-first-thing", () => ({ pickFirstThing }));
vi.mock("@/lib/agents/registry", () => ({ activateAgent, createAgent: vi.fn() }));
vi.mock("@/lib/feature-flags", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/feature-flags")>()), isAgentPlatformEnabled: () => true }));
vi.mock("@/app/(app)/agent/[username]/get-started-data", () => ({ loadGetStarted: vi.fn() }));
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
      update: membershipUpdate,
    },
    projectMembership: { findUnique: projectMembershipFindUnique, findFirst: projectMembershipFindFirst },
    issueWatch: { upsert: issueWatchUpsert, updateMany: vi.fn(), createMany: issueWatchCreateMany },
    user: { findUnique: userFindUnique, findFirst: userFindFirst, findMany: userFindMany },
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
import { joinAgentConnectAction, saveJoinAnswersAction } from "@/app/actions/join-questions";
import { refuseCanFundChange } from "@/lib/membership-admin";

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
    expect(data.projects).toEqual({ create: { name: "Web", slug: "web", solo: false, workflow: { create: {} } } });
    // Open to others: free on-call agents join it to give a quick win.
    expect(addOnCallGuests).toHaveBeenCalledWith(db, { organisationId: "org-new", creatorId: "ada" });
  });

  it("starts its Web project Solo when the creator chose it, with no on-call guests, whose agents would end Solo (#solo)", async () => {
    const { createOrganisation } = await import("@/lib/organisations");
    addOnCallGuests.mockClear();
    const create = vi.fn(async ({ data }: { data: { slug: string; name: string } }) => ({ id: "org-solo", slug: data.slug, name: data.name }));
    const db = { membership: { findFirst: vi.fn(async () => null) }, organisation: { create } };
    expect(await createOrganisation(db as never, { id: "ada" }, { name: "Ada Solo", solo: true })).toMatchObject({ ok: true });
    const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.projects).toEqual({ create: { name: "Web", slug: "web", solo: true, workflow: { create: {} } } });
    expect(addOnCallGuests).not.toHaveBeenCalled();
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

describe("join questions (#join-questions)", () => {
  it("saves a member's answers on their own membership only, and refuses where they aren't a member", async () => {
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "joiner-1", role: "user" });
    pickFirstThing.mockResolvedValue({ kind: "request", projectId: "project-1" });
    membershipFindFirst.mockResolvedValueOnce({ id: "membership-1", organisation: { id: "org-1", name: "Org" } });
    const answers = { organisationId: "org-1", strengths: ["review", "testing"] };
    await expect(saveJoinAnswersAction(answers)).resolves.toEqual({ ok: true, firstThing: { kind: "request", projectId: "project-1" } });
    expect(membershipFindFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ organisationId: "org-1", userId: "joiner-1" }) }));
    expect(membershipUpdate).toHaveBeenCalledWith({
      where: { id: "membership-1" },
      data: { strengths: ["testing", "review"], joinAnsweredAt: expect.any(Date) },
    });

    membershipUpdate.mockClear();
    membershipFindFirst.mockResolvedValueOnce(null);
    await expect(saveJoinAnswersAction({ ...answers, organisationId: "other-org" })).resolves.toEqual({ error: expect.any(String) });
    expect(membershipUpdate).not.toHaveBeenCalled();
  });

  it("brings an agent in only where its owner is a member, with that organisation's key", async () => {
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "joiner-1", role: "user" });
    membershipFindFirst.mockResolvedValueOnce(null);
    await expect(joinAgentConnectAction({ organisationId: "other-org", agentId: "agent-1" })).resolves.toEqual({ error: expect.any(String) });
    expect(activateAgent).not.toHaveBeenCalled();

    membershipFindFirst.mockResolvedValueOnce({ id: "membership-1", organisation: { id: "org-1", name: "Org" } });
    activateAgent.mockResolvedValueOnce({ ok: true, key: { agentId: "agent-1", name: "Claude", rawKey: "zk_live_raw", prefix: "zk_live" } });
    await expect(joinAgentConnectAction({ organisationId: "org-1", agentId: "agent-1" })).resolves.toMatchObject({ ok: true, agentId: "agent-1", setupText: expect.stringContaining("zk_live_raw") });
    expect(activateAgent).toHaveBeenCalledWith(expect.objectContaining({ id: "joiner-1" }), "agent-1", "org-1");
  });
});

describe("who funds an organisation's issues (#payers)", () => {
  const admin = { role: "admin" as const, canFundIssues: false };

  it("lets only an owner (or the site super admin) let an admin fund issues, or stop them", () => {
    expect(refuseCanFundChange({ actorIsOwner: true, actorIsSuperAdmin: false, target: admin, canFund: true })).toBeNull();
    expect(refuseCanFundChange({ actorIsOwner: false, actorIsSuperAdmin: true, target: admin, canFund: true })).toBeNull();
    expect(refuseCanFundChange({ actorIsOwner: true, actorIsSuperAdmin: false, target: { ...admin, canFundIssues: true }, canFund: false })).toBeNull();
    // An admin can't make themself or another admin a payer: funding spends their own wallet, and the owner decides.
    expect(refuseCanFundChange({ actorIsOwner: false, actorIsSuperAdmin: false, target: admin, canFund: true })).toBe("fund-not-allowed");
  });

  it("gives it only to admins: owners always fund, members never do", () => {
    expect(refuseCanFundChange({ actorIsOwner: true, actorIsSuperAdmin: false, target: { role: "member", canFundIssues: false }, canFund: true })).toBe("fund-admins-only");
    expect(refuseCanFundChange({ actorIsOwner: true, actorIsSuperAdmin: false, target: { role: "owner", canFundIssues: false }, canFund: false })).toBe("fund-admins-only");
    expect(refuseCanFundChange({ actorIsOwner: true, actorIsSuperAdmin: false, target: null, canFund: true })).toBe("not-found");
  });
});
