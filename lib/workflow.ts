import type { Prisma } from "@prisma/client";
import { databaseErrorReason } from "@/lib/db-error";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_PROJECT_WORKFLOW,
  workflowValues,
  type ProjectWorkflowValues,
} from "@/lib/workflow-config";

type Db = typeof prisma | Prisma.TransactionClient;

/** Short enough that another instance notices a change, long enough to help. */
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 1000;

const cache = new Map<string, { value: ProjectWorkflowValues; expiresAt: number }>();

/**
 * The workflow dials for one project (#595). Reads the project's row, not a
 * module constant. A missing row falls back to the defaults so a project that
 * predates the migration, or a test double without the delegate, still works.
 *
 * The cache is keyed by project id, so one project's settings can never be
 * returned for another. Updates call `invalidateWorkflow()`; other instances
 * pick the change up within the TTL.
 */
export async function workflowFor(
  projectId: string,
  db: Db = prisma,
): Promise<ProjectWorkflowValues> {
  const cached = cache.get(projectId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const delegate = (db as { projectWorkflow?: { findUnique?: (args: unknown) => Promise<unknown> } })
    .projectWorkflow;
  if (typeof delegate?.findUnique !== "function") {
    return { ...DEFAULT_PROJECT_WORKFLOW };
  }

  let row: Partial<ProjectWorkflowValues> | null;
  try {
    row = (await delegate.findUnique({
      where: { projectId },
      select: {
        confirmationsNeeded: true,
        verdictsNeeded: true,
        offerWindowSeconds: true,
        heartbeatMinutes: true,
        deliveryMinutes: true,
        maxActiveClaims: true,
        volunteerWindowSeconds: true,
        autoMerge: true,
        ideaThreshold: true,
        abandonCheckMinutes: true,
        abandonThreshold: true,
        closeThreshold: true,
        governance: true,
        managerVoteWeight: true,
        awardThreshold: true,
        acceptThreshold: true,
        stakeLimit: true,
        stakeInProgressLimit: true,
        revisionLimit: true,
        planReviewSeconds: true,
        humanApprovalsNeeded: true,
      },
    })) as Partial<ProjectWorkflowValues> | null;
  } catch (error) {
    // The team page reads this for every member. A database that has not
    // created ProjectWorkflow yet must use the defaults, not take the page down.
    if (!databaseErrorReason(error)) throw error;
    console.error("[workflow] project workflow is unavailable", error);
    return { ...DEFAULT_PROJECT_WORKFLOW };
  }

  // Never cache a missing row: creating the row later should take effect at
  // once, not after the TTL.
  if (!row) return { ...DEFAULT_PROJECT_WORKFLOW };

  const value = workflowValues(row);
  // A transaction client sees data that may roll back; only the shared client
  // populates the process-wide cache.
  if (db === prisma) {
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(projectId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return value;
}

/** Drop one project's cached settings after a committed edit. */
export function invalidateWorkflow(projectId: string): void {
  cache.delete(projectId);
}

/** Tests only. */
export function resetWorkflowCache(): void {
  cache.clear();
}
