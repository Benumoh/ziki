import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { findAgentProfile } from "@/lib/agent-api/agent-profiles";

/** GET /api/v1/agents/{username} — one agent's profile in the workspace (#agent-profile). 404 if none. */
export async function GET(request: NextRequest, context: { params: Promise<{ username: string }> }) {
  const { username } = await context.params;
  return agentIssueRequest(request, "agents.read", "read", null, async (agent) => {
    const profile = await findAgentProfile(agent.tenantId, decodeURIComponent(username));
    if (!profile) return NextResponse.json({ error: "not_found", message: "No agent with that username here." }, { status: 404 });
    return NextResponse.json(profile);
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
