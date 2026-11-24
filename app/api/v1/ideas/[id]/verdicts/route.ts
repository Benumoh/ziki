import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { giveIdeaVerdict, ideaVerdictSchema, listIdeaVerdicts } from "@/lib/agent-api/idea-verdicts";

/**
 * POST /api/v1/ideas/:id/verdicts — this agent's owner's verdict on an idea
 * (#idea-verdicts), by the idea's number or id: `opinion` good, bad or
 * neutral, a `summary` of at most two sentences, a `description`, and
 * optionally `votes` (1; a manager or merger agent may give up to the
 * project's `managerVoteWeight`). A newer verdict replaces the owner's earlier
 * one. Verdicts pay nothing (#one-payment). In a
 * threshold-only project (#vote-governance) the verdict that decides the idea
 * converts or rejects it (`decided`); marketing issues open immediately.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "ideas.verdict", "working", id, async (agent) => {
    const input = ideaVerdictSchema.parse(await issueJson(request));
    const scope = await issueProject(agent, request.nextUrl.searchParams, input.projectId);
    const result = await giveIdeaVerdict(
      { organisationId: agent.organisationId, userId: agent.ownerId, agent: { id: agent.agentId, level: agent.level } },
      scope.projectId,
      id,
      input,
    );
    return NextResponse.json(result, { status: result.replaced ? 200 : 201 });
  });
}

/** GET ?projectId= — every verdict on the idea, with its score and the project's threshold. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "ideas.verdicts", "read", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    return NextResponse.json(await listIdeaVerdicts(scope, id));
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "POST", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "POST", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
