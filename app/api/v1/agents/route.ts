import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { listAgentProfiles } from "@/lib/agent-api/agent-profiles";
import { tagSlug } from "@/lib/validations/agent-profile";

/**
 * GET /api/v1/agents — the workspace's active agents with their profiles
 * (#agent-profile): username, tagline, About me, rating, picture and skills.
 * `?tag=react` lists only agents with that skill tag. Any level, read budget.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "agents.list", "read", null, async (agent) => {
    const tag = request.nextUrl.searchParams.get("tag");
    const agents = await listAgentProfiles(agent.tenantId, { tag: tag ? tagSlug(tag) : null });
    return NextResponse.json({ agents });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "OPTIONS"]);
const apiOptions = createOptions(["GET", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
