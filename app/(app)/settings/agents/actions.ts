"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { isAgentLevel } from "@/lib/agents/levels";
import type { AgentLevel } from "@prisma/client";
import { consumePairingLimit } from "@/lib/agents/rate-limit";
import { approvePairing, findPendingPairing } from "@/lib/agents/pairing";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { activateAgent, createAgent, deactivateAgent, deleteAgent, regenerateKey, revokeAgent, setAgentAreaPreferences, setAgentLevel } from "@/lib/agents/registry";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { parseWorkSettings } from "@/lib/agents/work-mode";

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
  });
  if (!result.ok) return result;
  revalidatePath("/agents/mine");
  return { ok: true, name: result.key.name, rawKey: result.key.rawKey, prefix: result.key.prefix };
}

export type AgentActionResult = { ok: true } | { ok: false; error: string };

export async function revokeAgentAction(agentId: unknown): Promise<AgentActionResult> {
  if (typeof agentId !== "string") return { ok: false, error: "Invalid agent." };
  const user = await requireUser();
  const result = await revokeAgent(user, agentId);
  if (result.ok) revalidatePath("/agents/mine");
  return result;
}

export async function deleteAgentAction(agentId: unknown): Promise<AgentActionResult> {
  if (typeof agentId !== "string") return { ok: false, error: "Invalid agent." };
  const user = await requireUser();
  const result = await deleteAgent(user, agentId);
  if (result.ok) revalidatePath("/agents/mine");
  return result;
}

export type RegenerateKeyActionResult =
  | { ok: true; name: string; rawKey: string; prefix: string }
  | { ok: false; error: string };

/**
 * Replaces its live key in the organisation you are in (#572, #user-agents):
 * a key works in one organisation, every project there. The new secret is returned once.
 */
export async function regenerateAgentKeyAction(agentId: unknown): Promise<RegenerateKeyActionResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: PLATFORM_OFF };
  if (typeof agentId !== "string") return { ok: false, error: "Invalid agent." };
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { ok: false, error: NO_ORGANISATION };
  const result = await regenerateKey(user, agentId, organisationId);
  if (!result.ok) return result;
  revalidatePath("/agents/mine");
  return { ok: true, name: result.key.name, rawKey: result.key.rawKey, prefix: result.key.prefix };
}

/**
 * Its class is the organisation's grant (#user-agents): in `organisationId`, else
 * the organisation you are in. setAgentLevel checks the caller may set it there.
 */
export async function setAgentLevelAction(agentId: unknown, level: unknown, organisationIdInput?: unknown): Promise<AgentActionResult> {
  if (typeof agentId !== "string" || !isAgentLevel(level)) return { ok: false, error: "Invalid level." };
  const user = await requireUser();
  const organisationId = typeof organisationIdInput === "string" && organisationIdInput ? organisationIdInput : await currentOrganisationIdFor(user.id);
  if (!organisationId) return { ok: false, error: NO_ORGANISATION };
  const result = await setAgentLevel(user, agentId, organisationId, level);
  if (result.ok) {
    revalidatePath("/agents/mine");
    revalidatePath("/settings/team");
    revalidatePath("/workers");
    revalidatePath("/[org]/[project]/org", "layout");
    revalidatePath("/users/[id]", "page");
  }
  return result;
}

const NO_ORGANISATION = "Open an organisation first.";

/** Where an agent works changed: the pages that list agents. */
function revalidateAgentPlaces() {
  revalidatePath("/agents/mine");
  revalidatePath("/[org]/[project]/org", "layout");
  revalidatePath("/agent/[username]", "layout");
}

/**
 * Switch one of your agents on in an organisation you belong to (#user-agents).
 * It works in every project there; its key for that organisation is returned once.
 */
export async function activateAgentAction(agentId: unknown, organisationId: unknown): Promise<RegenerateKeyActionResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: PLATFORM_OFF };
  if (typeof agentId !== "string" || typeof organisationId !== "string") return { ok: false, error: "Invalid agent." };
  const user = await requireUser();
  const result = await activateAgent(user, agentId, organisationId);
  if (!result.ok) return result;
  revalidateAgentPlaces();
  return { ok: true, name: result.key.name, rawKey: result.key.rawKey, prefix: result.key.prefix };
}

/** Switch an agent off in an organisation: its key there stops, its work there is released. Its owner or that organisation's admin. */
export async function deactivateAgentAction(agentId: unknown, organisationId: unknown): Promise<AgentActionResult> {
  if (typeof agentId !== "string" || typeof organisationId !== "string") return { ok: false, error: "Invalid agent." };
  const user = await requireUser();
  const result = await deactivateAgent(user, agentId, organisationId);
  if (result.ok) revalidateAgentPlaces();
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
  if (result.ok) revalidatePath("/agents/mine");
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
    // #agent-work-mode: the owner chooses how it works, and its caps, before it gets a key.
    const work = parseWorkSettings(formData);
    if (!work.ok) return { ok: false, error: work.error };
    const result = await approvePairing(
      user,
      code,
      new Date(),
      await currentOrganisationIdFor(user.id),
      formData.get("instructions") ?? undefined,
      work.settings,
    );
    if (!result.ok) return result;
    revalidatePath("/agents/mine");
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
