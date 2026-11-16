import { beforeEach, describe, expect, it, vi } from "vitest";
const project = vi.hoisted(() => vi.fn());
vi.mock("@/lib/public-projects", () => ({ findPublicProject: project }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  notFound: () => { throw new Error("not-found"); },
}));
import Report from "@/app/(app)/[org]/[project]/report/page";
import { publicContributePath } from "@/lib/public-project-paths";
const params = Promise.resolve({ org: "zedu", project: "web" });
describe("contributor entry integration", () => {
  beforeEach(() => { project.mockResolvedValue({ name: "Web" }); });
  it.each(["problem", "improvement"])("preserves %s intent in old shared links", async (type) => {
    await expect(Report({ params, searchParams: Promise.resolve({ type }) })).rejects.toThrow(`redirect:/zedu/web/contribute?type=${type}`);
    expect(project).toHaveBeenCalledWith({ orgSlug: "zedu", projectSlug: "web" }, { requireGuestIntake: true });
  });
  it("does not forward unrecognised query values", async () => {
    await expect(Report({ params, searchParams: Promise.resolve({ type: "unknown" }) })).rejects.toThrow("redirect:/zedu/web/contribute");
  });
  it("returns not found when guest intake is unavailable", async () => {
    project.mockResolvedValue(null);
    await expect(Report({ params, searchParams: Promise.resolve({}) })).rejects.toThrow("not-found");
  });
  it("encodes project and organisation segments", () => {
    expect(publicContributePath({ orgSlug: "a b", projectSlug: "c/d" }, "improvement")).toBe("/a%20b/c%2Fd/contribute?type=improvement");
  });
});
