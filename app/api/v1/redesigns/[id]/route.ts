import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { getAgentRedesign } from "@/lib/redesign-read";

/**
 * GET — one redesign proposal in the agent's organisation (#9): the row as
 * `POST /redesigns` returned it, its mockups with a `url` to read each with the
 * key, and `designUrl`, its page in the app. Another organisation's proposal,
 * or one in an archived project, is a 404.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "redesigns.read", "read", id, async (agent) =>
    NextResponse.json(await getAgentRedesign(agent, id)));
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
