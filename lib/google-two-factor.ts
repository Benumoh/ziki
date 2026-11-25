import { prisma } from "@/lib/prisma";
import { isTwoFactorEnabled, verifySecondFactor } from "@/lib/two-factor";
import { createRawResetToken, hashResetToken } from "@/lib/password-reset";
import { safeCallbackUrl } from "@/lib/safe-callback-url";

export const GOOGLE_CHALLENGE_TTL_SECONDS = 5 * 60;

/** A Google callback creates no session until Ziki's second factor is satisfied. */
export async function createGoogleChallenge(user: { id: string; sessionVersion: number }, callbackUrl: string) {
  const raw = createRawResetToken();
  await prisma.$transaction(async (tx) => {
    await tx.googleSignInChallenge.deleteMany({
      where: { OR: [{ userId: user.id }, { expiresAt: { lte: new Date() } }] },
    });
    await tx.googleSignInChallenge.create({ data: {
      tokenHash: hashResetToken(raw), userId: user.id, sessionVersion: user.sessionVersion,
      callbackUrl: safeCallbackUrl(callbackUrl),
      expiresAt: new Date(Date.now() + GOOGLE_CHALLENGE_TTL_SECONDS * 1000),
    } });
  });
  return raw;
}

/** Rate-limited, single-use proof; password/factor changes invalidate pending challenges. */
export async function consumeGoogleChallenge(raw: string, code: string) {
  if (!/^[a-f0-9]{64}$/.test(raw) || !code.trim()) return null;
  const challenge = await prisma.googleSignInChallenge.findUnique({
    where: { tokenHash: hashResetToken(raw) }, include: { user: true },
  });
  if (!challenge || challenge.usedAt || challenge.expiresAt.getTime() <= Date.now() ||
      challenge.user.sessionVersion !== challenge.sessionVersion || !challenge.user.googleSubject) return null;
  if (!(await isTwoFactorEnabled(challenge.userId)) || !(await verifySecondFactor(challenge.userId, code))) return null;
  const claimed = await prisma.googleSignInChallenge.updateMany({
    where: { id: challenge.id, usedAt: null, expiresAt: { gt: new Date() },
      user: { sessionVersion: challenge.sessionVersion } },
    data: { usedAt: new Date() },
  });
  return claimed.count === 1 ? { user: challenge.user, callbackUrl: safeCallbackUrl(challenge.callbackUrl) } : null;
}
