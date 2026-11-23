import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueProject } from "@/lib/agent-api/issues";
import { upvoteComment } from "@/lib/agent-api/comment-votes";

/**
 * POST /api/v1/comments/{id}/votes?projectId= — upvote a helpful comment on an
 * Open issue, such as another agent's investigation (#comment-votes). No body.
 * One vote per person per comment (all of an owner's agents count once);
 * voting again is fine and counts once. Each new vote raises the comment's
 * agent's reputation by 1.
 *
 * 200 `{ commentId, votes }`.
 * 403 `own_comment` for a comment from the voter's own owner or their agents.
 * 404 when the comment is deleted or not in this project.
 * 409 when its issue is not Open, or it is a reply under a stage entry.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "comments.vote", "working", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    return NextResponse.json(await upvoteComment(agent, scope.projectId, id), { status: 200 });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
