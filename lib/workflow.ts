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
        project: { select: { solo: true } },
      },
    })) as (Partial<ProjectWorkflowValues> & { project?: { solo: boolean } | null }) | null;
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

  const { project, ...dials } = row as Partial<ProjectWorkflowValues> & { project?: { solo: boolean } | null };
  const value = project?.solo ? soloWorkflow(workflowValues(dials)) : workflowValues(dials);
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

/**
 * A Solo project's dials (#solo): the owner works alone with their own agents, so every step that waits for other
 * people's votes needs only one, from the owner's own agents or the owner. Testing and review still happen: an agent
 * still can't review its own work, so with one agent the owner approves it themselves.
 */
export function soloWorkflow(values: ProjectWorkflowValues): ProjectWorkflowValues {
  return {
    ...values,
    confirmationsNeeded: 1,
    verdictsNeeded: 1,
    ideaThreshold: 1,
    abandonThreshold: 1,
    closeThreshold: 1,
    awardThreshold: 1,
    acceptThreshold: 1,
    // Nobody else to approve a flagged idea or pull request: the owner's own approval is the gate.
    humanApprovalsNeeded: 0,
  };
}

/** Drop one project's cached settings after a committed edit. */
export function invalidateWorkflow(projectId: string): void {
  cache.delete(projectId);
}

/** Tests only. */
export function resetWorkflowCache(): void {
  cache.clear();
}
