import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { localDatabaseUrl } from "../env";
import { ok, refused } from "./helpers";

type Me = {
  id: string;
  work_mode: { mode: string | null; pace: string | null; pace_chosen: boolean; caps: { max_active_tasks: number | null; daily_task_limit: number | null }; settings_url: string } | null;
};

/**
 * Work mode from the terminal (#terminal-work-mode): a freshly connected agent
 * has no work mode, asks its person in the coding terminal, and saves the
 * answer with `set-work-mode`; then it asks how much to take on and saves the
 * pace the same way (#agent-get-started). Each can only fill an empty answer
 * (its owner may have answered on the agent's page first); after that only
 * the owner changes it on the site. (A value other than the two is
 * refused by the CLI itself; the API's 400 is a unit case.) The sandbox agents are shared by the
 * other scenarios, which expect no mode, so cara's is cleared before and after.
 */
describe("work mode from the terminal", () => {
  let agentId: string;
  const clear = () =>
    prisma.agent.update({ where: { id: agentId }, data: { workMode: null, workModeSetAt: null, paceSetAt: null, maxActiveTasks: null, dailyTaskLimit: null } });

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

    const saved = (await ok("cara", "set-work-mode", { workMode: "ask_first" })) as Me;
    expect(saved.work_mode?.mode).toBe("ask_first");
    expect(((await ok("cara", "whoami")) as Me).work_mode?.mode).toBe("ask_first");

    const again = (await refused("cara", "set-work-mode", { workMode: "automatic" }, 409)) as { error: string; settings_url: string };
    expect(again.error).toBe("work_mode_already_set");
    expect(((await ok("cara", "whoami")) as Me).work_mode?.mode).toBe("ask_first");
  });

  // #agent-get-started: the second setup question, asked in the terminal and on the agent's page at once.
  it("saves how much it takes on once, as task caps, and refuses a second answer", async () => {
    expect(((await ok("cara", "whoami")) as Me).work_mode?.pace_chosen).toBe(false);

    const saved = (await ok("cara", "set-work-mode", { pace: "light" })) as Me;
    expect(saved.work_mode).toMatchObject({ pace: "light", pace_chosen: true, caps: { max_active_tasks: 1, daily_task_limit: 2 } });

    const again = (await refused("cara", "set-work-mode", { pace: "busy" }, 409)) as { error: string };
    expect(again.error).toBe("pace_already_set");
    expect(((await ok("cara", "whoami")) as Me).work_mode?.caps).toMatchObject({ max_active_tasks: 1, daily_task_limit: 2 });
  });
});
