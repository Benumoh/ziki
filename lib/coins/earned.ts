import { Prisma, type PayoutRole, type PrismaClient } from "@prisma/client";
import { escrowBalance, zikOf } from "./ledger";
import { issueContributors, planIssuePayout } from "./issue-payout";

/**
 * What people earned (#one-payment), read from the Ziks ledger: the `release` rows that paid them, each saying what it
 * paid for (`payoutRole`). An issue's funded Ziks pay everyone who worked on it once it is live
 * (./issue-payout.ts), and a security finding's unlock pays its finder. Nothing else pays, so this is all of it: the
 * Earnings page, the header, weekly goals, leaderboards and rankings all read here. Amounts are whole Ziks.
 *
 * "Waiting" is what someone will be paid from issues that are funded but not live yet (`pendingZiks`).
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** The wallet rows that are earnings. (`earning` rows are from before Ziks were the only payment.) */
export const EARNING_KINDS = ["release", "earning"] as const;

/** What each role is called where a payment is listed. */
export const PAYOUT_ROLE_LABELS: Record<PayoutRole, string> = {
  fixer: "Fixed",
  tester: "Tested",
  merge_reviewer: "Reviewed for merge",
  reporter: "Reported",
  confirmer: "Confirmed",
  estimator: "Estimated",
  awarder: "Awarded the bid",
  security_finder: "Security finding",
};

/** A person's earning rows, optionally in one organisation (by the issue they were paid for) and since a time. */
export function earningsWhere(userId: string, scope: { organisationId?: string | null; since?: Date | null } = {}): Prisma.CoinEntryWhereInput {
  return {
    account: "wallet",
    userId,
    kind: { in: [...EARNING_KINDS] },
    ...(scope.organisationId ? { bug: { organisationId: scope.organisationId } } : {}),
    ...(scope.since ? { createdAt: { gte: scope.since } } : {}),
  };
}

/** What a person has earned: in one organisation when it is given, else everywhere; since `since` when given. */
export async function earnedZiks(db: Db, userId: string, scope: { organisationId?: string | null; since?: Date | null } = {}): Promise<number> {
  const sum = await db.coinEntry.aggregate({ where: earningsWhere(userId, scope), _sum: { amount: true } });
  return zikOf(sum._sum.amount);
}

/** What a person earned in each role, everywhere. */
export async function earnedByRole(db: Db, userId: string): Promise<Map<PayoutRole, number>> {
  const rows = await db.coinEntry.groupBy({ by: ["payoutRole"], where: { ...earningsWhere(userId), payoutRole: { not: null } }, _sum: { amount: true } });
  return new Map(rows.filter((row) => row.payoutRole).map((row) => [row.payoutRole as PayoutRole, zikOf(row._sum.amount)]));
}

/** How many issues a person was paid for fixing. */
export async function fixedCount(db: Db, userId: string): Promise<number> {
  return db.coinEntry.count({ where: { ...earningsWhere(userId), payoutRole: "fixer", amount: { gt: 0 } } });
}

/** What a person earned in each organisation, by the issues they were paid for. */
export async function earnedByOrganisation(db: Db, userId: string): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<{ organisationId: string; total: Prisma.Decimal | null }[]>`
    SELECT b."organisationId", SUM(c."amount") AS "total"
    FROM "CoinEntry" c JOIN "Bug" b ON b."id" = c."bugId"
    WHERE c."account" = 'wallet' AND c."userId" = ${userId} AND c."kind" IN ('release', 'earning')
    GROUP BY b."organisationId"`;
  return new Map(rows.map((row) => [row.organisationId, zikOf(row.total)]));
}

/** One payment, as a list shows it. */
export type EarningRow = { id: string; amount: number; role: PayoutRole | null; label: string; issueNumber: number | null; issueTitle: string | null; at: Date };

/** A person's latest payments, newest first. */
export async function latestEarnings(db: Db, userId: string, take = 6): Promise<EarningRow[]> {
  const rows = await db.coinEntry.findMany({
    where: earningsWhere(userId),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: { id: true, amount: true, payoutRole: true, createdAt: true, bug: { select: { number: true, title: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    amount: zikOf(row.amount),
    role: row.payoutRole,
    label: row.payoutRole ? PAYOUT_ROLE_LABELS[row.payoutRole] : "Earned",
    issueNumber: row.bug?.number ?? null,
    issueTitle: row.bug?.title ?? null,
    at: row.createdAt,
  }));
}

/** How many funded issues waiting to pay out `pendingZiks` looks at. */
const PENDING_LIMIT = 50;

/**
 * What a person will be paid from issues that are funded and resolved but not live yet (#live-payout): their share
 * if each paid out now. Only issues they worked on are looked at.
 */
export async function pendingZiks(db: Db, userId: string, organisationId: string | null = null): Promise<number> {
  const bugs = await db.bug.findMany({
    where: {
      status: "resolved",
      payoutReleasedAt: null,
      isDeleted: false,
      project: { solo: false },
      ...(organisationId ? { organisationId } : {}),
      coinEntries: { some: { account: "escrow" } },
      OR: [
        { assigneeId: userId },
        { reporterId: userId },
        { beneficiaryUserId: userId },
        { testVerdicts: { some: { onBehalfOfUserId: userId, goodToMerge: true } } },
        { mergeReviews: { some: { onBehalfOfUserId: userId, verdict: "accept" } } },
        { rewardEstimates: { some: { onBehalfOfUserId: userId } } },
        { confirmations: { some: { onBehalfOfUserId: userId, verdict: "confirm" } } },
        { claims: { some: { OR: [{ awardedByUserId: userId }, { dispatcherUserId: userId }] } } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: PENDING_LIMIT,
    select: {
      id: true, organisationId: true, reporterId: true, beneficiaryUserId: true, assigneeId: true, pullRequestUrl: true, createdByAgentId: true,
      createdByAgent: { select: { ownerUserId: true } }, idea: { select: { source: true } },
    },
  });
  let total = 0;
  for (const bug of bugs) {
    const escrow = await escrowBalance(db, bug.id);
    const plan = planIssuePayout(escrow, await issueContributors(db as Prisma.TransactionClient, bug));
    for (const line of plan?.lines ?? []) if (line.userId === userId) total += line.amount;
  }
  return total;
}
