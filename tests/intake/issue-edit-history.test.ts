import { describe, expect, it, vi, beforeEach } from "vitest";

/** Editing an issue (#713): only the reporter and organization admins may edit, an edit keeps the old version and voids the confirmations given before it. */
const publishWebEvent = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/agent-api/web-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-api/web-events")>()),
  publishWebEvent,
}));

vi.mock("@/lib/tenant-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenant-context")>()),
  currentTenantIdFor: vi.fn(async () => "tenant-zedu"),
  defaultProjectIdFor: vi.fn(async () => "project-zedu"),
  tenantIdForUser: vi.fn(async () => "tenant-zedu"),
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

vi.mock("@/lib/tenant-access", () => ({
  currentTenantAccess: vi.fn(async () => ({
    tenantId: "tenant-zedu",
    tenantName: "Zedu",
    tenantSlug: "zedu",
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

const correctMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/points/correct", () => ({
  correct: correctMock,
}));

const db = vi.hoisted(() => {
  const tx = {
    bug: { update: vi.fn() },
    bugActivity: { create: vi.fn() },
    bugRevision: { create: vi.fn() },
    issueConfirmation: { deleteMany: vi.fn() },
    pointEntry: { findFirst: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(async () => [{ title: "Original Title", description: "Original Description" }]),
  };
  return {
    tx,
    prisma: {
      bug: { findUnique: vi.fn() },
      user: { findMany: vi.fn() },
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));

import { editBugContentAction, editProofLinksAction } from "@/app/actions/issues";
import { canEditTicket } from "@/lib/ticket-editing";
import { buildVersions } from "@/lib/issue-revisions";

function existingBug(overrides: Record<string, unknown> = {}) {
  return {
    id: "bug-1",
    title: "Original Title",
    description: "Original Description",
    reporterId: "reporter-1",
    beneficiaryUserId: "reporter-1",
    tenantId: "tenant-zedu",
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
  db.tx.pointEntry.findFirst.mockResolvedValue({
    id: "entry-1",
    tenantId: "tenant-zedu",
    userId: "reporter-1",
    bugId: "bug-1",
    role: "reporter",
    points: 5,
  });
});

describe("editBugContentAction confirmation invalidation (#713)", () => {
  it("voids confirmations with a revision, reverses reporter points, and keeps the written entries", async () => {
    isConfirmedMock.mockResolvedValue(true);

    const formData = makeFormData("Updated Title", "Updated Description with new reproduction steps");
    const result = await editBugContentAction("bug-1", formData);

    expect(result).toEqual({ ok: true });

    // Checked if confirmed, before the revision that voids the entries
    expect(isConfirmedMock).toHaveBeenCalledWith("bug-1", db.tx);
    expect(isConfirmedMock.mock.invocationCallOrder[0]).toBeLessThan(db.tx.bugRevision.create.mock.invocationCallOrder[0]);
    expect(db.tx.bugRevision.create).toHaveBeenCalled();

    // Found reporter points entry
    expect(db.tx.pointEntry.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-zedu",
        sourceKey: "reporter:bug-1:reporter-1",
      },
      select: { id: true, tenantId: true, userId: true, bugId: true, role: true, points: true },
    });

    // Reversed reporter points via correct()
    expect(correctMock).toHaveBeenCalledWith(db.tx, {
      entry: expect.objectContaining({ id: "entry-1", points: 5, role: "reporter" }),
    });

    // Freed up the sourceKey
    expect(db.tx.pointEntry.update).toHaveBeenCalledWith({
      where: { id: "entry-1" },
      data: {
        sourceKey: "reporter:bug-1:reporter-1:invalidated:entry-1",
      },
    });

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

describe("editProofLinksAction PR provenance (#725)", () => {
  it("keeps proof-link edits separate from the issue's authoritative pull request", async () => {
    const currentPr = "https://github.com/acme/app/pull/12";
    db.prisma.bug.findUnique.mockResolvedValue(existingBug({
      proofLinks: [],
      pullRequestUrl: currentPr,
      reporterId: "reporter-1",
    }));
    const form = new FormData();
    form.set("proofLinks", "https://github.com/acme/app/pull/99\nhttps://github.com/other/app/pull/88");

    const result = await editProofLinksAction("bug-1", form);

    expect(result).toEqual({ ok: true });
    expect(db.tx.bug.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ proofLinks: ["https://github.com/acme/app/pull/99", "https://github.com/other/app/pull/88"] }),
    }));
    expect(db.tx.bug.update.mock.calls[0][0].data).not.toHaveProperty("pullRequestUrl");
    expect(db.tx.bug.update.mock.calls[0][0].data).not.toHaveProperty("pullRequestHeadSha");
  });
});

describe("who may edit", () => {
  it("lets the reporter, an organization owner or admin, and a super admin edit", () => {
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
