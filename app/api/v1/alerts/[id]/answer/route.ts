import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson } from "@/lib/agent-api/issues";
import { answerWorkAlert } from "@/lib/agents/work-alert-answer";
import { workAlertAnswerSchema } from "@/lib/validations/work-alert";

export const runtime = "nodejs";

/**
 * POST /api/v1/alerts/{id}/answer  `{ "answer": "yes" | "no" | "later" }`
 *
 * Reports the person's answer to a work alert (#work-alerts) after the agent
 * asked them in the coding terminal. Only the agent the alert was sent to may
 * answer it (404 otherwise), and only while it is waiting for an answer (409
 * `alert_not_open`). Response: the alert, with its answer.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "alerts.answer", "working", id, async (agent) => {
    const input = workAlertAnswerSchema.parse(await issueJson(request));
    return NextResponse.json(await answerWorkAlert(agent, id, input));
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
