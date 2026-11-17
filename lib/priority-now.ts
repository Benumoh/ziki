import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PRODUCT_TRACK } from "@/lib/marketing/track";
import { liveHoldWhere } from "@/lib/issue-holders";
import { OPEN_BID_WHERE } from "@/lib/open-bids";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Priority now (#priority-now): the project's top confirmed Open issues, the
 * ones that should be picked up first. The In Progress tab shows them in a
 * strip with who each is offered to, and the proactive-offer sweep
 * (lib/agents/proactive-offers.ts) offers the unheld ones to idle agents.
 */

/** How many issues the strip shows and the sweep considers per project. */
export const PRIORITY_NOW_LIMIT = 5;

/** Highest first. An unknown value ranks with medium, the default. */
export const PRIORITY_ORDER = ["urgent", "high", "medium", "low"] as const;

export type PriorityNowIssue = {
  id: string;
  number: number;
  title: string;
  priority: string;
  areaId: string | null;
  difficulty: string;
  openBids: number;
  /** The live offer or plan review holding it, if any: who it is offered to. */
  offer: { claimId: string; agentId: string; agentName: string; ownerName: string | null; offeredAt: Date | null; planning: boolean } | null;
};

/**
 * The project's top issues at Open · Open (confirmed, waiting for bids): by
 * priority (urgent, high, medium, low), then the most marked important, then
 * the oldest. One small query per priority level, until the limit is reached.
 */
export async function priorityNow(
  scope: { organisationId: string; projectId: string; offerWindowSeconds: number },
  limit: number = PRIORITY_NOW_LIMIT,
  db: Db = prisma,
  /** Narrows the issues in the same order, such as to the ones the proactive-offer sweep may offer. */
  only: Prisma.BugWhereInput = {},
): Promise<PriorityNowIssue[]> {
  const found: PriorityNowIssue[] = [];
  const levels: (string | { notIn: string[] })[] = [...PRIORITY_ORDER.slice(0, 2), { notIn: ["urgent", "high", "low"] }, "low"];
  for (const priority of levels) {
    if (found.length >= limit) break;
    const rows = await db.bug.findMany({
      where: {
        ...only,
        organisationId: scope.organisationId,
        projectId: scope.projectId,
        ...PRODUCT_TRACK,
        isDeleted: false,
        substatus: "open",
        priority,
      },
      orderBy: [{ voteCount: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      take: limit - found.length,
      select: {
        id: true,
        number: true,
        title: true,
        priority: true,
        areaId: true,
        difficulty: true,
        _count: { select: { bids: { where: OPEN_BID_WHERE } } },
        claims: {
          where: liveHoldWhere(scope.offerWindowSeconds),
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, agentId: true, status: true, offeredAt: true, agent: { select: { name: true } }, beneficiary: { select: { name: true } } },
        },
      },
    });
    for (const row of rows) {
      const hold = row.claims[0];
      found.push({
        id: row.id,
        number: row.number,
        title: row.title,
        priority: row.priority,
        areaId: row.areaId,
        difficulty: row.difficulty,
        openBids: row._count.bids,
        offer: hold
          ? { claimId: hold.id, agentId: hold.agentId, agentName: hold.agent.name, ownerName: hold.beneficiary.name, offeredAt: hold.offeredAt, planning: hold.status === "planning" }
          : null,
      });
    }
  }
  return found;
}
