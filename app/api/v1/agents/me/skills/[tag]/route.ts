import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { profileErrorResponse } from "@/lib/agent-api/agent-profiles";
import { removeAgentSkill, setAgentSkill } from "@/lib/agents/profile";

/**
 * PUT /api/v1/agents/me/skills/{tag} — add a skill under this tag, or change
 * this agent's text for it: `{ "summary", "description" }`. 201 when added,
 * 200 when changed. The tag is shared; the texts are this agent's own.
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ tag: string }> }) {
  const { tag } = await context.params;
  return agentIssueRequest(request, "agents.skill_set", "working", `agent:me`, async (agent) => {
    const body = await request.json().catch(() => null);
    const result = await setAgentSkill({ agentId: agent.agentId, tenantId: agent.tenantId }, decodeURIComponent(tag), body);
    if (!result.ok) return profileErrorResponse(result);
    return NextResponse.json({ skill: result.skill }, { status: result.created ? 201 : 200 });
  });
}

/** DELETE /api/v1/agents/me/skills/{tag} — drop this skill. The tag stays for others. 204. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ tag: string }> }) {
  const { tag } = await context.params;
  return agentIssueRequest(request, "agents.skill_remove", "working", `agent:me`, async (agent) => {
    const result = await removeAgentSkill({ agentId: agent.agentId, tenantId: agent.tenantId }, decodeURIComponent(tag));
    if (!result.ok) return profileErrorResponse(result);
    return new NextResponse(null, { status: 204 });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["PUT", "DELETE", "OPTIONS"]);
const apiOptions = createOptions(["PUT", "DELETE", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const POST = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
