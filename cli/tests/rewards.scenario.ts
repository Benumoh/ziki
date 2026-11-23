import { beforeAll, describe, expect, it } from "vitest";
import { fileIssue, ok, refused, ziki } from "./helpers";

/**
 * Rewards (#rewards): planning poker, in Ziks. An issue starts at 1,000 Ziks;
 * each person gives one estimate, 1,000 to 10,000 Ziks in steps of 1,000, and
 * the reward is their average; estimating again replaces yours; others'
 * estimates stay hidden until the reward is fixed; the issue carries it, and the
 * work feed asks for estimates.
 */
describe("rewards", () => {
  let id: string;

  beforeAll(async () => {
    id = await fileIssue("ada", "CLI rewards: the export runs twice", ["bob", "cara", "eli"]);
  });

  it("starts an issue at 1,000 Ziks with no estimates, and asks agents to estimate it", async () => {
    expect((await ok("bob", "get-issue", { id })).issue.reward).toMatchObject({ reward: 1000, estimates: 0, maxEstimates: 15, fixed: false });
    const feed = await ok("bob", "work");
    expect((feed.items as { kind: string; detail: string }[]).some((item) => item.kind === "estimate_reward")).toBe(true);
  });

  it("averages the estimates, one per person, and refuses one outside 1,000–10,000 Ziks or between the steps", async () => {
    // The API refuses a value outside 1,000–10,000 or not a multiple of 1,000 (the CLI already checks it before sending).
    const { projectId } = (await ok("bob", "get-issue", { id })).issue;
    for (const value of [0, 500, 11000, 2500, 2.5]) {
      const outside = await ziki("request", "POST", `/api/v1/issues/${id}/reward?projectId=${projectId}`, "--body", JSON.stringify({ value }), "--as", "bob");
      expect(outside.code).toBe(1);
      expect(outside.json?.status).toBe(400);
    }
    expect(await ok("bob", "estimate-reward", { id, value: 4000, reason: "One component." })).toMatchObject({ reward: 4000, estimates: 1, mine: 4000, replaced: false });
    expect(await ok("cara", "estimate-reward", { id, value: 6000, reason: "Needs a migration." })).toMatchObject({ reward: 5000, estimates: 2 });
    // bob changes his mind: his estimate is replaced, not added.
    expect(await ok("bob", "estimate-reward", { id, value: 8000, reason: "It also touches the API." })).toMatchObject({ reward: 7000, estimates: 2, replaced: true });
  });

  it("refuses an estimate from the organisation owner's agent: the owner pays for its issues (#price-lock)", async () => {
    expect((await refused("ada", "estimate-reward", { id, value: 2000, reason: "Mine, so cheap." }, 403)).error).toBe("payer_cannot_estimate");
    expect((await ok("bob", "get-reward", { id })).estimates).toBe(2);
  });

  it("hides the others' estimates until the reward is fixed", async () => {
    const read = await ok("eli", "get-reward", { id });
    expect(read).toMatchObject({ reward: 7000, estimates: 2, fixed: false, mine: null, estimatesList: null });
    expect((await ok("bob", "get-reward", { id })).mine).toMatchObject({ value: 8000 });
  });
});
