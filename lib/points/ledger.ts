import type { Prisma, PrismaClient, PointRole } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export type DetailedPointEntry = {
  id: string;
  points: number;
  role: PointRole;
  sourceKey: string;
  correctedAt: Date | null;
  createdAt: Date;
  bug: {
    id: string;
    number: number;
    title: string;
    status: string;
  } | null;
};

export type PointLedgerSummary = {
  totalEarned: number;
  totalDeductions: number;
  netPoints: number;
  entryCount: number;
};

function toNumber(val: unknown): number {
  if (typeof val === "number") return val;
  if (val && typeof (val as { toNumber?: () => number }).toNumber === "function") {
    return (val as { toNumber: () => number }).toNumber();
  }
  return Number(val) || 0;
}

/**
 * Loads a member's itemized point ledger entries with task details.
 * Supports filtering by role and pagination.
 */
export async function getDetailedPointLedger(
  db: Db,
  args: {
    organisationId?: string;
    tenantId?: string;
    userId: string;
    role?: PointRole;
    limit?: number;
    offset?: number;
  },
): Promise<{
  entries: DetailedPointEntry[];
  summary: PointLedgerSummary;
  total: number;
}> {
  const organisationId = args.organisationId ?? args.tenantId ?? "";
  const where: Prisma.PointEntryWhereInput = {
    organisationId,
    userId: args.userId,
    ...(args.role ? { role: args.role } : {}),
  };

  const [rows, allEntries] = await Promise.all([
    db.pointEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: args.limit ?? 50,
      skip: args.offset ?? 0,
      select: {
        id: true,
        points: true,
        role: true,
        sourceKey: true,
        correctedAt: true,
        createdAt: true,
        bug: {
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
          },
        },
      },
    }),
    db.pointEntry.findMany({
      where: { organisationId, userId: args.userId },
      select: { points: true },
    }),
  ]);

  let totalEarned = 0;
  let totalDeductions = 0;

  for (const entry of allEntries) {
    const pts = toNumber(entry.points);
    if (pts > 0) {
      totalEarned += pts;
    } else {
      totalDeductions += Math.abs(pts);
    }
  }

  const mappedEntries: DetailedPointEntry[] = rows.map((row) => ({
    id: row.id,
    points: toNumber(row.points),
    role: row.role,
    sourceKey: row.sourceKey,
    correctedAt: row.correctedAt,
    createdAt: row.createdAt,
    bug: row.bug,
  }));

  const summary: PointLedgerSummary = {
    totalEarned,
    totalDeductions,
    netPoints: totalEarned - totalDeductions,
    entryCount: allEntries.length,
  };

  return {
    entries: mappedEntries,
    summary,
    total: allEntries.length,
  };
}

/** User-friendly role names based on Ziki's contributor engine */
export const pointRoleLabels: Record<PointRole, string> = {
  solver: "Solver Bounty",
  reporter: "Reporter Bounty",
  reviewer: "Reviewer Award",
  triager: "Triager Award",
  submission: "Job Submission",
  dispatcher: "Dispatcher Award",
  idea: "Idea Contribution",
  signup: "Signup Bonus",
  comment: "Comment Upvote",
  plan: "Plan Approved",
  vote: "Importance / Bid Vote",
  security_check: "Security Check Job",
};

/** Explanation for how points were calculated for each role */
export function pointRoleDescription(role: PointRole, points: number, severity?: string | null): string {
  if (points < 0) {
    return "Administrative correction or reversed award";
  }
  switch (role) {
    case "solver":
      return severity
        ? `Resolved ${severity} severity issue within deadline`
        : "Delivered verified fix accepted by reviewers";
    case "reporter":
      return "Reported confirmed defect verified by independent agents";
    case "reviewer":
      return "Conducted independent test review and provided accepted verdict";
    case "triager":
      return points >= 5
        ? "Identified and verified duplicate issue"
        : "Triaged and cleared report as unique";
    case "dispatcher":
      return "Dispatched and prioritized verified task";
    case "submission":
      return "Submitted approved research job row";
    default:
      return "Completed task contribution";
  }
}
