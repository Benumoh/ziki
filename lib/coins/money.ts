import type { PrismaClient } from "@prisma/client";
import { roundZik, withdrawableOf, zikOf } from "./ledger";
import { TEST_CURRENCY } from "./test-mode";

/**
 * The money page's numbers (#ziki-coins), read straight off the ledger.
 * Everything is in Ziks; `reconcile` is where they meet dollars.
 */

export type MoneyTotals = {
  bought: number;
  /** Ziks moved in from people's points earnings and welcome bonuses (#earnings-in-ziks): like a purchase, they come into the ledger from outside. */
  fromEarnings: number;
  inEscrow: number;
  owedToEarners: number;
  /** Ziks people hold that they bought or were refunded and can only spend. */
  spendable: number;
  withdrawn: number;
  revenue: number;
  revenueFromFees: number;
  revenueFromChecks: number;
  pendingWithdrawals: number;
  /** Plan fees paid, in cents. Cash in Stripe that buys no Ziks, so it is never in the ledger. */
  subscriptionCents: number;
  /** How many plan invoices that is. */
  subscriptionPayments: number;
  /** Ziks owners have put behind whole projects, not yet reserved for an issue (#project-budget). */
  inBudgets: number;
  /** Everything the ledger holds in accounts: wallets + escrow + revenue + project budgets. */
  inLedger: number;
};

export async function moneyTotals(db: PrismaClient): Promise<MoneyTotals> {
  const [byKind, byAccount, revenueByKind, wallets, pending, plans] = await Promise.all([
    db.coinEntry.groupBy({ by: ["kind"], where: { account: "wallet" }, _sum: { amount: true } }),
    db.coinEntry.groupBy({ by: ["account"], _sum: { amount: true } }),
    db.coinEntry.groupBy({ by: ["kind"], where: { account: "revenue" }, _sum: { amount: true } }),
    db.coinEntry.groupBy({ by: ["userId", "kind"], where: { account: "wallet" }, _sum: { amount: true } }),
    db.withdrawal.aggregate({ where: { status: "pending" }, _sum: { zik: true } }),
    db.coinPurchase.aggregate({ where: { planId: { not: null } }, _sum: { amountCents: true }, _count: true }),
  ]);
  /** Wallet rows by kind: purchases, withdrawals and their reversals only ever touch a wallet. */
  const kind = (name: string) => zikOf(byKind.find((row) => row.kind === name)?._sum.amount);
  const revenueOf = (name: string) => zikOf(revenueByKind.find((row) => row.kind === name)?._sum.amount);
  const account = (name: string) => zikOf(byAccount.find((row) => row.account === name)?._sum.amount);

  const people = new Map<string, { balance: number; earned: number }>();
  for (const row of wallets) {
    if (!row.userId) continue;
    const entry = people.get(row.userId) ?? { balance: 0, earned: 0 };
    const amount = zikOf(row._sum.amount);
    entry.balance = roundZik(entry.balance + amount);
    if (row.kind === "release" || row.kind === "earning" || row.kind === "withdrawal" || row.kind === "withdrawal_reversal") entry.earned = roundZik(entry.earned + amount);
    people.set(row.userId, entry);
  }
  let owedToEarners = 0;
  let spendable = 0;
  for (const { balance, earned } of people.values()) {
    const withdrawable = withdrawableOf(balance, earned);
    owedToEarners = roundZik(owedToEarners + withdrawable);
    spendable = roundZik(spendable + Math.max(0, balance) - withdrawable);
  }

  // A reversal puts Ziks back, so withdrawn is what left less what came back.
  const withdrawn = roundZik(-kind("withdrawal") - kind("withdrawal_reversal"));
  return {
    bought: kind("purchase"),
    // Welcome bonuses come in from the points ledger too; they are spendable, not earned (counted in `spendable`).
    fromEarnings: roundZik(kind("earning") + kind("bonus")),
    inEscrow: account("escrow"),
    owedToEarners,
    spendable,
    withdrawn,
    revenue: account("revenue"),
    revenueFromFees: revenueOf("fee"),
    revenueFromChecks: revenueOf("check_payment"),
    pendingWithdrawals: zikOf(pending._sum.zik),
    subscriptionCents: plans._sum.amountCents ?? 0,
    subscriptionPayments: plans._count,
    inBudgets: account("budget"),
    inLedger: roundZik(account("wallet") + account("escrow") + account("revenue") + account("budget")),
  };
}

/**
 * The ledger balances when what is in its accounts is exactly what was bought
 * or moved in from earnings, less what was withdrawn. Every other row moves
 * Ziks between accounts, so any difference means a row was written on one side
 * only.
 */
export function ledgerBalances(totals: Pick<MoneyTotals, "bought" | "fromEarnings" | "withdrawn" | "inLedger">): { expected: number; difference: number } {
  const expected = roundZik(totals.bought + totals.fromEarnings - totals.withdrawn);
  return { expected, difference: roundZik(totals.inLedger - expected) };
}

export type Reconciliation = {
  ledger: { expected: number; difference: number };
  stripe: { availableCents: number; pendingCents: number } | null;
  stripeError: string | null;
  /** What Stripe should hold if the ledger is right: net of Stripe's fees, less what was sent to earners. */
  expectedCents: number;
  /** Stripe's balance less the expected one; null when Stripe couldn't be read. */
  differenceCents: number | null;
};

/**
 * Stripe's balance against the ledger. The platform balance should be what
 * buyers paid, less Stripe's fees on those charges, less the transfers sent to
 * earners (pending and paid ones). `readBalance` is Stripe's balance in cents,
 * injected so this can be tested without Stripe.
 */
export async function reconcile(
  db: PrismaClient,
  totals: MoneyTotals,
  readBalance: () => Promise<{ availableCents: number; pendingCents: number }>,
): Promise<Reconciliation> {
  const [purchases, transfers] = await Promise.all([
    // Test-mode purchases (lib/coins/test-mode.ts) never went through Stripe, so they are not part of what it should hold.
    db.coinPurchase.aggregate({ where: { currency: { not: TEST_CURRENCY } }, _sum: { amountCents: true, stripeFeeCents: true } }),
    db.withdrawal.aggregate({ where: { status: { in: ["pending", "paid"] } }, _sum: { amountCents: true } }),
  ]);
  const expectedCents = (purchases._sum.amountCents ?? 0) - (purchases._sum.stripeFeeCents ?? 0) - (transfers._sum.amountCents ?? 0);
  let stripe: Reconciliation["stripe"] = null;
  let stripeError: string | null = null;
  try {
    stripe = await readBalance();
  } catch (error) {
    stripeError = error instanceof Error ? error.message : "Stripe couldn't be read.";
  }
  return {
    ledger: ledgerBalances(totals),
    stripe,
    stripeError,
    expectedCents,
    differenceCents: stripe ? stripe.availableCents + stripe.pendingCents - expectedCents : null,
  };
}
