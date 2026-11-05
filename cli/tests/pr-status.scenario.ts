import { beforeAll, describe, expect, it } from "vitest";
import { confirm, feedItem, FILES, fileIssue, offeredTo, ok, refused } from "./helpers";

/**
 * Pull request state, reported by agents (#pr-reports). Ziki never calls
 * GitHub: an agent independent of the issue checks the linked pull request and
 * reports what it saw, and every rule reads the latest report. ada files the
 * issue, cara fixes and delivers it, bob and eli judge it and report the pull
 * request, dana reviews and resolves it.
 */
describe("pull request state, reported by agents", () => {
  let id: string;
  const pullRequestUrl = `https://github.com/emerjent/ziki/pull/${90_000 + (Date.now() % 9_000)}`;
  const delivery = {
    pullRequestUrl,
    summary: "Fixed Save on a slow network.",
    description: "Save now waits for the pending request; added a regression test.",
    testResults: "12 passed",
  };
  const good = { goodToMerge: true, summary: "Good to merge.", description: "Checked out the branch; Save works on a throttled network.", files: FILES };
  const review = { verdict: "accept", summary: "Accept: small and tested.", description: "Two independent testers verified it; the change is limited to the save handler." };

  beforeAll(async () => {
    id = await fileIssue("ada", "PR status: Save fails on a slow network", ["bob", "cara", "eli"]);
    await confirm(id, ["bob", "cara"]);
    const bid = await ok("cara", "bid", { id, summary: "I can fix Save.", description: "I will wait for the pending request and add a test." });
    // dana's vote counts 3, the award threshold: any agent may then award the bid.
    await ok("dana", "vote-bid", { id: bid.bid_id });
    await ok("dana", "award-bid", { id: bid.bid_id });
    const offer = await offeredTo(id);
    expect(offer?.agent).toBe("cara");
    await ok("cara", "accept-offer", { id: offer!.offerId });
    await ok("cara", "deliver", { id, ...delivery });
  });

  it("asks an independent agent to check the pull request, never the issue's own side", async () => {
    expect(await feedItem("eli", "report_pr_status", id)).toBeTruthy();
    expect(await feedItem("cara", "report_pr_status", id)).toBeUndefined();
    // The holder's own agent can't report on its own pull request.
    const own = await refused("cara", "report-pr-status", { id, pullRequestUrl, state: "open", checks: "passing", note: "Mine is fine." }, 403);
    expect(own.error).toBe("not_independent");
    // Only the linked pull request is reported on.
    const other = await refused("bob", "report-pr-status", { id, pullRequestUrl: "https://github.com/emerjent/ziki/pull/1", state: "open", note: "Another one." }, 409);
    expect(other.error).toBe("pr_mismatch");
  });

  it("can't be accepted until an independent agent reports it ready", async () => {
    await ok("bob", "submit-test-result", { id, ...good });
    await ok("eli", "submit-test-result", { id, ...good });
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({ status: "done", substatus: "accepted", pullRequestState: null });
    expect((await refused("dana", "merge-fix", { id, ...review }, 409)).error).toBe("needs_pr_report");

    const report = await ok("bob", "report-pr-status", { id, pullRequestUrl, state: "open", checks: "passing", mergeable: true, note: "Open, all checks green, no conflict." });
    expect(report.report).toMatchObject({ state: "open", checks: "passing", reportedBy: { agentName: "bob" } });
    expect((await ok("ada", "get-issue", { id })).issue.pullRequestState).toMatchObject({ id: report.report.id, state: "open" });

    const accepted = await ok("dana", "merge-fix", { id, ...review });
    expect(accepted).toMatchObject({ accepted: true, readyToMerge: true });
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({ status: "merge", substatus: "ready_to_merge" });
  });

  it("waits for the release when it is reported merged into staging", async () => {
    await ok("eli", "report-pr-status", {
      id, pullRequestUrl, state: "merged", mergedInto: "staging", inDefaultBranch: false, mergedAt: new Date(Date.now() + 1000).toISOString(), mergeCommitSha: "9f2c7aa", note: "Merged into staging; main doesn't have it yet.",
    });
    expect((await refused("dana", "resolve-issue", { id }, 409)).error).toBe("awaiting_release");
    const waiting = await feedItem("bob", "await_release", id);
    expect(waiting).toMatchObject({ canAct: false });
    expect(await feedItem("eli", "merge_fix", id)).toBeUndefined();
  });

  it("can't be delivered or resolved once reported missing, until a newer report corrects it", async () => {
    await ok("bob", "report-pr-status", { id, pullRequestUrl, state: "not_found", note: "GitHub answers 404." });
    // In Merge, a report that it can't merge is a Error (#substatus).
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({ status: "merge", substatus: "error" });
    expect((await refused("cara", "deliver", { id, ...delivery }, 422)).error).toBe("pull_request_not_found");
    expect((await refused("dana", "resolve-issue", { id }, 409)).error).toBe("pr_broken");

    // The latest report counts: eli saw it merged into main after all.
    await ok("eli", "report-pr-status", { id, pullRequestUrl, state: "merged", mergedInto: "main", inDefaultBranch: true, mergedAt: new Date(Date.now() + 1000).toISOString(), mergeCommitSha: "9f2c7aa", note: "Released: main contains the merge." });
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({ status: "merge", substatus: "ready_to_merge" });
    const resolved = await ok("dana", "resolve-issue", { id });
    expect(resolved).toMatchObject({ resolved: true, reconciled: true, mergedInto: "main", pullRequestState: { state: "merged", inDefaultBranch: true } });
    // Live starts On dev, until an agent reports where it is deployed.
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({ status: "resolved", substatus: "on_dev" });
  });

  it("moves through Live as agents report where it is deployed (#substatus)", async () => {
    expect(await feedItem("bob", "report_deployment", id)).toBeTruthy();
    const staging = await ok("bob", "report-deployment", { id, environment: "staging", note: "The staging site serves 9f2c7aa." });
    expect(staging).toMatchObject({ status: "resolved", substatus: "on_staging", previousSubstatus: "on_dev", changed: true });
    const prod = await ok("cara", "report-deployment", { id, environment: "prod", note: "Production health reports 9f2c7aa." });
    expect(prod).toMatchObject({ substatus: "on_prod", changed: true });
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({ status: "resolved", substatus: "on_prod" });
    expect(await feedItem("bob", "report_deployment", id)).toBeUndefined();
  });
});
