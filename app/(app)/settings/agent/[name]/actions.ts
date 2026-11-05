"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { sendAgentMessage, setAgentInstructions } from "@/lib/agent-messages";
import { renameAgent, setAgentAvatar, updateAgentProfileAsPerson } from "@/lib/agents/registry";

/** Messages and standing instructions for an agent (#605). The lib checks who may send them. */
export type AgentMessageActionResult = { ok: true } | { ok: false; error: string };

const PLATFORM_OFF = "The agent platform is turned off on this site.";

/** The agent's page, addressed by its name. */
const AGENT_PAGE = "/settings/agent/[name]";

function agentIdFrom(formData: FormData): string | null {
  const agentId = formData.get("agentId");
  return typeof agentId === "string" && agentId ? agentId : null;
}

export async function sendAgentMessageAction(
  _previous: AgentMessageActionResult | undefined,
  formData: FormData,
): Promise<AgentMessageActionResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: PLATFORM_OFF };
  const agentId = agentIdFrom(formData);
  if (!agentId) return { ok: false, error: "Invalid agent." };
  const user = await requireUser();
  const result = await sendAgentMessage(user, agentId, { body: formData.get("body") ?? "" });
  if (!result.ok) return result;
  revalidatePath(AGENT_PAGE, "page");
  return { ok: true };
}

export async function setAgentInstructionsAction(
  _previous: AgentMessageActionResult | undefined,
  formData: FormData,
): Promise<AgentMessageActionResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: PLATFORM_OFF };
  const agentId = agentIdFrom(formData);
  if (!agentId) return { ok: false, error: "Invalid agent." };
  const user = await requireUser();
  const result = await setAgentInstructions(user, agentId, { instructions: formData.get("instructions") ?? "" });
  if (!result.ok) return result;
  revalidatePath(AGENT_PAGE, "page");
  return { ok: true };
}

export type RenameAgentActionResult = { ok: true; name: string } | { ok: false; error: string };

/** Rename an agent from its page. Its address changes with it, so the caller moves to the new one. */
export async function renameAgentAction(agentId: unknown, name: unknown): Promise<RenameAgentActionResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: PLATFORM_OFF };
  if (typeof agentId !== "string" || !agentId) return { ok: false, error: "Invalid agent." };
  const user = await requireUser();
  const result = await renameAgent(user, agentId, typeof name === "string" ? name : "");
  if (!result.ok) return result;
  // The name shows in the header's Agents menu on every page.
  revalidatePath("/", "layout");
  return result;
}

/** Pick the agent's avatar from its page; null goes back to the automatic one. */
export async function setAgentAvatarAction(agentId: unknown, avatar: unknown): Promise<AgentMessageActionResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: PLATFORM_OFF };
  if (typeof agentId !== "string" || !agentId) return { ok: false, error: "Invalid agent." };
  const user = await requireUser();
  const result = await setAgentAvatar(user, agentId, avatar ?? null);
  // The avatar shows wherever the agent does, starting with the header's Agents menu.
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Save the agent's username, tagline and About me from its page (#agent-profile). */
export async function updateAgentProfileAction(
  _previous: AgentMessageActionResult | undefined,
  formData: FormData,
): Promise<AgentMessageActionResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: PLATFORM_OFF };
  const agentId = agentIdFrom(formData);
  if (!agentId) return { ok: false, error: "Invalid agent." };
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  const user = await requireUser();
  const result = await updateAgentProfileAsPerson(user, agentId, {
    username: text("username"),
    tagline: text("tagline"),
    about: text("about"),
  });
  if (!result.ok) return result;
  revalidatePath(AGENT_PAGE, "page");
  return { ok: true };
}
