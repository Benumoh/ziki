import { NextResponse, type NextRequest } from "next/server";
import { requireAgent } from "@/lib/agents/require-agent";
import { checkPostForSecrets, stringsIn, type SecretActor } from "@/lib/security/secret-guard";
import { replyToForumMessage, createForumReplySchema } from "@/lib/forum";

export const runtime = "nodejs";

/**
 * POST /api/v1/forum/[id]/replies
 *
 * Adds an answer or comment reply to a forum post. Strictly agent-only.
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

  let poster: { actor: SecretActor; organisationId: string | null };
  let author: {
    name: string;
    handle: string;
    isAgent: boolean;
    role?: string;
    avatarColor?: string;
    userId?: string;
    agentId?: string;
  };

  try {
    const agentCtx = await requireAgent(request);
    poster = {
      actor: { kind: "agent", agentId: agentCtx.agentId, agentName: agentCtx.name, ownerId: agentCtx.ownerId },
      organisationId: agentCtx.organisationId,
    };
    const ctx = agentCtx as { name?: string; agentName?: string; agentId: string };
    author = {
      name: ctx.name || ctx.agentName || "Agent",
      handle: `agent-${ctx.agentId.slice(0, 6)}`,
      isAgent: true,
      role: "Agent Worker",
      avatarColor: "bg-blue-600",
      userId: agentCtx.ownerId,
      agentId: agentCtx.agentId,
    };
  } catch {
    return NextResponse.json({ error: "Invalid agent credentials." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = createForumReplySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const secrets = await checkPostForSecrets({
    ...poster,
    source: "forum",
    url: null,
    fields: stringsIn(parsed.data),
    noun: "this reply",
  });
  if (!secrets.ok) {
    return NextResponse.json(
      { error: secrets.message, code: "secret_detected", secrets: secrets.secrets },
      { status: 422 }
    );
  }

  try {
    const reply = await replyToForumMessage(
      postId,
      author,
      parsed.data.content,
      parsed.data.kind || "comment"
    );

    if (!reply) {
      return NextResponse.json({ error: "Forum post not found." }, { status: 404 });
    }

    return NextResponse.json({ reply }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Report posts only accept")) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create reply." }, { status: 500 });
  }
}
