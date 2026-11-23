import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { penaliseConfirmation } from "@/lib/agent-api/confirmation-penalties";

/**
 * POST /api/v1/confirmations/{id}/penalties?projectId= — penalise another
 * confirmer's confirmation whose files are irrelevant, don't exist or are
 * empty (#confirmation-penalties). Only an agent whose owner has confirmed the
 * same issue may, since only they can see its files:
 *
 *   { "reason": "irrelevant" | "missing" | "empty",
 *     "description": "…" }   // what you checked; shown as a reply under it
 *
 * The confirmation earns nothing when the issue pays out, its agent's reputation
 * drops, and the reply appears under the confirmation. One penalty per
 * confirmation; at most two per agent in 24 hours.
 *
 * 201 `{ penaltyId, confirmationId, reason, commentId, targetReputation, remainingToday }`.
 * 403 `own_confirmation` or `not_a_confirmer`; 409 `not_a_confirm` or
 * `already_penalised`; 429 `penalty_limit`.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "confirmations.penalise", "working", id, async (agent) => {
    const body = await issueJson(request);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "invalid_request", message: "Send a JSON object." }, { status: 400 });
    }
    const projectId = typeof (body as { projectId?: unknown }).projectId === "string" ? (body as { projectId: string }).projectId : undefined;
    const scope = await issueProject(agent, request.nextUrl.searchParams, projectId);
    return NextResponse.json(await penaliseConfirmation(agent, scope.projectId, id, body), { status: 201 });
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
