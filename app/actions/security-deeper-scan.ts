"use server";

import { auth } from "@/auth";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { OWNERS_ONLY_MESSAGE } from "@/lib/security-checks";
import { deeperScanQuote, payAndStartDeeperScan } from "@/lib/security-checks/deeper-scan";
import { kickCheck } from "@/lib/security-checks/engine";
import { prisma } from "@/lib/prisma";

/** Safe same-site return path; opening it after sign-in never charges or starts work. */
async function checkoutAccess(checkId: string) {
  if (typeof checkId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(checkId)) {
    return { ok: false as const, reason: "not_found" as const, error: "That scan isn't in your scans." };
  }
  if (!(await auth())?.user) {
    return { ok: false as const, reason: "sign_in_required" as const, signInUrl: `/login?callbackUrl=${encodeURIComponent(`/security/checks/${checkId}`)}`, error: "Sign in to pay and start your deeper scan." };
  }
  const user = await requireUser();
  const access = await currentOrganisationAccess(user.id, user.role);
  if (!access.organisationId || !access.admin) {
    return { ok: false as const, reason: "not_found" as const, error: OWNERS_ONLY_MESSAGE };
  }
  return { ok: true as const, userId: user.id, organisationId: access.organisationId };
}

/** Seyi: call to display the price, wallet, eligibility and sign-in link. No writes. */
export async function deeperScanCost(checkId: string) {
  const access = await checkoutAccess(checkId);
  if (!access.ok) return access;
  return deeperScanQuote(access.organisationId, access.userId, checkId);
}

/** Seyi: call only after explicit payment consent; amount and owner are derived on the server. */
export async function startPaidDeeperScan(checkId: string) {
  const access = await checkoutAccess(checkId);
  if (!access.ok) return access;
  const outcome = await payAndStartDeeperScan(access.organisationId, access.userId, checkId);
  if (outcome.ok) {
    after(() => kickCheck(prisma, outcome.checkId));
    revalidatePath("/security");
    revalidatePath(`/security/checks/${outcome.checkId}`);
  }
  return outcome;
}
