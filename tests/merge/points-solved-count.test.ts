import { describe, expect, it, vi } from "vitest";
import { pointTotals } from "@/lib/points/leaderboard";
import { MULTIPLIER_KEY_PREFIX } from "@/lib/points/multiplier";

/** A ledger that answers `count` by applying the `where` it is given, the way the database would. */
function ledger(rows: Array<{ role: string; points: number; correctedAt: Date | null; sourceKey: string }>) {
  type Where = { role?: string; points?: { gt?: number }; correctedAt?: null; sourceKey?: { not?: { startsWith?: string } } };
  const matches = (where: Where, row: (typeof rows)[number]) =>
    (where.role === undefined || where.role === row.role) &&
    (where.points?.gt === undefined || row.points > where.points.gt) &&
    (where.correctedAt === undefined || (where.correctedAt === null ? row.correctedAt === null : true)) &&
    (where.sourceKey?.not?.startsWith === undefined || !row.sourceKey.startsWith(where.sourceKey.not.startsWith));
  return {
    pointEntry: {
      aggregate: vi.fn(async () => ({ _sum: { points: rows.reduce((sum, row) => sum + row.points, 0) } })),
      count: vi.fn(async ({ where }: { where: Where }) => rows.filter((row) => matches(where, row)).length),
    },
  } as never;
}

describe("solved tasks and the points multiplier (#points-multiplier)", () => {
  it("does not count a multiplier adjustment as another solved issue", async () => {
    const solver = { role: "solver", correctedAt: null };
    const db = ledger([
      { ...solver, points: 6, sourceKey: "solver:bug-1:u1" },
      { ...solver, points: 114, sourceKey: `${MULTIPLIER_KEY_PREFIX}t:1->20:run:u1:-:solver:bug-1:-` },
      { ...solver, points: 3, sourceKey: "solver:bug-2:u1" },
      { ...solver, points: 57, sourceKey: `${MULTIPLIER_KEY_PREFIX}t:1->20:run:u1:-:solver:bug-2:-` },
    ]);
    // The points include the adjustments (every balance is x20); the count is of issues solved.
    expect(await pointTotals(db, "t", "u1")).toEqual({ points: 180, solvedTasks: 2 });
  });

  it("still ignores a corrected solver entry and a reporter entry", async () => {
    const db = ledger([
      { role: "solver", points: 6, correctedAt: new Date(), sourceKey: "solver:bug-1:u1" },
      { role: "reporter", points: 1.5, correctedAt: null, sourceKey: "reporter:bug-1:u1" },
      { role: "solver", points: 4, correctedAt: null, sourceKey: "solver:bug-3:u1" },
    ]);
    expect((await pointTotals(db, "t", "u1")).solvedTasks).toBe(1);
  });
});
