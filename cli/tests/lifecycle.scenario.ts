import { prisma } from "@/lib/prisma";
import { localDatabaseUrl } from "../env";
import { sandbox } from "../setup";
import { beforeAll, describe, expect, it } from "vitest";
import { confirm, feedItem, FILES, fileIdea, offeredTo, ok, refused, ziki, type Agent } from "./helpers";

/**
 * One report from idea to merge, through the CLI, with each agent class doing
 * its part: ada files an idea; bob, cara and eli say it is a good idea; bob
 * (a working agent: any agent may) converts it to an issue; bob and cara confirm it and eli clears
 * duplicates; cara bids, dana votes her bid to the threshold and awards it as
 * an offer, and cara accepts
 * and delivers; two other owners test, one reporting the pull request's
 * state on GitHub (Ziki never asks GitHub, #pr-reports); dana reviews; and
 * nothing resolves it until a report says it is merged.
 */
describe("a report from idea to merge", () => {
  /** The idea, then (once converted) the issue it became. */
  let ideaId: string;
  let id: string;
  let solver: Agent;

  beforeAll(async () => {
    ideaId = await fileIdea("ada", "CLI lifecycle: Save does nothing");
    id = ideaId;
  });

  it("starts as an idea, apart from the issues, that every agent can read", async () => {
    const idea = (await ok("bob", "get-idea", { id })).idea;
    expect(idea).toMatchObject({ status: "open", score: 0, ideaThreshold: 3, convertible: false, issueId: null });
    const listed = await ok("cara", "list-ideas", { limit: 50, status: "open" });
    expect(listed.items.map((item: { id: string }) => item.id)).toContain(id);
    // An idea is not an issue.
    await refused("bob", "get-issue", { id }, 404);
  });

  it("takes verdicts, not importance marks or confirmations, while it is an idea", async () => {
    await refused("bob", "mark-important", { id }, 404);
    await refused("bob", "confirm-issue", { id, verdict: "confirm", summary: "Real.", description: "Reproduced it.", files: FILES }, 404);
    expect((await refused("dana", "convert-idea", { id, difficulty: "medium" }, 409)).error).toBe("below_threshold");
  });

  it("keeps the summary to two sentences and a working agent to one vote", async () => {
    await refused("bob", "give-idea-verdict", { id, opinion: "good", summary: "One. Two. Three.", description: "Too long a summary." }, 422);
    const tooMany = await refused("bob", "give-idea-verdict", { id, opinion: "good", votes: 2, summary: "Good.", description: "Two votes." }, 422);
    expect(tooMany).toMatchObject({ error: "too_many_votes", maxVotes: 1 });
  });

  it("scores good minus bad, and a newer verdict replaces the person's earlier one", async () => {
    const bad = await ok("bob", "give-idea-verdict", { id, opinion: "bad", summary: "Not needed.", description: "Saving already works for me." });
    expect(bad).toMatchObject({ ideaScore: -1, replaced: false });
    const changed = await ok("bob", "give-idea-verdict", { id, opinion: "good", summary: "I was wrong. It fails on Firefox.", description: "Reproduced on Firefox 131." });
    expect(changed).toMatchObject({ ideaScore: 1, replaced: true });
    expect((await ok("cara", "give-idea-verdict", { id, opinion: "neutral", summary: "No strong view.", description: "Fine either way." })).ideaScore).toBe(1);
    const reached = await ok("eli", "give-idea-verdict", { id, opinion: "good", votes: 2, summary: "Clear bug. Worth fixing.", description: "Merger agents may give up to 5 votes." });
    expect(reached).toMatchObject({ ideaScore: 3, convertible: true });
    const listed = await ok("ada", "list-idea-verdicts", { id });
    expect(listed).toMatchObject({ ideaId, status: "open", ideaScore: 3, ideaThreshold: 3, convertible: true, votes: { good: 3, bad: 0, neutral: 1 } });
    expect(listed.verdicts).toHaveLength(3);
  });

  it("is converted by any agent, a working one included, which creates the issue", async () => {
    const converted = await ok("bob", "convert-idea", { id: ideaId, difficulty: "medium" });
    expect(converted).toMatchObject({ ideaId, ideaScore: 3 });
    expect(converted.issueId).not.toBe(ideaId);
    id = converted.issueId;
    const issue = (await ok("ada", "get-issue", { id })).issue;
    expect(issue).toMatchObject({ status: "open", substatus: "requires_confirmation", confirmed: false, holder: null, idea: { id: ideaId } });
    // One status: no second, stage-like field next to it.
    expect(issue).not.toHaveProperty("stage");
    expect((await ok("bob", "get-idea", { id: ideaId })).idea).toMatchObject({ status: "converted", issueId: id, issueNumber: converted.issueNumber });
    const late = await refused("bob", "give-idea-verdict", { id: ideaId, opinion: "good", summary: "Late.", description: "Too late." }, 409);
    expect(late.error).toBe("idea_converted");
  });

  it("can be confirmed by the agent that filed it, counting 1 (#confirmation-weights)", async () => {
    const own = await ok("ada", "confirm-issue", { id, verdict: "confirm", summary: "Mine.", description: "My own issue: lib/save.ts:42 sends the request twice.", files: FILES });
    expect(own).toMatchObject({ replaced: false, confirmed: false, confirmations: 1, confirmationsNeeded: 3 });
  });

  it("refuses a confirm without the files where it was found (#confirmation-files)", async () => {
    const missing = await refused("bob", "confirm-issue", { id, verdict: "confirm", summary: "Real.", description: "Reproduced it." }, 400);
    expect(missing).toMatchObject({ error: "invalid_request", field: "files" });
  });

  it("refuses a bare verdict", async () => {
    const { projectId } = (await ok("bob", "get-issue", { id })).issue;
    const bare = await ziki("request", "POST", `/api/v1/issues/${id}/confirmations?projectId=${projectId}`, "--body", JSON.stringify({ verdict: "confirm" }), "--as", "bob");
    expect(bare.code).toBe(1);
    expect(bare.out + bare.err).toMatch(/invalid_request/);
  });

  it("takes one entry per person, replaced when given again; neutral counts for nothing", async () => {
    const neutral = await ok("eli", "confirm-issue", { id, verdict: "neutral", summary: "Can't tell.", description: "I could not reproduce it, but I only tried once." });
    expect(neutral).toMatchObject({ replaced: false, confirmed: false, confirmations: 1, confirmationsNeeded: 3 });
    const reject = await ok("bob", "confirm-issue", { id, verdict: "reject", summary: "Not real.", description: "Works for me on Chrome." });
    expect(reject).toMatchObject({ replaced: false, confirmed: false, confirmations: 1 });
    const listed = await ok("cara", "list-confirmations", { id });
    expect(listed).toMatchObject({ confirmations: 1, rejections: 1, confirmationsNeeded: 3, confirmed: false });
    expect(listed.entries).toHaveLength(3);
    const entryId = listed.entries.find((entry: { verdict: string }) => entry.verdict === "reject").id;
    const reply = await ok("cara", "comment", { id, summary: "A short comment.", body: "Try Firefox: it fails there.", confirmationId: entryId });
    expect(reply.comment).toMatchObject({ confirmationId: entryId, parentId: null });
    const relisted = await ok("ada", "list-confirmations", { id });
    expect(relisted.entries.find((entry: { id: string }) => entry.id === entryId).replies).toHaveLength(1);
  });

  it("is confirmed at the threshold, moved to Open by an agent, then ready without upvotes", async () => {
    // bob turns his reject into a confirm: one entry per person per class, replaced.
    await confirm(id, ["bob", "cara"]);
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({ status: "open", substatus: "open", confirmed: true, holder: null });
    expect((await ok("ada", "list-confirmations", { id })).entries).toHaveLength(4);
    // Entries belong to Requires confirmation: an Open issue takes none.
    expect((await refused("dana", "confirm-issue", { id, verdict: "confirm", summary: "Late.", description: "Too late.", files: FILES }, 409)).error).toBe("not_confirming");
  });

  it("hides other confirmers' files until you confirm, and lets a confirmer penalise bad ones (#confirmation-penalties)", async () => {
    type Entry = { id: string; by: string; verdict: string; onBehalfOfUserId: string; files: unknown; filesHidden: boolean; fileCount: number; penalty: unknown; agentReputation: number | null };
    // dana never confirmed: every confirm's files are hidden from her.
    const unseen = (await ok("dana", "list-confirmations", { id })).entries as Entry[];
    const confirms = unseen.filter((entry) => entry.verdict === "confirm");
    expect(confirms.length).toBeGreaterThan(1);
    for (const entry of confirms) expect(entry).toMatchObject({ files: null, filesHidden: true, fileCount: 1 });
    // cara confirmed, so she sees them all.
    const seen = (await ok("cara", "list-confirmations", { id })).entries as Entry[];
    for (const entry of seen.filter((e) => e.verdict === "confirm")) expect(entry.files).toEqual([{ path: "lib/save.ts", lines: "42" }]);

    // cara penalises a confirm given for someone else.
    const caraOwner = (await ok("cara", "whoami")).owner_id as string;
    const target = seen.find((entry) => entry.verdict === "confirm" && entry.onBehalfOfUserId !== caraOwner)!;
    expect(target).toBeTruthy();

    expect((await refused("dana", "penalise-confirmation", { id: target.id, reason: "irrelevant", description: "I haven't confirmed." }, 403)).error).toBe("not_a_confirmer");
    const before = target.agentReputation ?? 0;
    const penalty = await ok("cara", "penalise-confirmation", { id: target.id, reason: "irrelevant", description: "lib/save.ts:42 is the logger, not the save handler." });
    expect(penalty).toMatchObject({ confirmationId: target.id, reason: "irrelevant", targetReputation: before - 10 });
    expect((await refused("cara", "penalise-confirmation", { id: target.id, reason: "empty", description: "Again." }, 409)).error).toBe("already_penalised");
    const after = ((await ok("ada", "list-confirmations", { id })).entries as (Entry & { replies: { id: string }[] })[]).find((entry) => entry.id === target.id)!;
    expect(after.penalty).toMatchObject({ reason: "irrelevant" });
    expect(after.replies.map((reply) => reply.id)).toContain(penalty.commentId);
  });

  it("is marked important with a plain toggle, no reason (#importance)", async () => {
    const marked = await ok("bob", "mark-important", { id });
    expect(marked).toMatchObject({ important: true, importance: 1, changed: true });
    expect(marked).not.toHaveProperty("summary");
    expect(await ok("bob", "mark-important", { id })).toMatchObject({ important: true, importance: 1, changed: false });
    const issue = (await ok("ada", "get-issue", { id })).issue;
    expect(issue).toMatchObject({ importance: 1 });
    expect(issue).not.toHaveProperty("importanceMarks");
    expect(await ok("bob", "unmark-important", { id })).toMatchObject({ important: false, importance: 0, changed: true });
    expect(await ok("bob", "unmark-important", { id })).toMatchObject({ important: false, importance: 0, changed: false });
  });

  it("waits for bids once ready: nobody is offered it automatically", async () => {
    expect(await offeredTo(id)).toBeNull();
    expect(await feedItem("bob", "ready_issue", id)).toBeTruthy();
  });

  it("keeps dispatch metrics for manager agents", async () => {
    expect((await refused("bob", "dispatch-metrics", {}, 403)).error).toBe("This needs a manager agent.");
    expect(await ok("dana", "dispatch-metrics")).toBeTruthy();
  });

  it("is offered to the bidder once its bid is voted to the threshold and awarded, and becomes that agent's claim once accepted", async () => {
    const bid = await ok("cara", "bid", { id, summary: "I can fix Save.", description: "Save fires twice on a double click; I will wait for the pending request and add a test." });
    // dana's vote counts 3, the award threshold: any agent may then award the bid.
    await ok("dana", "vote-bid", { id: bid.bid_id });
    const awarded = await ok("dana", "award-bid", { id: bid.bid_id });
    expect(awarded).toMatchObject({ bidId: bid.bid_id, bugId: id, status: "offered" });
    const offer = await offeredTo(id);
    expect(offer).toEqual({ agent: "cara", offerId: awarded.claimId });
    solver = offer!.agent;
    const someoneElse = (["ada", "bob", "cara"] as const).find((agent) => agent !== solver)!;
    await refused(someoneElse, "accept-offer", { id: offer!.offerId }, 409);
    const accepted = await ok(solver, "accept-offer", { id: offer!.offerId });
    expect(accepted.claim.status).toBe("active");
    expect(accepted.claim.deliverBy).toBeTruthy();
    // The issue read names who has it now: the agent, for its owner, by an accepted offer.
    const { holder } = (await ok("ada", "get-issue", { id })).issue;
    expect(holder).toMatchObject({ status: "active", via: "bid", agentName: "cara", personName: expect.any(String) });
  });

  it("keeps the claim alive with heartbeats and one deadline extension", async () => {
    expect((await ok(solver, "heartbeat", { id })).claim.lastHeartbeatAt).toBeTruthy();
    const other = solver === "cara" ? "bob" : "cara";
    await refused(other, "heartbeat", { id }, 403);
    const extended = await ok(solver, "extend-deadline", { id, reason: "Waiting on a dependency upgrade." });
    expect(JSON.stringify(extended)).toMatch(/extendedAt/);
    await refused(solver, "extend-deadline", { id, reason: "Again, please." }, 409);
  });


  it("delivers owner steering until acknowledgement through the CLI, and keeps private holder fields out", async () => {
    localDatabaseUrl();
    const me = await ok(solver, "whoami");
    // Only create the owner-authored fixture inside this worker's local sandbox.
    const target = await prisma.agent.findFirst({ where: { id: me.id, activations: { some: { organisation: { slug: sandbox().organisationSlug } } } }, select: { id: true } });
    expect(target).toBeTruthy();
    if (!target) throw new Error("Steering fixture must belong to this test sandbox.");
    const note = await prisma.agentInboxItem.create({ data: {
      agentId: target.id, bugId: id, kind: "message", eventType: "agent.steer",
      payload: { type: "steer", body: "Keep the fix scoped to Save." },
    } });
    const other = solver === "cara" ? "bob" : "cara";
    const first = await ok(solver, "heartbeat", { id });
    expect(first.steering).toEqual(expect.arrayContaining([expect.objectContaining({ id: note.id, acknowledge_url: expect.any(String) })]));
    const retry = await ok(solver, "heartbeat", { id });
    expect(retry.steering.map((item: { id: string }) => item.id)).toContain(note.id);
    // Reading the inbox is not acknowledgement of a steer.
    await ok(solver, "mark-inbox-read", { ids: [note.id] });
    expect((await prisma.agentInboxItem.findUniqueOrThrow({ where: { id: note.id } })).readAt).toBeNull();
    await refused(other, "acknowledge-steer", { id, steerId: note.id, plan: "Not my note." }, 404);
    const plan = "I will scope the fix to Save and cover the double click.";
    expect(await ok(solver, "acknowledge-steer", { id, steerId: note.id, plan })).toMatchObject({ acknowledged: true });
    expect(await ok(solver, "acknowledge-steer", { id, steerId: note.id, plan: "A retried response." })).toMatchObject({ acknowledged: true });
    const saved = await prisma.agentInboxItem.findUniqueOrThrow({ where: { id: note.id } });
    expect(saved.readAt).not.toBeNull();
    expect(saved.payload).toMatchObject({ plan, acknowledgedAt: expect.any(String) });
    expect((await ok(solver, "heartbeat", { id })).steering.map((item: { id: string }) => item.id)).not.toContain(note.id);
    const holder = (await ok(other, "get-issue", { id })).issue.holder;
    expect(holder).not.toHaveProperty("ownerUserId");
    expect(holder).not.toHaveProperty("pausedAt");

    await prisma.agent.update({ where: { id: target.id }, data: { pausedAt: new Date() } });
    try {
      await refused(solver, "work", {}, 423);
      const before = await prisma.issueClaim.findFirstOrThrow({ where: { agentId: target.id, bugId: id, status: "active", releasedAt: null } });
      await ok(solver, "heartbeat", { id });
      const after = await prisma.issueClaim.findUniqueOrThrow({ where: { id: before.id } });
      expect(after.lastHeartbeatAt).toEqual(before.lastHeartbeatAt);
    } finally {
      await prisma.agent.update({ where: { id: target.id }, data: { pausedAt: null } });
    }
  });

  const delivery = {
    pullRequestUrl: "https://github.com/emerjent/ziki/pull/4242",
    summary: "Fixed Save on the second click.",
    description: "Save now waits for the pending request; added a regression test for the double click.",
    // #delivery-screenshots: how it looked when the work started, and how it looks now.
    beforeScreenshots: ["https://example.com/before.png"],
    screenshots: ["https://example.com/after.png"],
    testResults: "42 passed",
  };

  it("gets its work delivered by the claim holder only, as In progress's entry, and moves to Delivered", async () => {
    const other = solver === "cara" ? "bob" : "cara";
    // Nothing to judge before the work is delivered.
    expect((await refused(other, "submit-test-result", { id, goodToMerge: false, summary: "Too early.", description: "Nothing delivered.", files: FILES }, 409)).error).toBe("not_delivered");
    // A delivery explains itself: a bare one is refused by the API (sent raw; the CLI asks for the flags itself).
    const { projectId } = (await ok(solver, "get-issue", { id })).issue;
    const bare = await ziki("request", "POST", `/api/v1/issues/${id}/delivery?projectId=${projectId}`, "--body", JSON.stringify({ pullRequestUrl: delivery.pullRequestUrl, testResults: "1 passed" }), "--as", solver);
    expect(bare.code).toBe(1);
    expect(bare.json?.status).toBe(400);
    expect(bare.out + bare.err).toMatch(/summary/);
    // Only the agent holding the claim delivers.
    expect((await refused(other, "deliver", { id, ...delivery }, 409)).error).toBe("no_claim");
    // #delivery-screenshots: no product delivery without an image of before the work and after it.
    const withoutBefore = Object.fromEntries(Object.entries(delivery).filter(([key]) => key !== "beforeScreenshots"));
    const noBefore = await refused(solver, "deliver", { id, ...withoutBefore }, 400);
    expect(noBefore).toMatchObject({ error: "invalid_request", field: "beforeScreenshots" });
    const delivered = await ok(solver, "deliver", { id, ...delivery });
    expect(delivered).toMatchObject({ replaced: false, delivery: { summary: delivery.summary, pullRequestUrl: delivery.pullRequestUrl, current: true } });
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({ status: "done", substatus: "requires_review", pullRequestUrl: delivery.pullRequestUrl });
    // People reply to a delivery, like any entry.
    const reply = await ok("ada", "comment", { id, summary: "A short comment.", body: "Does it cover the keyboard shortcut too?", deliveryId: delivered.delivery.id });
    expect(reply.comment).toMatchObject({ deliveryId: delivered.delivery.id, parentId: null });
    const listed = await ok("dana", "list-deliveries", { id });
    expect(listed).toMatchObject({ status: "done", substatus: "requires_review", deliveries: [{ id: delivered.delivery.id, current: true }] });
    expect(JSON.stringify(listed)).toContain("keyboard shortcut");
  });

  it("is judged by independent owners, not by the solver, by what the latest report says of its PR", async () => {
    const verdict = { summary: "Good to merge.", description: "Verified on the branch: Save works again.", files: FILES };
    await refused(solver, "submit-test-result", { id, goodToMerge: true, ...verdict }, 403);
    const testers = (["bob", "cara", "eli"] as const).filter((agent) => agent !== solver).slice(0, 2);
    // #review-entries: a bare verdict is refused, and old clients are told notes is gone.
    const { projectId } = (await ok(testers[0], "get-issue", { id })).issue;
    const bare = await ziki("request", "POST", `/api/v1/issues/${id}/test-results?projectId=${projectId}`, "--body", JSON.stringify({ goodToMerge: true, notes: "Looks fine." }), "--as", testers[0]);
    expect(bare.code).toBe(1);
    expect(bare.json?.status).toBe(400);
    expect(bare.out + bare.err).toMatch(/summary/);
    // #pr-reports: Ziki doesn't ask GitHub. An independent agent reports the
    // pull request's checks failing, and from then on "good to merge" stops
    // here, with nothing posted on the issue: the answer says why and what to do.
    expect((await refused(solver, "report-pr-status", { id, pullRequestUrl: delivery.pullRequestUrl, state: "open", checks: "passing", note: "My own PR is fine." }, 403)).error).toBe("not_independent");
    const report = await ok(testers[1], "report-pr-status", { id, pullRequestUrl: delivery.pullRequestUrl, state: "open", checks: "failing", mergeable: true, note: "The test job fails on the PR head." });
    expect(report.report).toMatchObject({ state: "open", checks: "failing", reportedBy: { agentName: expect.any(String) } });
    expect((await ok("ada", "get-issue", { id })).issue.pullRequestState).toMatchObject({ id: report.report.id, checks: "failing" });
    const first = await refused(testers[0], "submit-test-result", { id, goodToMerge: true, ...verdict }, 409);
    expect(first).toMatchObject({ error: "not_ready", missing: "deployment_verification" });
    expect(first.todo).toBeTruthy();
    // "Not good to merge" is always recorded, and giving it again replaces it.
    const fail = await ok(testers[1], "submit-test-result", { id, goodToMerge: false, summary: "Not good to merge yet.", description: "Save still fails on the second click.", files: FILES });
    expect(fail.verdict).toMatchObject({ goodToMerge: false, summary: "Not good to merge yet." });
    const again = await ok(testers[1], "submit-test-result", { id, goodToMerge: false, summary: "Still not good to merge.", description: "Retested: the second click still fails.", files: FILES });
    expect(again).toMatchObject({ changed: true, verdict: { id: fail.verdict.id, summary: "Still not good to merge." } });
    const reply = await ok("ada", "comment", { id, summary: "A short comment.", body: "Which browser was this in?", testVerdictId: fail.verdict.id });
    expect(reply.comment).toMatchObject({ testVerdictId: fail.verdict.id, parentId: null });
    const listed = await ok("dana", "list-test-verdicts", { id });
    expect(listed.verdicts).toHaveLength(1);
    expect(listed.verdicts[0]).toMatchObject({ id: fail.verdict.id, goodToMerge: false, current: true });
    expect(JSON.stringify(listed)).toContain("Which browser was this in?");
    // One not-good judgement weighing 2 (eli is a merger agent) of the 3 needed: still Delivered.
    expect((await ok("ada", "get-issue", { id })).issue.substatus).toBe("requires_review");
  });

  it("is reviewed only by a manager or merger agent, with a written review", async () => {
    const review = { verdict: "accept", summary: "Accept.", description: "The fix is small and tested." };
    expect((await refused("cara", "merge-fix", { id, ...review }, 403)).error).toBe("insufficient_level");
    // A bare review is refused.
    const { projectId } = (await ok("dana", "get-issue", { id })).issue;
    const bare = await ziki("request", "POST", `/api/v1/issues/${id}/merge?projectId=${projectId}`, "--body", JSON.stringify({ action: "reject", feedback: "No." }), "--as", "dana");
    expect(bare.code).toBe(1);
    expect(bare.json?.status).toBe(400);
    // Untested, so even a manager can't accept it yet.
    expect((await refused("dana", "merge-fix", { id, ...review }, 409)).error).toBe("not_ready");
    // A reject is a merge review: the feedback is its description, and no comment narrates it.
    const rejected = await ok("dana", "merge-fix", { id, verdict: "reject", summary: "Reject: Save still fails.", description: "The second click still fails; handle the pending state and add a test." });
    expect(rejected).toMatchObject({ accepted: false, replaced: false, review: { verdict: "reject", summary: "Reject: Save still fails." } });
    const reply = await ok(solver, "comment", { id, summary: "A short comment.", body: "On it.", mergeReviewId: rejected.review.id });
    expect(reply.comment).toMatchObject({ mergeReviewId: rejected.review.id });
    const reviews = await ok("ada", "list-merge-reviews", { id });
    // A reject sends the fix back to In progress.
    expect(reviews.status).toBe("in_progress");
    expect(reviews.reviews[0]).toMatchObject({ id: rejected.review.id, verdict: "reject" });
    expect(JSON.stringify(reviews)).toContain("On it.");
    const comments = JSON.stringify(await ok("ada", "list-comments", { id }));
    expect(comments).not.toMatch(/Fix rejected|Fix accepted|Good-to-merge verdict not recorded|Accept blocked/);
  });

  it("is never merged by Ziki: resolving waits for a report that says it is merged", async () => {
    // The merger merges on GitHub itself; the latest report still says open.
    const checker = (["eli", "dana"] as const).find((agent) => agent !== solver)!;
    expect((await refused(checker, "resolve-issue", { id }, 409)).error).toBe("not_merged");
  });

  it("goes back to Open, the claim released, when enough independent agents judge the delivered work not good", async () => {
    // Sent back by the manager, the solver delivers again: Delivered once more.
    const again = await ok(solver, "deliver", { id, ...delivery, summary: "Delivered again after the review." });
    expect(again).toMatchObject({ replaced: true, delivery: { summary: "Delivered again after the review." } });
    expect((await ok("ada", "get-issue", { id })).issue.substatus).toBe("requires_review");
    // A working agent's not-good judgement (1) on top of eli's (2) reaches the 3 needed.
    const testers = (["bob", "cara", "eli"] as const).filter((agent) => agent !== solver).slice(0, 2);
    await ok(testers[0], "submit-test-result", { id, goodToMerge: false, summary: "Not good to merge.", description: "The second click still fails here too.", files: FILES });
    const issue = (await ok("ada", "get-issue", { id })).issue;
    expect(issue).toMatchObject({ status: "open", pullRequestUrl: null, holder: null });
    // The deliveries stay on the issue as its history.
    expect((await ok("ada", "list-deliveries", { id })).deliveries).toHaveLength(1);
  });
});
