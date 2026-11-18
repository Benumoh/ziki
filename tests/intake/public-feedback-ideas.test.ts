import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), findMany: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-helpers", () => ({ optionalUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { idea: { findMany: mocks.findMany } } }));
import { feedbackSubmitterName, listPublicFeedbackIdeas } from "@/lib/public-feedback-ideas";

describe("customer feedback idea visibility", () => {
  it("shows the associated account name for older submissions", () => {
    expect(feedbackSubmitterName({ reporter: { name: "Web public reporter" }, publicSubmission: { user: { name: "Kenneth" } } })).toBe("Kenneth");
  });
  it("shows the reporter name for signed-in submissions and Guest for anonymous ones", () => {
    expect(feedbackSubmitterName({ reporter: { name: "Ada" }, publicSubmission: null })).toBe("Ada");
    expect(feedbackSubmitterName({ reporter: { name: "Web public reporter" }, publicSubmission: null })).toBe("Guest");
  });
  beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue(null); mocks.findMany.mockResolvedValue([]); });

  it("restricts guest listings to customer reports on public projects", async () => {
    await listPublicFeedbackIdeas("team", { projectSlug: "mobile" });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      source: "public", isDeleted: false, securityFinding: { is: null },
      organisation: { slug: "team", archivedAt: null },
      project: { slug: "mobile", archivedAt: null, OR: [{ visibility: "public" }] },
    }) }));
  });

  it("limits private project access to the current user's memberships", async () => {
    mocks.user.mockResolvedValue({ id: "viewer", role: "user" });
    await listPublicFeedbackIdeas("team", { projectSlug: "desktop", number: 42 });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      source: "public", number: 42,
      project: { slug: "desktop", archivedAt: null, OR: [
        { visibility: "public" },
        { memberships: { some: { userId: "viewer" } } },
        { organisation: { memberships: { some: { userId: "viewer" } } } },
      ] },
    }) }));
  });
});
