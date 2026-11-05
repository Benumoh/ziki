import type { Prisma, PrismaClient } from "@prisma/client";
import { pointsNumber } from "./rules";
import { MULTIPLIER_KEY_PREFIX } from "./multiplier";

/**
 * Point balances and the leaderboard (#428), always inside one tenant.
 *
 * A balance is the sum of a person's ledger rows, corrections included. A
 * solved task is a positive solver entry that hasn't been corrected.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type PointTotals = { points: number; solvedTasks: number };

export type LeaderboardEntry = PointTotals & {
  userId: string;
  name: string;
  image: string | null;
  rank: number;
};

export type LeaderboardOptions = {
  page?: number;
  limit?: number;
};

export type PaginatedLeaderboard = {
  entries: LeaderboardEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export const DEFAULT_LEADERBOARD_LIMIT = 50;

// Cache with revalidation (#657)
const CACHE_TTL_MS = 30_000;
type CacheEntry = {
  expiresAt: number;
  data: PaginatedLeaderboard;
};
const cache = new Map<string, CacheEntry>();

export function clearLeaderboardCache(tenantId?: string): void {
  if (!tenantId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${tenantId}:`)) {
      cache.delete(key);
    }
  }
}

const solvedWhere = (tenantId: string): Prisma.PointEntryWhereInput => ({
  tenantId,
  role: "solver",
  points: { gt: 0 },
  correctedAt: null,
  // A multiplier adjustment (scripts/points-multiplier.mjs) is not an issue solved.
  sourceKey: { not: { startsWith: MULTIPLIER_KEY_PREFIX } },
});

/** One person's balance and solved-task count in `tenantId`. */
export async function pointTotals(db: Db, tenantId: string, userId: string): Promise<PointTotals> {
  const [sum, solvedTasks] = await Promise.all([
    db.pointEntry.aggregate({ where: { tenantId, userId }, _sum: { points: true } }),
    db.pointEntry.count({ where: { ...solvedWhere(tenantId), userId } }),
  ]);
  return { points: pointsNumber(sum._sum.points), solvedTasks };
}

/**
 * Orders people by points, then solved tasks, then name, and numbers them.
 * People level on both points and solved tasks share a rank (1, 2, 2, 4).
 */
export function rankLeaderboard(
  rows: ReadonlyArray<Omit<LeaderboardEntry, "rank">>,
  offset = 0,
): LeaderboardEntry[] {
  const sorted = [...rows].sort(
    (a, b) => b.points - a.points || b.solvedTasks - a.solvedTasks || a.name.localeCompare(b.name),
  );
  const ranked: LeaderboardEntry[] = [];
  sorted.forEach((row, index) => {
    const previous = ranked[index - 1];
    const tied = previous && previous.points === row.points && previous.solvedTasks === row.solvedTasks;
    ranked.push({ ...row, rank: tied ? previous.rank : offset + index + 1 });
  });
  return ranked;
}

/** Members of `tenantId` with any points, paginated and ranked (#657). */
export async function paginatedTenantLeaderboard(
  db: Db,
  tenantId: string,
  options: LeaderboardOptions = {},
): Promise<PaginatedLeaderboard> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.max(1, Math.min(100, options.limit ?? DEFAULT_LEADERBOARD_LIMIT));
  const offset = (page - 1) * limit;

  const cacheKey = `${tenantId}:${page}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // Fast-path: If db supports $queryRaw (Postgres in production), execute single optimized aggregation query with LIMIT/OFFSET.
  if (typeof (db as PrismaClient).$queryRaw === "function") {
    try {
      type RawRow = {
        userId: string;
        name: string;
        image: string | null;
        points: number | bigint;
        solvedTasks: number | bigint;
      };
      type CountRow = { count: number | bigint };

      const [rawRows, countRows] = await Promise.all([
        (db as PrismaClient).$queryRaw<RawRow[]>`
          SELECT
            u."id" AS "userId",
            u."name" AS "name",
            u."image" AS "image",
            COALESCE(SUM(pe."points"), 0)::float8 AS "points",
            COALESCE(COUNT(CASE WHEN pe."role" = 'solver' AND pe."points" > 0 AND pe."correctedAt" IS NULL AND pe."sourceKey" NOT LIKE 'multiplier:%' THEN 1 END), 0)::int AS "solvedTasks"
          FROM "User" u
          INNER JOIN "Membership" m ON m."userId" = u."id" AND m."tenantId" = ${tenantId}
          INNER JOIN "PointEntry" pe ON pe."userId" = u."id" AND pe."tenantId" = ${tenantId}
          GROUP BY u."id", u."name", u."image"
          ORDER BY "points" DESC, "solvedTasks" DESC, u."name" ASC
          LIMIT ${limit} OFFSET ${offset}
        `,
        (db as PrismaClient).$queryRaw<CountRow[]>`
          SELECT COUNT(DISTINCT pe."userId")::int AS "count"
          FROM "PointEntry" pe
          INNER JOIN "Membership" m ON m."userId" = pe."userId" AND m."tenantId" = ${tenantId}
          WHERE pe."tenantId" = ${tenantId}
        `,
      ]);

      const total = Number(countRows[0]?.count ?? 0);
      const rows = rawRows.map((r) => ({
        userId: r.userId,
        name: r.name,
        image: r.image,
        points: pointsNumber(r.points),
        solvedTasks: Number(r.solvedTasks),
      }));

      const entries = rankLeaderboard(rows, offset);
      const totalPages = Math.ceil(total / limit) || 1;
      const result: PaginatedLeaderboard = { entries, total, page, limit, totalPages };

      cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: result });
      return result;
    } catch {
      // Fallback to Prisma API (e.g. if unit tests mock PrismaClient without $queryRaw)
    }
  }

  // Fallback path using Prisma query methods
  const memberOnly = { user: { memberships: { some: { tenantId } } } } satisfies Prisma.PointEntryWhereInput;
  const [balances, solved] = await Promise.all([
    db.pointEntry.groupBy({
      by: ["userId"],
      where: { tenantId, ...memberOnly },
      _sum: { points: true },
    }),
    db.pointEntry.groupBy({
      by: ["userId"],
      where: { ...solvedWhere(tenantId), ...memberOnly },
      _count: { _all: true },
    }),
  ]);

  if (balances.length === 0) {
    const emptyResult = { entries: [], total: 0, page, limit, totalPages: 1 };
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: emptyResult });
    return emptyResult;
  }

  const users = await db.user.findMany({
    where: { id: { in: balances.map((b) => b.userId) } },
    select: { id: true, name: true, image: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  const solvedById = new Map(solved.map((s) => [s.userId, s._count._all]));

  const allRows = balances.flatMap((b) => {
    const user = byId.get(b.userId);
    if (!user) return [];
    return [{
      userId: b.userId,
      name: user.name,
      image: user.image,
      points: pointsNumber(b._sum.points),
      solvedTasks: solvedById.get(b.userId) ?? 0,
    }];
  });
  const total = allRows.length;
  const allRanked = rankLeaderboard(allRows);
  const entries = allRanked.slice(offset, offset + limit);
  const totalPages = Math.ceil(total / limit) || 1;

  const result: PaginatedLeaderboard = { entries, total, page, limit, totalPages };
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: result });
  return result;
}

/** Members of `tenantId` with any points, ranked. Non-members never appear. */
export async function tenantLeaderboard(
  db: Db,
  tenantId: string,
  limitOrOptions: number | LeaderboardOptions = DEFAULT_LEADERBOARD_LIMIT,
): Promise<LeaderboardEntry[]> {
  const options = typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions;
  const result = await paginatedTenantLeaderboard(db, tenantId, options);
  return result.entries;
}

/**
 * One person's place in the tenant, with the size of the field. Null when
 * they have no ledger rows at all — there is no honest rank for someone the
 * leaderboard would not list.
 *
 * Postgres gets one window-function query using the same tie rule as
 * rankLeaderboard (1, 2, 2, 4). Other clients (mocked in unit tests) walk the
 * ranked pages the leaderboard already exposes.
 */
export async function tenantRankFor(
  db: Db,
  tenantId: string,
  userId: string,
): Promise<{ rank: number; total: number } | null> {
  if (typeof (db as PrismaClient).$queryRaw === "function") {
    try {
      type RankRow = { rank: number | bigint; total: number | bigint };
      const rows = await (db as PrismaClient).$queryRaw<RankRow[]>`
        WITH totals AS (
          SELECT u."id",
                 COALESCE(SUM(pe."points"), 0)::float8 AS points,
                 COUNT(CASE WHEN pe."role" = 'solver' AND pe."points" > 0 AND pe."correctedAt" IS NULL AND pe."sourceKey" NOT LIKE 'multiplier:%' THEN 1 END)::int AS solved
          FROM "User" u
          INNER JOIN "Membership" m ON m."userId" = u."id" AND m."tenantId" = ${tenantId}
          INNER JOIN "PointEntry" pe ON pe."userId" = u."id" AND pe."tenantId" = ${tenantId}
          GROUP BY u."id"
        ), numbered AS (
          SELECT "id",
                 RANK() OVER (ORDER BY points DESC, solved DESC) AS rank,
                 COUNT(*) OVER () AS total
          FROM totals
        )
        SELECT rank, total FROM numbered WHERE "id" = ${userId}
      `;
      const row = rows[0];
      return row ? { rank: Number(row.rank), total: Number(row.total) } : null;
    } catch {
      // Fall through to the paginated API (mocked clients in tests).
    }
  }

  const first = await paginatedTenantLeaderboard(db, tenantId, { limit: 100 });
  for (let page = 1; page <= first.totalPages; page++) {
    const board =
      page === 1 ? first : await paginatedTenantLeaderboard(db, tenantId, { limit: 100, page });
    const entry = board.entries.find((row) => row.userId === userId);
    if (entry) return { rank: entry.rank, total: board.total };
  }
  return null;
}
