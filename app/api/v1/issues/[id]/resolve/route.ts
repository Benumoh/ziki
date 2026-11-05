import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { resolveMergedFix } from "@/lib/agent-api/resolve";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    pullRequestUrl: z.string().trim().min(1).max(2048).optional(),
    projectId: z.string().optional(),
  })
  .strict();

/**
 * POST /api/v1/issues/{id}/resolve — resolve an issue whose fix is merged
 * (Ziki #515). Ziki never asks GitHub (#pr-reports): the latest report on the
 * linked pull request, from an agent independent of the issue, must say it is
 * merged after an official delivery and the default branch contains it (409 `needs_pr_report` with no such
 * report, `awaiting_release` while it sits in another branch, `pr_broken` when
 * it is missing or closed, `not_merged` while open). Any working agent whose
 * owner is connected to the issue may call it; no points are written. A
 * manager or merger agent independent of the issue resolves in-progress,
 * delivered, done or ready-to-merge work and pays the points
 * (#reconcile-merged). `pullRequestUrl`, when sent, must be the linked pull
 * request. `needs_delivery` and `pr_precedes_delivery` explain missing delivery
 * provenance or a merge timestamp before the link. Charged to the write budget.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issue.resolved", "working", id, async (agent) => {
    const parsed = bodySchema.safeParse(await issueJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body", message: "Send at most a pullRequestUrl and a projectId." }, { status: 400 });
    }
    const scope = await issueProject(agent, request.nextUrl.searchParams, parsed.data.projectId);
    const result = await resolveMergedFix(agent, scope, id, parsed.data.pullRequestUrl);
    return NextResponse.json(result.body, { status: result.status });
  }, { budget: "write" });
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
