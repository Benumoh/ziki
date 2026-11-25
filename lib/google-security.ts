import { prisma } from "@/lib/prisma";
import { createRawResetToken, hashResetToken } from "@/lib/password-reset";
import type { GoogleSecurityIntent, GoogleSecurityOperation } from "@/lib/google-auth-intent";
import { isTwoFactorEnabled, verifySecondFactor } from "@/lib/two-factor";
import { hash } from "bcryptjs";
import { isRecentGoogleAuthentication } from "@/lib/google-authentication";

export const GOOGLE_SECURITY_TTL_SECONDS = 5 * 60;
export type SecuritySession = { id: string; sessionId?: string; sessionVersion?: number; authenticationMethod?: string; authenticatedAt?: number };

/** OAuth callbacks must prove the same Google identity and still-active app session. */
export async function issueGoogleSecurityProof(intent: GoogleSecurityIntent, subject: string, session: SecuritySession | undefined) {
  if (!session?.sessionId || session.id !== intent.userId || session.sessionId !== intent.sessionId ||
      session.sessionVersion !== intent.sessionVersion || subject !== intent.subject) return null;
  const [user, tracked] = await Promise.all([
    prisma.user.findUnique({ where: { id: intent.userId } }),
    prisma.userSession.findUnique({ where: { id: intent.sessionId } }),
  ]);
  if (!user || user.passwordHash || user.googleSubject !== subject || user.sessionVersion !== intent.sessionVersion ||
      !tracked || tracked.userId !== user.id || tracked.revokedAt || tracked.sessionVersion !== user.sessionVersion) return null;
  const raw = createRawResetToken();
  await prisma.$transaction(async (tx) => {
    await tx.googleSecurityProof.deleteMany({ where: { OR: [
      { userId: user.id, sessionId: intent.sessionId }, { expiresAt: { lte: new Date() } },
    ] } });
    await tx.googleSecurityProof.create({ data: {
      tokenHash: hashResetToken(raw), userId: user.id, sessionId: intent.sessionId,
      sessionVersion: user.sessionVersion, googleSubject: subject, operation: intent.operation,
      expiresAt: new Date(Date.now() + GOOGLE_SECURITY_TTL_SECONDS * 1000),
    } });
  });
  return raw;
}

export async function readGoogleSecurityProof(raw: string | undefined, session: SecuritySession | undefined) {
  if (!session?.sessionId || !raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
  const proof = await prisma.googleSecurityProof.findUnique({ where: { tokenHash: hashResetToken(raw) }, include: { user: true } });
  if (!proof || proof.usedAt || proof.expiresAt.getTime() <= Date.now() || proof.userId !== session.id ||
      proof.sessionId !== session.sessionId || proof.sessionVersion !== session.sessionVersion ||
      proof.user.sessionVersion !== proof.sessionVersion || proof.user.passwordHash ||
      proof.user.googleSubject !== proof.googleSubject || !["setup", "disable", "regenerate", "password"].includes(proof.operation)) return null;
  return { ...proof, operation: proof.operation as GoogleSecurityOperation };
}

/** Each proof authorizes one operation; a valid existing factor is also needed for destructive changes. */
export async function consumeGoogleSecurityProof(raw: string | undefined, session: SecuritySession | undefined, operation: GoogleSecurityOperation, code?: string) {
  if (operation === "password") return { ok: false as const, error: "Use password setup to save your password." };
  const proof = await readGoogleSecurityProof(raw, session);
  if (!proof || proof.operation !== operation) return { ok: false as const, requiresGoogleVerification: true, error: "Verify with Google again before making this change." };
  if (operation !== "setup" && !(await verifySecondFactor(proof.userId, code ?? ""))) {
    return { ok: false as const, error: "Enter a valid authenticator or backup code." };
  }
  const claimed = await prisma.googleSecurityProof.updateMany({
    where: { id: proof.id, usedAt: null, expiresAt: { gt: new Date() },
      user: { sessionVersion: proof.sessionVersion, googleSubject: proof.googleSubject, passwordHash: null,
        userSessions: { some: { id: proof.sessionId, revokedAt: null, sessionVersion: proof.sessionVersion } } } },
    data: { usedAt: new Date() },
  });
  return claimed.count === 1 ? { ok: true as const } : { ok: false as const, requiresGoogleVerification: true, error: "This verification expired or was already used. Verify with Google again." };
}

class PasswordSetupChanged extends Error {}

/** Save the first password atomically, retaining Google and the enrolled factor. */
export async function addGooglePassword(raw: string | undefined, session: SecuritySession | undefined, password: string, code?: string) {
  const denied = { ok: false as const, requiresGoogleVerification: true, error: "Verify your Google account again before saving a password." };
  if (!session?.sessionId) return denied;
  const recentGoogleSignIn = isRecentGoogleAuthentication(session);
  const proof = recentGoogleSignIn ? null : await readGoogleSecurityProof(raw, session);
  if (!recentGoogleSignIn && proof?.operation !== "password") return denied;
  const account = await prisma.user.findUnique({ where: { id: session.id } });
  if (!account || account.passwordHash || !account.googleSubject || account.sessionVersion !== session.sessionVersion) return denied;
  if (await isTwoFactorEnabled(account.id) && !(await verifySecondFactor(account.id, code ?? ""))) {
    return { ok: false as const, error: "Enter a valid authenticator or backup code." };
  }
  const passwordHash = await hash(password, 10);
  try {
    await prisma.$transaction(async (tx) => {
      if (proof) {
        const claimed = await tx.googleSecurityProof.updateMany({
          where: { id: proof.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() },
        });
        if (claimed.count !== 1) throw new PasswordSetupChanged();
      }
      const changed = await tx.user.updateMany({
        where: { id: account.id, OR: [{ passwordHash: null }, { passwordHash: "" }], sessionVersion: account.sessionVersion, googleSubject: account.googleSubject,
          userSessions: { some: { id: session.sessionId, revokedAt: null, sessionVersion: account.sessionVersion } } },
        data: { passwordHash, sessionVersion: { increment: 1 } },
      });
      if (changed.count !== 1) throw new PasswordSetupChanged();
      await tx.passwordResetToken.deleteMany({ where: { userId: account.id } });
      await tx.agentApiKey.updateMany({ where: { revokedAt: null, agent: { ownerUserId: account.id } }, data: { revokedAt: new Date() } });
    });
    return { ok: true as const };
  } catch (error) {
    if (error instanceof PasswordSetupChanged) return denied;
    throw error;
  }
}
