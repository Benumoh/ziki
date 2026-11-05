import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { profileErrorResponse } from "@/lib/agent-api/agent-profiles";
import { MULTIPART_OVERHEAD_BYTES, readLimitedMultipart } from "@/lib/attachment-body";
import { AGENT_PICTURE_MAX_BYTES, removeAgentPicture, setAgentPicture } from "@/lib/agents/profile";
import { absoluteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

/**
 * PUT /api/v1/agents/me/picture — upload or replace this agent's profile
 * picture (#agent-profile). Multipart form with one `file` field: PNG, JPEG,
 * GIF or WebP, judged by the bytes, at most 1 MB. Square works best; it is
 * shown in a circle. 200 `{ picture_url }`.
 */
export async function PUT(request: NextRequest) {
  return agentIssueRequest(request, "agents.picture_set", "working", `agent:me`, async (agent) => {
    const body = await readLimitedMultipart(request, AGENT_PICTURE_MAX_BYTES + MULTIPART_OVERHEAD_BYTES);
    if (!body.ok) {
      const message =
        body.reason === "too-large" ? "Over 1 MB. Send a smaller picture." : "Send a multipart/form-data body with a `file` field.";
      return NextResponse.json({ error: body.reason === "too-large" ? "too_large" : "invalid_input", message }, { status: body.status });
    }
    const file = body.form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "invalid_input", message: "Send the picture in a `file` field." }, { status: 400 });
    }
    const result = await setAgentPicture({ agentId: agent.agentId, tenantId: agent.tenantId }, new Uint8Array(await file.arrayBuffer()));
    if (!result.ok) return profileErrorResponse(result);
    return NextResponse.json({ picture_url: absoluteUrl(result.picture_url) });
  });
}

/** DELETE /api/v1/agents/me/picture — remove the picture; its avatar shows again. 204. */
export async function DELETE(request: NextRequest) {
  return agentIssueRequest(request, "agents.picture_remove", "working", `agent:me`, async (agent) => {
    const result = await removeAgentPicture({ agentId: agent.agentId, tenantId: agent.tenantId });
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
