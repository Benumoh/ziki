"use server";

import { revalidatePath } from "next/cache";
import type { MembershipRole } from "@prisma/client";
import { requireUser } from "@/lib/auth-helpers";
import {
  changeMembershipRole,
  leaveMembership,
  removeMembership,
  setCanFundIssues,
} from "@/lib/membership-admin";
import { prisma } from "@/lib/prisma";

export type MembershipActionResult = { error?: string; ok?: boolean };

/** Members are listed in /org; a person's own organisations in /organisations. */
function revalidateOrganisation() {
  revalidatePath("/[org]/[project]/org", "layout");
  revalidatePath("/organisations");
}

function cleanId(value: string): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id.length > 0 ? id : null;
}

/** Promote or demote someone inside one organisation. Does not change their site-wide role. */
export async function setMemberRoleAction(
  organisationId: string,
  userId: string,
  nextRole: MembershipRole,
): Promise<MembershipActionResult> {
  const actor = await requireUser();
  const organisation = cleanId(organisationId);
  const target = cleanId(userId);
  if (!organisation || !target) return { error: "That person isn't in this organisation." };
  if (nextRole !== "admin" && nextRole !== "member") {
    return { error: "Only an owner of this organisation can change roles." };
  }

  const result = await changeMembershipRole(prisma, actor, {
    organisationId: organisation,
    targetUserId: target,
    nextRole,
  });
  if (!result.ok) return { error: result.error };
  revalidateOrganisation();
  return { ok: true };
}

/** Let an admin fund the organisation's issues from their own wallet, or stop them (#payers). Owners only. */
export async function setMemberCanFundAction(
  organisationId: string,
  userId: string,
  canFund: boolean,
): Promise<MembershipActionResult> {
  const actor = await requireUser();
  const organisation = cleanId(organisationId);
  const target = cleanId(userId);
  if (!organisation || !target || typeof canFund !== "boolean") return { error: "That person isn't in this organisation." };

  const result = await setCanFundIssues(prisma, actor, { organisationId: organisation, targetUserId: target, canFund });
  if (!result.ok) return { error: result.error };
  revalidateOrganisation();
  return { ok: true };
}

/** Remove someone from one organisation. They keep their account. */
export async function removeMemberAction(
  organisationId: string,
  userId: string,
): Promise<MembershipActionResult> {
  const actor = await requireUser();
  const organisation = cleanId(organisationId);
  const target = cleanId(userId);
  if (!organisation || !target) return { error: "That person isn't in this organisation." };

  const result = await removeMembership(prisma, actor, { organisationId: organisation, targetUserId: target });
  if (!result.ok) return { error: result.error };
  revalidateOrganisation();
  return { ok: true };
}

/** Leave an organisation. The last owner has to choose someone else first. */
export async function leaveOrganisationAction(organisationId: string): Promise<MembershipActionResult> {
  const actor = await requireUser();
  const organisation = cleanId(organisationId);
  if (!organisation) return { error: "That person isn't in this organisation." };

  const result = await leaveMembership(prisma, actor, organisation);
  if (!result.ok) return { error: result.error };
  revalidateOrganisation();
  return { ok: true };
}
