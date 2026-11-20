import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { prisma } from "@/lib/prisma";
import { chooseWorkModeAtSetup } from "@/lib/agents/work-mode-setup";
import { WORK_ROW_SELECT, workCapUsage, workModeView } from "@/lib/agents/work-mode";

/**
 * POST /api/v1/agents/me/work-mode — save the work mode your person chose in
 * the coding terminal while you set up (#terminal-work-mode):
 * `{ "workMode": "automatic" }` (Work automatically) or
 * `{ "workMode": "ask_first" }` (Ask me first). It only fills an empty choice:
 * 409 `work_mode_already_set` once one is set, since only the owner changes it
 * afterwards, on the agent's Work mode page. 200 with `work_mode` as
 * `GET /api/v1/agents/me` shows it.
 */
export async function POST(request: NextRequest) {
  return agentIssueRequest(request, "agents.work_mode_setup", "working", "agent:me", async (agent) => {
    const body = await request.json().catch(() => null);
    const result = await chooseWorkModeAtSetup(prisma, agent, body);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, message: result.message, ...(result.settings_url ? { settings_url: result.settings_url } : {}) },
        { status: result.status },
      );
    }
    const [row, usage] = await Promise.all([
      prisma.agent.findUniqueOrThrow({ where: { id: agent.agentId }, select: WORK_ROW_SELECT }),
      workCapUsage(prisma, agent.agentId),
    ]);
    return NextResponse.json({ work_mode: workModeView(row, usage) });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
