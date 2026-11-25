import type { MembershipRole, Prisma, PrismaClient } from "@prisma/client";
import type { AppRole } from "@/lib/roles";
import { isSuperAdmin } from "@/lib/roles";

/**
 * Changing who can administer an organisation (#504, #515, #569).
 *
 * Owners (and the site super admin) set roles. Owners and admins can remove
 * members. The last owner always stays, so an organisation can't be left
 * with nobody allowed to invite or promote.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export const MEMBERSHIP_ADMIN_ERRORS = {
  "not-found": "That person isn't in this organisation.",
  "not-allowed": "Only an owner of this organisation can change roles.",
  "remove-not-allowed": "Only an owner or admin of this organisation can remove someone.",
  "last-owner": "This organisation needs at least one owner.",
  "same-role": "They already have that role.",
  "cannot-remove-self": "You can't remove yourself. Leave the organisation instead.",
  "admin-removes-member-only": "Admins can remove members. Ask an owner to change another admin.",
  "fund-not-allowed": "Only an owner of this organisation can choose who funds its issues.",
  "fund-admins-only": "Only admins can be given this. Owners always fund issues; make a member an admin first.",
  failed: "Couldn't update that membership. Try again.",
} as const;

export type MembershipAdminError = keyof typeof MEMBERSHIP_ADMIN_ERRORS;

export type MembershipRoleRefusal =
  | "not-found"
  | "not-allowed"
  | "last-owner"
  | "same-role"
  | null;

/** Whether `actor` may set `target` to `nextRole` inside this organisation. */
export function refuseMembershipRoleChange(input: {
  actorIsOwner: boolean;
  actorIsSuperAdmin: boolean;
  target: { role: MembershipRole } | null;
  nextRole: MembershipRole;
  ownerCount: number;
}): MembershipRoleRefusal {
  const { actorIsOwner, actorIsSuperAdmin, target, nextRole, ownerCount } = input;
  if (!target) return "not-found";
  if (!actorIsOwner && !actorIsSuperAdmin) return "not-allowed";
  if (nextRole === "owner") return "not-allowed";
  if (target.role === nextRole) return "same-role";
  if (target.role === "owner" && ownerCount <= 1) return "last-owner";
  return null;
}

export type MemberRemovalRefusal =
  | "not-found"
  | "not-allowed"
  | "last-owner"
  | "cannot-remove-self"
  | "admin-removes-member-only"
  | null;

/** Whether `actor` may remove `target`. Leaving is a separate check. */
export function refuseMemberRemoval(input: {
  actorId: string;
  actorIsOwner: boolean;
  actorIsAdmin: boolean;
  actorIsSuperAdmin: boolean;
  target: { userId: string; role: MembershipRole } | null;
  ownerCount: number;
}): MemberRemovalRefusal {
  const { actorId, actorIsOwner, actorIsAdmin, actorIsSuperAdmin, target, ownerCount } = input;
  if (!target) return "not-found";
  if (target.userId === actorId) return "cannot-remove-self";
  if (!actorIsOwner && !actorIsAdmin && !actorIsSuperAdmin) return "not-allowed";
  if (target.role === "owner" && ownerCount <= 1) return "last-owner";
  if (!actorIsOwner && !actorIsSuperAdmin && target.role !== "member") {
    return "admin-removes-member-only";
  }
  return null;
}

export type LeaveRefusal = "not-found" | "last-owner" | null;

/** Anyone can leave, except the last owner. */
export function refuseLeave(input: {
  target: { role: MembershipRole } | null;
  ownerCount: number;
}): LeaveRefusal {
  if (!input.target) return "not-found";
  if (input.target.role === "owner" && input.ownerCount <= 1) return "last-owner";
  return null;
}

export type MembershipAdminResult = { ok: true } | { ok: false; error: string };

function refusalMessage(code: string): string {
  if (code in MEMBERSHIP_ADMIN_ERRORS) {
    return MEMBERSHIP_ADMIN_ERRORS[code as MembershipAdminError];
  }
  return MEMBERSHIP_ADMIN_ERRORS.failed;
}

/** Run `fn` in a transaction when `db` can start one. A client already inside one just runs it. */
async function inTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  if ("$transaction" in db && typeof db.$transaction === "function") {
    return (db as PrismaClient).$transaction((tx) => fn(tx));
  }
  return fn(db);
}

type Actor = { id: string; role?: AppRole | null };

async function ownerCount(db: Db, organisationId: string): Promise<number> {
  return db.membership.count({ where: { organisationId, role: "owner" } });
}

async function recordChange(
  db: Db,
  row: {
    organisationId: string;
    actorUserId: string;
    targetUserId: string;
    action: "role_changed" | "removed" | "left" | "can_fund_on" | "can_fund_off";
    fromRole: MembershipRole;
    toRole: MembershipRole | null;
  },
): Promise<void> {
  await db.membershipChange.create({ data: row });
}

/**
 * Set a member's role in one organisation. Does not touch the site-wide
 * `User.role`, and never removes the last owner.
 */
export async function changeMembershipRole(
  db: Db,
  actor: Actor,
  input: { organisationId: string; targetUserId: string; nextRole: MembershipRole },
): Promise<MembershipAdminResult> {
  return inTransaction(db, async (tx) => {
    const [target, actorMembership, owners] = await Promise.all([
      tx.membership.findUnique({
        where: { organisationId_userId: { organisationId: input.organisationId, userId: input.targetUserId } },
        select: { id: true, role: true },
      }),
      tx.membership.findUnique({
        where: { organisationId_userId: { organisationId: input.organisationId, userId: actor.id } },
        select: { role: true },
      }),
      ownerCount(tx, input.organisationId),
    ]);

    const refusal = refuseMembershipRoleChange({
      actorIsOwner: actorMembership?.role === "owner",
      actorIsSuperAdmin: isSuperAdmin(actor.role),
      target,
      nextRole: input.nextRole,
      ownerCount: owners,
    });
    if (refusal || !target) return { ok: false, error: refusalMessage(refusal ?? "not-found") };

    // A new role starts without paying (#payers): an owner turns it on again for an admin who should.
    await tx.membership.update({ where: { id: target.id }, data: { role: input.nextRole, canFundIssues: false } });
    await recordChange(tx, {
      organisationId: input.organisationId,
      actorUserId: actor.id,
      targetUserId: input.targetUserId,
      action: "role_changed",
      fromRole: target.role,
      toRole: input.nextRole,
    });
    if (typeof tx.user?.update === "function") {
      await tx.user.update({
        where: { id: input.targetUserId },
        data: { sessionVersion: { increment: 1 } },
      });
    }
    return { ok: true };
  });
}

/** Whether `actor` may turn "Can fund issues" on or off for `target` (#payers): owners only, and only for an admin. */
export function refuseCanFundChange(input: {
  actorIsOwner: boolean;
  actorIsSuperAdmin: boolean;
  target: { role: MembershipRole; canFundIssues: boolean } | null;
  canFund: boolean;
}): "not-found" | "fund-not-allowed" | "fund-admins-only" | "unchanged" | null {
  const { actorIsOwner, actorIsSuperAdmin, target, canFund } = input;
  if (!target) return "not-found";
  if (!actorIsOwner && !actorIsSuperAdmin) return "fund-not-allowed";
  if (target.role !== "admin") return "fund-admins-only";
  if (target.canFundIssues === canFund) return "unchanged";
  return null;
}

/**
 * Lets an admin fund the organisation's issues, or stops them (#payers, lib/coins/payers.ts). Funding spends the
 * admin's own wallet, so only an owner chooses who may. Owners always pay; members never do.
 */
export async function setCanFundIssues(
  db: Db,
  actor: Actor,
  input: { organisationId: string; targetUserId: string; canFund: boolean },
): Promise<MembershipAdminResult> {
  return inTransaction(db, async (tx) => {
    const [target, actorMembership] = await Promise.all([
      tx.membership.findUnique({
        where: { organisationId_userId: { organisationId: input.organisationId, userId: input.targetUserId } },
        select: { id: true, role: true, canFundIssues: true },
      }),
      tx.membership.findUnique({
        where: { organisationId_userId: { organisationId: input.organisationId, userId: actor.id } },
        select: { role: true },
      }),
    ]);
    const refusal = refuseCanFundChange({
      actorIsOwner: actorMembership?.role === "owner",
      actorIsSuperAdmin: isSuperAdmin(actor.role),
      target,
      canFund: input.canFund,
    });
    // Already set that way (a double click): nothing to do.
    if (refusal === "unchanged") return { ok: true };
    if (refusal || !target) return { ok: false, error: refusalMessage(refusal ?? "not-found") };

    await tx.membership.update({ where: { id: target.id }, data: { canFundIssues: input.canFund } });
    await recordChange(tx, {
      organisationId: input.organisationId,
      actorUserId: actor.id,
      targetUserId: input.targetUserId,
      action: input.canFund ? "can_fund_on" : "can_fund_off",
      fromRole: target.role,
      toRole: target.role,
    });
    return { ok: true };
  });
}

/** Remove someone else. Admins can remove members; owners can remove anyone but the last owner. */
export async function removeMembership(
  db: Db,
  actor: Actor,
  input: { organisationId: string; targetUserId: string },
): Promise<MembershipAdminResult> {
  return inTransaction(db, async (tx) => {
    const [target, actorMembership, owners] = await Promise.all([
      tx.membership.findUnique({
        where: { organisationId_userId: { organisationId: input.organisationId, userId: input.targetUserId } },
        select: { id: true, role: true, userId: true },
      }),
      tx.membership.findUnique({
        where: { organisationId_userId: { organisationId: input.organisationId, userId: actor.id } },
        select: { role: true },
      }),
      ownerCount(tx, input.organisationId),
    ]);

    const refusal = refuseMemberRemoval({
      actorId: actor.id,
      actorIsOwner: actorMembership?.role === "owner",
      actorIsAdmin: actorMembership?.role === "admin",
      actorIsSuperAdmin: isSuperAdmin(actor.role),
      target,
      ownerCount: owners,
    });
    if (refusal || !target) {
      const code = refusal === "not-allowed" ? "remove-not-allowed" : (refusal ?? "not-found");
      return { ok: false, error: refusalMessage(code) };
    }

    await tx.membership.delete({ where: { id: target.id } });
    await switchOffAgentsIn(tx, input.targetUserId, input.organisationId);
    await recordChange(tx, {
      organisationId: input.organisationId,
      actorUserId: actor.id,
      targetUserId: input.targetUserId,
      action: "removed",
      fromRole: target.role,
      toRole: null,
    });
    if (typeof tx.user?.update === "function") {
      await tx.user.update({
        where: { id: input.targetUserId },
        data: { sessionVersion: { increment: 1 } },
      });
    }
    return { ok: true };
  });
}

/**
 * Someone who leaves an organisation takes their agents with them (#user-agents):
 * each is switched off there and its keys for it stop. They keep working elsewhere.
 */
async function switchOffAgentsIn(tx: Prisma.TransactionClient, userId: string, organisationId: string) {
  if (typeof tx.agentActivation?.updateMany !== "function") return;
  const now = new Date();
  await tx.agentActivation.updateMany({ where: { organisationId, deactivatedAt: null, agent: { ownerUserId: userId } }, data: { deactivatedAt: now } });
  await tx.agentApiKey.updateMany({ where: { organisationId, revokedAt: null, agent: { ownerUserId: userId } }, data: { revokedAt: now } });
}

/** Leave an organisation. The last owner has to choose another owner first. */
export async function leaveMembership(
  db: Db,
  actor: Actor,
  organisationId: string,
): Promise<MembershipAdminResult> {
  return inTransaction(db, async (tx) => {
    const [target, owners] = await Promise.all([
      tx.membership.findUnique({
        where: { organisationId_userId: { organisationId, userId: actor.id } },
        select: { id: true, role: true },
      }),
      ownerCount(tx, organisationId),
    ]);
    const refusal = refuseLeave({ target, ownerCount: owners });
    if (refusal || !target) return { ok: false, error: refusalMessage(refusal ?? "not-found") };

    await tx.membership.delete({ where: { id: target.id } });
    await switchOffAgentsIn(tx, actor.id, organisationId);
    await recordChange(tx, {
      organisationId,
      actorUserId: actor.id,
      targetUserId: actor.id,
      action: "left",
      fromRole: target.role,
      toRole: null,
    });
    return { ok: true };
  });
}
