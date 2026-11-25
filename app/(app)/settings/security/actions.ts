"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import QRCode from "qrcode";
import { auth, signIn, updateSession } from "@/auth";
import { requireUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { sessionRefreshFor } from "@/lib/session-refresh";
import { resolveCurrentSessionId, syncSessionsAfterVersionBump } from "@/lib/user-sessions";
import { GOOGLE_INTENT_COOKIE, GOOGLE_SECURITY_COOKIE } from "@/lib/google-auth-cookies";
import { sealGoogleIntent, GOOGLE_INTENT_TTL_SECONDS, type GoogleSecurityOperation } from "@/lib/google-auth-intent";
import { appCookieOptions } from "@/lib/cookie-options";
import { consumeGoogleSecurityProof } from "@/lib/google-security";
import { isGoogleOAuthConfigured } from "@/lib/google-oauth";
import { consumeAuthRateLimit, clientIpFrom, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import {
  confirmEnrolment,
  confirmIdentity,
  disableTwoFactor,
  regenerateBackupCodes,
  startEnrolment,
} from "@/lib/two-factor";

/**
 * Two-factor settings (#648). Every action acts as the signed-in person and
 * re-authenticates inside the call (password or fresh Google proof, plus a code once it is on), so a
 * session left open on a shared computer cannot turn the factor off.
 *
 * Turning it on, turning it off and making new backup codes sign out every
 * other session (Ziki #389). This one gets a fresh token and stays signed in.
 */

export type StartTwoFactorResult =
  | { ok: true; secret: string; qr: string }
  | { ok: false; error: string; requiresGoogleVerification?: boolean };
export type BackupCodesActionResult = { ok: true; codes: string[] } | { ok: false; error: string; requiresGoogleVerification?: boolean };
export type PlainActionResult = { ok: true } | { ok: false; error: string; requiresGoogleVerification?: boolean };

const text = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

export async function beginGoogleSecurityAction(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string } | undefined> {
  const user = await requireUser();
  const operation = text(formData.get("operation"));
  if (operation !== "setup" && operation !== "disable" && operation !== "regenerate" && operation !== "password") return { error: "Choose a security setting to change." };
  if (!isGoogleOAuthConfigured()) return { error: "Google sign-in is not configured on this site." };
  const session = await auth();
  const account = await prisma.user.findUnique({ where: { id: user.id } });
  if (!session?.user.sessionId || session.user.id !== user.id || !account?.googleSubject || account.passwordHash ||
      account.sessionVersion !== session.user.sessionVersion) return { error: "Sign in with Google again before verifying this change." };
  const limit = await consumeAuthRateLimit("login", { email: account.email, ip: clientIpFrom(await headers()) });
  if (!limit.allowed) return { error: RATE_LIMIT_MESSAGE };
  const jar = await cookies();
  jar.delete(GOOGLE_SECURITY_COOKIE);
  jar.set(GOOGLE_INTENT_COOKIE, sealGoogleIntent({
    callbackUrl: "/settings/security",
    security: { userId: user.id, sessionId: session.user.sessionId, sessionVersion: account.sessionVersion,
      subject: account.googleSubject, operation },
  }), appCookieOptions(GOOGLE_INTENT_TTL_SECONDS));
  await signIn("google", { redirectTo: "/settings/security" }, { prompt: "select_account" });
}

async function confirmSecurityIdentity(userId: string, operation: GoogleSecurityOperation, formData: FormData) {
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (account?.passwordHash) return confirmIdentity(userId, {
    password: text(formData.get("password")), code: text(formData.get("code")),
  });
  const session = await auth();
  if (session?.user.id !== userId) return { ok: false as const, error: "Sign in again before making this change." };
  const jar = await cookies();
  const result = await consumeGoogleSecurityProof(jar.get(GOOGLE_SECURITY_COOKIE)?.value, session.user, operation, text(formData.get("code")));
  if (result.ok) jar.delete(GOOGLE_SECURITY_COOKIE);
  return result;
}

/**
 * Moves this session's token to the new version. If that fails, this session
 * is signed out along with the others, which is the safe side to fail on.
 */
async function keepThisSession(userId: string, sessionVersion: number) {
  const session = await auth().catch(() => null);
  const reqHeaders = await headers().catch(() => null);
  const currentSessionId = await resolveCurrentSessionId({
    userId,
    sessionId: session?.user?.sessionId,
    headers: reqHeaders,
  });
  await syncSessionsAfterVersionBump({
    userId,
    currentSessionId,
    newSessionVersion: sessionVersion,
  });

  // The jwt callback reads `sessionRefresh`; Auth.js types the update as a Session.
  const data = { sessionRefresh: sessionRefreshFor(userId, sessionVersion) } as unknown as Parameters<typeof updateSession>[0];
  try {
    await updateSession(data);
  } catch (error) {
    logger.error("[security] could not keep the current session after a two-factor change", error);
  }
}

export async function startTwoFactorAction(formData: FormData): Promise<StartTwoFactorResult> {
  const user = await requireUser();
  const identity = await confirmSecurityIdentity(user.id, "setup", formData);
  if (!identity.ok) return identity;

  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true } });
  const started = await startEnrolment(user.id, account?.email ?? user.email ?? user.id);
  if (!started.ok) return started;
  const qr = await QRCode.toDataURL(started.uri, { margin: 1, width: 220 });
  return { ok: true, secret: started.secret, qr };
}

export async function confirmTwoFactorAction(formData: FormData): Promise<BackupCodesActionResult> {
  const user = await requireUser();
  const result = await confirmEnrolment(user.id, text(formData.get("code")));
  if (!result.ok) return result;
  await keepThisSession(user.id, result.sessionVersion);
  revalidatePath("/settings/security");
  return { ok: true, codes: result.codes };
}

export async function disableTwoFactorAction(formData: FormData): Promise<PlainActionResult> {
  const user = await requireUser();
  const identity = await confirmSecurityIdentity(user.id, "disable", formData);
  if (!identity.ok) return identity;
  await keepThisSession(user.id, await disableTwoFactor(user.id));
  revalidatePath("/settings/security");
  return { ok: true };
}

export async function regenerateBackupCodesAction(formData: FormData): Promise<BackupCodesActionResult> {
  const user = await requireUser();
  const identity = await confirmSecurityIdentity(user.id, "regenerate", formData);
  if (!identity.ok) return identity;
  const result = await regenerateBackupCodes(user.id);
  if (!result.ok) return result;
  await keepThisSession(user.id, result.sessionVersion);
  revalidatePath("/settings/security");
  return { ok: true, codes: result.codes };
}
