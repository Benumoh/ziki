"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { agentEditHref } from "@/lib/header-nav";
import { requireUser } from "@/lib/auth-helpers";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { sendAgentMessage, setAgentInstructions } from "@/lib/agent-messages";
import { checkAgentUsername, renameAgent, replaceAgentSkillsAsPerson, setAgentAvatar, updateAgentProfileAsPerson } from "@/lib/agents/registry";

/** Messages and standing instructions for an agent (#605). The lib checks who may send them. */
export type AgentMessageActionResult = { ok: true } | { ok: false; error: string };

const PLATFORM_OFF = "The agent platform is turned off on this site.";

/** The agent's page, addressed by its username. */
const AGENT_PAGE = "/agent/[username]";

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
  // Messages live in the Inbox's Messages tab.
  revalidatePath("/inbox");
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

/** Rename an agent from its page. Its page stays where it is: the address is its username. */
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

export type ProfileActionResult = { ok: true; username: string } | { ok: false; error: string };

/** Save the agent's public profile from its edit page (#agent-profile): name, username, tagline, About me and What I can do for you. A new username moves the page. */
export async function updateAgentProfileAction(
  _previous: ProfileActionResult | undefined,
  formData: FormData,
): Promise<ProfileActionResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: PLATFORM_OFF };
  const agentId = agentIdFrom(formData);
  if (!agentId) return { ok: false, error: "Invalid agent." };
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  const user = await requireUser();
  // The name is part of the profile too: one Save for all of it.
  const name = text("name").trim();
  if (name) {
    const renamed = await renameAgent(user, agentId, name);
    if (!renamed.ok) return renamed;
  }
  const result = await updateAgentProfileAsPerson(user, agentId, {
    username: text("username"),
    tagline: text("tagline"),
    about: text("about"),
    services: text("services"),
  });
  if (!result.ok) return result;
  // The name and username show in the header's Agents menu, the dock and the directory.
  revalidatePath("/", "layout");
  // The edit page is addressed by the username: a new one moves it, so send the
  // browser there now. Re-rendering the old address would answer 404.
  if (result.username !== text("currentUsername")) redirect(agentEditHref(result.username));
  return { ok: true, username: result.username };
}

export type UsernameCheck = { ok: true; available: boolean; message: string } | { ok: false; error: string };

/**
 * Whether a username is free for this agent across Ziki (#agent-profile),
 * for the profile form to say as you type. Saving checks again.
 */
export async function checkAgentUsernameAction(agentId: unknown, username: unknown): Promise<UsernameCheck> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: PLATFORM_OFF };
  if (typeof agentId !== "string" || !agentId || typeof username !== "string") return { ok: false, error: "Invalid agent." };
  const user = await requireUser();
  return checkAgentUsername(user, agentId, username);
}

/** Save the agent's whole skills list from its edit page (#agent-profile), in order. */
export async function saveAgentSkillsAction(agentId: unknown, skills: unknown): Promise<AgentMessageActionResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: PLATFORM_OFF };
  if (typeof agentId !== "string" || !agentId) return { ok: false, error: "Invalid agent." };
  const user = await requireUser();
  const result = await replaceAgentSkillsAsPerson(user, agentId, { skills });
  if (!result.ok) return result;
  revalidatePath(AGENT_PAGE, "page");
  return { ok: true };
}
