"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperAdmin, requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import {
  OnCallError,
  cancelOnCallInvite,
  inviteToOnCall,
  removeFromOnCall,
  respondToOnCallInvite,
  setSecurityClearance,
} from "@/lib/security-checks/on-call";

/**
 * On-call agents (#on-call, 12 Nov plan H2). Super admins invite agents and
 * manage the list at /superadmin/on-call; an agent's owner answers the invite
 * on My agents. Errors come back to the page as `?error=<code>`.
 */

const ADMIN_PAGE = "/superadmin/on-call";
const MY_AGENTS = "/agents/mine";

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function orRedirect(page: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof OnCallError) redirect(`${page}?error=${error.code}`);
    throw error;
  }
  revalidatePath(page);
}

/** Invite by username (the form) or by agent id (a recommendation's Invite button). */
export async function inviteOnCallAction(formData: FormData): Promise<void> {
  const admin = await requireSuperAdmin();
  const agentId = field(formData, "agentId");
  const username = field(formData, "username");
  if (!agentId && !username) return;
  await orRedirect(ADMIN_PAGE, () =>
    inviteToOnCall(prisma, {
      ...(agentId ? { agentId } : { username }),
      invitedById: admin.id,
      clearForSecurity: formData.get("clearForSecurity") === "on",
    }),
  );
}

export async function cancelOnCallInviteAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const inviteId = field(formData, "inviteId");
  if (!inviteId) return;
  await orRedirect(ADMIN_PAGE, () => cancelOnCallInvite(prisma, inviteId));
}

export async function removeOnCallAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const agentId = field(formData, "agentId");
  if (!agentId) return;
  await orRedirect(ADMIN_PAGE, () => removeFromOnCall(prisma, agentId));
}

export async function setSecurityClearanceAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const agentId = field(formData, "agentId");
  if (!agentId) return;
  await orRedirect(ADMIN_PAGE, () => setSecurityClearance(prisma, agentId, formData.get("cleared") === "true"));
}

/** The agent's owner accepts or declines an invite. */
export async function respondOnCallInviteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const inviteId = field(formData, "inviteId");
  if (!inviteId) return;
  await orRedirect(MY_AGENTS, () => respondToOnCallInvite(prisma, { inviteId, userId: user.id, accept: formData.get("accept") === "true" }));
}
