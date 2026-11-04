import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { DEFAULT_GOAL_PAGE_SIZE, encodeGoalCursor, type GoalCursor } from "@/lib/goals/paging";
import type { AgentContext } from "@/lib/agents/require-agent";
import { assertKeyProject } from "@/lib/agents/require-agent";
import { IssueApiError } from "@/lib/agent-api/errors";
import { audit } from "@/lib/agents/audit";
import { publish } from "@/lib/agent-api/events";
import {
  createGoalSchema,
  splitGoalPoolSchema,
  updateGoalStatusSchema,
  type CreateGoalInput,
  type SplitGoalPoolInput,
  type UpdateGoalStatusInput,
} from "@/lib/validations/goal";
import {
  PoolBudgetError,
  assertWithinPool,
  describeBudget,
  remainingPool,
  splitEvenly,
  splitMilestones,
  splitProportional,
  type GoalBudgetSummary,
} from "@/lib/goals/pool-split";

/**
 * Goal budgets and pool splitting (#616). The arithmetic lives in
 * `lib/goals/pool-split.ts`; this module owns the Prisma reads/writes, the
 * tenant/project scoping, and the transactional guard that keeps
 * `Goal.allocated` from ever passing `Goal.budgetPool`.
 */

type Db = typeof prisma | Prisma.TransactionClient;

/** A goal row, as the API returns it. */
export type GoalRecord = Prisma.GoalGetPayload<Record<string, never>>;

/** One slice carved out of a goal's pool, as the API returns it. */
export type GoalAllocationRecord = Prisma.GoalAllocationGetPayload<Record<string, never>>;

/** A goal row plus its computed budget projection. */
export type GoalWithBudget = GoalRecord & { budget: GoalBudgetSummary };

const goalSelect = {
  id: true,
  tenantId: true,
  projectId: true,
  createdById: true,
  title: true,
  description: true,
  budgetPool: true,
  allocated: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GoalSelect;

const allocationSelect = {
  id: true,
  goalId: true,
  method: true,
  targetType: true,
  targetBugId: true,
  targetGoalId: true,
  targetAgentId: true,
  label: true,
  amount: true,
  sourceKey: true,
  releasedAt: true,
  createdAt: true,
} satisfies Prisma.GoalAllocationSelect;

/**
 * Attaches the computed budget summary (remaining, utilization, split status)
 * to a raw goal row.
 *
 * @param goal - A row carrying at least `budgetPool` and `allocated`.
 * @returns The same row with a `budget` field for readers and the UI.
 */
export function withBudget<T extends { budgetPool: number; allocated: number }>(
  goal: T,
): T & { budget: GoalBudgetSummary } {
  return { ...goal, budget: describeBudget(goal.budgetPool, goal.allocated) };
}

/**
 * Translates a refusal from the pure pool arithmetic into the API's error
 * shape: request-shaped problems (`bad_*`) become 400s, budget conflicts
 * (`over_allocated`, `empty_pool`, `negative_pool`) become 409s.
 *
 * @param error - The pool arithmetic refusal.
 * @returns The equivalent `IssueApiError` for `agentIssueRequest` to render.
 */
function toApiError(error: PoolBudgetError): IssueApiError {
  const conflict = error.code === "over_allocated" || error.code === "empty_pool" || error.code === "negative_pool";
  return new IssueApiError(conflict ? 409 : 400, error.message);
}

/**
 * Loads a goal scoped to the agent's tenant, enforcing the key's project.
 *
 * @param agent - The authenticated agent context.
 * @param goalId - The goal to load.
 * @returns The selected goal row.
 * @throws {IssueApiError} 404 when no such goal exists in the tenant.
 */
async function resolveGoal(agent: AgentContext, goalId: string): Promise<GoalRecord> {
  const goal = await prisma.goal.findFirst({
    where: { id: goalId, tenantId: agent.tenantId },
    select: goalSelect,
  });
  if (!goal) throw new IssueApiError(404, "Goal not found.");
  assertKeyProject(agent, goal.projectId);
  return goal;
}

/**
 * Creates a goal in `projectId` on behalf of the calling agent (#616). The
 * pool starts unfunded (`allocated = 0`), so a fresh goal is `unfunded`.
 *
 * @param agent - The authenticated agent context; its owner becomes the creator.
 * @param input - A validated create payload (`createGoalSchema`).
 * @returns The created goal row.
 * @throws {IssueApiError} 404 when the agent's tenant has no such project.
 */
export async function createGoal(agent: AgentContext, input: CreateGoalInput): Promise<GoalRecord> {
  const parsed = createGoalSchema.parse(input);
  const { projectId, ...fields } = parsed;

  const project = await prisma.project.findFirst({
    where: { tenantId: agent.tenantId, ...(projectId ? { id: projectId } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, tenantId: true },
  });
  if (!project) throw new IssueApiError(404, "Project not found.");
  assertKeyProject(agent, project.id);

  return prisma.$transaction(async (tx) => {
    const goal = await tx.goal.create({
      data: {
        tenantId: project.tenantId,
        projectId: project.id,
        createdById: agent.ownerId,
        title: fields.title,
        description: fields.description ?? null,
        budgetPool: fields.budgetPool,
      },
      select: goalSelect,
    });

    await audit(agent, "goal.created", goal.id, { projectId: project.id, budgetPool: goal.budgetPool }, { db: tx });
    await publish(tx, {
      tenantId: project.tenantId,
      type: "goal.created",
      actorAgentId: agent.agentId,
      payload: {
        goalId: goal.id,
        projectId: project.id,
        title: goal.title,
        budgetPool: goal.budgetPool,
      },
    });
    return goal;
  });
}

/**
 * Lists a project's goals, newest first, each with its budget projection.
 *
 * @param tenantId - Tenant the goals belong to.
 * @param projectId - Project whose goals to list.
 * @param page - Page size and cursor, scoped to this project.
 * @returns Goal rows with `budget`, newest first, and the next cursor.
 */
export async function listGoals(
  tenantId: string,
  projectId: string,
  page: { limit: number; cursor: GoalCursor | null } = { limit: DEFAULT_GOAL_PAGE_SIZE, cursor: null },
): Promise<{ goals: GoalWithBudget[]; nextCursor: string | null }> {
  const rows = await prisma.goal.findMany({
    where: {
      tenantId,
      projectId,
      ...(page.cursor ? {
        OR: [
          { createdAt: { lt: page.cursor.createdAt } },
          { createdAt: page.cursor.createdAt, id: { lt: page.cursor.id } },
        ],
      } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page.limit + 1,
    select: goalSelect,
  });
  const goals = rows.slice(0, page.limit).map(withBudget);
  const last = goals[goals.length - 1];
  return {
    goals,
    nextCursor: rows.length > page.limit && last
      ? encodeGoalCursor({ projectId, createdAt: last.createdAt, id: last.id })
      : null,
  };
}

/**
 * Reads one goal with its budget summary and every allocation row (newest
 * first), for `GET /api/v1/goals/{id}`.
 *
 * @param agent - The authenticated agent context.
 * @param goalId - The goal to read.
 * @returns The goal with `budget`, plus its allocation rows.
 * @throws {IssueApiError} 404 when the goal is missing.
 */
export async function readGoal(
  agent: AgentContext,
  goalId: string,
): Promise<{ goal: GoalWithBudget; allocations: GoalAllocationRecord[] }> {
  const goal = await resolveGoal(agent, goalId);
  const allocations = await prisma.goalAllocation.findMany({
    where: { goalId: goal.id, releasedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: allocationSelect,
  });
  return { goal: withBudget(goal), allocations };
}

/**
 * Verifies every split target actually exists inside the goal's scope.
 *
 * @param db - Client or transaction performing the reads.
 * @param goal - The goal being split; supplies tenant and project scope.
 * @param targets - Validated split targets.
 * @throws {IssueApiError} 400 when a goal would fund itself, 404 when an
 *   issue, nested goal, or agent named by a target does not exist in scope.
 */
async function assertTargetsExist(
  db: Db,
  goal: GoalRecord,
  targets: SplitGoalPoolInput["targets"],
): Promise<void> {
  const bugIds = [...new Set(targets.filter((t) => t.targetBugId).map((t) => t.targetBugId!))];
  if (bugIds.length) {
    const found = await db.bug.findMany({
      where: { id: { in: bugIds }, tenantId: goal.tenantId, projectId: goal.projectId, isDeleted: false },
      select: { id: true },
    });
    const known = new Set(found.map((bug) => bug.id));
    const missing = bugIds.find((id) => !known.has(id));
    if (missing) throw new IssueApiError(404, `Issue ${missing} not found in this project.`);
  }

  const goalIds = [...new Set(targets.filter((t) => t.targetGoalId).map((t) => t.targetGoalId!))];
  if (goalIds.length) {
    if (goalIds.includes(goal.id)) throw new IssueApiError(400, "A goal cannot fund itself.");
    const found = await db.goal.findMany({
      where: { id: { in: goalIds }, tenantId: goal.tenantId, projectId: goal.projectId },
      select: { id: true },
    });
    const known = new Set(found.map((row) => row.id));
    const missing = goalIds.find((id) => !known.has(id));
    if (missing) throw new IssueApiError(404, `Goal ${missing} not found in this project.`);
  }

  const agentIds = [...new Set(targets.filter((t) => t.targetAgentId).map((t) => t.targetAgentId!))];
  if (agentIds.length) {
    const found = await db.agent.findMany({
      where: { id: { in: agentIds }, tenantId: goal.tenantId },
      select: { id: true },
    });
    const known = new Set(found.map((row) => row.id));
    const missing = agentIds.find((id) => !known.has(id));
    if (missing) throw new IssueApiError(404, `Agent ${missing} not found in this tenant.`);
  }
}

/**
 * Computes each target's slice for a split, validating the result against the
 * pool before anything touches the database.
 *
 * @param goal - The goal whose pool is being split.
 * @param input - A validated split payload (`splitGoalPoolSchema`).
 * @returns Per-target amounts (zeros dropped by the caller) and the total.
 * @throws {IssueApiError} 400 for bad weights/shares, 409 when the split would
 *   over-allocate the pool or the pool has nothing left to give.
 */
function computeSplit(goal: GoalRecord, input: SplitGoalPoolInput): { amounts: number[]; total: number } {
  try {
    const remaining = remainingPool(goal.budgetPool, goal.allocated);
    let amounts: number[];

    if (input.method === "manual") {
      amounts = input.targets.map((target) => target.amount!);
    } else {
      let splitAmount: number;
      if (input.amount === undefined) {
        // Default: everything still unallocated, with pool-specific refusals.
        if (goal.budgetPool === 0) {
          throw new PoolBudgetError("empty_pool", "This goal's budget pool is empty (0 credits).");
        }
        if (remaining <= 0) {
          throw new PoolBudgetError("over_allocated", "This goal's pool is already fully allocated.");
        }
        splitAmount = remaining;
      } else {
        splitAmount = input.amount;
      }

      const weights = input.targets.map((target) => target.weight ?? 0);
      if (input.method === "proportional") amounts = splitProportional(splitAmount, weights);
      else if (input.method === "milestone") amounts = splitMilestones(splitAmount, weights);
      else amounts = splitEvenly(splitAmount, input.targets.length);
    }

    const total = amounts.reduce((sum, amount) => sum + amount, 0);
    assertWithinPool(goal.budgetPool, goal.allocated, total);
    return { amounts, total };
  } catch (error) {
    if (error instanceof PoolBudgetError) throw toApiError(error);
    throw error;
  }
}

/**
 * Executes a pool split (#616): computes each target's slice, then commits the
 * allocation rows and the `allocated` bump in one transaction guarded so the
 * pool can never be over-allocated, even by concurrent splits.
 *
 * `sourceKey` makes retries safe: every row is keyed `<sourceKey>:<index>` and
 * a split that repeats an existing key is refused with 409 before any credit
 * moves. Amounts of 0 (a target that earned nothing to rounding) are not
 * written as rows.
 *
 * @param agent - The authenticated agent context.
 * @param goalId - The goal whose pool to split.
 * @param input - A validated split payload (`splitGoalPoolSchema`).
 * @returns The refreshed goal with `budget`, plus all live allocations.
 * @throws {IssueApiError} 404 missing goal/targets, 400 self-funding or bad
 *   weights, 409 over-allocation, closed goal, or duplicate `sourceKey`.
 */
export async function splitGoalPool(
  agent: AgentContext,
  goalId: string,
  input: SplitGoalPoolInput,
): Promise<{ goal: GoalWithBudget; allocations: GoalAllocationRecord[] }> {
  const parsed = splitGoalPoolSchema.parse(input);
  const goal = await resolveGoal(agent, goalId);
  if (goal.status !== "active") {
    throw new IssueApiError(409, "Only active goals can be split.");
  }
  await assertTargetsExist(prisma, goal, parsed.targets);

  const { amounts, total } = computeSplit(goal, parsed);
  const baseKey = parsed.sourceKey ?? `split-${goal.id}-${randomUUID()}`;
  const rows = parsed.targets
    .map((target, index) => ({
      goalId: goal.id,
      method: parsed.method,
      targetType: target.targetType,
      targetBugId: target.targetBugId ?? null,
      targetGoalId: target.targetGoalId ?? null,
      targetAgentId: target.targetAgentId ?? null,
      label: target.label ?? null,
      amount: amounts[index] ?? 0,
      sourceKey: `${baseKey}:${index}`,
    }))
    .filter((row) => row.amount > 0);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.goalAllocation.findMany({
      where: {
        goalId: goal.id,
        sourceKey: { in: rows.map((row) => row.sourceKey) },
      },
      select: { sourceKey: true },
    });
    if (existing.length) {
      throw new IssueApiError(409, "This split was already applied; reuse a new sourceKey to split again.");
    }

    // The where-clause is the invariant: the row only bumps when it is still
    // within budget after the increment, so two racing splits cannot both win.
    const guard = await tx.goal.updateMany({
      where: { id: goal.id, status: "active", allocated: { lte: goal.budgetPool - total } },
      data: { allocated: { increment: total } },
    });
    if (guard.count === 0) {
      throw new IssueApiError(409, "This split would over-allocate the goal's budget pool.");
    }
    if (rows.length) {
      try {
        await tx.goalAllocation.createMany({ data: rows });
      } catch (error) {
        if (
          (error instanceof Prisma.PrismaClientKnownRequestError ||
            (typeof error === "object" && error !== null && "code" in error)) &&
          (error as { code: unknown }).code === "P2002"
        ) {
          throw new IssueApiError(409, "This split was already applied; reuse a new sourceKey to split again.");
        }
        throw error;
      }
    }

    const fresh = await tx.goal.findUniqueOrThrow({ where: { id: goal.id }, select: goalSelect });
    const allocations = await tx.goalAllocation.findMany({
      where: { goalId: goal.id, releasedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: allocationSelect,
    });

    await audit(
      agent,
      "goal.split",
      goal.id,
      { method: parsed.method, total, targets: rows.length, projectId: goal.projectId },
      { db: tx },
    );
    await publish(tx, {
      tenantId: goal.tenantId,
      type: "goal.split",
      actorAgentId: agent.agentId,
      payload: {
        goalId: goal.id,
        projectId: goal.projectId,
        method: parsed.method,
        total,
        targets: rows.length,
      },
    });

    return { goal: withBudget(fresh), allocations };
  });
}

/**
 * Moves a goal between `active`, `completed`, and `cancelled` (#616). Closed
 * goals stop accepting splits; existing allocations stay.
 *
 * @param agent - The authenticated agent context.
 * @param goalId - The goal to update.
 * @param input - A validated status payload (`updateGoalStatusSchema`).
 * @returns The refreshed goal with its budget projection.
 * @throws {IssueApiError} 404 when the goal is missing.
 */
export async function updateGoalStatus(
  agent: AgentContext,
  goalId: string,
  input: UpdateGoalStatusInput,
): Promise<GoalWithBudget> {
  const { status } = updateGoalStatusSchema.parse(input);
  const goal = await resolveGoal(agent, goalId);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.goal.update({
      where: { id: goal.id },
      data: { status },
      select: goalSelect,
    });
    await audit(agent, "goal.status_changed", goal.id, { status }, { db: tx });
    await publish(tx, {
      tenantId: goal.tenantId,
      type: "goal.updated",
      actorAgentId: agent.agentId,
      payload: { goalId: goal.id, projectId: goal.projectId, status },
    });
    return withBudget(updated);
  });
}
