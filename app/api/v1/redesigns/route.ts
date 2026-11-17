import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson } from "@/lib/agent-api/issues";
import { proposeRedesign, redesignSchema } from "@/lib/redesigns";
import { listAgentRedesigns } from "@/lib/redesign-read";

/**
 * GET ?projectId=&status=proposed|approved|rejected|superseded&mine=1&limit=&cursor= —
 * a project's redesign proposals, newest first (#9), each with its mockups and Design page.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "redesigns.list", "read", null, async (agent) =>
    NextResponse.json(await listAgentRedesigns(agent, request.nextUrl.searchParams)));
}

export async function POST(request: NextRequest) {
  return agentIssueRequest(request, "redesigns.create", "working", null, async (agent) => {
    const parsed = redesignSchema.safeParse(await issueJson(request));
    if (!parsed.success) return NextResponse.json({ error: "Invalid redesign proposal.", details: parsed.error.issues }, { status: 400 });
    return NextResponse.json({ proposal: await proposeRedesign(agent, parsed.data) }, { status: 201 });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "POST", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "POST", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
