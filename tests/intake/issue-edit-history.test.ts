import { describe, expect, it, vi, beforeEach } from "vitest";

/** Editing an issue (#713): only the reporter and organisation admins may edit, an edit keeps the old version and voids the confirmations given before it. */
const publishWebEvent = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/agent-api/web-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-api/web-events")>()),
  publishWebEvent,
}));

vi.mock("@/lib/organisation-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/organisation-context")>()),
  currentOrganisationIdFor: vi.fn(async () => "organisation-zedu"),
  defaultProjectIdFor: vi.fn(async () => "project-zedu"),
  organisationIdForUser: vi.fn(async () => "organisation-zedu"),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "reporter-1", name: "Ada", role: "user" }),
}));

vi.mock("@/lib/organisation-access", () => ({
  currentOrganisationAccess: vi.fn(async () => ({
    organisationId: "organisation-zedu",
    organisationName: "Zedu",
    organisationSlug: "zedu",
    membershipRole: "member",
    admin: false,
  })),
}));

vi.mock("@/lib/session-user", () => ({
  resolveSessionUserId: vi.fn(),
  SESSION_EXPIRED_MESSAGE: "Session expired, sign in again",
}));

vi.mock("@/lib/notify", () => ({
  notifyLater: vi.fn(),
}));

const isConfirmedMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent-api/confirmations", () => ({
  isConfirmed: isConfirmedMock,
}));

const publishAgentEventMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/agent-api/events", () => ({ publish: publishAgentEventMock }));

const auditAgentMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/agents/audit", () => ({ audit: auditAgentMock }));

const issueIdForMock = vi.hoisted(() => vi.fn(async () => "bug-1"));
vi.mock("@/lib/issue-ref", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/issue-ref")>()),
  issueIdFor: issueIdForMock,
}));

const readAgentIssueMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent-api/issues", () => ({
  IssueApiError: class IssueApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
  readAgentIssue: readAgentIssueMock,
}));

const findSimilarIssuesMock = vi.hoisted(() => vi.fn(async () => []));
vi.mock("@/lib/agent-api/create-policy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-api/create-policy")>()),
  findSimilarIssues: findSimilarIssuesMock,
}));

const db = vi.hoisted(() => {
  const tx = {
    bug: { update: vi.fn(), updateMany: vi.fn() },
    delivery: { updateMany: vi.fn() },
    bugActivity: { create: vi.fn() },
    bugRevision: { create: vi.fn() },
    issueConfirmation: { deleteMany: vi.fn() },
    agentAuditEvent: { update: vi.fn() },
    $queryRaw: vi.fn(async () => [{
      title: "Original Title",
      description: "Original Description",
      categoryId: "category-1",
      typeId: "type-1",
      duplicateOfId: null,
      status: "open",
      substatus: "open",
    }]),

  };
  return {
    tx,
    prisma: {
      bug: { findUnique: vi.fn(), findFirst: vi.fn() },
      category: { findMany: vi.fn(async () => []) },
      issueType: { findMany: vi.fn(async () => [] as { id: string; name: string }[]) },
      user: { findMany: vi.fn() },
      agentAuditEvent: { findFirst: vi.fn() },
      pullRequestReport: { findFirst: vi.fn() },
      // #security-findings: none of these issues is a private finding.
      securityFinding: { findFirst: vi.fn(async () => null) },
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));

import { editBugContentAction, editPullRequestUrlAction } from "@/app/actions/issues";
import { structureIssue } from "@/lib/agent-api/structure";
import { canEditTicket, TICKET_EDIT_ERRORS } from "@/lib/ticket-editing";
import { buildVersions } from "@/lib/issue-revisions";
import { requireUser } from "@/lib/auth-helpers";

function existingBug(overrides: Record<string, unknown> = {}) {
  return {
    id: "bug-1",
    title: "Original Title",
    description: "Original Description",
    reporterId: "reporter-1",
    beneficiaryUserId: "reporter-1",
    organisationId: "organisation-zedu",
    isDeleted: false,
    ...overrides,
  };
}

function makeFormData(title: string, description: string) {
  const form = new FormData();
  form.set("title", title);
  form.set("description", description);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.prisma.bug.findUnique.mockResolvedValue(existingBug());
});

describe("editBugContentAction confirmation invalidation (#713)", () => {
  it("voids confirmations with a revision and keeps the written entries", async () => {
    isConfirmedMock.mockResolvedValue(true);

    const formData = makeFormData("Updated Title", "Updated Description with new reproduction steps");
    const result = await editBugContentAction("bug-1", formData);

    expect(result).toEqual({ ok: true });

    expect(db.tx.bugRevision.create).toHaveBeenCalled();

    // The entries and their replies stay; the revision makes them stop counting (#issue-confirmations).
    expect(db.tx.issueConfirmation.deleteMany).not.toHaveBeenCalled();
  });

  it("sends an Open issue back to Requires confirmation, since its reviews are void (#requires-confirmation)", async () => {
    isConfirmedMock.mockResolvedValue(true);
    db.prisma.bug.findUnique.mockResolvedValue(existingBug({ status: "open", substatus: "open" }));
    await editBugContentAction("bug-1", makeFormData("Updated Title", "Updated Description with new reproduction steps"));
    expect(db.tx.bug.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "open", substatus: "requires_confirmation" }),
    }));

    vi.clearAllMocks();
    db.prisma.bug.findUnique.mockResolvedValue(existingBug({ status: "in_progress", substatus: "in_progress" }));
    await editBugContentAction("bug-1", makeFormData("Updated Title", "Updated Description with new reproduction steps"));
    expect(db.tx.bug.update.mock.calls[0][0].data).not.toHaveProperty("status");
  });

  it("does nothing when title and description are unchanged", async () => {
    const formData = makeFormData("Original Title", "Original Description");
    const result = await editBugContentAction("bug-1", formData);

    expect(result).toEqual({ ok: true });
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.tx.bugRevision.create).not.toHaveBeenCalled();
  });
});

describe("who may edit", () => {
  it("lets the reporter, an organisation owner or admin, and a super admin edit", () => {
    expect(canEditTicket({ actorId: "u1", actorRole: "user", reporterId: "u1" })).toBe(true);
    expect(canEditTicket({ actorId: "a1", actorRole: "user", membershipRole: "owner", reporterId: "u1" })).toBe(true);
    expect(canEditTicket({ actorId: "s1", actorRole: "super_admin", reporterId: "u1" })).toBe(true);
  });

  it("refuses anyone else, a site admin who is only a member, and the signed-out", () => {
    expect(canEditTicket({ actorId: "u2", actorRole: "user", reporterId: "u1" })).toBe(false);
    expect(canEditTicket({ actorId: "a1", actorRole: "admin", membershipRole: "member", reporterId: "u1" })).toBe(false);
    expect(canEditTicket({ actorId: null, actorRole: null, reporterId: "u1" })).toBe(false);
  });
});

describe("the edit history", () => {
  it("keeps every version, each credited to whoever made the edit that produced it", () => {
    const d = (s: string) => new Date(s);
    const versions = buildVersions({ title: "T3", description: "D3", createdAt: d("2026-01-01"), reporterName: "Rae" }, [
      { id: "r2", title: "T2", description: "D2", editedAt: d("2026-01-03"), editedBy: { name: "Ann" } },
      { id: "r1", title: "T1", description: "D1", editedAt: d("2026-01-02"), editedBy: { name: "Rae" } },
    ]);
    expect(versions.map((v) => [v.number, v.title, v.author, v.isCurrent])).toEqual([
      [1, "T1", "Rae", false],
      [2, "T2", "Rae", false],
      [3, "T3", "Ann", true],
    ]);
  });
});

describe("agent structure edit history (#589)", () => {
  const agent = { agentId: "agent-1", ownerId: "editor-1", tenantId: "tenant-zedu" } as never;

  beforeEach(() => {
    db.prisma.bug.findFirst.mockResolvedValue(existingBug({
      projectId: "project-zedu",
      categoryId: "category-1",
      typeId: "type-1",
      duplicateOfId: null,
      status: "open",
      substatus: "open",
      createdByAgent: null,
      claims: [],
    }));
    db.tx.$queryRaw.mockResolvedValue([{
      title: "Original Title",
      description: "Original Description",
      categoryId: "category-1",
      typeId: "type-1",
      duplicateOfId: null,
      status: "open",
      substatus: "open",
    }]);
    isConfirmedMock.mockResolvedValue(true);
    readAgentIssueMock.mockResolvedValue({ id: "bug-1", title: "Updated Title", confirmed: false });
  });

  it("records a revision and returns an Open issue for confirmation after restructuring", async () => {
    const result = await structureIssue(agent, "project-zedu", "bug-1", {
      title: "Updated Title",
      description: "Updated Description",
      checkDuplicates: false,
    });

    expect(result.issue.confirmed).toBe(false);
    expect(db.tx.bugRevision.create).toHaveBeenCalledWith({
      data: {
        bugId: "bug-1",
        title: "Original Title",
        description: "Original Description",
        editedById: "editor-1",
      },
    });
    expect(db.tx.bug.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: "Updated Title",
        description: "Updated Description",
        status: "open",
        substatus: "requires_confirmation",
      }),
    }));
    expect(readAgentIssueMock.mock.invocationCallOrder[0]).toBeGreaterThan(db.tx.bugRevision.create.mock.invocationCallOrder[0]);
    expect(db.tx.issueConfirmation.deleteMany).not.toHaveBeenCalled();
  });

  it("does not create a content revision for a metadata-only structure update", async () => {
    db.prisma.issueType.findMany.mockResolvedValue([{ id: "type-2", name: "Bug" }]);

    await structureIssue(agent, "project-zedu", "bug-1", {
      typeId: "type-2",
      checkDuplicates: false,
    });

    expect(db.tx.bugRevision.create).not.toHaveBeenCalled();
    expect(isConfirmedMock).not.toHaveBeenCalled();
    expect(db.tx.bug.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ typeId: "type-2" }),
    }));
    expect(db.tx.bug.update.mock.calls[0][0].data).not.toHaveProperty("status");
  });

  it.each(["in_progress", "resolved"])("refuses to restructure an issue in %s", async (status) => {
    db.prisma.bug.findFirst.mockResolvedValue(existingBug({
      projectId: "project-zedu",
      categoryId: "category-1",
      typeId: "type-1",
      status,
      substatus: status,
      createdByAgent: null,
      claims: [],
    }));
    db.tx.$queryRaw.mockResolvedValue([{
      title: "Original Title",
      description: "Original Description",
      categoryId: "category-1",
      typeId: "type-1",
      duplicateOfId: null,
      status,
      substatus: status,
    }]);

    await expect(structureIssue(agent, "project-zedu", "bug-1", {
      title: "Updated Title",
      description: "Updated Description",
      checkDuplicates: false,
    })).rejects.toMatchObject({ status: 409 });

    expect(db.tx.bugRevision.create).not.toHaveBeenCalled();
    expect(db.tx.bug.update).not.toHaveBeenCalled();
  });
});

describe("editPullRequestUrlAction (#edit-pr-link)", () => {
  it("refuses former deliverer when another contributor holds active claim and delivered current PR", async () => {
    const formerDelivererId = "past-owner";
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: formerDelivererId, role: "user" });
    db.prisma.bug.findUnique.mockResolvedValue({
      id: "bug-1",
      status: "done",
      pullRequestUrl: "https://github.com/emerjent/ziki/pull/2",
      pullRequestHeadSha: "sha-2",
      proofLinks: [],
      reporterId: "reporter-1",
      assigneeId: "new-owner",
      isDeleted: false,
      project: { repoUrl: "https://github.com/emerjent/ziki" },
      claims: [
        { beneficiaryUserId: "new-owner", agent: { ownerUserId: "new-owner" }, status: "active", releasedAt: null },
      ],
      deliveries: [
        { beneficiaryUserId: formerDelivererId, pullRequestUrl: "https://github.com/emerjent/ziki/pull/1", agent: { ownerUserId: formerDelivererId } },
        { beneficiaryUserId: "new-owner", pullRequestUrl: "https://github.com/emerjent/ziki/pull/2", agent: { ownerUserId: "new-owner" } },
      ],
    });

    const formData = new FormData();
    formData.set("pullRequestUrl", "https://github.com/emerjent/ziki/pull/3");

    const result = await editPullRequestUrlAction("bug-1", formData);
    expect(result).toEqual({ error: TICKET_EDIT_ERRORS.unauthorized });
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  describe("an accepted fix (#replacement-pr)", () => {
    const OLD = "https://github.com/emerjent/ziki/pull/1";
    const NEXT = "https://github.com/emerjent/ziki/pull/3";
    const holder = "holder";

    beforeEach(() => {
      (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: holder, role: "user" });
      db.prisma.bug.findUnique.mockResolvedValue({
        id: "bug-1",
        status: "merge",
        pullRequestUrl: OLD,
        pullRequestHeadSha: "sha-1",
        proofLinks: [OLD],
        reporterId: "reporter-1",
        assigneeId: holder,
        isDeleted: false,
        project: { repoUrl: "https://github.com/emerjent/ziki" },
        claims: [{ beneficiaryUserId: holder, agent: { ownerUserId: holder }, status: "active", releasedAt: null }],
        deliveries: [{ beneficiaryUserId: holder, pullRequestUrl: OLD, agent: { ownerUserId: holder } }],
      });
      db.prisma.agentAuditEvent.findFirst.mockResolvedValue({ id: "accept1", payload: { pullRequestUrl: OLD } });
      db.tx.bug.updateMany.mockResolvedValue({ count: 1 });
    });

    /** The latest report on the accepted pull request; the replacement has none. */
    const reportOnAccepted = (state: string | null) =>
      db.prisma.pullRequestReport.findFirst.mockImplementation(async ({ where }: { where: { pullRequestUrl: string } }) =>
        state && where.pullRequestUrl === OLD ? { id: "r1", state, pullRequestUrl: OLD, createdAt: new Date(), headSha: "sha-1" } : null);
    const edit = () => {
      const form = new FormData();
      form.set("pullRequestUrl", NEXT);
      return editPullRequestUrlAction("bug-1", form);
    };

    it("links a replacement when the accepted pull request is reported closed, and restarts review", async () => {
      reportOnAccepted("closed");
      expect(await edit()).toEqual({ ok: true });
      expect(db.tx.agentAuditEvent.update).toHaveBeenCalledWith({ where: { id: "accept1" }, data: { undoneAt: expect.any(Date) } });
      expect(db.tx.bug.updateMany).toHaveBeenCalledWith({ where: { id: "bug-1", status: { in: ["done", "merge"] } }, data: { status: "done", substatus: "requires_review" } });
      expect(db.tx.bugActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ replacesPullRequestUrl: OLD }) }) }),
      );
    });

    it.each(["open", "merged", null])("keeps refusing a different pull request while the accepted one is %s", async (state) => {
      reportOnAccepted(state);
      expect(await edit()).toMatchObject({ error: expect.stringContaining("accepted fix is bound to a different pull request") });
      expect(db.prisma.$transaction).not.toHaveBeenCalled();
      expect(db.tx.agentAuditEvent.update).not.toHaveBeenCalled();
    });
  });
});
