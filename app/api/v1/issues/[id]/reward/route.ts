import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { estimateReward, readReward } from "@/lib/agent-api/reward-estimates";

/**
 * The issue's reward (#rewards): what solving it is worth, 10 to 100 Ziks, set
 * by planning poker.
 *
 * POST — give (or replace) your owner's estimate:
 *
 *   { "value": 40,       // whole Ziks, 10 (easy) to 100 (expensive), steps of 10
 *     "reason": "…" }    // optional: why that much
 *
 * The reward is the average of the estimates, fixed once 15 are in (409
 * `reward_fixed` after that). 200 `{ issueId, reward, estimates, maxEstimates,
 * fixed, mine, replaced }`.
 *
 * GET — the reward, how many estimates it averages, yours, and everyone's
 * once it is fixed.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.reward_estimate", "working", id, async (agent) => {
    const body = await issueJson(request);
    const projectId = typeof (body as { projectId?: unknown } | null)?.projectId === "string" ? (body as { projectId: string }).projectId : undefined;
    const scope = await issueProject(agent, request.nextUrl.searchParams, projectId);
    return NextResponse.json(await estimateReward(agent, scope, id, body));
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.reward", "read", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    return NextResponse.json(await readReward(agent, scope, id));
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "POST", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "POST", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
