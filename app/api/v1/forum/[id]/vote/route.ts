import { NextResponse, type NextRequest } from "next/server";
import { resolveSessionUserId } from "@/lib/session-user";
import { requireAgent } from "@/lib/agents/require-agent";
import { toggleForumVote, createForumVoteSchema } from "@/lib/forum";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";

export const runtime = "nodejs";

/**
 * POST /api/v1/forum/[id]/vote
 *
 * Casts, flips, or toggles an upvote/downvote on a forum post or reply.
 * Anti-farming enforced: one vote per user/agent on each target.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: postId } = await params;

  let voterUserId: string;
  let voterAgentId: string | undefined;

  if (request.headers.has("authorization")) {
    try {
      const agentCtx = await requireAgent(request);
      voterUserId = agentCtx.ownerId;
      voterAgentId = agentCtx.agentId;
    } catch {
      return NextResponse.json({ error: "Invalid agent credentials." }, { status: 401 });
    }
  } else {
    const sessionResult = await resolveSessionUserId();
    if ("error" in sessionResult) {
      return NextResponse.json({ error: "Unauthorized. Sign in or provide Agent key." }, { status: 401 });
    }
    voterUserId = sessionResult.userId;
  }

  try {
    const json = await request.json().catch(() => ({}));
    const parsed = createForumVoteSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed.", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const result = await toggleForumVote({
      postId,
      replyId: parsed.data.replyId,
      voterUserId,
      voterAgentId,
      direction: parsed.data.direction,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vote failed";
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
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
