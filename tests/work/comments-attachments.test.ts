import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth-helpers", () => ({
  requireUser: vi.fn(),
}));

/** Comment permissions and attachment access (#578, #658): files are served only to members of their organisation, unattached uploads only to their uploader; only authors edit comments, and only authors and organisation admins delete them. */
const organisationAccessFor = vi.hoisted(() =>
  vi.fn(async () => ({
    organisationId: "organisation-ziki",
    organisationName: "Ziki",
    organisationSlug: "ziki",
    membershipRole: "member" as "owner" | "admin" | "member",
    admin: false,
  })),
);
vi.mock("@/lib/organisation-access", () => ({ organisationAccessFor }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: { findUnique: vi.fn() },
    projectMembership: { findUnique: vi.fn() },
    attachment: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { GET, DELETE } from "@/app/api/attachments/[id]/route";
import { canDeleteComment, canEditComment } from "@/lib/comment-permissions";

const userMock = vi.mocked(requireUser) as unknown as ReturnType<typeof vi.fn>;
const findUnique = vi.mocked(prisma.attachment.findUnique) as unknown as ReturnType<typeof vi.fn>;
const attachmentDelete = vi.mocked(prisma.attachment.delete) as unknown as ReturnType<typeof vi.fn>;
const membershipFindUnique = vi.mocked(prisma.membership.findUnique) as unknown as ReturnType<typeof vi.fn>;

function makeRequest(id: string) {
  return GET(new NextRequest(`http://localhost:3000/api/attachments/${id}`), {
    params: Promise.resolve({ id }),
  });
}

describe("GET /api/attachments/[id]", () => {
  it("keeps idea screenshots private until conversion, then uses issue visibility", async () => {
    userMock.mockResolvedValue({ id: "outsider", role: "user" });
    membershipFindUnique.mockResolvedValue(null);
    vi.mocked(prisma.projectMembership.findUnique).mockResolvedValue(null);
    const parent = { isDeleted: false, organisationId: "org", projectId: "project", project: { visibility: "public" } };
    const file = { uploaderId: "reporter", filename: "shot.png", contentType: "image/png", size: 3, data: Buffer.from("png"), bug: null, idea: parent, comment: null, redesignProposal: null };
    findUnique.mockResolvedValue(file);
    expect((await makeRequest("private-shot")).status).toBe(404);
    membershipFindUnique.mockResolvedValue({ userId: "triager" });
    expect((await makeRequest("private-shot")).status).toBe(200);
    membershipFindUnique.mockResolvedValue(null);
    findUnique.mockResolvedValue({ ...file, bug: parent });
    expect((await makeRequest("converted-shot")).status).toBe(200);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    userMock.mockResolvedValue({ id: "user-1", role: "user" });
  });

  it("returns 404 if attachment is unlinked and uploader is someone else", async () => {
    findUnique.mockResolvedValue({
      uploaderId: "user-2",
      filename: "secret.pdf",
      contentType: "application/pdf",
      size: 100,
      data: Buffer.from("pdf-data"),
      bug: null,
      comment: null,
      redesignProposal: null,
    });
    const res = await makeRequest("att-1");
    expect(res.status).toBe(404);
  });

  it("returns 200 if attachment is unlinked but uploader is current user", async () => {
    findUnique.mockResolvedValue({
      uploaderId: "user-1",
      filename: "my-draft.log",
      contentType: "text/plain; charset=utf-8",
      size: 10,
      data: Buffer.from("log-content"),
      bug: null,
      comment: null,
      redesignProposal: null,
    });
    const res = await makeRequest("att-1");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("log-content");
    expect(res.headers.get("Content-Disposition")).toContain('filename="my-draft.log"');
  });

  it("returns 404 if attachment belongs to a deleted issue and user is not admin", async () => {
    userMock.mockResolvedValue({ id: "user-1", role: "user" });
    findUnique.mockResolvedValue({
      uploaderId: "user-1",
      filename: "issue.png",
      contentType: "image/png",
      size: 50,
      data: Buffer.from("png-bytes"),
      bug: { isDeleted: true },
      comment: null,
      redesignProposal: null,
    });
    const res = await makeRequest("att-2");
    expect(res.status).toBe(404);
  });

  it("returns 404 when a site admin is only a member of the issue's organisation", async () => {
    userMock.mockResolvedValue({ id: "admin-1", role: "admin" });
    findUnique.mockResolvedValue({
      uploaderId: "user-2",
      filename: "issue.png",
      contentType: "image/png",
      size: 50,
      data: Buffer.from("png-bytes"),
      bug: { isDeleted: true, organisationId: "organisation-ziki" },
      comment: null,
      redesignProposal: null,
    });
    const res = await makeRequest("att-2");
    expect(res.status).toBe(404);
  });

  it("returns 200 for normal user if attachment belongs to an active issue", async () => {
    userMock.mockResolvedValue({ id: "user-3", role: "user" });
    findUnique.mockResolvedValue({
      uploaderId: "user-2",
      filename: "screenshot.webp",
      contentType: "image/webp",
      size: 100,
      data: Buffer.from("webp-bytes"),
      bug: { isDeleted: false, organisationId: "organisation-ziki" },
      comment: null,
      redesignProposal: null,
    });
    membershipFindUnique.mockResolvedValue({ userId: "user-3" });
    const res = await makeRequest("att-3");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
  });

  it("returns 404 for non-member if attachment belongs to a comment (#578)", async () => {
    userMock.mockResolvedValue({ id: "user-3", role: "user" });
    findUnique.mockResolvedValue({
      uploaderId: "user-2",
      filename: "comment-attachment.png",
      contentType: "image/png",
      size: 100,
      data: Buffer.from("png-bytes"),
      bug: null,
      comment: { bug: { isDeleted: false, organisationId: "organisation-ziki" } },
      redesignProposal: null,
    });
    membershipFindUnique.mockResolvedValue(null);
    const res = await makeRequest("att-comment");
    expect(res.status).toBe(404);
  });

});

describe("DELETE /api/attachments/[id] (#658)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userMock.mockResolvedValue({ id: "user-1", role: "user" });
  });

  function makeDeleteRequest(id: string) {
    return DELETE(new NextRequest(`http://localhost:3000/api/attachments/${id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id }),
    });
  }

  it("returns 403 when a non-uploader non-admin user tries to delete an attachment", async () => {
    findUnique.mockResolvedValue({
      id: "att-2",
      uploaderId: "other-user",
      bugId: "bug-1",
      commentId: null,
      redesignProposalId: null,
      bug: { organisationId: "organisation-ziki" },
      comment: null,
      redesignProposal: null,
    });

    const res = await makeDeleteRequest("att-2");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(attachmentDelete).not.toHaveBeenCalled();
  });

});

describe("comment permissions", () => {
  const mine = { authorId: "me" };
  const theirs = { authorId: "them" };

  it("lets only the author edit, and never a deleted comment", () => {
    expect(canEditComment("me", mine)).toBe(true);
    expect(canEditComment("me", theirs)).toBe(false);
    expect(canEditComment("me", { authorId: "me", deletedAt: new Date() })).toBe(false);
  });

  it("lets the author, an organisation admin and the super admin delete, not a site admin who is only a member", () => {
    expect(canDeleteComment("me", "user", mine)).toBe(true);
    expect(canDeleteComment("me", "user", theirs, true)).toBe(true);
    expect(canDeleteComment("me", "super_admin", theirs)).toBe(true);
    expect(canDeleteComment("me", "admin", theirs)).toBe(false);
    expect(canDeleteComment(undefined, "user", theirs)).toBe(false);
  });
});
