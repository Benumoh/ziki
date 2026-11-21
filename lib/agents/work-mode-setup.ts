import type { AgentWorkMode, Prisma, PrismaClient } from "@prisma/client";
import { audit } from "@/lib/agents/audit";
import { absoluteUrl } from "@/lib/site-url";
import { WORK_MODE_LABELS, workModeSettingsPath } from "@/lib/agents/work-mode";
import { WORK_PACE_CAPS, WORK_PACE_LABELS, paceOf, type WorkPace } from "@/lib/agents/work-pace";
import { setupWorkModeSchema } from "@/lib/validations/agent-work-mode";

export type SetupWorkModeResult =
  | { ok: true; workMode?: AgentWorkMode; pace?: WorkPace }
  | {
      ok: false;
      status: 400 | 409;
      error: "invalid_work_mode" | "work_mode_already_set" | "pace_already_set";
      message: string;
      settings_url?: string;
    };

/**
 * The owner's first answers to the two setup questions (#terminal-work-mode,
 * #agent-get-started): how the agent works (`workMode`) and how much it takes
 * on (`pace`, which sets its task caps). They are asked in the coding terminal
 * by the agent (`via: "terminal_setup"`) and on the agent's page by its owner
 * (`via: "website"`) at the same time, and each answer only fills an empty
 * one, so whichever place is answered first counts and the other moves on to
 * the next question. Once answered, only the owner changes it, on the agent's
 * Work mode page, so an agent can never move itself to automatic or raise its caps.
 */
export async function chooseWorkModeAtSetup(
  db: PrismaClient | Prisma.TransactionClient,
  agent: { agentId: string; organisationId: string },
  body: unknown,
  now = new Date(),
  via: "terminal_setup" | "website" = "terminal_setup",
): Promise<SetupWorkModeResult> {
  const parsed = setupWorkModeSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: "invalid_work_mode",
      message:
        'Send {"workMode":"automatic"} for Work automatically or {"workMode":"ask_first"} for Ask me first, and {"pace":"light"}, {"pace":"steady"} or {"pace":"busy"} for how much you take on, as your person chose.',
    };
  }
  const { workMode, pace } = parsed.data;
  const result: { ok: true; workMode?: AgentWorkMode; pace?: WorkPace } = { ok: true };

  if (workMode) {
    // One write that only lands while no mode is set, so two answers can't both win.
    const { count } = await db.agent.updateMany({
      where: { id: agent.agentId, workMode: null },
      data: { workMode, workModeSetAt: now },
    });
    if (count === 0) return alreadyAnswered(db, agent.agentId, "work_mode_already_set");
    await audit(agent, "agent.work_mode_set", `agent:${agent.agentId}`, { workMode, via }, { db });
    result.workMode = workMode;
  }

  if (pace) {
    const { count } = await db.agent.updateMany({
      where: { id: agent.agentId, paceSetAt: null },
      data: { ...WORK_PACE_CAPS[pace], paceSetAt: now },
    });
    if (count === 0) return alreadyAnswered(db, agent.agentId, "pace_already_set");
    await audit(agent, "agent.work_mode_set", `agent:${agent.agentId}`, { pace, ...WORK_PACE_CAPS[pace], via }, { db });
    result.pace = pace;
  }
  return result;
}

/** The 409 for an answer given already, saying what the owner chose so the agent can tell them and move on. */
async function alreadyAnswered(
  db: PrismaClient | Prisma.TransactionClient,
  agentId: string,
  error: "work_mode_already_set" | "pace_already_set",
): Promise<SetupWorkModeResult> {
  const row = await db.agent.findUnique({
    where: { id: agentId },
    select: { username: true, workMode: true, maxActiveTasks: true, dailyTaskLimit: true },
  });
  let chose: string;
  if (error === "work_mode_already_set") {
    chose = row?.workMode ? WORK_MODE_LABELS[row.workMode] : "a work mode";
  } else {
    const preset = row ? paceOf(row) : null;
    chose = preset === null ? "no limits" : preset === "custom" ? "their own limits" : WORK_PACE_LABELS[preset];
  }
  return {
    ok: false,
    status: 409,
    error,
    message: `Your person already chose ${chose}, on your page or your Work mode page. Tell them, and go on to the next step. Only they change it, on your Work mode page (settings_url).`,
    ...(row ? { settings_url: absoluteUrl(workModeSettingsPath(row.username)) } : {}),
  };
}
