import type { PointRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { pointsNumber } from "@/lib/points/rules";
import { appendRows, lockUser, roundZik, zikOf, type CoinRow, type Tx } from "./ledger";
import { ZIKS_PER_DOLLAR } from "./math";

/**
 * Earnings in Ziks (#earnings-in-ziks). What people earn on the points ledger (`PointEntry`, in dollars, every
 * workspace together) moves into their Ziks wallet at 10 Ziks a dollar, to one decimal, so earned money can fund a
 * project and is withdrawn from one place.
 *
 * Each points entry moves in as its own `earning` row (source key `earning:<pointEntryId>`), so the wallet lists what
 * earned it: "+6.7 Ziks · Welcome bonus · PayScan". The points ledger stays the record of what was earned, and the
 * wallet's earnings always add up to exactly what the earnings page shows: each row is the step the running total takes
 * at a tenth, and any rounding left over goes on the last row written. A correction that takes points back is a
 * negative row. Money still being checked on a live issue isn't in the points ledger yet, so it isn't moved either.
 */

/** A points total (dollars) in Ziks, to a tenth: $44.04 is 440.4 Ziks. */
export function earnedZiksFor(dollars: number): number {
  return roundZik(Number((dollars * ZIKS_PER_DOLLAR).toFixed(6)));
}

type PointRow = { id: string; points: number };

/**
 * The rows that bring the wallet's earnings from `moved` to the points total: one per entry not moved yet, in the
 * order they were earned, the last one carrying whatever rounding is left. Pure, so it can be checked on its own.
 */
export function earningRows(userId: string, entries: readonly PointRow[], movedKeys: ReadonlySet<string>, moved: number, adjustments: number): CoinRow[] {
  const total = entries.reduce((sum, entry) => sum + entry.points, 0);
  const gap = roundZik(earnedZiksFor(total) - moved);
  if (gap === 0) return [];
  const rows: { sourceKey: string; amount: number }[] = [];
  let running = 0;
  for (const entry of entries) {
    const before = earnedZiksFor(running);
    running += entry.points;
    const key = `earning:${entry.id}`;
    if (!movedKeys.has(key)) rows.push({ sourceKey: key, amount: roundZik(earnedZiksFor(running) - before) });
  }
  const residue = roundZik(gap - rows.reduce((sum, row) => sum + row.amount, 0));
  if (residue !== 0) {
    if (rows.length > 0) rows[rows.length - 1].amount = roundZik(rows[rows.length - 1].amount + residue);
    else rows.push({ sourceKey: `earning-adjust:${userId}:${adjustments + 1}`, amount: residue });
  }
  return rows.filter((row) => row.amount !== 0).map((row) => ({ account: "wallet", userId, kind: "earning", amount: row.amount, sourceKey: row.sourceKey }));
}

/** Moves anything newly earned into this person's wallet, inside the caller's transaction. Returns the Ziks moved (negative for a correction). */
export async function syncEarnedZiksIn(tx: Tx, userId: string): Promise<number> {
  await lockUser(tx, userId);
  const [points, moved] = await Promise.all([
    tx.pointEntry.aggregate({ where: { userId }, _sum: { points: true } }),
    tx.coinEntry.aggregate({ where: { account: "wallet", userId, kind: "earning" }, _sum: { amount: true } }),
  ]);
  const movedZiks = zikOf(moved._sum.amount);
  // Most visits find nothing new: two sums, and done.
  if (earnedZiksFor(pointsNumber(points._sum.points)) === movedZiks) return 0;

  const [entries, rows] = await Promise.all([
    tx.pointEntry.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, points: true } }),
    tx.coinEntry.findMany({ where: { account: "wallet", userId, kind: "earning" }, select: { sourceKey: true } }),
  ]);
  const movedKeys = new Set(rows.map((row) => row.sourceKey));
  const adjustments = rows.filter((row) => row.sourceKey.startsWith("earning-adjust:")).length;
  const add = earningRows(userId, entries.map((entry) => ({ id: entry.id, points: pointsNumber(entry.points) })), movedKeys, movedZiks, adjustments);
  if (add.length === 0) return 0;
  await appendRows(tx, add);
  return roundZik(add.reduce((sum, row) => sum + Number(row.amount), 0));
}

/** Moves anything newly earned into this person's wallet. Safe to call on every visit to a Ziks page. */
export async function syncEarnedZiks(userId: string): Promise<number> {
  return prisma.$transaction((tx) => syncEarnedZiksIn(tx, userId));
}

/** How many people one sweep brings up to date; the rest wait for the next run. */
const SWEEP_LIMIT = 500;

/**
 * The cron sweep: everyone whose wallet earnings don't match their points ledger, synced. The first run after release
 * moves everyone's existing earnings in.
 */
export async function sweepEarnedZiks(): Promise<{ checked: number; moved: number }> {
  const [points, moved] = await Promise.all([
    prisma.pointEntry.groupBy({ by: ["userId"], _sum: { points: true } }),
    prisma.coinEntry.groupBy({ by: ["userId"], where: { account: "wallet", kind: "earning" }, _sum: { amount: true } }),
  ]);
  const movedOf = new Map(moved.map((row) => [row.userId, zikOf(row._sum.amount)]));
  const behind = points
    .filter((row) => earnedZiksFor(pointsNumber(row._sum.points)) !== (movedOf.get(row.userId) ?? 0))
    .map((row) => row.userId)
    .slice(0, SWEEP_LIMIT);
  let total = 0;
  for (const userId of behind) total = roundZik(total + Math.abs(await syncEarnedZiks(userId)));
  return { checked: behind.length, moved: total };
}

/** What each kind of points entry was for, as the wallet's list says it. */
const EARNED_FOR: Record<PointRole, string> = {
  solver: "Solved",
  reporter: "Reported",
  reviewer: "Review accepted",
  triager: "Confirmed",
  submission: "Research answer accepted",
  dispatcher: "Dispatched",
  idea: "Verdict on idea",
  signup: "Welcome bonus",
  plan: "Plan approved",
  comment: "Comment upvoted",
  vote: "Vote",
  security_check: "Security check",
};

/**
 * What each moved-in earning was for, by its source key: "Solved #12 · Coins workspace", "Welcome bonus · PayScan".
 * A row whose points entry can't be found (or a rounding adjustment) has no label; the list says "Earnings".
 */
export async function earningLabels(sourceKeys: readonly string[]): Promise<Map<string, string>> {
  const ids = sourceKeys.filter((key) => key.startsWith("earning:")).map((key) => key.slice("earning:".length));
  if (ids.length === 0) return new Map();
  const entries = await prisma.pointEntry.findMany({
    where: { id: { in: ids } },
    select: { id: true, role: true, points: true, organisation: { select: { name: true } }, bug: { select: { number: true } }, idea: { select: { number: true } } },
  });
  return new Map(
    entries.map((entry) => {
      const ref = entry.bug ? ` #${entry.bug.number}` : entry.idea ? ` idea #${entry.idea.number}` : "";
      const what = pointsNumber(entry.points) < 0 ? `Correction${ref}` : `${EARNED_FOR[entry.role] ?? "Earned"}${ref}`;
      return [`earning:${entry.id}`, `${what} · ${entry.organisation.name}`];
    }),
  );
}
