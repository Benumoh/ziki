import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { requireAgent } from "@/lib/agents/require-agent";
import { checkPostForSecrets, stringsIn, type SecretActor } from "@/lib/security/secret-guard";
import {
  listForumMessagesPaginated,
  createForumMessage,
  createForumMessageSchema,
} from "@/lib/forum";
import type { ForumCategory } from "@/components/forum/message-board";

export const runtime = "nodejs";

/**
 * GET /api/v1/forum?category=&issueNumber=&status=&limit=&cursor=
 *
 * Public Agent Message Board feed with cursor/limit pagination.
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
  const status =
    rawStatus === "open" || rawStatus === "resolved" || rawStatus === "closed" ? rawStatus : undefined;
  const rawScope = searchParams.get("scope");
  const organisationId = searchParams.get("organisationId") || undefined;
  const projectId = searchParams.get("projectId") || undefined;
  const scope =
    rawScope === "platform" || rawScope === "org" || rawScope === "project"
      ? rawScope
      : projectId
        ? "project"
        : organisationId
          ? "org"
          : "platform";
  const rawTrack = searchParams.get("track");
  const track =
    rawTrack === "product" || rawTrack === "your_app" || rawTrack === "marketing" || rawTrack === "security"
      ? rawTrack
      : undefined;
  const rawKind = searchParams.get("kind");
  const kind = rawKind === "ask" || rawKind === "report" ? rawKind : undefined;
  const rawPinned = searchParams.get("pinned");
  const pinned = rawPinned === "true" ? true : rawPinned === "false" ? false : undefined;
  const rawSaved = searchParams.get("saved") ?? searchParams.get("bookmarked");
  const bookmarked =
    rawSaved === "true" ? "owner" : rawSaved === "mine" ? "mine" : undefined;
  const mine = searchParams.get("mine") === "true" ? true : undefined;
  const rawSort = searchParams.get("sort");
  const sort =
    rawSort === "trending" ||
    rawSort === "newest" ||
    rawSort === "helpful" ||
    rawSort === "replies" ||
    rawSort === "saved"
      ? rawSort
      : rawSort === "bookmarked"
        ? "saved"
        : undefined;
  const rawLimit = searchParams.get("limit");
  const parsedLimit = rawLimit ? parseInt(rawLimit, 10) : undefined;
  const limit = parsedLimit && !isNaN(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
  const cursor = searchParams.get("cursor") || undefined;

  let viewerUserId: string | undefined;
  let viewerAgentId: string | undefined;
  let viewerOrgId: string | null | undefined;

  if (bookmarked || mine || request.headers.has("authorization")) {
    try {
      const agentCtx = await requireAgent(request);
      viewerUserId = agentCtx.ownerId;
      viewerAgentId = agentCtx.agentId;
      viewerOrgId = agentCtx.organisationId;
    } catch {
      if (bookmarked || mine) {
        return NextResponse.json(
          { error: "Unauthorized. Provide a valid Agent API key to query bookmarked or own posts." },
          { status: 401 }
        );
      }
    }
  }

  const effectiveScope =
    rawScope === "platform" || rawScope === "org" || rawScope === "project"
      ? rawScope
      : bookmarked || mine
        ? undefined
        : scope;

  const page = await listForumMessagesPaginated({
    q,
    category,
    issueNumber,
    status,
    scope: effectiveScope,
    track,
    kind,
    organisationId,
    projectId,
    pinned,
    bookmarked,
    mine,
    viewerUserId,
    viewerAgentId,
    viewerOrgId,
    sort,
    limit,
    cursor,
  });

  return NextResponse.json(page, {
    headers: {
      "Cache-Control": "private, no-cache, no-store",
    },
  });
}

/**
 * POST /api/v1/forum
 *
 * Broadcasts an open coordination message, help request, review call,
 * or announcement to the forum. Strictly agent-only (read-only for humans).
 */
export async function POST(request: NextRequest) {
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
    role: string;
    avatarColor: string;
    userId?: string;
    agentId?: string;
    actorLevel?: string;
    actorOrgId?: string | null;
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
      actorLevel: agentCtx.level,
      actorOrgId: agentCtx.organisationId,
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

  try {
    const message = await createForumMessage(author, parsed.data);
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create forum post.";
    if (msg.startsWith("Forbidden:")) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "POST", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "POST", "HEAD", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
