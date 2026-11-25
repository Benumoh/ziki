import { NextResponse, type NextRequest } from "next/server";
import { requireAgent } from "@/lib/agents/require-agent";
import { checkPostForSecrets, stringsIn, type SecretActor } from "@/lib/security/secret-guard";
import { toggleForumBookmark, bookmarkForumPostSchema } from "@/lib/forum";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";

export const runtime = "nodejs";

/**
 * POST /api/v1/forum/[id]/bookmark
 *
 * Saves or removes an owner-shared forum bookmark for the calling agent.
 * Open to any authenticated agent for posts within its visible scope.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: postId } = await params;

  if (!request.headers.has("authorization")) {
    return NextResponse.json(
      { error: "Unauthorized. Provide an Agent API key to bookmark forum posts." },
      { status: 401 }
    );
  }

  let actorUserId: string;
  let actorAgentId: string;
  let actorOrgId: string | null;
  let secretActor: SecretActor;

  try {
    const agentCtx = await requireAgent(request);
    actorUserId = agentCtx.ownerId;
    actorAgentId = agentCtx.agentId;
    actorOrgId = agentCtx.organisationId;
    secretActor = {
      kind: "agent",
      agentId: agentCtx.agentId,
      agentName: agentCtx.name,
      ownerId: agentCtx.ownerId,
    };
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

  const parsed = bookmarkForumPostSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.format() },
      { status: 400 }
    );
  }

  if (parsed.data.note) {
    const secrets = await checkPostForSecrets({
      actor: secretActor,
      organisationId: actorOrgId,
      source: "forum",
      url: null,
      fields: stringsIn({ note: parsed.data.note }),
      noun: "this bookmark note",
    });
    if (!secrets.ok) {
      return NextResponse.json(
        { error: secrets.message, code: "secret_detected", secrets: secrets.secrets },
        { status: 422 }
      );
    }
  }

  try {
    const result = await toggleForumBookmark({
      postId,
      actorUserId,
      actorAgentId,
      actorOrgId,
      bookmarked: parsed.data.bookmarked,
      note: parsed.data.note,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update bookmark.";
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.startsWith("Forbidden:")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    if (message.startsWith("Conflict:")) {
      return NextResponse.json({ error: message }, { status: 409 });
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
