import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleting an issue only hides it, and owners can restore it "as it was"
 * (#596): the delete must leave its attachments, comment attachments
 * included, for the retention sweep's grace period instead of erasing them.
 */
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/revalidate-issue", () => ({ revalidateIssue: vi.fn() }));

vi.mock("@/lib/auth-helpers", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "admin-1", name: "Ada", role: "user" }),
}));

vi.mock("@/lib/organisation-access", () => ({
  currentOrganisationAccess: vi.fn(async () => ({
    organisationId: "organisation-zedu",
    organisationName: "Zedu",
    organisationSlug: "zedu",
    membershipRole: "owner",
    admin: true,
  })),
}));

vi.mock("@/lib/session-user", () => ({
  resolveSessionUserId: vi.fn(),
  SESSION_EXPIRED_MESSAGE: "Session expired, sign in again",
}));

const closeSupportThreadsForIssue = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/support-threads", () => ({ closeSupportThreadsForIssue }));

const db = vi.hoisted(() => {
  const tx = {
    bug: { update: vi.fn() },
    issueClaim: { updateMany: vi.fn() },
    attachment: { deleteMany: vi.fn() },
    bugActivity: { create: vi.fn() },
    $queryRaw: vi.fn(async () => [{ id: "bug-1" }]),
  };
  return {
    tx,
    prisma: {
      bug: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));

import { deleteBugAction } from "@/app/actions/issues";

beforeEach(() => {
  vi.clearAllMocks();
  db.prisma.bug.findUnique.mockResolvedValue({ id: "bug-1", isDeleted: false });
});

describe("deleteBugAction keeps the issue's attachments (#596)", () => {
  it("hides the issue without deleting any attachment", async () => {
    await deleteBugAction("bug-1");

    expect(db.tx.bug.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bug-1" },
        data: expect.objectContaining({ isDeleted: true, deletedAt: expect.any(Date) }),
      }),
    );
    expect(db.tx.attachment.deleteMany).not.toHaveBeenCalled();
  });

  it("still releases claims and records the deletion", async () => {
    await deleteBugAction("bug-1");

    expect(db.tx.issueClaim.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ bugId: "bug-1", releasedAt: null }) }),
    );
    expect(db.tx.bugActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bugId: "bug-1", type: "deleted" }) }),
    );
  });
});
