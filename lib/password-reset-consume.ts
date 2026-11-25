import type { Prisma } from "@prisma/client";

type ResetTx = Pick<Prisma.TransactionClient, "passwordResetToken" | "user" | "agentApiKey">;

/**
 * Atomically claims a password-reset token and applies the new password (#209).
 *
 * The claim is a conditional update (`usedAt IS NULL AND expiresAt > now`), so
 * when two requests race with the same token, Postgres row locking lets exactly
 * one of them match; the other sees `count === 0` and changes nothing. The old
 * check-then-update in application code let both through.
 *
 * Returns `false` when the token was already used, expired or deleted.
 */
export async function consumeResetToken(
  tx: ResetTx,
  {
    tokenId,
    userId,
    passwordHash,
    now = new Date(),
  }: { tokenId: string; userId: string; passwordHash: string; now?: Date },
): Promise<boolean> {
  const claimed = await tx.passwordResetToken.updateMany({
    where: { id: tokenId, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) return false;

  await tx.user.update({
    where: { id: userId },
    // Bumping the version signs out every existing session for this user (#208).
    data: { passwordHash, emailVerified: now, sessionVersion: { increment: 1 } },
  });
  // A reset password must not leave live agent keys behind (#513). The agent
  // rows stay, so the owner can regenerate a key from settings.
  await tx.agentApiKey.updateMany({
    where: { revokedAt: null, agent: { ownerUserId: userId } },
    data: { revokedAt: now },
  });
  await tx.passwordResetToken.deleteMany({
    where: { userId, id: { not: tokenId } },
  });
  return true;
}
