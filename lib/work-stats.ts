import "server-only";
import type { Prisma } from "@prisma/client";
import { PRODUCT_TRACK } from "@/lib/marketing/track";
import { prisma } from "@/lib/prisma";

/** How many days a card's tick strip shows, one tick a day, oldest first. */
export const STAT_DAYS = 28;
const DAY = 24 * 60 * 60 * 1000;

/** One stat card (#work-stats): this week's count, last week's, and a count for each of the last 28 days. */
export type WorkStat = {
  key: "ideas" | "opened" | "delivered" | "live";
  label: string;
  /** What it counts, under the number. */
  note: string;
  /** The design's chart colour for it. */
  colour: string;
  thisWeek: number;
  lastWeek: number;
  daily: number[];
};

/** Per-day counts for the last STAT_DAYS days, from the dates of what happened. */
function perDay(dates: Date[], now: number): number[] {
  const days = new Array<number>(STAT_DAYS).fill(0);
  for (const date of dates) {
    const ago = Math.floor((now - date.getTime()) / DAY);
    if (ago >= 0 && ago < STAT_DAYS) days[STAT_DAYS - 1 - ago] += 1;
  }
  return days;
}

/**
 * The work page Overview's stat cards (#work-stats): ideas filed, issues opened, work delivered and work gone live,
 * each this week against the week before, with a tick a day for the last four weeks. Product work in the
 * organisation, or one project of it.
 */
export async function readWorkStats({ organisationId, projectId }: { organisationId: string; projectId: string | null }): Promise<WorkStat[]> {
  const now = Date.now();
  const since = new Date(now - STAT_DAYS * DAY);
  const ofBug: Prisma.BugWhereInput = { organisationId, ...PRODUCT_TRACK, isDeleted: false, ...(projectId ? { projectId } : {}) };
  const [ideas, opened, delivered, live] = await Promise.all([
    prisma.idea.findMany({ where: { organisationId, ...PRODUCT_TRACK, isDeleted: false, ...(projectId ? { projectId } : {}), createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.bug.findMany({ where: { ...ofBug, createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.delivery.findMany({ where: { bug: ofBug, createdAt: { gte: since } }, select: { createdAt: true } }),
    // Gone live: a move into Live in the issue's history, which names the step (On dev, or Force-merged).
    prisma.bugActivity.findMany({
      where: {
        bug: ofBug, type: "status_changed", createdAt: { gte: since },
        OR: ["on_dev", "force_merged", "resolved"].map((to) => ({ metadata: { path: ["to"], equals: to } })),
      },
      select: { createdAt: true },
    }),
  ]);
  const stat = (key: WorkStat["key"], label: string, note: string, colour: string, rows: { createdAt: Date }[]): WorkStat => {
    const daily = perDay(rows.map((row) => row.createdAt), now);
    return {
      key, label, note, colour, daily,
      thisWeek: daily.slice(-7).reduce((sum, count) => sum + count, 0),
      lastWeek: daily.slice(-14, -7).reduce((sum, count) => sum + count, 0),
    };
  };
  return [
    stat("ideas", "Ideas filed", "New ideas this week", "#1b8ce8", ideas),
    stat("opened", "Issues opened", "Ideas that became issues", "#ff5601", opened),
    stat("delivered", "Work delivered", "Deliveries by agents", "#ef0c78", delivered),
    stat("live", "Gone live", "Work that reached Live", "#17a673", live),
  ];
}
