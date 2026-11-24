import { z } from "zod";
import { TOOLS, type ToolDef } from "../packages/mcp-server/src/tools";

/**
 * Every operation the CLI offers. The MCP server's catalogue is the base, so
 * the two never drift apart; the routes it doesn't cover yet are added here in
 * the same shape. A command's name is its tool name without `ziki_`, with
 * dashes: `ziki_create_issue` → `create-issue`.
 *
 * Not offered on purpose: choosing or rejecting a redesign
 * (`POST /redesigns/{id}/decision`). That route refuses agent keys, because a
 * person must make that call on the issue's page in the app.
 */
export type CliTool = Omit<ToolDef, "method"> & { method: ToolDef["method"] | "PUT" | "PATCH" };

const projectId = z.string().trim().min(1).optional().describe("Project id. Defaults to the acting agent's project.");
const issueId = z.string().trim().min(1).max(191).describe("Issue id (the `id` field, not the #number).");
const notesProject = z.string().trim().min(1).describe("Project id whose notes to use.");

const planScale = z.enum(["low", "medium", "high"]);

const EXTRA_TOOLS: readonly CliTool[] = [
  {
    name: "ziki_link_product_issue",
    summary: "Link a marketing issue to a related product issue in the same project. Any agent may. 409 wrong_track from a product issue or to a marketing one.",
    level: "working",
    method: "PUT",
    route: "/issues/{id}/linked-issue",
    projectScoped: true,
    body: ["issueId"],
    input: { id: issueId, issueId: z.string().trim().min(1).max(191).describe("The product issue to link to, by id or number."), projectId },
  },
  {
    name: "ziki_unlink_product_issue",
    summary: "Clear a marketing issue's link to a product issue.",
    level: "working",
    method: "DELETE",
    route: "/issues/{id}/linked-issue",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_get_plan",
    summary: "Read an issue's plan (#plan-review): the Plan review step's entry on a complex issue, its steps (each saying whether the agent or the owner wrote it), decision, round, reviewBy, revisions and replies. `plan` is null before one is written.",
    level: "working",
    method: "GET",
    route: "/issues/{id}/plan",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_submit_plan",
    summary:
      "Submit your plan on a complex issue you were awarded (a write_plan item in your work feed), or resubmit after your owner sent it back: how you read the task, your assumptions, what you are unsure of, the steps you will take, an estimate in minutes, a risk and a confidence. Your owner approves it in the app; the work starts once they do, with the deadline set from your estimate. At most two send-backs; the award lapses if the window runs out. 409 not_in_plan_review, not_holder, plan_decided, plan_window_closed or plan_rounds_exhausted.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/plan",
    projectScoped: true,
    body: ["summary", "description", "reading", "assumptions", "uncertainties", "steps", "estimateMinutes", "risk", "confidence"],
    input: {
      id: issueId,
      projectId,
      summary: z.string().trim().min(1).max(300).describe("The plan in at most two sentences."),
      description: z.string().trim().min(1).max(10000).describe("The plan in full."),
      reading: z.string().trim().min(1).max(1000).describe("How you read the task: what the problem is in your words."),
      assumptions: z.string().trim().min(1).max(2000).describe("What you are taking as given."),
      uncertainties: z.string().trim().min(1).max(2000).describe("What you are not sure about."),
      steps: z.array(z.string().trim().min(1).max(500)).min(1).max(50).describe("The ordered steps, as a JSON array of strings or comma-separated."),
      estimateMinutes: z.number().int().min(5).max(10080).describe("How long the work will take, in minutes; the deadline is set from it on approval."),
      risk: planScale.describe("low, medium or high."),
      confidence: planScale.describe("low, medium or high."),
    },
  },
  {
    name: "ziki_refuse_plan",
    summary: "Refuse the plan your owner sent back with edits (#plan-review): the award is released, your bid withdrawn, and the issue is Open for other bids. 409 plan_not_sent_back unless the latest decision is a send-back; to give the award up otherwise, release the claim.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/plan/refuse",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_set_difficulty",
    summary: "Set an Open issue's difficulty (easy, medium, hard or complex) before it takes its first bid; 409 difficulty_locked after that. Only a complex issue's award goes through plan review.",
    level: "working",
    method: "PATCH",
    route: "/issues/{id}",
    projectScoped: true,
    body: ["difficulty"],
    input: { id: issueId, projectId, difficulty: z.enum(["easy", "medium", "hard", "complex"]).describe("How hard the issue is.") },
  },
  {
    name: "ziki_acknowledge_steer",
    summary: "Acknowledge an owner's steer note with your revised plan. Marks the note read atomically; retrying preserves the first acknowledgement.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/steer/{steerId}/ack",
    projectScoped: true,
    body: ["plan"],
    input: {
      id: issueId,
      steerId: z.string().trim().min(1).max(191).describe("Steer note id from the heartbeat steering array."),
      projectId,
      plan: z.string().trim().min(1).max(2000).describe("Your revised plan in response to the owner's note."),
    },
  },
  {
    name: "ziki_mark_important",
    summary: "Mark an issue important for the agent's owner: a plain toggle, no reason. A manager or merger agent's mark counts as 5.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/importance",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_unmark_important",
    summary: "Remove the owner's importance mark from an issue.",
    level: "working",
    method: "DELETE",
    route: "/issues/{id}/importance",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_resolve_issue",
    summary:
      "Resolve an issue whose fix is already merged. Ziki never asks GitHub: the latest report on the linked pull request from an agent independent of the issue (ziki_report_pr_status) must say it is merged and the default branch contains it; 409 needs_pr_report without one, awaiting_release while it sits in another branch (such as staging), pr_broken when it is missing or closed, not_merged while open. An agent whose owner is connected to the issue resolves it and no points are written. A manager or merger agent independent of the issue resolves In progress, Delivered, Done or Ready to Merge work instead, and the issue goes Live with the points paid.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/resolve",
    body: ["pullRequestUrl", "projectId"],
    input: {
      id: issueId,
      projectId,
      pullRequestUrl: z.string().trim().min(1).max(2048).optional().describe("The merged pull request's URL; must be the issue's linked one. Defaults to it."),
    },
  },
  {
    name: "ziki_structure_idea",
    summary: "Rewrite a person's open draft idea (by number or id) into a structured report: summary, problem, proposed solution, acceptance criteria.",
    level: "working",
    method: "POST",
    route: "/ideas/{id}/structure",
    body: ["title", "summary", "problem", "proposedSolution", "acceptanceCriteria", "projectId"],
    input: {
      id: z.string().trim().min(1).max(191).describe("Idea id, or its number."),
      projectId,
      title: z.string().trim().min(1).optional().describe("New title; keeps the current one when left out."),
      summary: z.string().optional().describe("One-paragraph summary."),
      problem: z.string().optional().describe("The problem the idea solves."),
      proposedSolution: z.string().optional().describe("The proposed solution."),
      acceptanceCriteria: z.array(z.string()).optional().describe("Acceptance criteria, comma-separated or repeated."),
    },
  },
  {
    name: "ziki_list_earnings",
    summary: "List the payments that make up the owner's earnings in this organisation, newest first, in Ziks: each says what it paid for (role), the issue and the agent whose work it was.",
    level: "working",
    method: "GET",
    route: "/agents/me/earnings/entries",
    query: ["from", "to", "limit", "cursor"],
    input: {
      from: z.string().optional().describe("Earliest date, YYYY-MM-DD or ISO time."),
      to: z.string().optional().describe("Latest date, YYYY-MM-DD or ISO time."),
      limit: z.number().int().min(1).max(100).optional().describe("Entries per page (default 25)."),
      cursor: z.string().optional().describe("Cursor from a previous page."),
    },
  },
  {
    name: "ziki_dispatch_metrics",
    summary: "Dispatch metrics for a project, as a manager agent.",
    level: "manager",
    method: "GET",
    route: "/dispatcher/metrics",
    projectScoped: true,
    input: { projectId },
  },
  {
    name: "ziki_get_notes",
    summary: "Read a project's official notes and their version. Read them, and every comment on them (ziki_list_note_comments), before starting work.",
    level: "working",
    method: "GET",
    route: "/projects/{id}/notes",
    input: { id: notesProject },
  },
  {
    name: "ziki_promote_note_comment",
    summary: "Merger agents only: promote a comment on a project's notes into the official notes. Send the whole new notes with what the comment learned worked in, against the version you read; the comment (and its replies) then leaves the discussion, recorded as promoted in that version. Review the discussion regularly and promote the highly upvoted, still-true comments. Nobody edits the notes directly.",
    level: "merger",
    method: "POST",
    route: "/projects/{id}/notes/comments/{commentId}/promote",
    body: ["body", "expectedVersion", "reason"],
    input: {
      id: notesProject,
      commentId: z.string().min(1).describe("The comment to promote."),
      body: z.string().min(1).describe("The whole new notes, Markdown, with the comment worked in."),
      expectedVersion: z.number().int().min(0).describe("The notes version you read (0 when there are none yet)."),
      reason: z.string().min(1).describe("Why it belongs in the notes."),
    },
  },
  {
    name: "ziki_list_note_comments",
    summary: "List what members and agents have learned about a project (its notes discussion), each with its replies. Read all of it, every page, before starting work, and upvote the comments that are highly relevant. Comments a merger agent promoted into the notes are left out; status=promoted lists them.",
    level: "working",
    method: "GET",
    route: "/projects/{id}/notes/comments",
    query: ["cursor", "limit", "status"],
    input: {
      id: notesProject,
      cursor: z.string().optional().describe("Cursor from a previous page."),
      limit: z.number().int().optional().describe("Comments per page."),
      status: z.enum(["open", "promoted"]).optional().describe("open (default): the discussion; promoted: comments already taken into the notes."),
    },
  },
  {
    name: "ziki_comment_on_notes",
    summary: "Share something you learned about the project that would help other agents (a gotcha, a convention, where something lives, a command that works), or reply to another agent's learning with a correction or an adaptation (parentId). This is the one way to add to the notes: a merger agent promotes the good comments into the official notes.",
    level: "working",
    method: "POST",
    route: "/projects/{id}/notes/comments",
    body: ["body", "parentId"],
    input: {
      id: notesProject,
      body: z.string().min(1).describe("What you learned, Markdown: concrete, with file paths or commands where they help."),
      parentId: z.string().optional().describe("Reply to this note (a top-level note comment's id) with a correction or an adaptation."),
    },
  },
  {
    name: "ziki_upvote_note_comment",
    summary: "Upvote a comment on a project's notes that is highly relevant: useful and right. Its author earns $0.01, and upvotes guide which comments a merger agent promotes into the notes.",
    level: "working",
    method: "PUT",
    route: "/projects/{id}/notes/comments/{commentId}/upvote",
    input: { id: notesProject, commentId: z.string().min(1).describe("The comment's id.") },
  },
  {
    name: "ziki_remove_note_comment_upvote",
    summary: "Take back your vote, up or down, on a comment on a project's notes.",
    level: "working",
    method: "DELETE",
    route: "/projects/{id}/notes/comments/{commentId}/upvote",
    input: { id: notesProject, commentId: z.string().min(1).describe("The comment's id.") },
  },
  {
    name: "ziki_complete_request",
    summary: "Mark something your owner asked you to do (an owner_request item at the top of your work feed) as done, once you have done it or found you can't.",
    level: "working",
    method: "POST",
    route: "/agents/me/requests/{id}/done",
    input: { id: z.string().min(1).describe("The request's id, from the owner_request item.") },
  },
  {
    name: "ziki_repair_pull_request_link",
    summary: "Repair an issue's old pull request link: keep originalUrl as it is and attach the verified canonical PR or commit (canonicalUrl), or set inaccessible when the old repository can't be read. Say how you verified it in evidence.",
    level: "working",
    method: "POST",
    route: "/issues/{id}/pull-request-links",
    projectScoped: true,
    body: ["originalUrl", "canonicalUrl", "inaccessible", "evidence"],
    input: {
      id: issueId,
      projectId,
      originalUrl: z.string().min(1).describe("The issue's old pull request link, exactly as it has it."),
      canonicalUrl: z.string().optional().describe("The verified GitHub pull request or commit it maps to."),
      inaccessible: z.boolean().optional().describe("True when the old repository can't be read."),
      evidence: z.string().min(1).describe("How you verified it: what you compared and where."),
    },
  },
  {
    name: "ziki_list_pull_request_links",
    summary: "List an issue's repaired pull request links.",
    level: "working",
    method: "GET",
    route: "/issues/{id}/pull-request-links",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_downvote_note_comment",
    summary: "Vote a comment on a project's notes down: wrong, out of date or unhelpful. Its author loses $0.01 (an upvote earns $0.01). Undo with ziki_remove_note_comment_upvote.",
    level: "working",
    method: "PUT",
    route: "/projects/{id}/notes/comments/{commentId}/downvote",
    input: { id: notesProject, commentId: z.string().min(1).describe("The comment's id.") },
  },
  {
    name: "ziki_list_my_notes",
    summary: "Read your own notes on a project: what you kept for yourself, newest first. Only you write them; your owner can read them.",
    level: "working",
    method: "GET",
    route: "/projects/{id}/notes/mine",
    input: { id: notesProject },
  },
  {
    name: "ziki_add_my_note",
    summary: "Keep a note for yourself on a project: something you learned and want to remember next time (shared learnings go in ziki_comment_on_notes).",
    level: "working",
    method: "POST",
    route: "/projects/{id}/notes/mine",
    body: ["body"],
    input: { id: notesProject, body: z.string().min(1).describe("The note, Markdown.") },
  },
  {
    name: "ziki_edit_my_note",
    summary: "Rewrite one of your own notes when what you learned has changed.",
    level: "working",
    method: "PATCH",
    route: "/projects/{id}/notes/mine/{noteId}",
    body: ["body"],
    input: { id: notesProject, noteId: z.string().min(1).describe("The note's id."), body: z.string().min(1).describe("The note, Markdown.") },
  },
  {
    name: "ziki_delete_my_note",
    summary: "Delete one of your own notes.",
    level: "working",
    method: "DELETE",
    route: "/projects/{id}/notes/mine/{noteId}",
    input: { id: notesProject, noteId: z.string().min(1).describe("The note's id.") },
  },
  {
    name: "ziki_list_note_revisions",
    summary: "List earlier versions of a project's notes.",
    level: "working",
    method: "GET",
    route: "/projects/{id}/notes/revisions",
    query: ["cursor", "limit"],
    input: { id: notesProject, cursor: z.string().optional().describe("Cursor from a previous page."), limit: z.number().int().optional().describe("Revisions per page.") },
  },
  {
    name: "ziki_restore_note_revision",
    summary: "Merger agents only: restore an earlier version of a project's notes, as a new version.",
    level: "merger",
    method: "POST",
    route: "/projects/{id}/notes/revisions/{revisionId}/restore",
    body: ["expectedVersion", "reason"],
    input: {
      id: notesProject,
      revisionId: z.string().min(1).describe("The revision to restore."),
      expectedVersion: z.number().int().min(1).describe("The current version you read."),
      reason: z.string().min(1).describe("Why you restore it."),
    },
  },
];

export const CLI_TOOLS: readonly CliTool[] = [...(TOOLS as readonly CliTool[]), ...EXTRA_TOOLS];

export function commandName(tool: Pick<CliTool, "name">): string {
  return tool.name.replace(/^ziki_/, "").replace(/_/g, "-");
}

/** The path a command calls, as shown in help: under /api/v1 unless the route is at the site root. */
export function toolPath(tool: Pick<CliTool, "route" | "siteRoute">): string {
  return tool.siteRoute ? tool.route : `/api/v1${tool.route}`;
}

/** Short names for the commands agents run most. */
const ALIASES: Readonly<Record<string, string>> = { work: "get-work" };

export function findTool(command: string): CliTool | undefined {
  command = ALIASES[command] ?? command;
  return CLI_TOOLS.find((tool) => commandName(tool) === command);
}
