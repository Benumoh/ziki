import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * The Ziks ledger (#ziki-coins). `CoinEntry` is append-only: a balance is the sum of its rows, a correction is a new
 * row, nothing is edited or deleted (the database refuses both), and
 * `sourceKey` is unique so the same event written twice adds one row.
 *
 * A move between accounts is two rows written together, one negative and one
 * positive. Anything that spends takes a row lock on what it spends from, then
 * reads the balance, so two spends at once can't both pass the same balance.
 */

type Db = PrismaClient | Prisma.TransactionClient;
export type Tx = Prisma.TransactionClient;
export type CoinRow = Prisma.CoinEntryCreateManyInput;

export class CoinError extends Error {
  constructor(
    readonly code: "insufficient_ziks" | "invalid_amount" | "not_allowed" | "not_found" | "closed" | "payouts_not_ready" | "below_threshold" | "not_configured" | "out_of_funds" | "not_priced" | "paused",
    message: string,
  ) {
    super(message);
    this.name = "CoinError";
  }
}

/** Whole, positive Ziks. */
export function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new CoinError("invalid_amount", "Enter a whole number of Ziks above zero.");
}

/**
 * Whole Ziks: the ledger stores whole Ziks (1,000 to the dollar, so earnings move in as whole numbers), and every
 * amount read from it, and every sum of amounts, goes through this to come back as a plain whole number.
 */
export function zikOf(value: { toString(): string } | number | null | undefined): number {
  if (value == null) return 0;
  return roundZik(typeof value === "number" ? value : Number(value.toString()));
}

/** Ziks rounded to a whole number, so float arithmetic never leaves a stray digit. */
export function roundZik(value: number): number {
  return Math.round(value);
}

/**
 * Writes the rows unless their source keys exist. True if they were all
 * written now, false if the event had already been recorded. A pair is only
 * ever written inside one transaction, so it is both or neither.
 */
export async function appendRows(db: Db, rows: CoinRow[]): Promise<boolean> {
  const { count } = await db.coinEntry.createMany({ data: rows, skipDuplicates: true });
  return count === rows.length;
}

export async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
}

export async function lockBug(tx: Tx, bugId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${bugId} FOR UPDATE`;
}

export async function walletBalance(db: Db, userId: string): Promise<number> {
  const sum = await db.coinEntry.aggregate({ where: { account: "wallet", userId }, _sum: { amount: true } });
  return zikOf(sum._sum.amount);
}

export async function escrowBalance(db: Db, bugId: string): Promise<number> {
  const sum = await db.coinEntry.aggregate({ where: { account: "escrow", bugId }, _sum: { amount: true } });
  return zikOf(sum._sum.amount);
}

/** The Ziks held behind each of these issues, in one query, for lists. Issues with nothing held are left out. */
export async function escrowByBug(db: Db, bugIds: string[]): Promise<Map<string, number>> {
  if (bugIds.length === 0) return new Map();
  const rows = await db.coinEntry.groupBy({ by: ["bugId"], where: { account: "escrow", bugId: { in: bugIds } }, _sum: { amount: true } });
  const held = new Map<string, number>();
  for (const row of rows) if (row.bugId && zikOf(row._sum.amount) > 0) held.set(row.bugId, zikOf(row._sum.amount));
  return held;
}

/** The wallet rows that count as earned: paid for an issue, or moved in from the points ledger (#earnings-in-ziks). */
export const EARNED_KINDS = ["release", "earning"] as const;

/**
 * What a person may withdraw: the Ziks they earned (released to them, or
 * moved in from their points earnings) less what they already took out, never
 * more than the wallet holds. Ziks they bought are for spending on issues and
 * checks, not for cashing out.
 */
export function withdrawableOf(balance: number, earnedNet: number): number {
  return roundZik(Math.max(0, Math.min(balance, earnedNet)));
}

export async function earnedNet(db: Db, userId: string): Promise<number> {
  const sum = await db.coinEntry.aggregate({
    where: { account: "wallet", userId, kind: { in: [...EARNED_KINDS, "withdrawal", "withdrawal_reversal"] } },
    _sum: { amount: true },
  });
  return zikOf(sum._sum.amount);
}

/**
 * Whether this person has ever earned Ziks: paid for solving an issue, or earnings moved in from the points ledger.
 * Only they have anything to withdraw, so only they see Withdraw (someone who just posts issues never does). True even
 * after they withdrew it all.
 */
export async function hasEarnedZiks(db: Db, userId: string): Promise<boolean> {
  return (await db.coinEntry.count({ where: { account: "wallet", userId, kind: { in: [...EARNED_KINDS] }, amount: { gt: 0 } }, take: 1 })) > 0;
}

export async function walletSummary(db: Db, userId: string) {
  const [balance, earned] = await Promise.all([walletBalance(db, userId), earnedNet(db, userId)]);
  return { balance, earned, withdrawable: withdrawableOf(balance, earned) };
}

/** Takes `amount` out of a wallet in a row pair's first half, refusing to go below zero. Caller holds the user lock. */
export async function assertCanSpend(tx: Tx, userId: string, amount: number): Promise<void> {
  assertAmount(amount);
  const balance = await walletBalance(tx, userId);
  if (balance < amount) {
    throw new CoinError("insufficient_ziks", `You have ${balance.toLocaleString("en-US")} Ziks and this needs ${amount.toLocaleString("en-US")}.`);
  }
}
