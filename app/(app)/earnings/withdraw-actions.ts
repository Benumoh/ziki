"use server";

import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { beingChecked } from "@/lib/earnings";
import { walletSummary } from "@/lib/coins/ledger";

/** What the Withdraw window shows, in Ziks: what can be withdrawn now, and what is still being checked. */
export type WithdrawDetails = { available: number; checking: number };

/**
 * What the Withdraw window shows (#one-payment): the same money as the Withdraw page, the Ziks wallet's withdrawable
 * part, in every workspace, with what funded issues will still pay once they are live shown beside it. Read when the
 * window opens, so ordinary pages don't pay for it. Your own money only.
 */
export async function withdrawDetailsAction(): Promise<WithdrawDetails> {
  const user = await requireUser();
  const [wallet, checking] = await Promise.all([walletSummary(prisma, user.id), beingChecked(prisma, user.id)]);
  return { available: wallet.withdrawable, checking };
}
