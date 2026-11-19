import type { AgentWorkMode, Prisma, PrismaClient } from "@prisma/client";
import { audit } from "@/lib/agents/audit";
import { absoluteUrl } from "@/lib/site-url";
import { WORK_MODE_LABELS, workModeSettingsPath } from "@/lib/agents/work-mode";
import { setupWorkModeSchema } from "@/lib/validations/agent-work-mode";

export type SetupWorkModeResult =
  | { ok: true; workMode: AgentWorkMode }
  | { ok: false; status: 400 | 409; error: "invalid_work_mode" | "work_mode_already_set"; message: string; settings_url?: string };

/**
 * The owner's first choice, given in the coding terminal while the agent sets
 * itself up (#terminal-work-mode). The agent asks its person "Work
 * automatically or Ask me first?" and reports the answer here. It only fills
 * an empty choice: once a mode is set, only the owner changes it, on the
 * agent's Work mode page, so an agent can never move itself to automatic. The
 * caps stay empty (no cap); the owner sets them on that page.
 */
export async function chooseWorkModeAtSetup(
  db: PrismaClient | Prisma.TransactionClient,
  agent: { agentId: string; organisationId: string },
  body: unknown,
  now = new Date(),
): Promise<SetupWorkModeResult> {
  const parsed = setupWorkModeSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: "invalid_work_mode",
      message: 'Send {"workMode":"automatic"} for Work automatically or {"workMode":"ask_first"} for Ask me first, as your person chose.',
    };
  }
  const workMode: AgentWorkMode = parsed.data.workMode;
  // One write that only lands while no mode is set, so two calls can't both win.
  const { count } = await db.agent.updateMany({
    where: { id: agent.agentId, workMode: null },
    data: { workMode, workModeSetAt: now },
  });
  if (count === 0) {
    const row = await db.agent.findUnique({ where: { id: agent.agentId }, select: { username: true, workMode: true } });
    const label = row?.workMode ? WORK_MODE_LABELS[row.workMode] : "a work mode";
    return {
      ok: false,
      status: 409,
      error: "work_mode_already_set",
      message: `Your person already chose ${label}. Only they can change it, on your Work mode page (settings_url).`,
      ...(row ? { settings_url: absoluteUrl(workModeSettingsPath(row.username)) } : {}),
    };
  }
  await audit(agent, "agent.work_mode_set", `agent:${agent.agentId}`, { workMode, via: "terminal_setup" }, { db });
  return { ok: true, workMode };
}
