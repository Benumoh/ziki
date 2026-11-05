"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { isAgentLevel } from "@/lib/agents/levels";
import type { AgentLevel } from "@prisma/client";
import { consumePairingLimit } from "@/lib/agents/rate-limit";
import { approvePairing, findPendingPairing } from "@/lib/agents/pairing";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { createAgent, deleteAgent, regenerateKey, revokeAgent, setAgentAreaPreferences, setAgentLevel } from "@/lib/agents/registry";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";

/** Shown when the platform is off (#505): no new agents or keys get issued. */
const PLATFORM_OFF = "The agent platform is turned off on this site.";

/** The settings page's agent actions (#427). Every one acts as the signed-in person. */

export type CreateAgentActionResult =
  | { ok: true; name: string; rawKey: string; prefix: string }
  | { ok: false; error: string; field?: string };

export async function createAgentAction(
  _previous: CreateAgentActionResult | undefined,
  formData: FormData,
): Promise<CreateAgentActionResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: PLATFORM_OFF };
  const user = await requireUser();
  const result = await createAgent(user, {
    name: formData.get("name") ?? "",
    model: formData.get("model") || undefined,
    level: formData.get("level") || undefined,
    projectId: formData.get("projectId") ?? "",
  });
  if (!result.ok) return result;
  revalidatePath("/agents");
  return { ok: true, name: result.key.name, rawKey: result.key.rawKey, prefix: result.key.prefix };
}

export type AgentActionResult = { ok: true } | { ok: false; error: string };

export async function revokeAgentAction(agentId: unknown): Promise<AgentActionResult> {
  if (typeof agentId !== "string") return { ok: false, error: "Invalid agent." };
  const user = await requireUser();
  const result = await revokeAgent(user, agentId);
  if (result.ok) revalidatePath("/agents");
  return result;
}

export async function deleteAgentAction(agentId: unknown): Promise<AgentActionResult> {
  if (typeof agentId !== "string") return { ok: false, error: "Invalid agent." };
  const user = await requireUser();
  const result = await deleteAgent(user, agentId);
  if (result.ok) revalidatePath("/agents");
  return result;
}

export type RegenerateKeyActionResult =
  | { ok: true; name: string; rawKey: string; prefix: string }
  | { ok: false; error: string };

/** Replaces every live key. The new secret is returned once (#572). */
export async function regenerateAgentKeyAction(
  agentId: unknown,
  projectId: unknown,
): Promise<RegenerateKeyActionResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: PLATFORM_OFF };
  if (typeof agentId !== "string" || typeof projectId !== "string" || !projectId) {
    return { ok: false, error: "Choose a project in this workspace." };
  }
  const user = await requireUser();
  const result = await regenerateKey(user, agentId, projectId);
  if (!result.ok) return result;
  revalidatePath("/agents");
  return { ok: true, name: result.key.name, rawKey: result.key.rawKey, prefix: result.key.prefix };
}

export async function setAgentLevelAction(agentId: unknown, level: unknown): Promise<AgentActionResult> {
  if (typeof agentId !== "string" || !isAgentLevel(level)) return { ok: false, error: "Invalid level." };
  const user = await requireUser();
  const result = await setAgentLevel(user, agentId, level);
  if (result.ok) {
    revalidatePath("/agents");
    revalidatePath("/settings/team");
    revalidatePath("/workers");
    revalidatePath("/[project]/org", "layout");
    revalidatePath("/users/[id]", "page");
  }
  return result;
}

export async function setAgentAreaPreferencesAction(
  agentId: unknown,
  projectId: unknown,
  areaIds: unknown,
): Promise<AgentActionResult> {
  if (
    typeof agentId !== "string" || typeof projectId !== "string" || !projectId ||
    !Array.isArray(areaIds) || areaIds.length > 25 ||
    areaIds.some((areaId) => typeof areaId !== "string" || areaId.length > 191)
  ) {
    return { ok: false, error: "Choose a project and valid areas." };
  }
  const user = await requireUser();
  const result = await setAgentAreaPreferences(user, agentId, projectId, areaIds);
  if (result.ok) revalidatePath("/agents");
  return result;
}

export type PairingActionResult =
  | {
      ok: true;
      step: "confirm";
      code: string;
      name: string;
      model: string | null;
      level: AgentLevel;
      /** What the agent proposed (#431); the owner approves, edits or clears it. */
      instructions: string | null;
    }
  | { ok: true; step: "done"; name: string }
  | { ok: false; error: string };

/**
 * Two steps on one form: look the code up and show the agent's name, then
 * approve it. Both count against the same limit, so codes can't be guessed.
 */
export async function pairAgentAction(
  _previous: PairingActionResult | undefined,
  formData: FormData,
): Promise<PairingActionResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: PLATFORM_OFF };
  const user = await requireUser();
  if (await consumePairingLimit("approve", user.id)) return { ok: false, error: RATE_LIMIT_MESSAGE };

  const code = String(formData.get("code") ?? "");
  if (formData.get("intent") === "approve") {
    const result = await approvePairing(
      user,
      code,
      new Date(),
      String(formData.get("projectId") ?? ""),
      await currentTenantIdFor(user.id),
      formData.get("instructions") ?? undefined,
    );
    if (!result.ok) return result;
    revalidatePath("/agents");
    return { ok: true, step: "done", name: result.name };
  }

  const pending = await findPendingPairing(code);
  if (!pending) {
    return { ok: false, error: "That code doesn't match a waiting agent. It may have expired; ask the agent for a new one." };
  }
  return {
    ok: true,
    step: "confirm",
    code,
    name: pending.proposedName,
    model: pending.proposedModel,
    level: pending.proposedLevel ?? "working",
    instructions: pending.proposedInstructions,
  };
}
