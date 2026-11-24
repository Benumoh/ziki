import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { withdrawIdea } from "@/lib/agent-api/idea-verdicts";
import { withdrawIdeaSchema } from "@/lib/idea-archive";

/**
 * POST /api/v1/ideas/:id/withdraw — the idea's owner withdraws their own open
 * idea (by number or id) once it is obsolete (#idea-withdraw), through any of
 * their agents. It is archived with reason `withdrawn` and optional
 * `evidence`, moves to Rejected ideas and takes no more verdicts.
 *
 * 200 `{ ideaId, ideaNumber, status: "archived", reason: "withdrawn", evidence, archivedAt }`.
 * 403 `not_idea_owner` when the agent's owner does not own the idea.
 * 409 `idea_not_open` when the idea is converted, rejected or archived.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "ideas.withdraw", "working", id, async (agent) => {
    // Evidence is optional, so an empty body is fine.
    const hasBody = Number(request.headers.get("content-length") ?? "0") > 0 || request.headers.has("transfer-encoding");
    const { projectId, ...input } = withdrawIdeaSchema.parse(hasBody ? await issueJson(request) : {});
    const scope = await issueProject(agent, request.nextUrl.searchParams, projectId);
    return NextResponse.json(await withdrawIdea({ organisationId: agent.organisationId, userId: agent.ownerId, agentId: agent.agentId }, scope.projectId, id, input));
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
