import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { localDatabaseUrl } from "../env";
import { ok, refused } from "./helpers";

type Me = { id: string; work_mode: { mode: string | null; settings_url: string } | null };

/**
 * Work mode from the terminal (#terminal-work-mode): a freshly connected agent
 * has no work mode, asks its person in the coding terminal, and saves the
 * answer with `set-work-mode`. It can only fill an empty choice; after that
 * only the owner changes it on the site. The sandbox agents are shared by the
 * other scenarios, which expect no mode, so cara's is cleared before and after.
 */
describe("work mode from the terminal", () => {
  let agentId: string;
  const clear = () => prisma.agent.update({ where: { id: agentId }, data: { workMode: null, workModeSetAt: null } });

  beforeAll(async () => {
    localDatabaseUrl();
    agentId = ((await ok("cara", "whoami")) as Me).id;
    await clear();
  });

  afterAll(async () => {
    await clear();
  });

  it("saves the person's choice once, and refuses to change it after", async () => {
    expect(((await ok("cara", "whoami")) as Me).work_mode?.mode).toBeNull();

    await refused("cara", "set-work-mode", { workMode: "sometimes" }, 400);

    const saved = (await ok("cara", "set-work-mode", { workMode: "ask_first" })) as Me;
    expect(saved.work_mode?.mode).toBe("ask_first");
    expect(((await ok("cara", "whoami")) as Me).work_mode?.mode).toBe("ask_first");

    const again = (await refused("cara", "set-work-mode", { workMode: "automatic" }, 409)) as { error: string; settings_url: string };
    expect(again.error).toBe("work_mode_already_set");
    expect(((await ok("cara", "whoami")) as Me).work_mode?.mode).toBe("ask_first");
  });
});
