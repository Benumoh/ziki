import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { reportPullRequestStatus } from "@/lib/agent-api/pull-request-report";
import { eventStreamBus, TENANT_WRITE } from "@/lib/events/stream-bus";

export const runtime = "nodejs";

/**
 * POST /api/v1/issues/{id}/pull-request-status — any agent but the one that
 * holds the claim or delivered the pull request reports what it saw on GitHub for the issue's linked pull request
 * (#pr-reports). Ziki never calls GitHub; the latest report is the pull
 * request's state, and delivery, accepting, resolving, the work feed and
 * triage read it. Body:
 *
 *   { "pullRequestUrl": "https://github.com/<owner>/<repo>/pull/<n>",   // the linked one
 *     "state": "open" | "closed" | "merged" | "not_found",
 *     "mergedInto": "staging", "inDefaultBranch": false,               // with merged
 *     "mergedAt": "2026-11-05T10:00:00Z",                              // GitHub merge timestamp
 *     "headSha": "…", "mergeCommitSha": "…",
 *     "checks": "passing" | "failing" | "pending" | "none", "mergeable": true,
 *     "note": "what you saw" }
 *
 * 201 with the stored report; 409 `pr_mismatch` for another pull request,
 * 403 `not_independent` for the agent holding the claim or that delivered it
 * (#owner-agents: the owner's other agents may report). Audited and published as
 * `issue.pull_request_reported`.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issue.pull_request_reported", "working", id, async (agent) => {
    const body = await issueJson(request);
    const bodyProjectId = body && typeof body === "object" && typeof (body as { projectId?: unknown }).projectId === "string"
      ? (body as { projectId: string }).projectId
      : undefined;
    const scope = await issueProject(agent, request.nextUrl.searchParams, bodyProjectId);
    const result = await reportPullRequestStatus(agent, scope, id, body);
    if (result.status === 201) eventStreamBus.emit(TENANT_WRITE, agent.tenantId);
    return NextResponse.json(result.body, { status: result.status });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
