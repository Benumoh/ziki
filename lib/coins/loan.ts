import type { Prisma, PrismaClient } from "@prisma/client";
import { CoinError, assertAmount, walletBalance, type Tx } from "./ledger";
import { ZIKS_PER_DOLLAR } from "./math";

/**
 * Borrowing Ziks to try Security (16 Nov call with Mark: "would you like to borrow $20 worth of credit and try
 * it out"). A person who has never bought Ziks may borrow ZIKS_LOAN once. It is an overdraft, not a gift: no row
 * is written; their wallet may simply go down to -ZIKS_LOAN, and only for Security payments. Their first purchase
 * pays it back by itself, because a balance is the sum of its rows (at -1,200, buying 5,000 leaves 3,800), and from then on
 * the overdraft is gone for good.
 *
 * Only Security may use it: borrowed Ziks put behind an issue's reward could be earned by the borrower's own
 * agent and withdrawn as money, so funding an issue (lib/coins/fund.ts) still refuses to go below zero.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** $2 of Ziks: as much as it was before Ziks moved to 1,000 to the dollar. */
export const ZIKS_LOAN = 2 * ZIKS_PER_DOLLAR;

export type LoanState = {
  /** May borrow now: never borrowed and never bought Ziks. */
  canBorrow: boolean;
  /** Ziks below zero this person may still go, for Security payments: ZIKS_LOAN while a loan is open, else 0. */
  overdraft: number;
};

async function hasBought(db: Pick<Db, "coinEntry">, userId: string): Promise<boolean> {
  return (await db.coinEntry.count({ where: { account: "wallet", userId, kind: "purchase" }, take: 1 })) > 0;
}

export async function loanState(db: Db, userId: string): Promise<LoanState> {
  const [user, bought] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { ziksLoanAt: true } }),
    hasBought(db, userId),
  ]);
  if (!user || bought) return { canBorrow: false, overdraft: 0 };
  return user.ziksLoanAt ? { canBorrow: false, overdraft: ZIKS_LOAN } : { canBorrow: true, overdraft: 0 };
}

/** What the person owes from a loan: the part of their wallet below zero. */
export function owedOf(balance: number): number {
  return balance < 0 ? -balance : 0;
}

/**
 * Takes the loan, once. Only an explicit click does this ("Borrow 2,000 Ziks"); nothing borrows on its own.
 * Returns false when the person may not borrow (already borrowed, or has bought Ziks).
 */
export async function takeZiksLoan(db: Pick<PrismaClient, "user" | "coinEntry">, userId: string, now = new Date()): Promise<boolean> {
  if (await hasBought(db, userId)) return false;
  const { count } = await db.user.updateMany({ where: { id: userId, ziksLoanAt: null }, data: { ziksLoanAt: now } });
  return count === 1;
}

/**
 * Like `assertCanSpend`, but a Security payment may also use an open loan's overdraft. The caller holds the user
 * lock. Throws `insufficient_ziks` when even the overdraft doesn't cover it.
 */
export async function assertCanSpendOnSecurity(tx: Tx, userId: string, amount: number): Promise<void> {
  assertAmount(amount);
  const [balance, loan] = await Promise.all([walletBalance(tx, userId), loanState(tx, userId)]);
  if (balance + loan.overdraft < amount) {
    throw new CoinError("insufficient_ziks", `You have ${balance.toLocaleString("en-US")} Ziks and this needs ${amount.toLocaleString("en-US")}.`);
  }
}
