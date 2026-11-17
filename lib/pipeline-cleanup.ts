import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { closeInTransaction, lockedRow, type Actor } from "@/lib/agent-api/close-suggestions";
import { isDone } from "@/lib/issue-state";

/**
 * Pipeline cleanup (#pipeline-cleanup): open issues that have left the
 * pipeline are closed once they have sat that way for two days.
 *
 * | rule      | the issue                                                        | closed as  |
 * | --------- | ---------------------------------------------------------------- | ---------- |
 * | duplicate | is marked a duplicate of another issue (`Bug.duplicateOfId`)     | duplicate  |
 * | rejected  | has more live reject confirmations than confirm ones             | rejected   |
 *
 * Only issues still in Open (Requires confirmation or Open) are touched: work
 * someone has started, delivered or shipped is left alone, and so is anything
 * already closed (already implemented included). The two days count from when
 * it was marked a duplicate, or from the latest confirmation entry.
 *
 * `PIPELINE_CLEANUP` turns it on: `off` (default) does nothing, `dry_run`
 * reports what it would close, `on` closes. `scripts/pipeline-cleanup.ts`
 * prints the dry-run list for a project.
 */

export const PIPELINE_GRACE_DAYS = 2;
export const PIPELINE_CLEANUP_BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PipelineCleanupMode = "off" | "dry_run" | "on";
export type PipelineCleanupReason = "duplicate" | "rejected";

export function pipelineCleanupMode(value: string | undefined = process.env.PIPELINE_CLEANUP): PipelineCleanupMode {
  const mode = value?.trim().toLowerCase();
  return mode === "on" || mode === "dry_run" ? mode : "off";
}

export function pipelineCutoff(now: Date, graceDays = PIPELINE_GRACE_DAYS): Date {
  return new Date(now.getTime() - graceDays * DAY_MS);
}

export type CleanupInput = {
  status: string;
  duplicateOfId: string | null;
  /** When it was marked a duplicate; null when unknown. */
  duplicateMarkedAt: Date | null;
  /** The live (not undone) confirmation entries. */
  confirmations: { verdict: string; updatedAt: Date }[];
  /** Fallback for a duplicate with no recorded marking. */
  updatedAt: Date;
};

export type CleanupDecision = {
  reason: PipelineCleanupReason;
  /** When the issue left the pipeline. */
  since: Date;
  rejects: number;
  confirms: number;
};

/**
 * Why this issue should be closed now, or null when it stays. Pure, so the
 * rules are tested without a database.
 */
export function cleanupDecision(input: CleanupInput, cutoff: Date): CleanupDecision | null {
  if (input.status !== "open") return null;
  const rejects = input.confirmations.filter((c) => c.verdict === "reject").length;
  const confirms = input.confirmations.filter((c) => c.verdict === "confirm").length;

  if (input.duplicateOfId) {
    const since = input.duplicateMarkedAt ?? input.updatedAt;
    return since <= cutoff ? { reason: "duplicate", since, rejects, confirms } : null;
  }
  if (rejects > confirms) {
    const since = new Date(Math.max(...input.confirmations.map((c) => c.updatedAt.getTime())));
    return since <= cutoff ? { reason: "rejected", since, rejects, confirms } : null;
  }
  return null;
}

/** What the evidence on the closed issue says. */
export function cleanupEvidence(decision: CleanupDecision, graceDays = PIPELINE_GRACE_DAYS): string {
  const days = `${graceDays} day${graceDays === 1 ? "" : "s"}`;
  return decision.reason === "duplicate"
    ? `Closed automatically: marked as a duplicate and still open after ${days}.`
    : `Closed automatically: rejected by confirmations (${decision.rejects} reject, ${decision.confirms} confirm) and still open after ${days}.`;
}

/** Open issues that may have left the pipeline: the shortlist, rechecked by cleanupDecision. */
export const pipelineCandidateWhere = {
  isDeleted: false,
  status: "open",
  OR: [
    { duplicateOfId: { not: null } },
    { confirmations: { some: { verdict: "reject", undoneAt: null } } },
  ],
} satisfies Prisma.BugWhereInput;

const candidateSelect = {
  id: true,
  number: true,
  title: true,
  status: true,
  organisationId: true,
  projectId: true,
  duplicateOfId: true,
  updatedAt: true,
  duplicateOf: { select: { number: true } },
  project: { select: { slug: true, name: true } },
  confirmations: { where: { undoneAt: null }, select: { verdict: true, updatedAt: true } },
} satisfies Prisma.BugSelect;

type CandidateRow = Prisma.BugGetPayload<{ select: typeof candidateSelect }>;

/** When each duplicate was last marked one: its latest `duplicate_changed` activity. */
async function duplicateMarkedAt(db: Prisma.TransactionClient | typeof prisma, bugIds: string[]): Promise<Map<string, Date>> {
  if (!bugIds.length) return new Map();
  const rows = await db.bugActivity.findMany({
    where: { bugId: { in: bugIds }, type: "duplicate_changed", metadata: { path: ["field"], equals: "duplicateOf" } },
    select: { bugId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const marked = new Map<string, Date>();
  for (const row of rows) if (!marked.has(row.bugId)) marked.set(row.bugId, row.createdAt);
  return marked;
}

function toInput(row: CandidateRow, marked: Map<string, Date>): CleanupInput {
  return {
    status: row.status,
    duplicateOfId: row.duplicateOfId,
    duplicateMarkedAt: marked.get(row.id) ?? null,
    confirmations: row.confirmations,
    updatedAt: row.updatedAt,
  };
}

export type PipelineCandidate = {
  id: string;
  number: number;
  title: string;
  organisationId: string;
  projectId: string;
  project: { slug: string; name: string };
  duplicateOfId: string | null;
  duplicateOfNumber: number | null;
} & CleanupDecision;

/**
 * One page of issues the cleanup would close now, oldest update first. Pass
 * the last `cursor` back to read the next page; null when there is none.
 */
export async function findPipelineCandidates(options: {
  now?: Date;
  graceDays?: number;
  projectId?: string;
  organisationId?: string;
  take?: number;
  cursor?: string | null;
} = {}): Promise<{ candidates: PipelineCandidate[]; cursor: string | null }> {
  const now = options.now ?? new Date();
  const cutoff = pipelineCutoff(now, options.graceDays);
  const take = options.take ?? PIPELINE_CLEANUP_BATCH;
  const rows = await prisma.bug.findMany({
    where: {
      ...pipelineCandidateWhere,
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.organisationId ? { organisationId: options.organisationId } : {}),
    },
    select: candidateSelect,
    orderBy: { id: "asc" },
    take,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
  const marked = await duplicateMarkedAt(prisma, rows.filter((r) => r.duplicateOfId).map((r) => r.id));
  const candidates: PipelineCandidate[] = [];
  for (const row of rows) {
    const decision = cleanupDecision(toInput(row, marked), cutoff);
    if (!decision) continue;
    candidates.push({
      id: row.id,
      number: row.number,
      title: row.title,
      organisationId: row.organisationId,
      projectId: row.projectId,
      project: row.project,
      duplicateOfId: row.duplicateOfId,
      duplicateOfNumber: row.duplicateOf?.number ?? null,
      ...decision,
    });
  }
  return { candidates, cursor: rows.length === take ? rows[rows.length - 1].id : null };
}

/**
 * Who the close is recorded as: the organisation's earliest owner, with no
 * agent. Null when the organisation has no owner (nothing is closed then).
 */
async function systemActor(organisationId: string): Promise<Actor | null> {
  const owner = await prisma.membership.findFirst({
    where: { organisationId, role: "owner" },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  return owner ? { organisationId, userId: owner.userId, agentId: null, agentName: "Pipeline cleanup" } : null;
}

export type PipelineSweepResult = {
  mode: PipelineCleanupMode;
  found: number;
  closed: number;
  skipped: number;
  byReason: Record<PipelineCleanupReason, number>;
};

/**
 * The cron sweep: finds a batch of issues that left the pipeline and, in
 * `on` mode, closes each with its reason and evidence through the same close
 * as a manager's (claims released, history and `issue.closed` recorded). Each
 * issue is locked and its rule rechecked before it is closed.
 */
export async function sweepPipelineCleanup(options: { mode?: PipelineCleanupMode; now?: Date } = {}): Promise<PipelineSweepResult> {
  const mode = options.mode ?? pipelineCleanupMode();
  const result: PipelineSweepResult = { mode, found: 0, closed: 0, skipped: 0, byReason: { duplicate: 0, rejected: 0 } };
  if (mode === "off") return result;

  const now = options.now ?? new Date();
  const cutoff = pipelineCutoff(now);
  const { candidates } = await findPipelineCandidates({ now });
  result.found = candidates.length;
  for (const c of candidates) result.byReason[c.reason]++;
  if (mode === "dry_run") return result;

  const actors = new Map<string, Actor | null>();
  for (const candidate of candidates) {
    if (!actors.has(candidate.organisationId)) actors.set(candidate.organisationId, await systemActor(candidate.organisationId));
    const actor = actors.get(candidate.organisationId);
    if (!actor) {
      result.skipped++;
      continue;
    }
    // A refusal (the duplicate's target became a duplicate itself, say) skips this issue, not the batch.
    const closed = await prisma.$transaction(async (tx) => {
      const fresh = await lockedRow(tx, candidate.id).catch(() => null);
      if (!fresh || isDone(fresh.status)) return false;
      const row = await tx.bug.findUnique({ where: { id: candidate.id }, select: candidateSelect });
      if (!row) return false;
      const marked = await duplicateMarkedAt(tx, row.duplicateOfId ? [row.id] : []);
      const decision = cleanupDecision(toInput(row, marked), cutoff);
      if (!decision) return false;
      await closeInTransaction(tx, actor, row.projectId, { id: row.id, number: row.number }, fresh, {
        reason: decision.reason,
        evidence: cleanupEvidence(decision),
        duplicateOfId: decision.reason === "duplicate" ? row.duplicateOfId : null,
      });
      return true;
    }).catch(() => false);
    if (closed) result.closed++;
    else result.skipped++;
  }
  return result;
}
