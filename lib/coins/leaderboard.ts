import { Prisma, type PrismaClient } from "@prisma/client";
import { zikOf } from "./ledger";

/**
 * The leaderboard (#428, #one-payment), always inside one organisation: what each member earned there in Ziks, read
 * from the Ziks ledger's `release` rows for the organisation's issues (lib/coins/earned.ts). A fixed issue is a
 * positive fixer payment. Ziks are the only payment, so this is everyone's real earnings.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type EarnedTotals = { ziks: number; fixedIssues: number };

export type LeaderboardEntry = EarnedTotals & {
  userId: string;
  name: string;
  image: string | null;
  rank: number;
};

export type LeaderboardPeriod = "week" | "month" | "all";

export type LeaderboardOptions = {
  page?: number;
  limit?: number;
  period?: LeaderboardPeriod;
  /** Clock override for deterministic callers and tests. */
  now?: Date;
};

export type PaginatedLeaderboard = {
  entries: LeaderboardEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  period: LeaderboardPeriod;
  periodStart: string | null;
};

export const DEFAULT_LEADERBOARD_LIMIT = 50;

// Cache with revalidation (#657)
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { expiresAt: number; data: PaginatedLeaderboard }>();

export function clearLeaderboardCache(organisationId?: string): void {
  if (!organisationId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) if (key.startsWith(`${organisationId}:`)) cache.delete(key);
}

/** UTC period boundary: Monday for the week, the 1st for the month. */
export function leaderboardPeriodStart(period: LeaderboardPeriod, now = new Date()): Date | null {
  if (period === "all") return null;
  if (period === "month") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const day = (now.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
}

/** The earning rows of an organisation's issues, since a time. */
function earningRows(organisationId: string, since: Date | null) {
  return Prisma.sql`
    FROM "CoinEntry" c
    INNER JOIN "Bug" b ON b."id" = c."bugId" AND b."organisationId" = ${organisationId}
    INNER JOIN "Membership" m ON m."userId" = c."userId" AND m."organisationId" = ${organisationId}
    INNER JOIN "User" u ON u."id" = c."userId"
    WHERE c."account" = 'wallet' AND c."kind" IN ('release', 'earning')
      ${since ? Prisma.sql`AND c."createdAt" >= ${since}` : Prisma.empty}`;
}

/** One person's earnings and fixed-issue count in `organisationId`. */
export async function earnedTotals(db: Db, organisationId: string, userId: string): Promise<EarnedTotals> {
  const where = { account: "wallet" as const, userId, kind: { in: ["release" as const, "earning" as const] }, bug: { organisationId } };
  const [sum, fixedIssues] = await Promise.all([
    db.coinEntry.aggregate({ where, _sum: { amount: true } }),
    db.coinEntry.count({ where: { ...where, payoutRole: "fixer", amount: { gt: 0 } } }),
  ]);
  return { ziks: zikOf(sum._sum.amount), fixedIssues };
}

/**
 * Orders people by Ziks, then fixed issues, then name, and numbers them. People level on both share a rank
 * (1, 2, 2, 4).
 */
export function rankLeaderboard(rows: ReadonlyArray<Omit<LeaderboardEntry, "rank">>, offset = 0): LeaderboardEntry[] {
  const sorted = [...rows].sort((a, b) => b.ziks - a.ziks || b.fixedIssues - a.fixedIssues || a.name.localeCompare(b.name));
  const ranked: LeaderboardEntry[] = [];
  sorted.forEach((row, index) => {
    const previous = ranked[index - 1];
    const tied = previous && previous.ziks === row.ziks && previous.fixedIssues === row.fixedIssues;
    ranked.push({ ...row, rank: tied ? previous.rank : offset + index + 1 });
  });
  return ranked;
}

/** Members of `organisationId` who earned anything there, paginated and ranked (#657). */
export async function paginatedOrganisationLeaderboard(db: Db, organisationId: string, options: LeaderboardOptions = {}): Promise<PaginatedLeaderboard> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.max(1, Math.min(100, options.limit ?? DEFAULT_LEADERBOARD_LIMIT));
  const offset = (page - 1) * limit;
  const period = options.period ?? "all";
  const periodStart = leaderboardPeriodStart(period, options.now);
  const periodStartIso = periodStart?.toISOString() ?? null;

  const cacheKey = `${organisationId}:${period}:${periodStartIso ?? "all"}:${page}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  type RawRow = { userId: string; name: string; image: string | null; ziks: Prisma.Decimal | number | null; fixedIssues: number | bigint };
  const [rawRows, countRows] = await Promise.all([
    db.$queryRaw<RawRow[]>`
      SELECT u."id" AS "userId", u."name" AS "name", u."image" AS "image",
             SUM(c."amount") AS "ziks",
             COUNT(*) FILTER (WHERE c."payoutRole" = 'fixer' AND c."amount" > 0)::int AS "fixedIssues"
      ${earningRows(organisationId, periodStart)}
      GROUP BY u."id", u."name", u."image"
      ORDER BY "ziks" DESC, "fixedIssues" DESC, u."name" ASC
      LIMIT ${limit} OFFSET ${offset}`,
    db.$queryRaw<{ count: number | bigint }[]>`SELECT COUNT(DISTINCT c."userId")::int AS "count" ${earningRows(organisationId, periodStart)}`,
  ]);
  const rows = rawRows.map((row) => ({ userId: row.userId, name: row.name, image: row.image, ziks: zikOf(row.ziks), fixedIssues: Number(row.fixedIssues) }));
  const total = Number(countRows[0]?.count ?? 0);
  const result: PaginatedLeaderboard = {
    entries: rankLeaderboard(rows, offset),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
    period,
    periodStart: periodStartIso,
  };
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: result });
  return result;
}

/** Members of `organisationId` who earned anything there, ranked. Non-members never appear. */
export async function organisationLeaderboard(db: Db, organisationId: string, limitOrOptions: number | LeaderboardOptions = DEFAULT_LEADERBOARD_LIMIT): Promise<LeaderboardEntry[]> {
  const options = typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions;
  return (await paginatedOrganisationLeaderboard(db, organisationId, options)).entries;
}

/**
 * One person's place in the organisation, with the size of the field. Null when they earned nothing there: there is
 * no honest rank for someone the leaderboard would not list. Uses the same tie rule as `rankLeaderboard`.
 */
export async function organisationRankFor(db: Db, organisationId: string, userId: string): Promise<{ rank: number; total: number } | null> {
  const rows = await db.$queryRaw<{ rank: number | bigint; total: number | bigint }[]>`
    WITH totals AS (
      SELECT c."userId" AS "id", SUM(c."amount") AS ziks,
             COUNT(*) FILTER (WHERE c."payoutRole" = 'fixer' AND c."amount" > 0) AS fixed
      ${earningRows(organisationId, null)}
      GROUP BY c."userId"
    ), numbered AS (
      SELECT "id", RANK() OVER (ORDER BY ziks DESC, fixed DESC) AS rank, COUNT(*) OVER () AS total FROM totals
    )
    SELECT rank, total FROM numbered WHERE "id" = ${userId}`;
  const row = rows[0];
  return row ? { rank: Number(row.rank), total: Number(row.total) } : null;
}
