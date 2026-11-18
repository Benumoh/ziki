import { beforeAll, describe, expect, it } from "vitest";
import { fileIssue, ok, ziki } from "./helpers";

/**
 * Rewards (#rewards): planning poker, in Ziks. An issue starts at 10 Ziks; each
 * person gives one estimate, 10 to 100 Ziks in steps of 10, and the reward is
 * their average; estimating again replaces yours; others' estimates stay hidden
 * until the reward is fixed; the issue carries it, and the work feed asks for
 * estimates.
 */
describe("rewards", () => {
  let id: string;

  beforeAll(async () => {
    id = await fileIssue("ada", "CLI rewards: the export runs twice", ["bob", "cara", "eli"]);
  });

  it("starts an issue at 10 Ziks with no estimates, and asks agents to estimate it", async () => {
    expect((await ok("bob", "get-issue", { id })).issue.reward).toMatchObject({ reward: 10, estimates: 0, maxEstimates: 15, fixed: false });
    const feed = await ok("bob", "work");
    expect((feed.items as { kind: string; detail: string }[]).some((item) => item.kind === "estimate_reward")).toBe(true);
  });

  it("averages the estimates, one per person, and refuses one outside 10–100 Ziks or between the steps", async () => {
    // The API refuses a value outside 10–100 or not a multiple of 10 (the CLI already checks it before sending).
    const { projectId } = (await ok("bob", "get-issue", { id })).issue;
    for (const value of [0, 5, 110, 25, 2.5]) {
      const outside = await ziki("request", "POST", `/api/v1/issues/${id}/reward?projectId=${projectId}`, "--body", JSON.stringify({ value }), "--as", "bob");
      expect(outside.code).toBe(1);
      expect(outside.json?.status).toBe(400);
    }
    expect(await ok("bob", "estimate-reward", { id, value: 40, reason: "One component." })).toMatchObject({ reward: 40, estimates: 1, mine: 40, replaced: false });
    expect(await ok("cara", "estimate-reward", { id, value: 60, reason: "Needs a migration." })).toMatchObject({ reward: 50, estimates: 2 });
    // bob changes his mind: his estimate is replaced, not added.
    expect(await ok("bob", "estimate-reward", { id, value: 80, reason: "It also touches the API." })).toMatchObject({ reward: 70, estimates: 2, replaced: true });
  });

  it("hides the others' estimates until the reward is fixed", async () => {
    const read = await ok("eli", "get-reward", { id });
    expect(read).toMatchObject({ reward: 70, estimates: 2, fixed: false, mine: null, estimatesList: null });
    expect((await ok("bob", "get-reward", { id })).mine).toMatchObject({ value: 80 });
  });
});
