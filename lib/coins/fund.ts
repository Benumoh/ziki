import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CoinError, appendRows, assertAmount, assertCanSpend, escrowBalance, lockBug, lockUser } from "./ledger";
import { SETTLE_FIELDS, lockPrice, priceStage, unpricedMessage } from "./budget";
import { MAX_FUND_ZIK } from "./math";
import { isPayer } from "./payers";

/**
 * Funding an issue (#ziki-coins). The owner moves Ziks from their wallet into
 * the issue's escrow, which locks its price (#price-lock). Releasing and
 * refunding it are in ./escrow.ts, which runs inside the payout's and the
 * close's own transactions.
 */

/** Whether this person may put Ziks behind this issue: its reporter, or someone who pays for its organisation (#payers). */
export async function canFundIssue(userId: string, bug: { organisationId: string; reporterId: string }): Promise<boolean> {
  if (bug.reporterId === userId) return true;
  return isPayer(prisma, userId, bug.organisationId);
}

/**
 * What an issue must be funded to, in Ziks: its settled price (lib/coins/budget.ts priceStage), which exists once three
 * agents have estimated it and a minute has passed since the last estimate. Before that nobody can fund it, so a rushed
 * funding can't fix the price ahead of the agents' estimates.
 */
async function priceFloor(tx: Pick<Prisma.TransactionClient, "bug">, bugId: string): Promise<number> {
  const issue = await tx.bug.findUniqueOrThrow({ where: { id: bugId }, select: SETTLE_FIELDS });
  const stage = priceStage(issue);
  if (stage.stage === "estimating" || stage.stage === "settling") throw new CoinError("not_priced", unpricedMessage(stage));
  return stage.price;
}

/** `requestId` makes a double click or a retry fund once. */
export async function fundIssue(userId: string, bugId: string, amount: number, requestId: string): Promise<{ funded: boolean; escrow: number }> {
  assertAmount(amount);
  if (amount > MAX_FUND_ZIK) throw new CoinError("invalid_amount", `Fund at most ${MAX_FUND_ZIK.toLocaleString("en-US")} Ziks at a time.`);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new CoinError("invalid_amount", "Reload the page and try again.");
  const bug = await prisma.bug.findUnique({
    where: { id: bugId },
    select: { organisationId: true, reporterId: true, status: true, isDeleted: true, payoutReleasedAt: true },
  });
  if (!bug || bug.isDeleted) throw new CoinError("not_found", "That issue doesn't exist.");
  if (!(await canFundIssue(userId, bug))) throw new CoinError("not_allowed", "Only the issue's reporter, an owner, or an admin an owner lets fund issues can fund it.");
  if (bug.status === "closed" || bug.payoutReleasedAt) throw new CoinError("closed", "This issue is finished, so it can't take more Ziks.");

  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    await lockBug(tx, bugId);
    // Re-read under the lock: the issue may have closed or paid out while we waited.
    const fresh = await tx.bug.findUniqueOrThrow({ where: { id: bugId }, select: { status: true, payoutReleasedAt: true } });
    if (fresh.status === "closed" || fresh.payoutReleasedAt) throw new CoinError("closed", "This issue is finished, so it can't take more Ziks.");
    const key = `fund:${bugId}:${userId}:${requestId}`;
    if (await tx.coinEntry.findUnique({ where: { sourceKey: `${key}:wallet` }, select: { id: true } })) {
      return { funded: false, escrow: await escrowBalance(tx, bugId) };
    }
    // An issue can't be funded below its price. Once it is funded to the price, any amount adds to it.
    const [floor, held] = await Promise.all([priceFloor(tx, bugId), escrowBalance(tx, bugId)]);
    if (held + amount < floor) {
      throw new CoinError("invalid_amount", `Fund at least ${(floor - held).toLocaleString("en-US")} Ziks: this issue's price is ${floor.toLocaleString("en-US")} Ziks.`);
    }
    await assertCanSpend(tx, userId, amount);
    await appendRows(tx, [
      { account: "wallet", userId, bugId, kind: "fund_issue", amount: -amount, sourceKey: `${key}:wallet` },
      { account: "escrow", bugId, kind: "fund_issue", amount, sourceKey: `${key}:escrow` },
    ]);
    // Held now, so the price is locked: no more estimates change it.
    await lockPrice(tx, bugId);
    return { funded: true, escrow: await escrowBalance(tx, bugId) };
  });
}
