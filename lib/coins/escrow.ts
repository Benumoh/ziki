import { lockProject } from "./budget";
import { appendRows, escrowBalance, lockBug, zikOf, type Tx } from "./ledger";
import { splitByWeight } from "./math";

/**
 * An issue's escrow (#ziki-coins). The owner funds it from their wallet (./fund.ts), or the project's budget reserves
 * it. Once the issue is live the escrow pays everyone who worked on it (./issue-payout.ts), and whatever is still in
 * escrow when the issue closes goes back to whoever funded it.
 */

/** The issue's funders and what they have put in. */
async function contributions(tx: Tx, bugId: string): Promise<Map<string, number>> {
  const rows = await tx.coinEntry.groupBy({
    by: ["userId"],
    where: { account: "wallet", bugId, kind: { in: ["fund_issue", "refund"] } },
    _sum: { amount: true },
  });
  // Funding is negative on the wallet, a refund positive: what is still theirs behind the issue.
  return new Map(rows.filter((row) => row.userId).map((row) => [row.userId as string, -zikOf(row._sum.amount)]));
}

/**
 * Gives back what is still in escrow when the issue closes, to whoever put it
 * there, in proportion to what each put in. Runs in the close's transaction.
 */
export async function refundEscrow(tx: Tx, bugId: string): Promise<number> {
  await lockBug(tx, bugId);
  let escrow = await escrowBalance(tx, bugId);
  if (escrow <= 0) return 0;
  // What a project's budget reserved for this issue goes back to that budget first (#project-budget); the rest to the people who funded the issue itself.
  const toBudget = await returnReservedToBudget(tx, bugId, escrow);
  escrow -= toBudget;
  if (escrow <= 0) return toBudget;
  const funders = await contributions(tx, bugId);
  const shares = splitByWeight(escrow, funders);
  if (shares.size === 0) return toBudget;
  // A later refund after a re-open and re-close gets its own key from the escrow it empties.
  const generation = await tx.coinEntry.count({ where: { account: "escrow", bugId, kind: "refund" } });
  const rows: Parameters<typeof appendRows>[1] = [];
  for (const [userId, share] of shares) {
    const key = `refund:${bugId}:${userId}:${generation}`;
    rows.push(
      { account: "escrow", bugId, kind: "refund", amount: -share, sourceKey: `${key}:escrow` },
      { account: "wallet", userId, bugId, kind: "refund", amount: share, sourceKey: `${key}:wallet` },
    );
  }
  await appendRows(tx, rows);
  return toBudget + [...shares.values()].reduce((sum, share) => sum + share, 0);
}

/** Puts back into the project's budget what it reserved for this issue and the issue still holds, up to `escrow`. Returns what it moved. */
async function returnReservedToBudget(tx: Tx, bugId: string, escrow: number): Promise<number> {
  const reserved = await tx.coinEntry.aggregate({ where: { account: "escrow", bugId, kind: { in: ["reserve", "unreserve"] } }, _sum: { amount: true } });
  const amount = Math.min(escrow, Math.max(0, zikOf(reserved._sum.amount)));
  if (amount <= 0) return 0;
  const bug = await tx.bug.findUniqueOrThrow({ where: { id: bugId }, select: { projectId: true } });
  await lockProject(tx, bug.projectId);
  // A later return after a re-open and re-close gets its own key from the returns already made.
  const generation = await tx.coinEntry.count({ where: { account: "escrow", bugId, kind: "unreserve" } });
  const key = `unreserve:${bugId}:${generation}`;
  await appendRows(tx, [
    { account: "escrow", bugId, projectId: bug.projectId, kind: "unreserve", amount: -amount, sourceKey: `${key}:escrow` },
    { account: "budget", projectId: bug.projectId, bugId, kind: "unreserve", amount, sourceKey: `${key}:budget` },
  ]);
  return amount;
}
