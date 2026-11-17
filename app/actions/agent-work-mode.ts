"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/agents/audit";
import { parseWorkSettings, workSettingsData } from "@/lib/agents/work-mode";

export type WorkModeActionResult = { ok: true } | { ok: false; error: string; field?: string };

/**
 * The owner changes how their agent works and its caps (#agent-work-mode).
 * Only the owner: the caps limit what is spent on their behalf.
 */
export async function setAgentWorkModeAction(
  _previous: WorkModeActionResult | undefined,
  formData: FormData,
): Promise<WorkModeActionResult> {
  const user = await requireUser();
  const agentId = String(formData.get("agentId") ?? "");
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, ownerUserId: user.id, revokedAt: null },
    select: { id: true, username: true, activations: { where: { deactivatedAt: null }, select: { organisationId: true }, take: 1 } },
  });
  if (!agent) return { ok: false, error: "Only its owner can change how this agent works." };
  const parsed = parseWorkSettings(formData);
  if (!parsed.ok) return parsed;
  await prisma.agent.update({ where: { id: agent.id }, data: workSettingsData(parsed.settings) });
  const organisationId = agent.activations[0]?.organisationId;
  if (organisationId) {
    await audit({ agentId: agent.id, organisationId }, "agent.work_mode_set", `agent:${agent.id}`, { ...parsed.settings }, { actorUserId: user.id });
  }
  revalidatePath(`/agent/${agent.username}/edit/work-mode`);
  return { ok: true };
}
