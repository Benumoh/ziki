import type { Prisma, PrismaClient, DisputeStatus } from "@prisma/client";
import { z } from "zod";
import { issueHref } from "@/lib/issue-ref";
import { award, type PointAward } from "./award";
import { getProjectRewardConfig } from "./platform-rewards";
import {
  calculateReporterPoints,
  solverReward,
  type ProjectRewardConfig,
} from "./project-rewards";
import { pointSourceKey, pointsNumber, type PointAmount, type PointRole } from "./rules";

/**
 * Dispute logic (#436). A member says an award is missing or wrong; a
 * workspace admin resolves it. `lib/points/award.ts` and `prisma/**` are
 * owned by other issues — disputes only call them.
 *
 * A grant reuses the canonical `pointSourceKey`, so granting twice adds one
 * row. A correction never edits a row: it marks `correctedAt` and writes a
 * new entry with negative points.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export const NOT_IN_WORKSPACE = "That issue isn't in this workspace.";
export const ALREADY_RESOLVED = "That dispute has already been resolved.";
export const NOT_YOUR_ENTRY = "That points entry isn't yours.";
export const NOBODY_TO_AWARD = "This issue has nobody to award: it has no assignee.";
export const NO_ENTRY_ON_THIS_DISPUTE = "This dispute isn't about a points entry.";
export const ALREADY_CORRECTED = "That points entry has already been corrected.";
export const DISPUTE_ALREADY_OPEN = "An open dispute already exists for this entry.";

export const disputeInputSchema = z
  .object({
    bugNumber: z.coerce.number().int().positive("Enter the issue number."),
    kind: z.enum(["missing", "wrong"]),
    role: z.enum(["solver", "reporter"]).optional(),
    pointEntryId: z.string().trim().min(1).optional(),
    reason: z
      .string()
      .trim()
      .min(3, "Say what looks wrong so an admin can check it.")
      .max(1000, "Keep the reason under 1000 characters."),
  })
  .refine((value) => value.kind !== "missing" || Boolean(value.role), {
    message: "Pick which award is missing.",
    path: ["role"],
  })
  .refine((value) => value.kind !== "wrong" || Boolean(value.pointEntryId), {
    message: "Pick the entry you think is wrong.",
    path: ["pointEntryId"],
  });

export type DisputeInput = z.infer<typeof disputeInputSchema>;

/** The dispute-kind a member claims; the admin picks the role at resolve time. */
export type DisputeKind = "missing" | "wrong";
export type DisputeRole = "solver" | "reporter";

export type DisputableBug = {
  id: string;
  number: number;
  tenantId: string;
  reporterId: string;
  assigneeId: string | null;
  projectId?: string | null;
  /** #rewards: what solving it pays. */
  reward?: number | { toNumber(): number } | null;
};

export type DisputeRow = {
  id: string;
  tenantId: string;
  userId: string;
  bugId: string;
  pointEntryId: string | null;
  status: DisputeStatus;
};

export type DisputeResult = { ok: true; disputeId: string } | { ok: false; error: string };
export type GrantResult = { ok: true; awarded: boolean } | { ok: false; error: string };

/** The canonical entry for the award a "missing" dispute asks for; null when there is nobody to award. */
export function missingAwardEntry(
  bug: Pick<DisputableBug, "id" | "tenantId" | "reporterId" | "assigneeId" | "reward">,
  role: DisputeRole,
  rewardConfig?: ProjectRewardConfig | null,
): PointAward | null {
  if (role === "reporter") {
    return {
      tenantId: bug.tenantId,
      userId: bug.reporterId,
      bugId: bug.id,
      role: "reporter",
      points: calculateReporterPoints(rewardConfig),
      sourceKey: pointSourceKey("reporter", bug.id, bug.reporterId),
    };
  }
  if (!bug.assigneeId) return null;
  return {
    tenantId: bug.tenantId,
    userId: bug.assigneeId,
    bugId: bug.id,
    role: "solver",
    points: solverReward(bug.reward),
    sourceKey: pointSourceKey("solver", bug.id, bug.assigneeId),
  };
}

/** A correction is a new row that reverses an entry; the original is never edited. */
export function correctionSourceKey(pointEntryId: string): string {
  return `undo:${pointEntryId}`;
}

/** Opens a dispute on an issue in the member's workspace. */
export async function openDispute(
  db: Db,
  args: { tenantId: string; userId: string; input: DisputeInput },
): Promise<DisputeResult> {
  const { tenantId, userId, input } = args;

  const bug = await db.bug.findFirst({
    where: { number: input.bugNumber, tenantId },
    select: { id: true },
  });
  if (!bug) return { ok: false, error: NOT_IN_WORKSPACE };

  if (input.kind === "wrong") {
    const entry = await db.pointEntry.findFirst({
      where: { id: input.pointEntryId, userId, tenantId, bugId: bug.id },
      select: { id: true, correctedAt: true },
    });
    if (!entry) return { ok: false, error: NOT_YOUR_ENTRY };
    if (entry.correctedAt) return { ok: false, error: ALREADY_CORRECTED };

    const existingDispute = await db.pointDispute.findFirst({
      where: { pointEntryId: input.pointEntryId, status: "open" },
      select: { id: true },
    });
    if (existingDispute) return { ok: false, error: DISPUTE_ALREADY_OPEN };
  }

  const dispute = await db.pointDispute.create({
    data: {
      tenantId,
      userId,
      bugId: bug.id,
      pointEntryId: input.kind === "wrong" ? input.pointEntryId : null,
      requestedRole:
        input.kind === "missing" && (input.role === "solver" || input.role === "reporter")
          ? input.role
          : null,
      reason: input.reason,
    },
    select: { id: true },
  });
  return { ok: true, disputeId: dispute.id };
}

/**
 * Grants the missing solver or reporter award once. The canonical sourceKey
 * means a second grant adds no rows, so points never double (#436).
 */
export async function grantMissingAward(
  db: Db,
  args: {
    dispute: DisputeRow;
    bug: Pick<DisputableBug, "id" | "tenantId" | "reporterId" | "assigneeId" | "projectId">;
    role: DisputeRole;
    resolvedById: string;
  },
): Promise<GrantResult> {
  const { dispute, bug, role, resolvedById } = args;
  if (dispute.status !== "open") return { ok: false, error: ALREADY_RESOLVED };
  if (bug.id !== dispute.bugId || bug.tenantId !== dispute.tenantId) {
    return { ok: false, error: NOT_IN_WORKSPACE };
  }

  const rewardConfig = await getProjectRewardConfig(db, bug.projectId);
  const entry = missingAwardEntry(bug, role, rewardConfig);
  if (!entry) return { ok: false, error: NOBODY_TO_AWARD };

  const awarded = await award(db, entry);
  await db.pointDispute.update({
    where: { id: dispute.id },
    data: {
      status: "granted",
      resolvedById,
      resolvedAt: new Date(),
      resolution: `Granted the missing ${role} award.`,
    },
  });
  return { ok: true, awarded };
}

/** Marks the entry corrected and writes the reversing row. */
export async function correctEntry(
  db: Db,
  args: {
    dispute: DisputeRow;
    entry: {
      id: string;
      tenantId: string;
      userId: string;
      bugId: string | null;
      role: PointRole;
      points: PointAmount;
      correctedAt?: Date | null;
    };
    resolvedById: string;
    note?: string | null;
  },
): Promise<GrantResult> {
  const { dispute, entry, resolvedById, note } = args;
  if (dispute.status !== "open") return { ok: false, error: ALREADY_RESOLVED };
  if (!dispute.pointEntryId || dispute.pointEntryId !== entry.id) {
    return { ok: false, error: NO_ENTRY_ON_THIS_DISPUTE };
  }
  if (entry.tenantId !== dispute.tenantId) return { ok: false, error: NOT_IN_WORKSPACE };
  if (entry.correctedAt) return { ok: false, error: ALREADY_CORRECTED };

  if (typeof db.pointEntry.findUnique === "function") {
    const currentEntry = await db.pointEntry.findUnique({
      where: { id: entry.id },
      select: { correctedAt: true },
    });
    if (currentEntry?.correctedAt) return { ok: false, error: ALREADY_CORRECTED };
  } else if (typeof db.pointEntry.findFirst === "function") {
    const currentEntry = await db.pointEntry.findFirst({
      where: { id: entry.id },
      select: { correctedAt: true },
    });
    if (currentEntry?.correctedAt) return { ok: false, error: ALREADY_CORRECTED };
  }

  await db.pointEntry.update({
    where: { id: entry.id },
    data: { correctedAt: new Date() },
  });
  const awarded = await award(db, {
    tenantId: entry.tenantId,
    userId: entry.userId,
    bugId: entry.bugId,
    role: entry.role,
    points: -pointsNumber(entry.points),
    sourceKey: correctionSourceKey(entry.id),
    exact: true,
  });
  await db.pointDispute.update({
    where: { id: dispute.id },
    data: {
      status: "granted",
      resolvedById,
      resolvedAt: new Date(),
      resolution: note?.trim() ? note.trim() : "Corrected the points entry.",
    },
  });
  return { ok: true, awarded };
}

/** Rejects a dispute; nothing is written to the ledger. */
export async function rejectDispute(
  db: Db,
  args: { dispute: DisputeRow; resolvedById: string; note?: string | null },
): Promise<DisputeResult> {
  const { dispute, resolvedById, note } = args;
  if (dispute.status !== "open") return { ok: false, error: ALREADY_RESOLVED };

  await db.pointDispute.update({
    where: { id: dispute.id },
    data: {
      status: "rejected",
      resolvedById,
      resolvedAt: new Date(),
      resolution: note?.trim() ? note.trim() : "Rejected.",
    },
  });
  return { ok: true, disputeId: dispute.id };
}

const disputeSelect = {
  id: true,
  status: true,
  reason: true,
  resolution: true,
  resolvedAt: true,
  createdAt: true,
  pointEntryId: true,
  requestedRole: true,
  bug: { select: { id: true, number: true, title: true, project: { select: { slug: true } } } },
  user: { select: { id: true, name: true } },
  pointEntry: { select: { id: true, points: true, role: true } },
} satisfies Prisma.PointDisputeSelect;

export type DisputeView = {
  id: string;
  status: DisputeStatus;
  reason: string;
  resolution: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  /** "wrong" when it disputes an entry, "missing" otherwise. */
  kind: DisputeKind;
  /** The award a missing-points dispute asked for. */
  requestedRole: DisputeRole | null;
  bugId: string;
  bugNumber: number;
  bugTitle: string;
  /** The issue's address, `/<project-slug>/<number>`. */
  bugPath: string;
  openerId: string;
  openerName: string;
  entry: { id: string; points: number; role: PointRole } | null;
};

type DisputeRowWithRelations = Prisma.PointDisputeGetPayload<{ select: typeof disputeSelect }>;

function toView(row: DisputeRowWithRelations): DisputeView {
  return {
    id: row.id,
    status: row.status,
    reason: row.reason,
    resolution: row.resolution,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    kind: row.pointEntryId ? "wrong" : "missing",
    requestedRole:
      row.requestedRole === "solver" || row.requestedRole === "reporter" ? row.requestedRole : null,
    bugId: row.bug.id,
    bugNumber: row.bug.number,
    bugTitle: row.bug.title,
    bugPath: issueHref(row.bug),
    openerId: row.user.id,
    openerName: row.user.name,
    entry: row.pointEntry
      ? { id: row.pointEntry.id, points: pointsNumber(row.pointEntry.points), role: row.pointEntry.role }
      : null,
  };
}

/** One member's disputes, newest first. */
export async function disputesForMember(
  db: Db,
  args: { tenantId: string; userId: string },
): Promise<DisputeView[]> {
  const rows = await db.pointDispute.findMany({
    where: { tenantId: args.tenantId, userId: args.userId },
    orderBy: { createdAt: "desc" },
    select: disputeSelect,
  });
  return rows.map(toView);
}

/** The open queue for a workspace, oldest first. */
export async function openDisputes(db: Db, tenantId: string): Promise<DisputeView[]> {
  const rows = await db.pointDispute.findMany({
    where: { tenantId, status: "open" },
    orderBy: { createdAt: "asc" },
    select: disputeSelect,
  });
  return rows.map(toView);
}

/** A member's own ledger rows, newest first — for the "dispute this entry" picker. */
export async function entriesForMember(
  db: Db,
  args: { tenantId: string; userId: string },
): Promise<
  Array<{
    id: string;
    points: number;
    role: PointRole;
    correctedAt: Date | null;
    createdAt: Date;
    bugNumber: number | null;
  }>
> {
  const rows = await db.pointEntry.findMany({
    where: { tenantId: args.tenantId, userId: args.userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      points: true,
      role: true,
      correctedAt: true,
      createdAt: true,
      bug: { select: { number: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    points: pointsNumber(row.points),
    role: row.role,
    correctedAt: row.correctedAt,
    createdAt: row.createdAt,
    bugNumber: row.bug?.number ?? null,
  }));
}

/** How many issue numbers one credit request may name. */
export const MAX_CREDIT_NUMBERS = 50;

export type CreditSkip = { number: number; reason: string };

export type CreditResult = {
  credited: number[];
  already: number[];
  skipped: CreditSkip[];
};

/** Pulls positive issue numbers out of a list like "#269, 270 10". */
export function parseIssueNumbers(raw: string): number[] {
  const numbers = [
    ...new Set(
      raw
        .split(/[^0-9]+/)
        .map((part) => Number(part))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  ];
  return numbers.slice(0, MAX_CREDIT_NUMBERS);
}

type CreditBug = DisputableBug & {
  status: string;
  isDeleted: boolean;
  duplicateOfId: string | null;
};

/**
 * Writes the missing solver or reporter award for the named issues.
 * The canonical sourceKey means an issue that already has the award is skipped
 * rather than paid twice. Solver points need a resolved or closed issue with
 * an assignee. Reporter points are withheld on duplicates.
 */
export async function creditMissingAwards(
  db: Db,
  args: { tenantId: string; numbers: number[]; role: DisputeRole },
): Promise<CreditResult> {
  const numbers = [...new Set(args.numbers)].slice(0, MAX_CREDIT_NUMBERS);
  const credited: number[] = [];
  const already: number[] = [];
  const skipped: CreditSkip[] = [];
  if (numbers.length === 0) return { credited, already, skipped };

  const bugs = (await db.bug.findMany({
    where: { tenantId: args.tenantId, number: { in: numbers } },
    select: {
      id: true,
      number: true,
      tenantId: true,
      reporterId: true,
      assigneeId: true,
      status: true,
      isDeleted: true,
      duplicateOfId: true,
      projectId: true,
    },
  })) as CreditBug[];
  const byNumber = new Map(bugs.map((bug) => [bug.number, bug]));
  const rewardByProject = new Map<string | null, ProjectRewardConfig>();

  for (const number of numbers) {
    const bug = byNumber.get(number);
    if (!bug) {
      skipped.push({ number, reason: "not in this workspace" });
      continue;
    }
    if (bug.isDeleted) {
      skipped.push({ number, reason: "deleted" });
      continue;
    }
    if (args.role === "solver") {
      if (bug.status !== "resolved" && bug.status !== "closed") {
        skipped.push({ number, reason: "not resolved" });
        continue;
      }
      if (!bug.assigneeId) {
        skipped.push({ number, reason: "no assignee" });
        continue;
      }
    } else if (bug.duplicateOfId) {
      skipped.push({ number, reason: "duplicate" });
      continue;
    }

    const projectKey = bug.projectId ?? null;
    let rewardConfig = rewardByProject.get(projectKey);
    if (!rewardConfig) {
      rewardConfig = await getProjectRewardConfig(db, projectKey);
      rewardByProject.set(projectKey, rewardConfig);
    }
    const entry = missingAwardEntry(bug, args.role, rewardConfig);
    if (!entry) {
      skipped.push({ number, reason: "no assignee" });
      continue;
    }
    const awarded = await award(db, entry);
    if (awarded) credited.push(number);
    else already.push(number);
  }

  return { credited, already, skipped };
}
