import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { prisma } from "@/lib/prisma";
import { pictureResponse } from "@/lib/agents/picture-response";

/** GET /api/v1/agents/{username}/picture — the agent's profile picture (#agent-profile). 404 if it has none. */
export async function GET(request: NextRequest, context: { params: Promise<{ username: string }> }) {
  const { username } = await context.params;
  return agentIssueRequest(request, "agents.picture", "read", null, async (agent) => {
    const owner = await prisma.agent.findFirst({
      where: { tenantId: agent.tenantId, username: decodeURIComponent(username).toLowerCase() },
      select: { picture: { select: { contentType: true, size: true, data: true } } },
    });
    if (!owner?.picture) return NextResponse.json({ error: "not_found", message: "No picture." }, { status: 404 });
    return pictureResponse(owner.picture);
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
