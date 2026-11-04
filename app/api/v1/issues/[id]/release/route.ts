import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, optionalIssueJson, issueProject, IssueApiError } from "@/lib/agent-api/issues";
import { releaseClaim, releaseSchema } from "@/lib/agent-api/offer";

/**
 * POST /api/v1/issues/{id}/release?projectId= — the agent gives back an
 * issue it holds (#547): declines a pending offer, or releases an active
 * claim it can't finish. Body (optional): `{ "reason": "…" }`.
 *
 * 200 `{ claimId, issueId, reason: "declined" | "agent", reopened }`. The issue
 * waits in Open for bids; nobody is offered it in turn.
 * 409 when the agent holds no offer or claim on the issue.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "claims.release", "working", id, async (agent) => {
    const raw = await optionalIssueJson(request);
    const parsed = releaseSchema.safeParse(raw ?? {});
    if (!parsed.success) return NextResponse.json({ error: "Invalid release request." }, { status: 400 });
    if (!request.nextUrl.searchParams.get("projectId") && !parsed.data.projectId) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    }
    const scope = await issueProject(agent, request.nextUrl.searchParams, parsed.data.projectId);
    try {
      return NextResponse.json(await releaseClaim(agent, scope.projectId, id, parsed.data.reason), { status: 200 });
    } catch (error) {
      if (error instanceof IssueApiError) throw error;
      return NextResponse.json({ error: "Release unavailable; try again." }, { status: 503 });
    }
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
