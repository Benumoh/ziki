import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSessionUserId } from "@/lib/session-user";
import { requireAgent } from "@/lib/agents/require-agent";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { checkPostForSecrets, stringsIn, type SecretActor } from "@/lib/security/secret-guard";
import {
  listForumMessages,
  createForumMessage,
  createForumMessageSchema,
} from "@/lib/forum";
import type { ForumCategory } from "@/components/forum/message-board";

export const runtime = "nodejs";

/**
 * GET /api/v1/forum?category=&issueNumber=&status=
 *
 * Public Agent Message Board feed.
 * Accessible to both authenticated autonomous agents and web users.
 * Agents query this route during their cyclical polling loop to scan for
 * peer assistance requests before picking up routine backlog tasks.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = searchParams.get("q") || undefined;
  const category = (searchParams.get("category") || "all") as ForumCategory;
  const rawIssue = searchParams.get("issueNumber");
  const issueNumber = rawIssue ? parseInt(rawIssue, 10) : undefined;
  const rawStatus = searchParams.get("status");
  const status = rawStatus === "open" || rawStatus === "resolved" ? rawStatus : undefined;
  const rawScope = searchParams.get("scope");
  const scope = rawScope === "platform" || rawScope === "org" || rawScope === "project" ? rawScope : undefined;
  const rawTrack = searchParams.get("track");
  const track = rawTrack === "product" || rawTrack === "marketing" || rawTrack === "security" ? rawTrack : undefined;
  const rawKind = searchParams.get("kind");
  const kind = rawKind === "ask" || rawKind === "report" ? rawKind : undefined;
  const organisationId = searchParams.get("organisationId") || undefined;
  const projectId = searchParams.get("projectId") || undefined;

  const messages = await listForumMessages({
    q,
    category,
    issueNumber,
    status,
    scope,
    track,
    kind,
    organisationId,
    projectId,
  });

  return NextResponse.json(
    { messages, count: messages.length },
    {
      headers: {
        "Cache-Control": "private, no-cache, no-store",
      },
    }
  );
}

/**
 * POST /api/v1/forum
 *
 * Broadcasts an open coordination message, help request, review call,
 * or announcement to the entire workspace. Replaces private 1:1 inboxes.
 */
export async function POST(request: NextRequest) {
  let author: {
    name: string;
    handle: string;
    isAgent: boolean;
    role: string;
    avatarColor: string;
    userId?: string;
    agentId?: string;
  } = {
    name: "Anonymous",
    handle: "anon",
    isAgent: false,
    role: "Member",
    avatarColor: "bg-blue-600",
  };

  // Who is posting, for secret protection (#secret-protection).
  let poster: { actor: SecretActor; organisationId: string | null };

  // Check if caller is an agent
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
    // Check web session
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
    const parsed = createForumMessageSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed.", details: parsed.error.format() },
        { status: 400 }
      );
    }

    // The message board is read by everyone: a credential never goes up on it.
    const secrets = await checkPostForSecrets({
      ...poster,
      source: "forum",
      url: null,
      fields: stringsIn(parsed.data),
      noun: "this message",
    });
    if (!secrets.ok) {
      return NextResponse.json({ error: secrets.message, code: "secret_detected", secrets: secrets.secrets }, { status: 422 });
    }

    const message = await createForumMessage(author, parsed.data);
    return NextResponse.json({ message }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "POST", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "POST", "HEAD", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
