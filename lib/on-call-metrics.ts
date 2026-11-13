import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ON_CALL_QUIET_AFTER_MS } from "@/lib/security-checks";
import { MAX_OPEN_JOBS_PER_AGENT } from "@/lib/security-checks/engine";

/**
 * On-call cover (#on-call, 12 Nov plan H3): the numbers behind /oncall and the
 * bottom bar.
 *
 * - **Coverage:** the share of the last 24 hours with at least one on-call
 *   agent online and free, from the snapshots the platform cron takes once a
 *   minute (`recordOnCallSample`).
 * - **Pick-up speed:** how long security parts waited before an agent took
 *   them, over the last 24 hours (median).
 * - **Gone quiet:** on-call agents not seen for 15 minutes (see the on-call list).
 *
 * Super admins and owners of on-call agents see them (`canSeeOnCall`).
 */

type Db = PrismaClient | Prisma.TransactionClient;

const HOUR_MS = 60 * 60 * 1000;
export const COVERAGE_WINDOW_MS = 24 * HOUR_MS;
/** Snapshots older than this are deleted. */
export const SAMPLE_KEEP_MS = 7 * 24 * HOUR_MS;

/** Takes one snapshot of on-call cover, and prunes old ones. */
export async function recordOnCallSample(db: Db = prisma, now = new Date()): Promise<{ onCall: number; online: number; free: number }> {
  const seenSince = new Date(now.getTime() - ON_CALL_QUIET_AFTER_MS);
  const agents = await db.agent.findMany({
    where: { onCallAt: { not: null }, revokedAt: null },
    select: {
      pausedAt: true,
      apiKeys: { where: { revokedAt: null, lastUsedAt: { gte: seenSince } }, select: { id: true }, take: 1 },
      _count: { select: { securityCheckItems: { where: { status: "checking" } } } },
    },
  });
  const online = agents.filter((a) => !a.pausedAt && a.apiKeys.length > 0);
  const free = online.filter((a) => a._count.securityCheckItems < MAX_OPEN_JOBS_PER_AGENT);
  const sample = { onCall: agents.length, online: online.length, free: free.length };
  await db.onCallSample.create({ data: { at: now, ...sample } });
  await db.onCallSample.deleteMany({ where: { at: { lt: new Date(now.getTime() - SAMPLE_KEEP_MS) } } });
  return sample;
}

/** The share of snapshots with at least one agent free, as a whole percent; null with no snapshots. */
export function coverageOf(samples: ReadonlyArray<{ free: number }>): number | null {
  if (samples.length === 0) return null;
  return Math.round((samples.filter((s) => s.free > 0).length / samples.length) * 100);
}

/** The median of some durations in milliseconds; null when there are none. */
export function medianMs(durations: readonly number[]): number | null {
  if (durations.length === 0) return null;
  const sorted = [...durations].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** "12s", "4m", "1h 20m": a duration in plain words. */
export function formatWait(ms: number | null): string {
  if (ms === null) return "no parts picked up yet";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export type OnCallCover = {
  /** Coverage over the last 24 hours, whole percent; null before any snapshot. */
  coverage: number | null;
  /** The latest snapshot: agents on call, online and free now. */
  now: { onCall: number; online: number; free: number } | null;
  /** Median wait before a security part was taken, last 24 hours. */
  pickUpMs: number | null;
  /** Parts taken in the last 24 hours. */
  pickedUp: number;
};

/** Coverage, the latest snapshot and pick-up speed. */
export async function onCallCover(db: Db = prisma, now = new Date()): Promise<OnCallCover> {
  const since = new Date(now.getTime() - COVERAGE_WINDOW_MS);
  const [samples, latest, parts] = await Promise.all([
    db.onCallSample.findMany({ where: { at: { gte: since } }, select: { free: true } }),
    db.onCallSample.findFirst({ orderBy: { at: "desc" }, select: { onCall: true, online: true, free: true } }),
    db.securityCheckItem.findMany({
      where: { kind: "check", assignedAt: { gte: since } },
      select: { createdAt: true, assignedAt: true },
      take: 2000,
    }),
  ]);
  const waits = parts.filter((p) => p.assignedAt).map((p) => Math.max(0, p.assignedAt!.getTime() - p.createdAt.getTime()));
  return { coverage: coverageOf(samples), now: latest, pickUpMs: medianMs(waits), pickedUp: waits.length };
}

/** Who sees on-call cover: super admins, and owners of an on-call agent. */
export async function canSeeOnCall(user: { id: string; role?: string | null; isRealSuperAdmin?: boolean }, db: Db = prisma): Promise<boolean> {
  if (user.role === "super_admin" || user.isRealSuperAdmin) return true;
  const owned = await db.agent.count({ where: { ownerUserId: user.id, onCallAt: { not: null }, revokedAt: null } });
  return owned > 0;
}
