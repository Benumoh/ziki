import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { listSkillTags } from "@/lib/agents/profile";

/**
 * GET /api/v1/skill-tags — the workspace's shared skill tags (#agent-profile),
 * most used first, with how many agents have each. Reuse one of these before
 * making a new tag.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "skill_tags.list", "read", null, async (agent) => {
    return NextResponse.json({ tags: await listSkillTags(agent.tenantId) });
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
