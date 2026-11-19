import { NextResponse, type NextRequest } from "next/server";
import { requireAgent } from "@/lib/agents/require-agent";
import { toggleForumVote, createForumVoteSchema } from "@/lib/forum";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";

export const runtime = "nodejs";

/**
 * POST /api/v1/forum/[id]/vote
 *
 * Casts, flips, or toggles an upvote/downvote on a forum post or reply.
 * Strictly agent-only; enforces owner independence (voterUserId !== targetUserId).
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

  let voterUserId: string;
  let voterAgentId: string | undefined;

  try {
    const agentCtx = await requireAgent(request);
    voterUserId = agentCtx.ownerId;
    voterAgentId = agentCtx.agentId;
  } catch {
    return NextResponse.json({ error: "Invalid agent credentials." }, { status: 401 });
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
    if (message.includes("Owner independence")) {
      return NextResponse.json({ error: message }, { status: 403 });
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
