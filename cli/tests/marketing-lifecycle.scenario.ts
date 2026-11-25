import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { FILES, feedItem, fileIssue, ok, refused, unique, ziki, type Agent } from "./helpers";
import { priceAndFund } from "./funding";

/**
 * One marketing task from proposal to Live, through the CLI
 * (docs/ziki-for-agents.md, "Marketing work"): the verdict at the threshold
 * opens it, delivery is a link, not good sends it back to the same worker, and
 * a manager's accept publishes it and pays. The steps only product work has are
 * refused, so nothing moves or pays through them.
 */
async function openTask(label: string): Promise<string> {
  const proposal = await ok("ada", "create-idea", {
    title: unique(label),
    summary: "A short post explaining what changed in the issue list.\nPeople keep asking about it.",
    description: "Write and publish a post for people who already use the issue list.",
    track: "marketing",
    rationale: "People keep asking what changed, and a post answers them all at once.",
    idempotencyKey: randomUUID(),
    acknowledgeSimilar: true,
  });
  for (const agent of ["bob", "cara", "eli"] as const) {
    const given = await ok(agent, "give-idea-verdict", { id: proposal.idea.id, opinion: "good", summary: "Worth doing.", description: "This serves the current focus." });
    if (given.decided?.outcome === "converted") return given.decided.issueId as string;
  }
  throw new Error("The verdict at the threshold should have opened it.");
}

const judge = (agent: Agent, id: string, goodToMerge: boolean) =>
  ok(agent, "submit-test-result", { id, goodToMerge, summary: goodToMerge ? "Approved." : "Needs changes.", description: goodToMerge ? "Reads well and its links work." : "The opening doesn't say who it is for." });

const deliver = (id: string) =>
  ok("cara", "deliver", { id, summary: "Wrote and published the post.", description: "Published it and checked its links.", deliverableUrls: ["https://example.com/blog/post"] });

async function award(id: string): Promise<void> {
  // Funded first, as every task must be before it is awarded (#price-lock).
  await priceAndFund(id);
  const bid = await ok("cara", "bid", { id, summary: "I can write it.", description: "Draft, edit and publish it, then check its links." });
  const awarded = await ok("dana", "award-bid", { id: bid.bid_id });
  await ok("cara", "accept-offer", { id: awarded.claimId });
}

describe("a marketing task from proposal to Live", () => {
  let id: string;

  beforeAll(async () => {
    id = await openTask("CLI marketing lifecycle: launch post");
  });

  it("opens on the deciding verdict, with no confirmation step, and only on the marketing feed", async () => {
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({ track: "marketing", status: "open", substatus: "open", revisionCount: 0 });
    const product = await ok("dana", "work");
    expect((product.items as { issue?: { id: string } }[]).some((item) => item.issue?.id === id)).toBe(false);
  });

  it("is bid on, awarded and accepted like product work", async () => {
    await award(id);
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({ status: "in_progress", substatus: "in_progress" });
  });

  it("goes back to the same worker when judged not good, using up a revision round", async () => {
    await deliver(id);
    expect((await ok("ada", "get-issue", { id })).issue.substatus).toBe("requires_review");
    for (const agent of ["ada", "bob", "eli"] as const) await judge(agent, id, false);
    const issue = (await ok("ada", "get-issue", { id })).issue;
    expect(issue).toMatchObject({ substatus: "in_progress", revisionCount: 1 });
    expect(issue.holder).toBeTruthy();
  });

  it("delivers the work itself as Markdown, and delivering again replaces it", async () => {
    const summary = "Rewrote the opening.";
    const description = "Says who it is for in the first line.";
    const text = `# The post\n\n${"Every line of the work is kept. ".repeat(1500)}`.trim();
    expect((await ok("cara", "deliver", { id, summary, description, deliverableText: text })).replaced).toBe(true);
    const read = await ok("ada", "list-deliveries", { id });
    expect(read.deliveries[0]).toMatchObject({ deliverableText: text, deliverableUrls: [] });
    await deliver(id);
    expect((await ok("ada", "list-deliveries", { id })).deliveries[0].deliverableText).toBeNull();
  });

  it("goes Live · Published on a manager's accept, and pays once", async () => {
    for (const agent of ["ada", "bob", "eli"] as const) await judge(agent, id, true);
    expect((await ok("ada", "get-issue", { id })).issue.substatus).toBe("accepted");
    await ok("dana", "merge-fix", { id, verdict: "accept", summary: "Accepted.", description: "Good work, ready to go live." });
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({ status: "resolved", substatus: "published", holder: null });
    const entries = await ziki("request", "GET", "/api/v1/agents/me/earnings/entries?limit=20", "--as", "cara");
    const fixer = (entries.json.items as { role: string; issue: { id: string } | null }[]).filter((entry) => entry.role === "fixer" && entry.issue?.id === id);
    expect(fixer).toHaveLength(1);
  });
});

describe("the steps only product work has", () => {
  const PR = "https://github.com/example/site/pull/7";
  let id: string;
  let query: string;

  const post = (agent: Agent, step: string, body: unknown) =>
    ziki("request", "POST", `/api/v1/issues/${id}/${step}?${query}`, "--body", JSON.stringify(body), "--as", agent);

  beforeAll(async () => {
    id = await openTask("CLI marketing lifecycle: refused steps");
    query = `projectId=${(await ok("ada", "get-issue", { id })).issue.projectId as string}`;
  });

  it.each([
    ["confirmations", "bob", { verdict: "confirm", summary: "Real.", description: "Seen it in lib/save.ts.", files: JSON.parse(FILES) }],
    ["open", "bob", {}],
    ["pull-request", "dana", { pullRequestUrl: PR }],
    ["pull-request-status", "bob", { pullRequestUrl: PR, state: "merged", inDefaultBranch: true, note: "Merged on GitHub." }],
    ["resolve", "eli", {}],
    ["deployment", "bob", { environment: "prod", note: "It is on prod." }],
  ] as const)("refuses %s with 409 wrong_track", async (step, agent, body) => {
    const refusal = await post(agent, step, body);
    expect(refusal.json?.status, refusal.out).toBe(409);
    expect(refusal.json?.body?.error).toBe("wrong_track");
  });

  it("left the task where it was and paid nobody for trying", async () => {
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({ status: "open", substatus: "open" });
    const entries = await ziki("request", "GET", "/api/v1/agents/me/earnings/entries?limit=50", "--as", "bob");
    const paid = (entries.json.items as { role: string; issue: { id: string } | null }[]).filter((entry) => entry.issue?.id === id);
    expect(paid).toEqual([]);
  });

  it("doesn't list a confirmation step in anyone's feed", async () => {
    expect(await feedItem("bob", "confirm_issue", id)).toBeUndefined();
  });
});

describe("linking a marketing task to a product issue", () => {
  it("sets and clears the link, and refuses the wrong tracks", async () => {
    const task = await openTask("CLI marketing link: launch post");
    const otherTask = await openTask("CLI marketing link: another post");
    const product = await fileIssue("ada", "CLI marketing link: the issue list", ["bob", "cara", "eli"]);

    const linked = await ok("bob", "link-product-issue", { id: task, issueId: product });
    expect(linked).toMatchObject({ issueId: task, changed: true, linkedIssue: { id: product } });
    expect((await ok("ada", "get-issue", { id: task })).issue.linkedIssue).toMatchObject({ id: product });
    expect(await ok("bob", "link-product-issue", { id: task, issueId: product })).toMatchObject({ changed: false });

    expect((await refused("bob", "link-product-issue", { id: product, issueId: task }, 409)).error).toBe("wrong_track");
    expect((await refused("bob", "link-product-issue", { id: task, issueId: otherTask }, 409)).error).toBe("wrong_track");
    await refused("bob", "link-product-issue", { id: task, issueId: "no-such-issue" }, 404);

    expect(await ok("bob", "unlink-product-issue", { id: task })).toMatchObject({ changed: true, linkedIssue: null });
    expect((await ok("ada", "get-issue", { id: task })).issue.linkedIssue).toBeNull();
  });
});
