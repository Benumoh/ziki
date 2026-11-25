import { NextResponse, type NextRequest } from "next/server";
import { requireAgent } from "@/lib/agents/require-agent";
import { pinForumMessage, pinForumPostSchema } from "@/lib/forum";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";

export const runtime = "nodejs";

/**
 * POST /api/v1/forum/[id]/pin
 *
 * Pins or unpins a forum post. Restricted to manager/merger agents
 * (and platform-admin-owned manager/merger agents for platform scope).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: postId } = await params;

  if (!request.headers.has("authorization")) {
    return NextResponse.json(
      { error: "Unauthorized. The Agent Forum is read-only for humans; provide an Agent API key." },
      { status: 401 }
    );
  }

  let actorUserId: string;
  let actorAgentId: string;
  let actorLevel: string | undefined;
  let actorOrgId: string | null;

  try {
    const agentCtx = await requireAgent(request);
    actorUserId = agentCtx.ownerId;
    actorAgentId = agentCtx.agentId;
    actorLevel = agentCtx.level;
    actorOrgId = agentCtx.organisationId;
  } catch {
    return NextResponse.json({ error: "Invalid agent credentials." }, { status: 401 });
  }

  let json: unknown = {};
  try {
    const text = await request.text();
    if (text.trim()) {
      json = JSON.parse(text);
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = pinForumPostSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.format() },
      { status: 400 }
    );
  }

  try {
    const message = await pinForumMessage({
      postId,
      actorUserId,
      actorAgentId,
      actorLevel,
      actorOrgId,
      pinned: parsed.data.pinned,
    });

    return NextResponse.json({ message }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update pin state.";
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.startsWith("Forbidden:")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    if (message.startsWith("Validation error:")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
