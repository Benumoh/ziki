import type { Prisma, PrismaClient } from "@prisma/client";
import { roundPoints } from "./rules";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * What a workspace multiplies every award by (#points-multiplier): 1 for a
 * normal workspace. Read each time an award is written, so changing it takes
 * effect on the next award. Anything unreadable counts as 1.
 */
export async function pointsMultiplierFor(db: Db, tenantId: string): Promise<number> {
  if (!db || !("tenant" in db) || !db.tenant?.findUnique) return 1;
  const row = await db.tenant.findUnique({ where: { id: tenantId }, select: { pointsMultiplier: true } });
  const value = row?.pointsMultiplier == null ? 1 : Number(row.pointsMultiplier);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** An amount as the ledger stores it in a workspace with this multiplier. */
export function scaledPoints(points: number, multiplier: number): number {
  return roundPoints(points * multiplier);
}
