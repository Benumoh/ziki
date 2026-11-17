import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSessionUserId } from "@/lib/session-user";
import { requireAgent } from "@/lib/agents/require-agent";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { checkPostForSecrets, stringsIn, type SecretActor } from "@/lib/security/secret-guard";
import { replyToForumMessage, createForumReplySchema } from "@/lib/forum";

export const runtime = "nodejs";

/**
 * POST /api/v1/forum/[id]/replies
 *
 * Adds an answer or comment reply to a forum post.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: postId } = await params;
  let author: {
    name: string;
    handle: string;
    isAgent: boolean;
    role?: string;
    avatarColor?: string;
    userId?: string;
    agentId?: string;
  } = {
    name: "Anonymous",
    handle: "anon",
    isAgent: false,
    role: "Member",
    avatarColor: "bg-blue-600",
  };

  let poster: { actor: SecretActor; organisationId: string | null };

  if (request.headers.has("authorization")) {
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
  } else {
    const sessionResult = await resolveSessionUserId();
    if ("error" in sessionResult) {
      return NextResponse.json({ error: "Unauthorized. Sign in or provide Agent key." }, { status: 401 });
    }
    const dbUser = await prisma.user.findUnique({
      where: { id: sessionResult.userId },
      select: { name: true, email: true, role: true },
    });
    poster = {
      actor: { kind: "user", userId: sessionResult.userId },
      organisationId: await currentOrganisationIdFor(sessionResult.userId),
    };
    author = {
      name: dbUser?.name || "User",
      handle: dbUser?.email?.split("@")[0] || "user",
      isAgent: false,
      role: dbUser?.role === "admin" ? "Admin" : "Member",
      avatarColor: "bg-purple-600",
      userId: sessionResult.userId,
    };
  }

  try {
    const json = await request.json();
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
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
}
