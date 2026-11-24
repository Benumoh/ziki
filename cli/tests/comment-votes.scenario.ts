import { beforeAll, describe, expect, it } from "vitest";
import { confirm, fileIssue, ok, refused, type Agent } from "./helpers";

type Item = { kind: string; key: string; canAct: boolean; issue?: { id: string }; actions: { name: string; cli: string }[] };

/**
 * Investigation comments and their upvotes (#comment-votes). ada files the
 * issue; once it is Open, bob drops an investigation comment on it; eli
 * upvotes it, which raises bob's agent's reputation (it pays nothing: Ziks are the
 * only payment). One vote per person, and nobody upvotes their own comment.
 */
describe("investigation comments and upvotes", () => {
  let id: string;
  let commentId: string;

  const items = async (agent: Agent) => (await ok(agent, "work")).items as Item[];
  const byKey = async (agent: Agent, key: string) => (await items(agent)).find((item) => item.key === key);

  beforeAll(async () => {
    id = await fileIssue("ada", "CLI comment votes: the date picker skips a day", ["bob", "cara", "eli"]);
    await confirm(id, ["bob", "cara"]);
  });

  it("asks agents to investigate the Open issue, but not its reporter", async () => {
    const item = await byKey("bob", `investigate_issue:${id}`);
    expect(item).toMatchObject({ kind: "investigate_issue", canAct: true, issue: { id } });
    expect(item!.actions.map((action) => action.name)).toEqual(["get_issue", "comment"]);
    expect(await byKey("ada", `investigate_issue:${id}`)).toBeUndefined();
  });

  it("takes bob's investigation comment, and stops asking bob once he has commented", async () => {
    const created = await ok("bob", "comment", {
      id,
      summary: "The date picker converts the local day to UTC, so it lands a day early east of UTC.",
      body: "Root cause: the picker converts the local date to UTC in lib/date-picker.ts toIsoDay(), so east of UTC it lands on the day before. Suggested fix: format the day in the user's zone and add a test for UTC+10.",
    });
    commentId = created.comment.id;
    expect(commentId).toBeTruthy();
    expect(await byKey("bob", `investigate_issue:${id}`)).toBeUndefined();
    expect(await byKey("cara", `investigate_issue:${id}`)).toBeTruthy();
  });

  it("asks other owners' agents to upvote it, not its author", async () => {
    const item = await byKey("eli", `review_comment:${commentId}`);
    expect(item).toMatchObject({ kind: "review_comment", canAct: true, issue: { id } });
    expect(item!.actions.map((action) => action.cli)).toEqual([`upvote-comment --id ${commentId}`]);
    expect(await byKey("bob", `review_comment:${commentId}`)).toBeUndefined();
  });

  it("counts eli's upvote once", async () => {
    expect(await ok("eli", "upvote-comment", { id: commentId })).toEqual({ commentId, votes: 1 });
    // Upvoting again is fine and counts once.
    expect(await ok("eli", "upvote-comment", { id: commentId })).toEqual({ commentId, votes: 1 });
    expect(await byKey("eli", `review_comment:${commentId}`)).toBeUndefined();

    const issue = (await ok("ada", "get-issue", { id })).issue as { comments: { id: string; votes: number }[] };
    expect(issue.comments.find((comment) => comment.id === commentId)?.votes).toBe(1);
    const listed = (await ok("ada", "list-comments", { id })).items as { id: string; votes: number }[];
    expect(listed.find((comment) => comment.id === commentId)?.votes).toBe(1);
  });

  it("refuses an upvote on the voter's own comment", async () => {
    expect((await refused("bob", "upvote-comment", { id: commentId }, 403)).error).toBe("own_comment");
    expect(await ok("cara", "upvote-comment", { id: commentId })).toEqual({ commentId, votes: 2 });
  });
});
