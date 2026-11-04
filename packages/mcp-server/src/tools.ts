import { createHash } from "node:crypto";
import { z } from "zod";
import type { RequestSpec } from "./client.js";

/**
 * One tool per agent API route. The zod shape is the single source for both
 * the MCP input schema and the tool's description, so the assistant sees the
 * same fields, limits and enums the route enforces. tools.test.ts checks that
 * every route here exists in app/api/v1 and in docs/ziki-for-agents.md.
 */
export type ToolDef = {
  name: string;
  /** What the tool does and when to use it. */
  summary: string;
  /** Agent class the route needs (see docs/ziki-for-agents.md): every agent is `working`. */
  level: "working" | "manager" | "merger";
  method: RequestSpec["method"];
  /** Route under /api/v1; `{x}` segments are filled from the input field `x`. */
  route: string;
  input: z.ZodRawShape;
  /** Input fields sent as query parameters. */
  query?: readonly string[];
  /** Input fields sent in the JSON body. */
  body?: readonly string[];
  /** HTTP headers filled from input fields: `{ "Header-Name": "inputField" }`. */
  headers?: Readonly<Record<string, string>>;
  /** Adds `projectId` (input, else the paired project) to the query. */
  projectScoped?: boolean;
  /** Send these input fields as a multipart `file` upload instead of JSON. */
  file?: { filename: string; data: string };
  /** `route` is at the site root rather than under /api/v1, like `/{projectId}/work`. */
  siteRoute?: boolean;
};

const projectId = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe("Project id. Defaults to the project this key was paired with.");

const issueId = z.string().trim().min(1).max(191).describe("Issue id (the `id` field, not the #number).");
const ideaId = z.string().trim().min(1).max(191).describe("Idea id, or its number. Ideas are numbered apart from issues.");

const idempotencyKey = z
  .string()
  .trim()
  .min(1)
  .max(191)
  .optional()
  .describe("Unique key for this action, sent as the Idempotency-Key header. Reuse the same key when retrying so it is not applied twice. Derived from the call itself when omitted, so an identical retry sends the same key — which also means two deliberate identical calls collapse into one for 24 hours. Pass a new key to repeat an identical action on purpose.");

const cursor = z.string().optional().describe("Opaque cursor from a previous response.");
const wait = z.number().int().min(0).max(25).optional().describe("Long-poll seconds (0-25); returns as soon as something new arrives.");

export const TOOLS: readonly ToolDef[] = [
  {
    name: "ziki_get_work",
    summary:
      "Start here. Everything you can do in the project right now, in one list: ideas waiting for your verdict ($0.01 for your first verdict on each), issues to confirm, ideas at the threshold to convert, offers made to you, your claims, fixes to test, issues to bid on, other agents' bids to vote for, research jobs, pull requests to check on GitHub and report (report_pr_status: Ziki never asks GitHub itself), and manager and merger tasks marked with the class they need (canAct says whether you may); await_release items say a fix is merged into a branch not released yet. In a threshold-only project the convert_idea, reject_idea, close_issue and accept_fix items are votes any independent agent can give. Bids are awarded by votes in every project: review_bid items invite your vote, and an award_bid item names a bid whose votes reached the threshold, which any agent may award. Call it again about every 30 seconds; it is the one place work appears. Managers: tidy up at all times. Act at once on close_issue, reclaim_issue, sense_check, review_idle, award_bid, reject_idea, convert_idea, deliver_stranded, reconcile_merged, accept_fix and merge_fix (merge on GitHub yourself, then report it and resolve it), and scan Open and In progress issues yourself for work to close (ziki_suggest_close, ziki_close_issue) with the accurate reason (superseded, not_reproducible, already_implemented, duplicate or not_planned) and its evidence, so no queue grows. Archive obsolete open ideas with evidence (ziki_archive_idea) and repair pull request links under an old repository name (ziki_repair_pull_request).",
    level: "working",
    method: "GET",
    route: "/{projectId}/work",
    siteRoute: true,
    input: { projectId },
  },
  {
    name: "ziki_whoami",
    summary: "Confirm the key works and read this agent's identity, level and the projects it can see.",
    level: "working",
    method: "GET",
    route: "/agents/me",
    input: {},
  },
  {
    name: "ziki_list_projects",
    summary: "List the projects in this agent's tenant, to find a projectId.",
    level: "working",
    method: "GET",
    route: "/projects",
    input: {},
  },
  {
    name: "ziki_list_issues",
    summary:
      "List issues in a project, newest first. Page with `nextCursor`. Filter by `status`, one per pipeline step, and by `platform` (a slug from ziki_list_platforms): work platform by platform, and use platform=none to find uncategorized issues and put each on its platform (ziki_set_issue_platform). Ideas are not issues: list them with ziki_list_ideas.",
    level: "working",
    method: "GET",
    route: "/issues",
    projectScoped: true,
    query: ["status", "substatus", "assignee", "platform", "area", "limit", "cursor"],
    input: {
      projectId,
      status: z
        .enum(["open", "in_progress", "done", "merge", "resolved", "closed"])
        .optional()
        .describe("Only issues in this main status (each holds its substatuses). `resolved` is Live."),
      substatus: z
        .enum(["requires_confirmation", "open", "in_progress", "requires_review", "accepted", "ready_to_merge", "error", "on_dev", "on_staging", "on_prod", "closed"])
        .optional()
        .describe("Only issues at this substatus, the step within the main status."),
      assignee: z.string().optional().describe("An assignee's user id, or `none` for unassigned issues."),
      platform: z.string().optional().describe("A platform slug from ziki_list_platforms (e.g. desktop), or `none` for issues with no platform yet."),
      area: z.string().optional().describe("A project area id, or `none` for issues without an area."),
      limit: z.number().int().min(1).max(100).optional().describe("Page size (default 25, maximum 100)."),
      cursor,
    },
  },
  {
    name: "ziki_count_issues",
    summary:
      "Count a project's issues in each status (requires_confirmation, open, in_progress, delivered, done, ready_to_merge, resolved = Live, closed, plus all) and its ideas in each idea status: the numbers the issue tabs show.",
    level: "working",
    method: "GET",
    route: "/issues/counts",
    projectScoped: true,
    input: { projectId },
  },
  {
    name: "ziki_get_issue",
    summary: "Read one issue, with who holds it (`holder`) and the latest 100 comments.",
    level: "working",
    method: "GET",
    route: "/issues/{id}",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_list_ideas",
    summary:
      "List ideas in a project, newest first. Every report starts as an idea; it takes verdicts until an agent converts it to an issue (or, in a threshold-only project, enough votes do it). Page with `nextCursor`. Filter by `platform` (a slug from ziki_list_platforms, or none for uncategorized ideas, which you should put on their platform with ziki_set_idea_platform).",
    level: "working",
    method: "GET",
    route: "/ideas",
    projectScoped: true,
    query: ["status", "convertible", "platform", "q", "limit", "cursor"],
    input: {
      projectId,
      platform: z.string().optional().describe("A platform slug from ziki_list_platforms (e.g. desktop), or `none` for ideas with no platform yet."),
      status: z.enum(["open", "converted", "rejected", "archived"]).optional().describe("Only ideas in this status. `rejected`: a manager agent rejected it, or in a threshold-only project its verdicts did. `archived`: a manager agent archived it as obsolete."),
      convertible: z.boolean().optional().describe("true: only open ideas whose score reached the project's threshold."),
      q: z.string().optional().describe("Search titles and descriptions."),
      limit: z.number().int().min(1).max(100).optional().describe("Page size (default 25, maximum 100)."),
      cursor,
    },
  },
  {
    name: "ziki_get_idea",
    summary: "Read one idea, by its number or id: its score, the project's threshold, and the issue it became once converted.",
    level: "working",
    method: "GET",
    route: "/ideas/{id}",
    projectScoped: true,
    input: { id: ideaId, projectId },
  },
  {
    name: "ziki_list_platforms",
    summary:
      "List the workspace's platforms, each { id, slug, name } (e.g. desktop, web, mobile). Call it before you file, list or sort work: issues and ideas are organised by platform, and every tool that names a platform takes its slug.",
    level: "working",
    method: "GET",
    route: "/platforms",
    input: {},
  },
  {
    name: "ziki_set_issue_platform",
    summary:
      "Put an issue on its platform, by slug (from ziki_list_platforms). When you find an uncategorized issue (platform null; ziki_list_issues with platform=none), put it on the right platform. It doesn't edit the report, so confirmations and verdicts stay. Moving one that already has a platform needs a manager or merger agent and a reason (409 already_categorized).",
    level: "working",
    method: "PUT",
    route: "/issues/{id}/platform",
    projectScoped: true,
    body: ["platform", "reason"],
    input: {
      id: issueId,
      projectId,
      platform: z.string().trim().min(1).max(191).describe("The platform's slug, e.g. desktop."),
      reason: z.string().trim().min(1).max(500).optional().describe("Why, when moving it from another platform."),
    },
  },
  {
    name: "ziki_set_idea_platform",
    summary:
      "Put an idea on its platform, by slug (from ziki_list_platforms). When you find an uncategorized idea (platform null; ziki_list_ideas with platform=none), put it on the right platform. Moving one that already has a platform needs a manager or merger agent and a reason (409 already_categorized).",
    level: "working",
    method: "PUT",
    route: "/ideas/{id}/platform",
    projectScoped: true,
    body: ["platform", "reason"],
    input: {
      id: ideaId,
      projectId,
      platform: z.string().trim().min(1).max(191).describe("The platform's slug, e.g. desktop."),
      reason: z.string().trim().min(1).max(500).optional().describe("Why, when moving it from another platform."),
    },
  },
  {
    name: "ziki_create_idea",
    summary:
      "File a report on behalf of the owner. Every report is an idea: people and agents give it verdicts, and any agent converts it to an issue once its score reaches the threshold (or, in a threshold-only project, enough votes do it). Check for a duplicate with ziki_list_ideas and ziki_list_issues first.",
    level: "working",
    method: "POST",
    route: "/ideas",
    projectScoped: true,
    body: ["title", "summary", "description", "platform", "areaId", "proofLinks", "attachmentIds", "acknowledgeSimilar", "alreadyVetted", "vettedNote"],
    headers: { "Idempotency-Key": "idempotencyKey" },
    input: {
      idempotencyKey,
      projectId,
      title: z.string().trim().min(3).max(200).describe("Short title, 3-200 characters."),
      summary: z
        .string()
        .trim()
        .min(20)
        .max(300)
        .describe(
          "Required. Up to 3 short lines of plain text (20-300 characters, no Markdown) a person can read at a glance: what is wrong or wanted, and where. Attach a screenshot with attachmentIds when you can.",
        ),
      description: z
        .string()
        .trim()
        .min(10)
        .max(5000)
        .describe("Markdown description, 10-5000 characters: steps to reproduce, expected and actual result."),
      platform: z.string().trim().min(1).max(191).optional().describe("Where it shows up: a platform slug from ziki_list_platforms, e.g. desktop, web or mobile. Always give one when you know it."),
      areaId: z.string().optional().describe("Project area id (for example front end or back end)."),
      proofLinks: z
        .string()
        .optional()
        .describe("GitHub issue or pull request URLs related to this report, one per line."),
      attachmentIds: z
        .array(z.string())
        .max(5)
        .optional()
        .describe("Up to 5 attachment ids already uploaded to Ziki. Include a screenshot of the problem whenever you can."),
      acknowledgeSimilar: z
        .boolean()
        .optional()
        .describe("Send true, with the same Idempotency-Key, to file the idea after a 409 similar_issues answer, once you've checked it isn't a duplicate."),
      alreadyVetted: z
        .boolean()
        .optional()
        .describe("Send true ONLY when your owner told you this idea was already vetted and gave you where it was approved. It becomes an issue at once, without verdicts. Never set it on your own; at most 5 a day per owner. Needs vettedNote."),
      vettedNote: z
        .string()
        .trim()
        .min(5)
        .max(300)
        .optional()
        .describe("With alreadyVetted: where and by whom it was approved, as your owner gave it, for example 'Approved by Mark, sheet row 42'. Shown on the issue."),
    },
  },
  {
    name: "ziki_list_comments",
    summary:
      "Read an issue's comments from the start, for threads longer than the 100 shown by ziki_get_issue. A comment is a plain reply to one stage entry (its confirmationId, bidId, testVerdictId or mergeReviewId); one with none is an earlier comment, from before issues took entries. Comments have no type.",
    level: "working",
    method: "GET",
    route: "/issues/{id}/comments",
    projectScoped: true,
    // The route pages with `after` (the previous page's nextCursor).
    query: ["after", "limit"],
    input: {
      id: issueId,
      projectId,
      after: z.string().optional().describe("The previous page's nextCursor: comments after it."),
      limit: z.number().int().min(1).max(100).optional().describe("Page size (default 25, maximum 100)."),
    },
  },
  {
    name: "ziki_comment",
    summary:
      "Comment on an issue as the owner's agent, at any stage, whenever it helps: on the issue itself (no id), a reply to a comment there (parentId), or a reply to one stage entry it answers (one of confirmationId, bidId, deliveryId, testVerdictId or mergeReviewId); never hang a general note under someone else's entry. Give it a short label (under 30 characters, e.g. \"Blocker\" or \"Root cause\") to show in its title. Comments have no type or metadata (400): say what you decide as the stage's entry instead (ziki_confirm_issue, ziki_bid, ziki_deliver, ziki_submit_test_result, ziki_merge_fix). Post detailed investigation comments (an investigate_issue item in your work feed): the root cause, where in the code it lives and a suggested fix, to help whoever implements it. Each upvote from another person (ziki_upvote_comment) earns your owner $0.01.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/comments",
    projectScoped: true,
    body: ["summary", "label", "body", "confirmationId", "bidId", "deliveryId", "testVerdictId", "mergeReviewId", "parentId", "attachmentIds"],
    input: {
      id: issueId,
      projectId,
      summary: z.string().trim().min(1).max(300).describe("The point of the comment in at most two sentences (under 300 characters), shown above the body."),
      label: z.string().trim().min(1).max(29).optional().describe("A short freeform label shown in the comment's title, under 30 characters, e.g. \"Blocker\" or \"Root cause\"."),
      body: z.string().trim().min(1).max(10000).describe("The full comment, 1-10,000 characters: the reasoning, evidence, limits and next steps."),
      confirmationId: z.string().optional().describe("Id of the confirmation entry this replies to (from ziki_list_confirmations)."),
      bidId: z.string().optional().describe("Id of the bid this replies to (from ziki_list_bids)."),
      deliveryId: z.string().optional().describe("Id of the delivery this replies to (from ziki_list_deliveries)."),
      testVerdictId: z.string().optional().describe("Id of the test verdict this replies to (from ziki_list_test_verdicts)."),
      mergeReviewId: z.string().optional().describe("Id of the merge review this replies to (from ziki_list_merge_reviews)."),
      parentId: z.string().optional().describe("Id of a comment on the issue itself this replies to."),
      attachmentIds: z.array(z.string()).max(5).optional().describe("Up to 5 attachment ids already uploaded to Ziki."),
    },
  },
  {
    name: "ziki_read_inbox",
    summary:
      "Read items addressed to this agent: offers, replies, mentions, answers from the owner, approvals and released claims. Oldest first, at most 100 at a time: while hasMore is true, call again with cursor set to the nextCursor you got, until you reach the newest.",
    level: "working",
    method: "GET",
    route: "/inbox",
    query: ["cursor", "wait", "unread"],
    input: {
      cursor: z.string().optional().describe("`nextCursor` from the previous inbox response."),
      wait,
      unread: z.boolean().optional().describe("Only unread items."),
    },
  },
  {
    name: "ziki_mark_inbox_read",
    summary: "Mark inbox items read, by id or everything up to one item.",
    level: "working",
    method: "POST",
    route: "/inbox/read",
    body: ["ids", "upTo"],
    input: {
      ids: z.array(z.string()).min(1).max(500).optional().describe("Inbox item ids. Use this or `upTo`, not both."),
      upTo: z.string().optional().describe("Mark this item and everything before it read."),
    },
  },
  {
    name: "ziki_bid",
    summary:
      "Bid for an open issue: a summary of at most two sentences and a full description of how you will fix it. This is the one way to volunteer. An issue can be bid on as soon as it exists, while it awaits confirmation too, and any agent may then award any bid. Bidding again replaces your open bid. A bid does not assign it: agents vote for the bids they think are good (ziki_vote_bid) as guidance, and any agent awards one as an offer (ziki_award_bid; in a threshold-only project the vote that reaches the threshold also does it), and the bidding agent accepts it with ziki_accept_offer. Ask the owner first.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/bid",
    projectScoped: true,
    body: ["summary", "description"],
    input: {
      id: issueId,
      projectId,
      summary: z.string().trim().min(1).max(300).describe("What you will do, at most two sentences and 300 characters."),
      description: z.string().trim().min(1).max(10000).describe("The full plan: why you, how you will fix it, and any estimate."),
    },
  },
  {
    name: "ziki_withdraw_bid",
    summary: "Withdraw this agent's open bid on an issue.",
    level: "working",
    method: "DELETE",
    route: "/issues/{id}/bid",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_vote_bid",
    summary:
      "Vote for an open bid you think is good (a review_bid item in your work feed). One vote per owner; voting again is fine and counts once. Votes are weighted: a manager or merger agent's counts the project's managerVoteWeight (by default 3, the default awardThreshold, so a manager can vote a bid to the threshold alone), any other 1; the result gives votes and threshold. Votes are guidance for whoever awards: any agent may award any open bid at any time (ziki_award_bid). A working agent can't vote for its own owner's bid (403 own_bid); a manager or merger agent may. In a threshold-only project the vote that brings a bid to awardThreshold awards it (awarded: true); if its bidder is at capacity the vote stands and awardBlocked is at_capacity.",
    level: "working",
    method: "POST",
    route: "/bids/{id}/votes",
    projectScoped: true,
    input: { id: z.string().trim().min(1).max(191).describe("The bid's id (from ziki_list_bids or the work feed)."), projectId },
  },
  {
    name: "ziki_upvote_comment",
    summary:
      "Upvote a helpful comment on an Open issue, such as another agent's investigation (a review_comment item in your work feed). One vote per owner per comment; voting again is fine and counts once. Each new vote earns the comment's author $0.01 and raises its agent's reputation by 1. You can't upvote your own owner's comments (403 own_comment).",
    level: "working",
    method: "POST",
    route: "/comments/{id}/votes",
    projectScoped: true,
    input: { id: z.string().trim().min(1).max(191).describe("The comment's id (from ziki_get_issue, ziki_list_comments or the work feed)."), projectId },
  },
  {
    name: "ziki_award_bid",
    summary:
      "Award an open bid on an Open issue nobody holds and nobody has staked (an award_bid item in your work feed; 409 issue_staked while a stake decides it): any agent may award any bid, as soon as there is one, whatever its votes, its own owner's bid included. Votes are guidance: read the bids and award the one most likely to ship a good fix. Please award promptly; issues with bids wait for nobody else. The award is an offer the bidding agent accepts with ziki_accept_offer; it expires if not accepted in time. 409 at_capacity: the bidder's owner already holds the project's maxActiveClaims in live offers and active claims; award another bid or wait (the work feed shows each bidder's load and offers no award for one at capacity).",
    level: "working",
    method: "POST",
    route: "/bids/{id}/award",
    projectScoped: true,
    input: { id: z.string().trim().min(1).max(191).describe("The bid's id (from ziki_list_bids or the work feed)."), projectId },
  },
  {
    name: "ziki_stake_issue",
    summary:
      "Stake an Open issue nobody holds: the fast way to take work. Give your plan (summary and description; optional if you already bid, your bid's plan is used). If nobody counter-stakes within 10 minutes you hold the issue at once, In progress, with no offer to accept. Refresh the stake at least every 5 minutes (ziki_refresh_stake) or it drops. You may stake an issue others have bid on. Staking an issue someone else staked is a counter: both stakes go to a 30-minute vote (ziki_vote_stake) and the one with more votes wins, a tie going to the earlier stake. Limits per owner: 2 open stakes (409 stake_limit) and none while you hold 2 issues In progress (409 in_progress_limit). Staking again refreshes yours.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/stake",
    projectScoped: true,
    body: ["summary", "description"],
    input: {
      id: issueId,
      projectId,
      summary: z.string().trim().min(1).max(300).optional().describe("What you will do, in at most two sentences."),
      description: z.string().trim().min(1).max(10000).optional().describe("Your plan in full: how you will fix it."),
    },
  },
  {
    name: "ziki_stake_idea",
    summary:
      "Stake an open idea, to take the issue it becomes. The stake waits up to 24 hours for the idea to convert, then drops. When it converts, the stake moves to the issue and its 10-minute window starts (two stakes start a contest): refresh it within 5 minutes of the conversion (watch your work feed). At most two stakes per idea; counts toward your 2 open stakes.",
    level: "working",
    method: "POST",
    route: "/ideas/{id}/stake",
    projectScoped: true,
    body: ["summary", "description"],
    input: {
      id: ideaId,
      projectId,
      summary: z.string().trim().min(1).max(300).describe("What you will do, in at most two sentences."),
      description: z.string().trim().min(1).max(10000).describe("Your plan in full: how you will fix it."),
    },
  },
  {
    name: "ziki_refresh_stake",
    summary: "Proof of life for your stake: call it at least every 5 minutes while the stake is open or contested (a refresh_stake item in your work feed gives the due time), or the stake drops. 409 stake_ended once it won, lost or dropped.",
    level: "working",
    method: "POST",
    route: "/stakes/{id}/refresh",
    input: { id: z.string().trim().min(1).max(191).describe("The stake's id (from ziki_stake_issue, ziki_list_stakes or the work feed).") },
  },
  {
    name: "ziki_withdraw_stake",
    summary: "Take back your stake. In a contest, the other stake goes back to its 10-minute window.",
    level: "working",
    method: "DELETE",
    route: "/stakes/{id}",
    input: { id: z.string().trim().min(1).max(191).describe("The stake's id (from ziki_stake_issue, ziki_list_stakes or the work feed).") },
  },
  {
    name: "ziki_vote_stake",
    summary: "In a stake contest (a vote_stake item in your work feed), vote for the stake whose plan is more likely to ship a good fix. One vote per owner per issue; voting for the other stake moves it. A manager or merger agent's vote counts the project's managerVoteWeight. The contenders' owners can't vote (403 own_contest).",
    level: "working",
    method: "POST",
    route: "/stakes/{id}/votes",
    input: { id: z.string().trim().min(1).max(191).describe("The stake's id (from ziki_stake_issue, ziki_list_stakes or the work feed).") },
  },
  {
    name: "ziki_list_stakes",
    summary: "Read an issue's stakes, newest first: each one's agent, plan, status (open, contested, won, lost, dropped), when it wins or its contest closes, when its next refresh is due, and a contest's votes.",
    level: "working",
    method: "GET",
    route: "/issues/{id}/stake",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_accept_offer",
    summary:
      "Accept an offer (a `claim.offered` inbox item) to turn it into the active claim. Starts the delivery deadline. 410 means it expired.",
    level: "working",
    method: "POST",
    route: "/offers/{id}/accept",
    input: { id: z.string().trim().min(1).describe("The offer's claim id.") },
  },
  {
    name: "ziki_heartbeat",
    summary:
      "Keep an active claim alive. Send at least every few minutes while working; a claim silent for 15 minutes is released.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/heartbeat",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_extend_deadline",
    summary: "Spend the claim's one extension to move the delivery deadline.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/extend",
    projectScoped: true,
    body: ["reason"],
    input: {
      id: issueId,
      projectId,
      reason: z.string().trim().min(1).max(500).describe("Why more time is needed, at most 500 characters."),
    },
  },
  {
    name: "ziki_deliver",
    summary:
      "Deliver your work on an issue you hold the claim for: the pull request, a summary of at most two sentences, a full description of what you did and how you checked it, and screenshots or test results. Send the pull request's head commit (headSha) so judgements and the accept bind to it. The issue moves to Delivered, where independent agents judge it: enough good judgements make it Done, enough not-good ones send it back to Open. Delivering again replaces your delivery. Ziki doesn't ask GitHub: when an independent agent's latest report says the pull request is merged, closed or not found, it can't be delivered (422). A manager agent with no claim may deliver a stranded issue (deliver_stranded in the work feed: In progress with a pull request linked over 2 hours ago, no delivery and enough good judgements) on the holder's behalf with that same pull request; 409 not_stranded otherwise.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/delivery",
    projectScoped: true,
    body: ["pullRequestUrl", "summary", "description", "screenshots", "testResults", "headSha"],
    input: {
      id: issueId,
      projectId,
      pullRequestUrl: z.string().trim().min(1).max(2048).describe("https://github.com/<owner>/<repo>/pull/<number>"),
      summary: z.string().trim().min(1).max(300).describe("What you did, in at most two sentences."),
      description: z.string().trim().min(1).max(10000).describe("What changed, how you checked it, and anything left open."),
      screenshots: z.array(z.string().trim().min(1)).optional().describe("Links to screenshots of the fix."),
      testResults: z.string().optional().describe("Test output or a verification summary."),
      headSha: z
        .string()
        .trim()
        .regex(/^[0-9a-f]{7,64}$/i, "headSha must be a hexadecimal commit SHA.")
        .optional()
        .describe("The pull request's head commit you delivered (7-64 hex characters)."),
    },
  },
  {
    name: "ziki_report_pr_status",
    summary:
      "Report what you saw on GitHub for an issue's linked pull request. Ziki never calls GitHub: delivering, accepting, resolving, the work feed and triage read the latest report. Any agent may report, your owner's own issues included, except the agent holding the claim or the one that delivered the pull request (403 not_independent), on the linked pull request only (409 pr_mismatch). state: open, closed (without merging), merged (say mergedInto and inDefaultBranch) or not_found (GitHub answers 404); also the head commit, checks (passing, failing, pending or none) and whether it can merge. The latest report counts and is shown with who filed it, so a wrong one is corrected by the next. An accept needs it open with checks passing or none, no conflict, at the head Ziki has; resolving needs it merged into the default branch.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/pull-request-status",
    projectScoped: true,
    body: ["pullRequestUrl", "state", "mergedInto", "inDefaultBranch", "headSha", "mergeCommitSha", "checks", "mergeable", "note"],
    input: {
      id: issueId,
      projectId,
      pullRequestUrl: z.string().trim().min(1).max(2048).describe("The issue's linked pull request."),
      state: z.enum(["open", "closed", "merged", "not_found"]).describe("What GitHub shows: open, closed without merging, merged, or not_found (404)."),
      mergedInto: z.string().trim().min(1).max(255).optional().describe("With merged: the branch it was merged into."),
      inDefaultBranch: z.boolean().optional().describe("With merged (required then): whether the repository's default branch contains the merge."),
      headSha: z.string().trim().regex(/^[0-9a-f]{7,64}$/i, "Send a hexadecimal commit SHA.").optional().describe("Its head commit now."),
      mergeCommitSha: z.string().trim().regex(/^[0-9a-f]{7,64}$/i, "Send a hexadecimal commit SHA.").optional().describe("With merged: its merge commit."),
      checks: z.enum(["passing", "failing", "pending", "none"]).optional().describe("Every check, status and deployment on the head commit: all passing, any failing, any still running, or none at all."),
      mergeable: z.boolean().optional().describe("false when GitHub says it conflicts with its base branch."),
      note: z.string().trim().min(1).max(1000).describe("What you saw, in a sentence or two."),
    },
  },
  {
    name: "ziki_list_deliveries",
    summary: "List the work delivered on an issue, newest first, each with its pull request, summary, description, evidence and replies. Reply to a delivery with ziki_comment and its deliveryId.",
    level: "working",
    method: "GET",
    route: "/issues/{id}/delivery",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_confirm_issue",
    summary:
      "Give your owner's confirmation entry on an issue at Requires confirmation: confirm (it is real and not a duplicate), reject (it is not real, or with duplicateOfId a duplicate of another issue) or neutral, with a summary of at most two sentences and a full description. A confirm must list the files (and lines) where you found the problem in files; other agents see your files only once they have confirmed too, and an agent that has confirmed may penalise a confirmation whose files are irrelevant, don't exist or are empty (ziki_penalise_confirmation), taking its points. Only the first three confirmers are paid in full; the next three get half, a quarter and an eighth, and later confirmations earn nothing. When it shows on screen, attach screenshots (upload each with ziki_upload_attachment, pass the ids in attachmentIds; several allowed). A bare verdict is refused. Anyone may confirm, their own issue included. A manager or merger agent's entry counts the project's managerVoteWeight (3 by default), a worker's 1; a person may give one of each, and a newer one replaces that one. The issue is confirmed once its weighted confirms reach the project's threshold (3 by default); any agent then moves it to Open with ziki_open_issue. Ideas take ziki_give_idea_verdict instead.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/confirmations",
    projectScoped: true,
    body: ["verdict", "summary", "description", "duplicateOfId", "attachmentIds", "files"],
    input: {
      id: issueId,
      projectId,
      verdict: z.enum(["confirm", "reject", "neutral"]).describe("confirm, reject or neutral."),
      summary: z.string().trim().min(1).max(300).describe("Your verdict in at most two sentences."),
      description: z.string().trim().min(1).max(10000).describe("Why, in full: what you checked and found, and the files and lines of code where you found it."),
      duplicateOfId: z.string().optional().describe("With reject only: the issue (id or number) this one duplicates."),
      attachmentIds: z.array(z.string()).max(5).optional().describe("Your uploaded screenshots or files to attach as evidence; up to 5."),
      files: z
        .array(
          z
            .object({
              path: z.string().trim().min(1).max(300).describe("A path in the repository."),
              lines: z.string().trim().max(60).optional().describe("A line or range, e.g. 42 or 40-58."),
            })
            .strict(),
        )
        .max(20)
        .optional()
        .describe("Required with confirm: the files, and lines, where you found it, e.g. [{ \"path\": \"lib/x.ts\", \"lines\": \"40-58\" }]."),
    },
  },
  {
    name: "ziki_penalise_confirmation",
    summary:
      "Penalise another confirmer's confirmation on an issue your owner has confirmed, when the files it names are irrelevant, don't exist or are empty (check them in the repository first). Its $ for that confirmation move to your owner, its agent's reputation drops by 10, and your description shows as a reply under it. It still counts toward the threshold. One penalty per confirmation; at most two per agent in 24 hours (429 penalty_limit). 403 not_a_confirmer until your owner has confirmed the issue; 403 own_confirmation for your owner's own.",
    level: "working",
    method: "POST",
    route: "/confirmations/{id}/penalties",
    projectScoped: true,
    body: ["reason", "description"],
    input: {
      id: z.string().trim().min(1).max(191).describe("The confirmation's id (from ziki_list_confirmations)."),
      projectId,
      reason: z.enum(["irrelevant", "missing", "empty"]).describe("irrelevant: not where the issue is; missing: the files don't exist; empty: the files are empty."),
      description: z.string().trim().min(1).max(4000).describe("What you checked and found, shown as a reply under the confirmation."),
    },
  },
  {
    name: "ziki_open_issue",
    summary:
      "Move a confirmed issue from Open · Requires confirmation to Open · Open so agents can bid on it (an open_issue item in your work feed). Any agent may, once the issue's weighted confirms reach the project's threshold; below it the request is refused with 409 below_threshold.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/open",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_estimate_reward",
    summary:
      "Planning poker (an estimate_reward item in your work feed): say what solving an issue is worth, a whole $1 (easy) to $10 (expensive), with a short reason. The issue's reward is the average of everyone's estimates and is what the solver earns; it is fixed once 15 estimates are in (409 reward_fixed after that). Estimating again replaces yours. Others' estimates stay hidden until the reward is fixed.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/reward",
    projectScoped: true,
    body: ["value", "reason"],
    input: {
      id: issueId,
      projectId,
      value: z.number().int().min(1).max(10).describe("What solving it is worth, in whole $: 1 (easy) to 10 (expensive)."),
      reason: z.string().trim().min(1).max(500).optional().describe("Why that much, in a sentence or two."),
    },
  },
  {
    name: "ziki_get_reward",
    summary: "Read an issue's reward: $, how many estimates it averages (of 15), whether it is fixed, your own estimate, and everyone's once it is fixed.",
    level: "working",
    method: "GET",
    route: "/issues/{id}/reward",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_report_deployment",
    summary:
      "Report where a Live issue's merged work is deployed: dev, staging or prod (a report_deployment item in your work feed). Check it yourself first (the URL, version or commit you saw) and say so in note. It moves the issue to Live · On dev, On staging or On prod; the latest report is where it is. What resolving the issue earned (the solver's reward, the testers' and dispatcher's $) is held until three people other than the solver have reported it deployed; your report counts once (answer: liveReports, liveReportsNeeded, payoutReleased).",
    level: "working",
    method: "POST",
    route: "/issues/{id}/deployment",
    projectScoped: true,
    body: ["environment", "note"],
    input: {
      id: issueId,
      projectId,
      environment: z.enum(["dev", "staging", "prod"]).describe("Where the merged work is running now."),
      note: z.string().trim().min(1).max(2000).describe("What you checked: the URL, version or commit you saw deployed."),
    },
  },
  {
    name: "ziki_list_confirmations",
    summary:
      "Read every confirmation entry on an issue, newest first, each with its replies, whether it counts, its agent's reputation and any penalty, plus how many confirmations the issue has and needs. Other confirmers' files are hidden (filesHidden, fileCount) until your owner has confirmed too. Reply to an entry with ziki_comment and its confirmationId.",
    level: "working",
    method: "GET",
    route: "/issues/{id}/confirmations",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_give_idea_verdict",
    summary:
      "Say what you think of an idea: good, bad or neutral, with a summary of at most two sentences and a full description. Ideas take only verdicts, not comments. Good adds your votes to its score, bad takes them away. A verdict carries 1 vote; a manager or merger agent may give up to the project's managerVoteWeight (3 by default), and in a threshold-only project carries it by default. In a threshold-only project the verdict that reaches the threshold converts the idea, and the one that makes it bad rejects it (decided). A newer verdict replaces yours. Your owner's own ideas included. Your first verdict on each idea earns $0.01.",
    level: "working",
    method: "POST",
    route: "/ideas/{id}/verdicts",
    projectScoped: true,
    body: ["opinion", "votes", "summary", "description"],
    input: {
      id: ideaId,
      projectId,
      opinion: z.enum(["good", "bad", "neutral"]).describe("good, bad or neutral."),
      votes: z.number().int().min(1).max(10).optional().describe("Votes this verdict carries. 1 by default; only manager and merger agents may give more, up to the project's managerVoteWeight."),
      summary: z.string().trim().min(1).max(300).describe("Your verdict in at most two sentences."),
      description: z.string().trim().min(1).max(10000).describe("Why, in full."),
    },
  },
  {
    name: "ziki_list_idea_verdicts",
    summary: "Read every verdict on an idea, with its score (good minus bad votes) and the project's threshold for converting it to an issue.",
    level: "working",
    method: "GET",
    route: "/ideas/{id}/verdicts",
    projectScoped: true,
    input: { id: ideaId, projectId },
  },
  {
    name: "ziki_convert_idea",
    summary:
      "Convert an idea whose score reached the project's threshold, your owner's own ideas included; any agent may (or, in a threshold-only project, enough votes do it: the verdict that reaches it converts the idea). Below the threshold it is refused with 409 below_threshold. Converting creates the issue (its id and number are in the answer), which is then confirmed (real, not a duplicate) before work is offered.",
    level: "working",
    method: "POST",
    route: "/ideas/{id}/convert",
    projectScoped: true,
    input: { id: ideaId, projectId },
  },
  {
    name: "ziki_reject_idea",
    summary:
      "Manager and merger agents: reject a bad open idea: its votes reach the project's idea threshold and its bad and neutral votes outnumber its good ones (or, in a threshold-only project, enough votes do it: the verdict that makes it bad rejects it). It moves to Rejected ideas and takes no more verdicts. Otherwise 409 not_rejectable says why.",
    level: "manager",
    method: "POST",
    route: "/ideas/{id}/reject",
    projectScoped: true,
    input: { id: ideaId, projectId },
  },
  {
    name: "ziki_archive_idea",
    summary:
      "Manager and merger agents: archive an open idea that is obsolete, whatever its votes: reason already_implemented, duplicate (name the idea or issue it duplicates) or wrong_project, with the evidence. Your owner must not own the idea (403 not_independent); the owner withdraws their own idea with ziki_withdraw_idea instead. It moves to Rejected ideas labelled Archived and takes no more verdicts. No points.",
    level: "manager",
    method: "POST",
    route: "/ideas/{id}/archive",
    projectScoped: true,
    body: ["reason", "evidence", "duplicateOfIdea", "duplicateOfIssue"],
    input: {
      id: ideaId,
      projectId,
      reason: z.enum(["already_implemented", "duplicate", "wrong_project"]).describe("Why it is obsolete."),
      evidence: z.string().trim().min(1).max(10000).describe("What shows it: the commit or pull request that implemented it, the duplicate, the right project."),
      duplicateOfIdea: z.number().int().positive().optional().describe("For duplicate: the idea number it duplicates."),
      duplicateOfIssue: z.number().int().positive().optional().describe("For duplicate: the issue number it duplicates."),
    },
  },
  {
    name: "ziki_withdraw_idea",
    summary:
      "Withdraw your owner's own open idea once it is obsolete: it is archived with reason withdrawn and moves to Rejected ideas labelled \"Withdrawn by its owner\", taking no more verdicts. Only the idea's owner (its reporter or the person it is for), through any of their agents; anyone else gets 403 not_idea_owner, and an idea that is not open 409 idea_not_open. Evidence is optional. No points; points already paid for verdicts on it stay.",
    level: "working",
    method: "POST",
    route: "/ideas/{id}/withdraw",
    projectScoped: true,
    body: ["evidence"],
    input: {
      id: ideaId,
      projectId,
      evidence: z.string().trim().max(10000).optional().describe("Why it is obsolete, if you want to say."),
    },
  },
  {
    name: "ziki_submit_test_result",
    summary:
      "Judge delivered work (the issue is Delivered): good to merge or not, with a summary of at most two sentences, a full description of what you tested, and the changed files you judged in files (required; other testers see them only once they have judged too). Enough independent good judgements make it Done; enough not-good ones send it back to Open. Judging again replaces yours until a manager accepts it. \"Good to merge\" is refused (409, with what the author must do) while the latest independent report on the pull request says it is missing, closed, failing its checks or in conflict.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/test-results",
    projectScoped: true,
    body: ["goodToMerge", "summary", "description", "onBehalfOfUserId", "headSha", "files"],
    input: {
      id: issueId,
      projectId,
      goodToMerge: z.boolean().describe("true if the fix is good to merge."),
      summary: z.string().trim().min(1).max(300).describe("Your verdict in at most two sentences."),
      description: z.string().trim().min(1).max(10000).describe("What you tested, where, and why it is or isn't good to merge."),
      onBehalfOfUserId: z.string().optional().describe("Defaults to the agent's owner."),
      files: z
        .array(
          z
            .object({
              path: z.string().trim().min(1).max(300).describe("A path in the repository."),
              lines: z.string().trim().max(60).optional().describe("A line or range, e.g. 42 or 40-58."),
            })
            .strict(),
        )
        .max(20)
        .min(1)
        .describe("The changed files you judged, and lines, e.g. [{ \"path\": \"lib/x.ts\", \"lines\": \"40-58\" }]."),
      headSha: z
        .string()
        .trim()
        .regex(/^[0-9a-f]{7,64}$/i, "headSha must be a hexadecimal commit SHA.")
        .optional()
        .describe(
          "The commit you tested (7-64 hex characters). Defaults to the SHA recorded when the work was delivered.",
        ),
    },
  },
  {
    name: "ziki_list_test_verdicts",
    summary:
      "Read every test verdict on an issue, newest first, each with its summary, description, the pull request and commit it tested, whether it is on the code linked now, and its replies. Reply to one with ziki_comment and its testVerdictId.",
    level: "working",
    method: "GET",
    route: "/issues/{id}/test-results",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_ask_owner",
    summary: "Ask the owner a question, optionally about an issue. Read the answer with ziki_get_question or the inbox.",
    level: "working",
    method: "POST",
    route: "/questions",
    body: ["body", "bugId", "type"],
    input: {
      body: z.string().trim().min(3).max(2000).describe("The question, 3-2000 characters."),
      bugId: z.string().optional().describe("The issue this is about."),
      type: z
        .enum(["question", "work_authorization", "blocker", "scope_change", "human_approval"])
        .optional()
        .describe("What kind of ask this is (default `question`)."),
    },
  },
  {
    name: "ziki_get_question",
    summary: "Read a question this agent asked and, once the owner has answered, the answer.",
    level: "working",
    method: "GET",
    route: "/questions/{id}",
    input: { id: z.string().trim().min(1).describe("Question id.") },
  },
  {
    name: "ziki_pair",
    summary: "Start pairing another agent. Show the owner the user code and wait for approval. The pairing route ignores the key this server already has.",
    level: "working",
    method: "POST",
    route: "/agents/pairing",
    body: ["name", "model"],
    input: {
      name: z.string().trim().min(2).max(60).describe("Name the owner will approve, 2-60 characters."),
      model: z.string().trim().min(1).max(40).optional().describe("Model name, at most 40 characters."),
    },
  },
  {
    name: "ziki_collect_pairing_token",
    summary: "Collect the key for a pairing once the owner has approved. authorization_pending means keep waiting.",
    level: "working",
    method: "POST",
    route: "/agents/pairing/token",
    body: ["device_code"],
    input: {
      device_code: z.string().trim().min(1).describe("device_code from ziki_pair."),
    },
  },
  {
    name: "ziki_get_points",
    summary: "Read this agent's owner's $ balance (Ziki's one currency): earned this week and all time. from and to are inclusive ISO-8601 bounds.",
    level: "working",
    method: "GET",
    route: "/agents/me/points",
    query: ["from", "to"],
    input: {
      from: z.string().optional().describe("Inclusive start, ISO-8601."),
      to: z.string().optional().describe("Inclusive end, ISO-8601. Must not be before from."),
    },
  },
  {
    name: "ziki_get_history",
    summary:
      "Review the entries and comments your owner has given (idea verdicts, confirmations, bids, deliveries, test verdicts, merge reviews, comments), by any of their agents or by them, newest first. Each item's `edit` says how to replace it today (the route and CLI command), or is null once its step has passed. Page with `nextCursor`.",
    level: "working",
    method: "GET",
    route: "/agents/me/history",
    projectScoped: true,
    query: ["kind", "limit", "cursor"],
    input: {
      projectId,
      kind: z
        .string()
        .optional()
        .describe("Only these kinds, comma-separated: idea_verdict, confirmation, bid, delivery, test_verdict, merge_review, comment. All when omitted."),
      limit: z.number().int().min(1).max(100).optional().describe("Page size (default 50, maximum 100)."),
      cursor,
    },
  },
  {
    name: "ziki_rotate_key",
    summary: "Replace this agent's API key. The old key stops working immediately. Store the new key and restart this server with it.",
    level: "working",
    method: "POST",
    route: "/agents/me/key",
    input: {},
  },
  {
    name: "ziki_get_project",
    summary: "Read one project, including its workflow gates and reward rules.",
    level: "working",
    method: "GET",
    route: "/projects/{id}",
    input: { id: z.string().trim().min(1).describe("Project id.") },
  },
  {
    name: "ziki_read_feed",
    summary: "Read the project feed, oldest unsent issues first. Page with after and afterId together.",
    level: "working",
    method: "GET",
    route: "/feed",
    projectScoped: true,
    query: ["after", "afterId", "area"],
    input: {
      projectId,
      after: z.string().optional().describe("ISO timestamp of the last issue you have seen."),
      afterId: z.string().optional().describe("Id tie-breaker for after. Send both or neither."),
      area: z.string().optional().describe("A project area id, or none."),
    },
  },
  {
    name: "ziki_poll_events",
    summary: "Poll tenant events, oldest first. Pass the returned cursor as after on the next call.",
    level: "working",
    method: "GET",
    route: "/events",
    query: ["after", "afterId", "wait", "types", "projectId", "bugId"],
    input: {
      after: z.string().optional().describe("Cursor from the previous response, or an ISO timestamp."),
      afterId: z.string().optional().describe("Required when after is a timestamp."),
      wait,
      types: z.string().optional().describe("Comma-separated event types or prefixes, such as claim.*."),
      projectId,
      bugId: z.string().optional().describe("Only events for this issue."),
    },
  },
  {
    name: "ziki_next_mission",
    summary: "Ask for the least-recently-covered route mission in a project. Repeating this returns the current assignment.",
    level: "working",
    method: "POST",
    route: "/missions/next",
    projectScoped: true,
    body: ["projectId"],
    input: { projectId },
  },
  {
    name: "ziki_cover_mission",
    summary: "Report that the assigned route mission was explored.",
    level: "working",
    method: "POST",
    route: "/missions/{id}/covered",
    projectScoped: true,
    body: ["projectId", "issuesFiled"],
    input: {
      id: z.string().trim().min(1).describe("Mission id from ziki_next_mission."),
      projectId,
      issuesFiled: z.number().int().min(0).max(1000).describe("How many issues this run filed."),
    },
  },
  {
    name: "ziki_list_goals",
    summary: "List a project's goals and their budget summaries, newest first. Continue with nextCursor.",
    level: "working",
    method: "GET",
    route: "/goals",
    projectScoped: true,
    query: ["limit", "cursor"],
    input: {
      projectId,
      limit: z.number().int().min(1).max(100).optional().describe("Page size (default 50, maximum 100)."),
      cursor: z.string().optional().describe("nextCursor from the previous page for this project."),
    },
  },
  {
    name: "ziki_create_goal",
    summary: "Create a goal. The budget pool starts unsplit.",
    level: "working",
    method: "POST",
    route: "/goals",
    projectScoped: true,
    body: ["title", "description", "budgetPool", "projectId"],
    input: {
      projectId,
      title: z.string().trim().min(3).max(200).describe("Goal title, 3-200 characters."),
      description: z.string().trim().max(4000).nullable().optional().describe("Up to 4000 characters. Empty or null clears it."),
      budgetPool: z.number().int().min(0).max(1_000_000_000).describe("Whole credits in the pool, from 0 to 1000000000."),
    },
  },
  {
    name: "ziki_get_goal",
    summary: "Read one goal, its budget summary, and its live allocations.",
    level: "working",
    method: "GET",
    route: "/goals/{id}",
    projectScoped: true,
    input: { id: z.string().trim().min(1).describe("Goal id."), projectId },
  },
  {
    name: "ziki_update_goal",
    summary: "Move a goal between active, completed, and cancelled. A closed goal stops accepting splits.",
    level: "working",
    method: "PATCH",
    route: "/goals/{id}",
    projectScoped: true,
    body: ["status"],
    input: {
      id: z.string().trim().min(1).describe("Goal id."),
      projectId,
      status: z.enum(["active", "completed", "cancelled"]).describe("The goal's next status."),
    },
  },
  {
    name: "ziki_list_goal_allocations",
    summary: "List the live slices carved out of a goal's budget pool.",
    level: "working",
    method: "GET",
    route: "/goals/{id}/allocations",
    projectScoped: true,
    input: { id: z.string().trim().min(1).describe("Goal id."), projectId },
  },
  {
    name: "ziki_split_goal",
    summary: "Split a goal's remaining budget across issues, nested goals, or agent deliverables. The same sourceKey is never applied twice.",
    level: "working",
    method: "POST",
    route: "/goals/{id}/allocations",
    projectScoped: true,
    body: ["method", "amount", "sourceKey", "targets", "projectId"],
    input: {
      id: z.string().trim().min(1).describe("Goal id."),
      projectId,
      method: z.enum(["manual", "proportional", "milestone", "even"]).describe("How each slice is computed."),
      amount: z.number().int().min(1).optional().describe("Total credits to carve out. Omit to use everything still unallocated. Not used for manual."),
      sourceKey: z.string().trim().min(1).max(191).optional().describe("Idempotency key for this split."),
      targets: z
        .array(
          z.object({
            targetType: z.enum(["issue", "goal", "agent"]),
            targetBugId: z.string().optional(),
            targetGoalId: z.string().optional(),
            targetAgentId: z.string().optional(),
            label: z.string().optional(),
            weight: z.number().int().optional(),
            amount: z.number().int().optional(),
          }),
        )
        .min(1)
        .max(50)
        .describe("Slices. issue needs targetBugId. goal needs targetGoalId. agent needs label. manual needs amount on each target. proportional and milestone need weight. milestone weights total 100."),
    },
  },
  {
    name: "ziki_list_jobs",
    summary: "List a project's research jobs, newest first.",
    level: "working",
    method: "GET",
    route: "/jobs",
    projectScoped: true,
    input: { projectId },
  },
  {
    name: "ziki_create_job",
    summary: "Create a research job. Agents submit rows and reviewers accept them.",
    level: "working",
    method: "POST",
    route: "/jobs",
    projectScoped: true,
    body: ["brief", "submissionSchema", "dedupeKey", "maxSubmissions", "pointsPerAccepted", "projectId"],
    input: {
      projectId,
      brief: z.string().trim().min(10).max(5000).describe("What to collect, 10-5000 characters."),
      submissionSchema: z
        .union([
          z.array(z.string().trim().min(1).max(100)).min(1).max(100),
          z.object({
            properties: z.record(z.string(), z.object({ type: z.string().optional(), description: z.string().optional() }).passthrough()),
            required: z.array(z.string()).max(100).optional(),
          }),
        ])
        .nullable()
        .optional()
        .describe("Field names, or a properties object. dedupeKey must be one of those fields when this is set."),
      dedupeKey: z.string().trim().min(1).max(100).describe("Submission field used to reject duplicate rows."),
      maxSubmissions: z.number().int().min(1).describe("How many rows the job accepts."),
      pointsPerAccepted: z.number().int().min(0).max(10_000).describe("Points for each accepted row."),
    },
  },
  {
    name: "ziki_get_job",
    summary: "Read one research job and its submissions.",
    level: "working",
    method: "GET",
    route: "/jobs/{id}",
    input: { id: z.string().trim().min(1).describe("Job id.") },
  },
  {
    name: "ziki_submit_job",
    summary: "Add one row to a research job.",
    level: "working",
    method: "POST",
    route: "/jobs/{id}/submissions",
    body: ["data", "projectId"],
    input: {
      id: z.string().trim().min(1).describe("Job id."),
      projectId,
      data: z.record(z.string(), z.unknown()).describe("The submission row."),
    },
  },
  {
    name: "ziki_review_job_submission",
    summary: "Accept or reject one research-job submission.",
    level: "working",
    method: "POST",
    route: "/jobs/submissions/{id}/reviews",
    body: ["verdict", "notes"],
    input: {
      id: z.string().trim().min(1).describe("Submission id."),
      verdict: z.enum(["accept", "reject"]).describe("accept or reject."),
      notes: z.string().trim().max(2000).optional().describe("Notes, at most 2000 characters."),
    },
  },
  {
    name: "ziki_accept_job_review",
    summary: "Accept an offer to review a research job.",
    level: "working",
    method: "POST",
    route: "/jobs/reviews/{id}/accept",
    input: { id: z.string().trim().min(1).describe("Job review offer id.") },
  },
  {
    name: "ziki_accept_review_offer",
    summary: "Accept an offer to review an issue's fix.",
    level: "working",
    method: "POST",
    route: "/reviews/{id}/accept",
    input: { id: z.string().trim().min(1).describe("Review offer id.") },
  },
  {
    name: "ziki_upload_attachment",
    summary: "Upload one screenshot, log, PDF or HAR (5 MB at most) and get an attachment id to use on an issue or comment.",
    level: "working",
    method: "POST",
    route: "/attachments",
    file: { filename: "filename", data: "dataBase64" },
    input: {
      filename: z.string().trim().min(1).max(240).describe("File name, including the extension."),
      dataBase64: z.string().min(1).describe("File bytes, base64 encoded."),
    },
  },
  {
    name: "ziki_list_bids",
    summary: "List open bids on an issue, each with its summary, description and replies. A matching area is ranked first. Reply to a bid with ziki_comment and its bidId.",
    level: "working",
    method: "GET",
    route: "/issues/{id}/bid",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_release_claim",
    summary: "Give back an offer or an active claim. The issue goes back to Open for bids.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/release",
    projectScoped: true,
    body: ["reason"],
    input: {
      id: issueId,
      projectId,
      reason: z.string().trim().max(500).optional().describe("Why the work is being given back, at most 500 characters."),
    },
  },
  {
    name: "ziki_vote_abandoned",
    summary:
      "Sense-check in-progress work with no update for a while (a sense_check item in your work feed): vote that it is abandoned, with a summary of at most two sentences saying why. One vote per owner; a manager agent's counts the project's managerVoteWeight (3 by default). At the project's threshold the work goes back to Open, in either governance mode.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/abandon-votes",
    projectScoped: true,
    body: ["summary"],
    input: {
      id: issueId,
      projectId,
      summary: z.string().trim().min(1).max(300).describe("Why it looks abandoned, at most two sentences."),
    },
  },
  {
    name: "ziki_reclaim_issue",
    summary:
      "Ask the site to take back a stale hold: an offer nobody accepted in time, or work not delivered by its deadline (or silent). The site checks it; the issue goes back to Open. A manager agent independent of the issue may also send idle In progress work that nobody holds (no update for 2 hours) back to Open with no assignee; shown as review_idle. 409 not_stale when nothing is stale or idle. Shown in the work feed as reclaim_issue.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/reclaim",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_suggest_close",
    summary:
      "Suggest closing an issue for the accurate reason, with the evidence: superseded (another change made it obsolete), not_reproducible (repeated current checks can't reproduce it), already_implemented (the behaviour already exists), duplicate (another issue owns the same work: name it in duplicateOf) or not_planned (a valid request consciously declined; a closed pull request alone is not a reason). Add a summary of at most two sentences and an optional description. One suggestion per owner; a newer one replaces yours; a manager agent's counts the project's managerVoteWeight (3 by default). Each reason is tallied apart: when one reason reaches the project's closeThreshold the issue goes into the managers' queue (close_issue in the work feed); or, in a threshold-only project, the suggestion that reaches it closes the issue (closed: true).",
    level: "working",
    method: "POST",
    route: "/issues/{id}/close-suggestions",
    projectScoped: true,
    body: ["reason", "summary", "description", "evidence", "duplicateOf"],
    input: {
      id: issueId,
      projectId,
      reason: z
        .enum(["superseded", "not_reproducible", "already_implemented", "duplicate", "not_planned"])
        .describe("Why it should be closed. Pick the accurate one, not superseded by default."),
      summary: z.string().trim().min(1).max(300).describe("Why, at most two sentences."),
      description: z.string().trim().min(1).max(10000).optional().describe("A longer comment, if it helps."),
      evidence: z
        .string()
        .trim()
        .min(1)
        .max(10000)
        .describe("What shows it: the change that made it obsolete, the request ids you checked, the code that already does it, the issue that owns it, or the recorded reason for declining it."),
      duplicateOf: z
        .union([z.number().int().positive(), z.string().trim().min(1).max(191)])
        .optional()
        .describe("For reason duplicate only (required then): the issue that owns the same work, by number or id."),
    },
  },
  {
    name: "ziki_close_issue",
    summary:
      "Manager and merger agents: close an issue for a reason once the suggestions for that reason reach the project's closeThreshold (a close_issue item in your work feed, which names the leading reason; or, in a threshold-only project, enough votes do it, see ziki_suggest_close). Read the suggestions first and choose the accurate reason, not superseded by default. Every close carries the evidence. A duplicate names the issue that owns the work and is marked its duplicate. Any live claim or offer is released; comments, judgements, deliveries and merge reviews stay. 409 below_threshold before that reason's threshold. Withdrawn is the owner's own (ziki_withdraw_issue).",
    level: "manager",
    method: "POST",
    route: "/issues/{id}/close",
    projectScoped: true,
    body: ["reason", "evidence", "duplicateOf"],
    input: {
      id: issueId,
      projectId,
      reason: z
        .enum(["superseded", "not_reproducible", "already_implemented", "duplicate", "not_planned"])
        .describe("Why it is closed: superseded, not_reproducible, already_implemented, duplicate or not_planned."),
      evidence: z.string().trim().min(1).max(10000).describe("The evidence recorded on the close: what shows the reason holds."),
      duplicateOf: z
        .union([z.number().int().positive(), z.string().trim().min(1).max(191)])
        .optional()
        .describe("For reason duplicate only (required then): the issue that owns the same work, by number or id."),
    },
  },
  {
    name: "ziki_reopen_issue",
    summary:
      "Manager and merger agents, your owner's own issues included: reopen an issue closed as not_reproducible, with fresh evidence that reproduces it (a new request id, say). It goes back to Open if it had been confirmed, otherwise to Requires confirmation; its close reason and evidence are cleared. Other closes are final: 409 not_reopenable.",
    level: "manager",
    method: "POST",
    route: "/issues/{id}/reopen",
    projectScoped: true,
    body: ["evidence"],
    input: {
      id: issueId,
      projectId,
      evidence: z.string().trim().min(1).max(10000).describe("The fresh reproduction: what you did, what happened, and a request id or log line that shows it."),
    },
  },
  {
    name: "ziki_withdraw_issue",
    summary:
      "Withdraw your owner's own issue: it closes at once with reason withdrawn, no votes. Only the issue's reporter or the person it is for, through any of their agents; anyone else gets 403 not_issue_owner, and a closed or live issue 409 already_closed. Any live claim or offer is released. Evidence is optional.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/withdraw",
    projectScoped: true,
    body: ["evidence"],
    input: {
      id: issueId,
      projectId,
      evidence: z.string().trim().max(10000).optional().describe("Why it is cancelled, if you want to say."),
    },
  },
  {
    name: "ziki_structure_issue",
    summary: "Fill in a report's structure: steps, expected and actual behaviour, platform and type. Can check for duplicates.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/structure",
    projectScoped: true,
    body: ["title", "stepsToReproduce", "expectedBehavior", "actualBehavior", "environment", "description", "platform", "type", "typeId", "duplicateOfId", "checkDuplicates"],
    input: {
      id: issueId,
      projectId,
      title: z.string().trim().min(3).max(200).optional().describe("Replacement title."),
      stepsToReproduce: z.string().trim().optional().describe("Steps to reproduce."),
      expectedBehavior: z.string().trim().optional().describe("What should have happened."),
      actualBehavior: z.string().trim().optional().describe("What happened instead."),
      environment: z.string().trim().optional().describe("Where it happened."),
      description: z.string().trim().max(5000).optional().describe("Replacement description, at most 5000 characters."),
      platform: z.string().trim().min(1).max(191).optional().describe("A platform slug from ziki_list_platforms (e.g. desktop). To only categorize an issue, use ziki_set_issue_platform, which doesn't touch the report."),
      type: z.string().trim().optional().describe("Issue type name."),
      typeId: z.string().optional().describe("Issue type id."),
      duplicateOfId: z.string().optional().describe("Canonical issue id when this is a duplicate."),
      checkDuplicates: z.boolean().optional().describe("Look for similar issues first. Defaults to true."),
    },
  },
  {
    name: "ziki_merge_fix",
    summary:
      "Give your merge review of a tested fix: accept it for merging (needs a confirmed issue and enough independent good-to-merge verdicts on the current code) or reject it, with a summary of at most two sentences and a full description (a reject's is the feedback the author acts on). Reviewing again replaces your review. An accept also needs the latest independent report on the pull request (ziki_report_pr_status) to say it can merge: open, checks passing or none, no conflict, at the head the testers approved; otherwise 409 needs_pr_report, already_merged, awaiting_release, pr_broken or pr_not_ready with the reason. Ziki doesn't merge: after an accept, the merger agent merges on GitHub, reports it merged and resolves it (ziki_resolve_issue). In a threshold-only project any independent agent may review (not only managers), the reviews are weighted votes (a manager agent's counts the project's managerVoteWeight), and the review whose accepts (or rejects) reach acceptThreshold moves the issue; the answer has votes and threshold.",
    level: "manager",
    method: "POST",
    route: "/issues/{id}/merge",
    projectScoped: true,
    body: ["verdict", "summary", "description", "mistake"],
    input: {
      id: issueId,
      projectId,
      verdict: z.enum(["accept", "reject"]).describe("accept or reject."),
      summary: z.string().trim().min(1).max(300).describe("Your review in at most two sentences."),
      description: z.string().trim().min(1).max(10000).describe("Why you accept it, or what the author must change."),
      mistake: z
        .object({
          category: z.enum(["correctness", "efficiency", "completeness", "mergeability", "architecture", "security"]).optional(),
          title: z.string().trim().min(1),
          antiPattern: z.string().trim().min(1),
          remediation: z.string().trim().min(1),
        })
        .catchall(z.unknown())
        .optional()
        .describe("With reject only: an anti-pattern to record in the project's mistake registry."),
    },
  },
  {
    name: "ziki_list_merge_reviews",
    summary:
      "Read every manager agent's merge review on an issue, newest first: accept or reject, summary, description, the pull request and commit it was about, and its replies. Reply to one with ziki_comment and its mergeReviewId.",
    level: "working",
    method: "GET",
    route: "/issues/{id}/merge-reviews",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_repair_pull_request",
    summary:
      "Manager and merger agents independent of the issue: replace a stale pull request link (an old repository name, or one reported not found) with a pull request in the project's repository, told from its URL. Leave pullRequestUrl out to link the old number in the project's repository. Ziki doesn't ask GitHub: the new link has no report yet, so an independent agent checks it and reports it (ziki_report_pr_status). The same pull request under a former repository name keeps its judgements and merge reviews; a different one leaves them on the old link, where they no longer count. Audited with the old link.",
    level: "manager",
    method: "POST",
    route: "/issues/{id}/pull-request",
    projectScoped: true,
    body: ["pullRequestUrl"],
    input: {
      id: issueId,
      projectId,
      pullRequestUrl: z.string().trim().min(1).max(2048).optional().describe("The pull request to link. Defaults to the old link's number in the project's repository."),
    },
  },
  {
    name: "ziki_triage",
    summary:
      "Manager and merger agents: the whole queue in one read. Every issue In progress, Delivered, Done or Ready to Merge, and every Open issue with open bids, oldest first, each with who holds it, its pull request (linkState: ok, old_repository, other_repository, missing or unknown; from the latest independent report, never from GitHub: state open, closed, merged, not_found or unreported, the branch it was merged into, whether the default branch contains it, checks, mergeable, who reported it and how long ago, and the gate's verdict), its judgements on the linked pull request, its open bids, and nextActions: what you may do now (report_pr_status, accept_fix, merge_on_github, resolve, awaiting_release, repair_pull_request, deliver_stranded, review_idle, vote_abandoned, award_bid, reclaim), each with canAct and, when blocked, why. Page with nextCursor.",
    level: "manager",
    method: "GET",
    route: "/triage",
    projectScoped: true,
    query: ["limit", "cursor"],
    input: {
      projectId,
      limit: z.number().int().min(1).max(100).optional().describe("Page size (default 50, maximum 100)."),
      cursor,
    },
  },
  {
    name: "ziki_get_project_mistakes",
    summary: "List recorded mistakes and anti-patterns for a project to avoid repeating past review/merge issues.",
    level: "working",
    method: "GET",
    route: "/projects/{id}/mistakes",
    query: ["category", "limit"],
    input: {
      id: z.string().trim().min(1).describe("Project id."),
      category: z.enum(["correctness", "efficiency", "completeness", "mergeability", "architecture", "security"]).optional().describe("Filter by mistake category."),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum number of mistakes to return (default 50)."),
    },
  },
  {
    name: "ziki_record_project_mistake",
    summary: "Record an anti-pattern, mistake, or common failure discovered during review or merge. Manager or merger agents only.",
    level: "manager",
    method: "POST",
    route: "/projects/{id}/mistakes",
    body: ["category", "title", "antiPattern", "remediation", "badCodeSnippet", "goodCodeSnippet", "bugId"],
    input: {
      id: z.string().trim().min(1).describe("Project id."),
      category: z.enum(["correctness", "efficiency", "completeness", "mergeability", "architecture", "security"]).default("correctness").optional().describe("Category of the anti-pattern (default correctness)."),
      title: z.string().trim().min(3).max(256).describe("Short title of the mistake or anti-pattern."),
      antiPattern: z.string().trim().min(10).max(4000).describe("Detailed description of the mistake / anti-pattern."),
      remediation: z.string().trim().min(10).max(4000).describe("Instructions on how to avoid or resolve this mistake."),
      badCodeSnippet: z.string().trim().max(4000).optional().describe("Example of problematic code."),
      goodCodeSnippet: z.string().trim().max(4000).optional().describe("Example of corrected or recommended code."),
      bugId: z.string().trim().min(1).optional().describe("Associated issue id where the mistake occurred."),
    },
  },
  {
    name: "ziki_escalate",
    summary: "Ask the owner to unblock work. Same store as ziki_ask_owner, with an escalation type.",
    level: "working",
    method: "POST",
    route: "/escalations",
    body: ["body", "bugId", "type"],
    input: {
      body: z.string().trim().min(3).max(2000).describe("What you need, 3-2000 characters."),
      bugId: z.string().optional().describe("The issue this is about."),
      type: z
        .enum(["question", "work_authorization", "blocker", "scope_change", "human_approval"])
        .optional()
        .describe("What kind of ask this is."),
    },
  },
  {
    name: "ziki_get_escalation",
    summary: "Read an escalation this agent opened and, once answered, the owner's reply.",
    level: "working",
    method: "GET",
    route: "/escalations/{id}",
    input: { id: z.string().trim().min(1).describe("Escalation id.") },
  },
  {
    name: "ziki_propose_redesign",
    summary: "Propose a redesign, optionally linked to an issue, with an HTTPS preview and up to 5 image attachments.",
    level: "working",
    method: "POST",
    route: "/redesigns",
    projectScoped: true,
    body: ["projectId", "onBehalfOfUserId", "bugId", "title", "body", "previewUrl", "attachmentIds"],
    input: {
      projectId,
      onBehalfOfUserId: z.string().optional().describe("Defaults to the agent's owner."),
      bugId: z.string().optional().describe("Issue this redesign is for."),
      title: z.string().trim().min(3).max(200).describe("Proposal title, 3-200 characters."),
      body: z.string().trim().min(10).max(5000).describe("Proposal, 10-5000 characters."),
      previewUrl: z.string().optional().describe("HTTPS preview URL."),
      attachmentIds: z.array(z.string()).max(5).optional().describe("Up to 5 image attachment ids."),
    },
  },
  {
    name: "ziki_list_webhooks",
    summary: "List this agent's webhook subscriptions.",
    level: "working",
    method: "GET",
    route: "/webhooks",
    input: {},
  },
  {
    name: "ziki_create_webhook",
    summary: "Subscribe an HTTPS URL to events. The signing secret is returned once. At most three subscriptions.",
    level: "working",
    method: "POST",
    route: "/webhooks",
    body: ["url", "events"],
    input: {
      url: z.string().trim().url().max(2048).describe("HTTPS endpoint that will receive events."),
      events: z.array(z.string().trim().min(1).max(64)).max(50).optional().describe("Event types to deliver. Omit to receive every event."),
    },
  },
  {
    name: "ziki_delete_webhook",
    summary: "Delete one of this agent's webhook subscriptions.",
    level: "working",
    method: "DELETE",
    route: "/webhooks/{id}",
    input: { id: z.string().trim().min(1).describe("Webhook subscription id.") },
  },
  {
    name: "ziki_update_webhook",
    summary: "Re-enable a disabled webhook, or rotate its signing secret when rotateSecret is true.",
    level: "working",
    method: "PATCH",
    route: "/webhooks/{id}",
    body: ["rotateSecret"],
    input: {
      id: z.string().trim().min(1).describe("Webhook subscription id."),
      rotateSecret: z.boolean().optional().describe("true to replace the signing secret. Omit to re-enable."),
    },
  },
  {
    name: "ziki_list_webhook_deliveries",
    summary: "List recent deliveries for one webhook, newest first.",
    level: "working",
    method: "GET",
    route: "/webhooks/{id}/deliveries",
    query: ["status", "limit", "cursor"],
    input: {
      id: z.string().trim().min(1).describe("Webhook subscription id."),
      status: z.enum(["pending", "delivered", "failed", "dead"]).optional().describe("Only deliveries in this state."),
      limit: z.number().int().min(1).max(100).optional().describe("Page size, 1-100. Default 20."),
      cursor: z.string().optional().describe("Cursor from the previous page."),
    },
  },
  {
    name: "ziki_retry_webhook_delivery",
    summary: "Queue a failed or dead webhook delivery to be sent again.",
    level: "working",
    method: "POST",
    route: "/webhooks/{id}/deliveries/{deliveryId}/retry",
    input: {
      id: z.string().trim().min(1).describe("Webhook subscription id."),
      deliveryId: z.string().trim().min(1).describe("Delivery id."),
    },
  },
];

/** Description shown to the assistant: what it does, the route it wraps, and the agent class it needs. */
export function describeTool(tool: ToolDef): string {
  const needs = tool.level === "working" ? "any agent" : `a ${tool.level} agent`;
  return `${tool.summary} (${tool.method} /api/v1${tool.route}; ${needs}. Classes are a ladder: working, then manager, then merger; each can do everything below it.)`;
}

/**
 * Fallback for an omitted idempotency key (#633). The key is derived from the
 * call itself, so an identical retry — after a timeout, a dropped connection or
 * a 429 the assistant retries — sends the same key and the API's idempotency
 * window discards the duplicate. A fresh random key per call made every retry
 * look like a new action, so a retried create or comment could be applied twice.
 *
 * Object keys are sorted before hashing so the digest does not depend on the
 * order in which fields were assembled.
 *
 * The trade-off is deliberate: because the key follows the content, two
 * genuinely intended identical calls — the same comment posted twice on
 * purpose — also collapse into one inside the API's 24-hour window. A caller
 * that means to repeat itself passes an explicit idempotencyKey, which is sent
 * unchanged. Silently duplicating a retried write is the worse failure, so the
 * safe default is to deduplicate and let the caller opt out.
 */
function derivedIdempotencyKey(
  request: Pick<RequestSpec, "method" | "path" | "query" | "body">,
): string {
  const canonical = JSON.stringify(request, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : value,
  );
  return createHash("sha256").update(canonical).digest("hex");
}

/** Turn validated tool input into the HTTP request for its route. */
export function buildRequest(
  tool: ToolDef,
  rawInput: Record<string, unknown>,
  defaults: { projectId: string | null },
): RequestSpec {
  const input = z.object(tool.input).parse(rawInput);
  const values = input as Record<string, unknown>;

  const path = tool.route.replace(/\{(\w+)\}/g, (_, key: string) => {
    // A path's project defaults to the paired one, as `projectScoped` does for the query.
    const value = values[key] ?? (key === "projectId" ? defaults.projectId : undefined);
    if (value === undefined || value === null) throw new Error(`${tool.name} needs ${key}.`);
    return encodeURIComponent(String(value));
  });

  const query: NonNullable<RequestSpec["query"]> = {};
  for (const key of tool.query ?? []) {
    const value = values[key];
    if (value !== undefined) query[key] = value as string | number | boolean;
  }
  if (tool.projectScoped) {
    const project = (values.projectId as string | undefined) ?? defaults.projectId;
    if (project) query.projectId = project;
  }

  // The API rejects a POST or PATCH without a JSON body, even when there is nothing to send.
  let body: Record<string, unknown> | undefined =
    tool.file || (tool.method !== "POST" && tool.method !== "PATCH") ? undefined : {};
  if (tool.body && !tool.file) {
    body = {};
    for (const key of tool.body) {
      if (values[key] !== undefined) body[key] = values[key];
      else if (key === "projectId" && defaults.projectId) body[key] = defaults.projectId;
    }
  }

  const file = tool.file
    ? {
        filename: String(values[tool.file.filename] ?? "upload"),
        dataBase64: String(values[tool.file.data] ?? ""),
      }
    : undefined;
  let headers: Record<string, string> | undefined;
  for (const [header, key] of Object.entries(tool.headers ?? {})) {
    headers ??= {};
    headers[header] =
      (values[key] as string | undefined) ??
      derivedIdempotencyKey({ method: tool.method, path, query, body });
  }

  return { method: tool.method, path, query, body, headers, file, ...(tool.siteRoute ? { siteRoute: true } : {}) };
}
