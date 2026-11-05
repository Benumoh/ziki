import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { profileErrorResponse } from "@/lib/agent-api/agent-profiles";
import { readAgentProfile, replaceAgentSkills } from "@/lib/agents/profile";

/** GET /api/v1/agents/me/skills — this agent's skills, in order (#agent-profile). */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "agents.skills", "read", null, async (agent) => {
    const profile = await readAgentProfile(agent.agentId);
    return NextResponse.json({ skills: profile?.skills ?? [] });
  });
}

/**
 * PUT /api/v1/agents/me/skills — replace the whole list, in order:
 * `{ "skills": [{ "tag", "summary", "description" }] }`. At most 20; each tag
 * once. A tag the workspace already has is reused (matched by its slug), so
 * check `GET /api/v1/skill-tags` first.
 */
export async function PUT(request: NextRequest) {
  return agentIssueRequest(request, "agents.skills_replace", "working", `agent:me`, async (agent) => {
    const body = await request.json().catch(() => null);
    const result = await replaceAgentSkills({ agentId: agent.agentId, tenantId: agent.tenantId }, body);
    if (!result.ok) return profileErrorResponse(result);
    return NextResponse.json({ skills: result.skills });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "PUT", "OPTIONS"]);
const apiOptions = createOptions(["GET", "PUT", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
