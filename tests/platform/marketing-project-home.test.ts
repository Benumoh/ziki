import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { isMarketingProject, projectHomePath } from "@/lib/marketing/project-home";
import { projectRef } from "@/lib/project-paths";

type Where = { where: { track: string } };

/** A fake db whose project has ideas and issues on the given tracks. */
function dbWith({ ideas = [], issues = [] }: { ideas?: string[]; issues?: string[] }) {
  const finder = (tracks: string[]) => vi.fn(async ({ where }: Where) => (tracks.includes(where.track) ? { id: "row" } : null));
  return { idea: { findFirst: finder(ideas) }, bug: { findFirst: finder(issues) } } as never;
}

/** Where a project opens (#marketing-home): an all-marketing project opens on its Marketing tab. */
describe("project home (#marketing-home)", () => {
  const ref = projectRef("ziki", "ziki-marketing");

  it("opens an all-marketing project on its organisation's Marketing (#org-marketing), even while its tasks are all still ideas", async () => {
    for (const work of [{ ideas: ["marketing"] }, { issues: ["marketing"] }, { ideas: ["marketing"], issues: ["marketing"] }]) {
      expect(await isMarketingProject(dbWith(work), "p")).toBe(true);
      expect(await projectHomePath(dbWith(work), "p", ref)).toBe("/ziki/marketing");
    }
  });

  it("keeps product projects, mixed ones and empty ones on Ideas", async () => {
    for (const work of [{ issues: ["product"] }, { ideas: ["product"] }, { ideas: ["marketing"], issues: ["product"] }, { ideas: ["product", "marketing"] }, {}]) {
      expect(await isMarketingProject(dbWith(work), "p")).toBe(false);
      expect(await projectHomePath(dbWith(work), "p", ref)).toBe("/ziki/ziki-marketing/new");
    }
  });
});
