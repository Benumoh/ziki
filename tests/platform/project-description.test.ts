import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), org: vi.fn(), admin: vi.fn(), project: vi.fn(), rate: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: mocks.user }));
vi.mock("@/lib/organisation-context", () => ({ currentOrganisationIdFor: mocks.org }));
vi.mock("@/lib/agents/membership", () => ({ isAdminOfOrganisation: mocks.admin }));
vi.mock("@/lib/prisma", () => ({ prisma: { project: { findFirst: mocks.project } } }));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: mocks.rate, RATE_LIMIT_MESSAGE: "Slow down" }));
vi.mock("@/lib/project-description-generation", () => ({ generateProjectDescription: mocks.generate }));
import { generateProjectDescriptionAction } from "@/app/actions/project-description";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "owner" }); mocks.org.mockResolvedValue("org"); mocks.admin.mockResolvedValue(true);
  mocks.project.mockResolvedValue({ name: "Atlas", goal: null, organisation: { name: "Team" }, areas: [{ name: "Web" }], brief: null });
  mocks.rate.mockResolvedValue({ allowed: true }); mocks.generate.mockResolvedValue("Atlas helps teams plan their shared work.");
});
it("authorises an owner and returns a draft without writing a description", async () => {
  expect(await generateProjectDescriptionAction({ slug: "atlas", details: "A shared team planner" })).toEqual({ ok: true, description: "Atlas helps teams plan their shared work." });
  expect(mocks.project).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: "atlas", organisationId: "org", archivedAt: null, organisation: { archivedAt: null } } }));
  expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ details: "A shared team planner", areas: ["Web"] }));
});
it("blocks non-admins before reading project data or calling AI", async () => {
  mocks.admin.mockResolvedValue(false);
  expect((await generateProjectDescriptionAction({ slug: "atlas", details: "Planner" })).ok).toBe(false);
  expect(mocks.project).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
});
it("preserves saved descriptions", async () => {
  mocks.project.mockResolvedValue({ goal: "Owner-written description" });
  expect((await generateProjectDescriptionAction({ slug: "atlas", details: "Planner" })).ok).toBe(false);
  expect(mocks.generate).not.toHaveBeenCalled();
});
it("requests context instead of inventing features from a name", async () => {
  expect((await generateProjectDescriptionAction({ slug: "atlas", details: "" })).ok).toBe(false);
  expect(mocks.generate).not.toHaveBeenCalled();
});
it("leaves manual editing available when the platform AI is unavailable", async () => {
  mocks.generate.mockResolvedValue(null);
  const result = await generateProjectDescriptionAction({ slug: "atlas", details: "Team planner" });
  expect(result).toEqual({ ok: false, error: expect.stringContaining("write and save") });
});
