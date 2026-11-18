import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { requireLevel } from "@/lib/agents/levels";
import { audit } from "@/lib/agents/audit";
import { IssueApiError } from "@/lib/agent-api/errors";
import { parseIssueRef } from "@/lib/issue-ref";
import { REWARD_DEFAULT, REWARD_MAX_ESTIMATES, REWARD_ZIK_MAX, REWARD_ZIK_MIN, REWARD_ZIK_STEP } from "@/lib/points/rules";
import { dollarsToZiks, ziksToDollars } from "@/lib/coins/math";

/**
 * Rewards (#rewards): what solving an issue is worth, 10 Ziks (easy) to 100
 * Ziks (expensive), in steps of 10. Agents set it by planning poker: each person
 * gives one estimate (`POST /api/v1/issues/{id}/reward`, `{ value, reason }`,
 * `value` in Ziks), and the reward is the average. Estimating again replaces
 * yours. Once `REWARD_MAX_ESTIMATES` (15) are in, the reward is fixed and takes
 * no more. Until the first estimate the reward is `REWARD_DEFAULT` (10 Ziks).
 * Others' individual estimates stay hidden until the reward is fixed, so nobody
 * anchors on them; the running average and the count are always shown.
 *
 * Everything the API and the pages say is in Ziks. Underneath, the points
 * economy keeps the reward in dollars (a Zik is 10 cents), so the conversion
 * happens only here: `ziksToDollars` on the way in, `dollarsToZiks` on the way out.
 */

export const estimateSchema = z
  .object({
    projectId: z.string().trim().min(1).max(191).optional(),
    value: z
      .number()
      .int()
      .min(REWARD_ZIK_MIN)
      .max(REWARD_ZIK_MAX)
      .refine((ziks) => ziks % REWARD_ZIK_STEP === 0),
    /** Why that much, in a sentence or two. */
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

type Scope = { organisationId: string; projectId: string };
type Tx = Prisma.TransactionClient;

/** The reward as issues and the work feed show it: in Ziks (the stored reward is in dollars). */
export function rewardView(bug: { reward: { toNumber(): number } | number; rewardEstimateCount: number; rewardFixedAt: Date | null }) {
  const dollars = typeof bug.reward === "number" ? bug.reward : bug.reward.toNumber();
  return {
    reward: dollarsToZiks(dollars),
    estimates: bug.rewardEstimateCount,
    maxEstimates: REWARD_MAX_ESTIMATES,
    fixed: Boolean(bug.rewardFixedAt),
  };
}

const ESTIMATING_CLOSED = new Set(["closed"]);

async function findBug(tx: Tx, scope: Scope, ref: string) {
  const parsed = parseIssueRef(ref);
  const found = await tx.bug.findFirst({
    where: { ...scope, isDeleted: false, ...(parsed.kind === "number" ? { number: parsed.number } : { id: parsed.id }) },
    select: { id: true },
  });
  if (!found) throw new IssueApiError(404, "Issue not found in this project.");
  return found.id;
}

/** Parses an estimate, throwing a 400 that names the field. */
export function parseEstimate(raw: unknown) {
  const parsed = estimateSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = typeof issue?.path[0] === "string" ? issue.path[0] : undefined;
    const message =
      field === "value"
        ? `value must be a whole number of Ziks from ${REWARD_ZIK_MIN} (easy) to ${REWARD_ZIK_MAX} (expensive), in steps of ${REWARD_ZIK_STEP}.`
        : issue?.message ?? "Invalid estimate.";
    throw new IssueApiError(400, message, { error: "invalid_request", message, ...(field ? { field } : {}) });
  }
  return parsed.data;
}

/**
 * Records `giver`'s estimate on an issue, replacing theirs, and recomputes the
 * reward (the average, fixed at 15). An agent's estimate is for its owner; a
 * person gives theirs on the issue page. Throws `IssueApiError`.
 */
export async function giveRewardEstimate(
  giver: { userId: string; agentId: string | null },
  scope: Scope,
  ref: string,
  input: { value: number; reason?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const bugId = await findBug(tx, scope, ref);
    await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${bugId} FOR UPDATE`;
    const bug = await tx.bug.findUniqueOrThrow({ where: { id: bugId }, select: { id: true, status: true, rewardFixedAt: true, rewardEstimateCount: true, reward: true } });
    if (bug.rewardFixedAt) {
      const message = `This reward is fixed at ${rewardView(bug).reward} Ziks after ${REWARD_MAX_ESTIMATES} estimates.`;
      throw new IssueApiError(409, message, { error: "reward_fixed", message, ...rewardView(bug) });
    }
    if (ESTIMATING_CLOSED.has(bug.status)) {
      const message = "A closed issue takes no estimates.";
      throw new IssueApiError(409, message, { error: "not_estimable", message });
    }
    const key = { bugId_onBehalfOfUserId: { bugId, onBehalfOfUserId: giver.userId } };
    const existing = await tx.rewardEstimate.findUnique({ where: key, select: { id: true } });
    // The estimate arrives in Ziks (whole tens, checked by parseEstimate) and is stored in dollars.
    const dollars = ziksToDollars(input.value);
    await tx.rewardEstimate.upsert({
      where: key,
      create: { bugId, onBehalfOfUserId: giver.userId, agentId: giver.agentId, value: dollars, reason: input.reason ?? null },
      update: { agentId: giver.agentId, value: dollars, reason: input.reason ?? null },
    });
    const totals = await tx.rewardEstimate.aggregate({ where: { bugId }, _avg: { value: true }, _count: { _all: true } });
    const count = totals._count._all;
    const average = Math.round((totals._avg.value ?? REWARD_DEFAULT) * 100) / 100;
    const fixed = count >= REWARD_MAX_ESTIMATES;
    const updated = await tx.bug.update({
      where: { id: bugId },
      data: { reward: average, rewardEstimateCount: count, ...(fixed ? { rewardFixedAt: new Date() } : {}) },
      select: { reward: true, rewardEstimateCount: true, rewardFixedAt: true },
    });
    return { issueId: bugId, mine: input.value, replaced: Boolean(existing), ...rewardView(updated) };
  });
}

/** `POST /api/v1/issues/{id}/reward`: give or replace your owner's estimate. */
export async function estimateReward(agent: AgentContext, scope: Scope, ref: string, raw: unknown) {
  requireLevel(agent, "working");
  const input = parseEstimate(raw);
  const result = await giveRewardEstimate({ userId: agent.ownerId, agentId: agent.agentId }, scope, ref, input);
  await audit(agent, "issue.reward_estimated", `issue:${result.issueId}`, { value: input.value, reward: result.reward, estimates: result.estimates }, { bugId: result.issueId });
  return result;
}

/** Every estimate on an issue, oldest first, with who gave it: the issue page's Reward panel. */
export async function rewardEstimatesFor(bugId: string) {
  const estimates = await prisma.rewardEstimate.findMany({
    where: { bugId },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    select: { id: true, onBehalfOfUserId: true, agentId: true, value: true, reason: true, updatedAt: true },
  });
  const [people, agents] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...new Set(estimates.map((e) => e.onBehalfOfUserId))] } }, select: { id: true, name: true } }),
    prisma.agent.findMany({ where: { id: { in: [...new Set(estimates.map((e) => e.agentId).filter((id): id is string => Boolean(id)))] } }, select: { id: true, name: true } }),
  ]);
  const personName = new Map(people.map((person) => [person.id, person.name]));
  const agentName = new Map(agents.map((agent) => [agent.id, agent.name]));
  return estimates.map((estimate) => ({
    id: estimate.id,
    userId: estimate.onBehalfOfUserId,
    by: personName.get(estimate.onBehalfOfUserId) ?? "A member",
    agentName: estimate.agentId ? agentName.get(estimate.agentId) ?? null : null,
    value: dollarsToZiks(estimate.value),
    reason: estimate.reason,
    updatedAt: estimate.updatedAt,
  }));
}

/** `GET /api/v1/issues/{id}/reward`: the reward, how many estimates it averages, yours, and everyone's once it is fixed. */
export async function readReward(agent: AgentContext, scope: Scope, ref: string) {
  const bugId = await findBug(prisma as unknown as Tx, scope, ref);
  const [bug, estimates] = await Promise.all([
    prisma.bug.findUniqueOrThrow({ where: { id: bugId }, select: { reward: true, rewardEstimateCount: true, rewardFixedAt: true } }),
    prisma.rewardEstimate.findMany({ where: { bugId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { onBehalfOfUserId: true, value: true, reason: true, createdAt: true } }),
  ]);
  const view = rewardView(bug);
  const mine = estimates.find((estimate) => estimate.onBehalfOfUserId === agent.ownerId) ?? null;
  return {
    issueId: bugId,
    ...view,
    mine: mine ? { value: dollarsToZiks(mine.value), reason: mine.reason } : null,
    // Planning poker: the others' estimates show once the reward is fixed.
    estimatesList: view.fixed ? estimates.map(({ value, reason, createdAt }) => ({ value: dollarsToZiks(value), reason, createdAt })) : null,
  };
}
