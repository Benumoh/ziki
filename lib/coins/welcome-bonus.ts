import type { Prisma, PrismaClient } from "@prisma/client";
import { appendRows } from "./ledger";
import { ziksFor } from "./math";

type Db = PrismaClient | Prisma.TransactionClient;

/** What every new account gets to spend on its projects: $0.67 in Ziks (#signup-bonus). */
export const WELCOME_BONUS_ZIKS = ziksFor(0.67);

/**
 * The welcome bonus (#signup-bonus, #one-payment): Ziks straight into the new account's wallet, once, the first time
 * it joins or creates an organisation. It is a `bonus`, so it can fund a project or pay for a scan but is never
 * withdrawable (lib/coins/ledger.ts `EARNED_KINDS`). True if it was given now.
 */
export async function giveWelcomeBonus(db: Db, userId: string): Promise<boolean> {
  // Accounts given the bonus before it was paid in Ziks have it under another key.
  const given = await db.coinEntry.findFirst({ where: { account: "wallet", userId, kind: "bonus" }, select: { id: true } });
  if (given) return false;
  return appendRows(db, [{ account: "wallet", userId, kind: "bonus", amount: WELCOME_BONUS_ZIKS, sourceKey: `bonus:welcome:${userId}` }]);
}
