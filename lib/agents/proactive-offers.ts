import "server-only";
import { Prisma, type AgentWorkMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/agent-api/events";
import { assertUnderCapacity, isAtCapacityError } from "@/lib/agent-api/capacity";
import { ON_ISSUE_STAKE_STATUSES } from "@/lib/agent-api/stakes";
import { liveHoldWhere } from "@/lib/issue-holders";
import { OPEN_BID_WHERE } from "@/lib/open-bids";
import { workflowFor } from "@/lib/workflow";
import { PRODUCT_TRACK } from "@/lib/marketing/track";
import { priorityNow, type PriorityNowIssue } from "@/lib/priority-now";
import { WORK_ROW_SELECT, capReached, workCapUsage } from "@/lib/agents/work-mode";
import { budgetBlock } from "@/lib/coins/budget";
import { STALE_AFTER_MS, agentsLastSeen, isStale, seenRecentlyWhere } from "@/lib/agents/last-seen";

/**
 * Proactive offers (#proactive-offers): matching runs both ways. Agents bid on
 * the work they want; the site also offers each project's top-priority issues
 * (lib/priority-now.ts) to its idle active agents, so urgent work isn't left
 * waiting for a bid. It is the second exception to "nothing offers an issue
 * automatically" (AGENTS.md), and it makes the same offer an award does: an
 * offered claim the agent accepts (`POST /api/v1/offers/{id}/accept`) within
 * the project's offer window, or that lapses.
 *
 * An issue is offered only while it is Open · Open (confirmed), nobody holds
 * it or has a live offer on it, no stake is live on it, and no agent that is
 * still checking in has an open bid on it (a bid means an agent asked for it:
 * award that instead). A complex issue is offered too: accepting its offer
 * opens plan review instead of starting the work (lib/agent-api/offer.ts). A bid from a stale bidder, one not seen
 * for the stale window, doesn't hold the issue back. The sweep takes the
 * highest-ranked issues that pass, in Priority now's order, so issues it can't
 * offer never hide the ones below them.
 *
 * An agent is idle when it is active in the organisation, not revoked or
 * paused, checked in within the stale window (lib/agents/last-seen.ts), holds
 * no offer, plan review or claim on work In progress in the organisation, is
 * within the caps its owner set with its work mode (#agent-work-mode), and
 * its owner is under the project's capacity. It is never offered an issue it
 * was offered or held before. Each agent gets at most one offer per sweep;
 * an area match goes first, then the agent seen most recently.
 */

/** At most this many offers per sweep, across every project. */
export const PROACTIVE_OFFERS_PER_SWEEP = 25;

/** How many offerable issues the sweep reads per project, highest-ranked first. */
export const PROACTIVE_CANDIDATES_PER_PROJECT = 25;

export type IdleAgent = { id: string; ownerUserId: string; areaIds: Set<string>; lastSeenAt: Date; workMode: AgentWorkMode | null };

/**
 * The issues that may be offered now, by the rule above, as a condition on the
 * issue: the sweep's candidate query and the offer's re-check under the lock
 * both read it. (Open · Open is the caller's: Priority now reads only those.)
 */
export function offerableWhere(offerWindowSeconds: number, now: Date): Prisma.BugWhereInput {
  return {
    claims: { none: liveHoldWhere(offerWindowSeconds, now.getTime()) },
    stakes: { none: { status: { in: ON_ISSUE_STAKE_STATUSES } } },
    bids: { none: { ...OPEN_BID_WHERE, agent: { revokedAt: null, ...seenRecentlyWhere(now) } } },
  };
}

/**
 * The idle agent for an issue, or null: one never offered or holding it
 * before, an area match first, then the most recently seen.
 */
export function pickAgent(issue: { areaId: string | null }, idle: IdleAgent[], triedBefore: Set<string>): IdleAgent | null {
  const candidates = idle.filter((agent) => !triedBefore.has(agent.id));
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) =>
      Number(Boolean(issue.areaId && b.areaIds.has(issue.areaId))) - Number(Boolean(issue.areaId && a.areaIds.has(issue.areaId))) ||
      b.lastSeenAt.getTime() - a.lastSeenAt.getTime(),
  )[0]!;
}

/** The agents in an organisation that are online and hold nothing (also the lapsed-offer hand-over's, lib/agent-api/hand-over.ts). */
export async function idleAgentsIn(organisationId: string, now: Date): Promise<IdleAgent[]> {
  const agents = await prisma.agent.findMany({
    where: {
      revokedAt: null,
      pausedAt: null,
      activations: { some: { organisationId, deactivatedAt: null } },
      // A cheap first cut: a key used recently (every call stamps it, at most once a minute).
      apiKeys: { some: { revokedAt: null, lastUsedAt: { gt: new Date(now.getTime() - STALE_AFTER_MS) } } },
      // Holds nothing here: no offer, plan review, or claim on work still In progress.
      claims: {
        none: {
          releasedAt: null,
          bug: { organisationId },
          OR: [{ status: "offered" }, { status: "planning" }, { status: "active", bug: { status: "in_progress" } }],
        },
      },
    },
    select: { id: true, ownerUserId: true, areaPreferences: { select: { projectAreaId: true } }, ...WORK_ROW_SELECT },
  });
  if (agents.length === 0) return [];
  const seen = await agentsLastSeen(agents.map((agent) => agent.id));
  // An agent at a cap couldn't accept the offer: it would only lapse.
  const capped = new Set<string>();
  for (const agent of agents) {
    if (agent.maxActiveTasks === null && agent.dailyTaskLimit === null) continue;
    if (capReached(agent, await workCapUsage(prisma, agent.id, now))) capped.add(agent.id);
  }
  return agents.flatMap((agent) => {
    const lastSeenAt = seen.get(agent.id) ?? null;
    if (!lastSeenAt || isStale(lastSeenAt, now) || capped.has(agent.id)) return [];
    return [{ id: agent.id, ownerUserId: agent.ownerUserId, areaIds: new Set(agent.areaPreferences.map((row) => row.projectAreaId)), lastSeenAt, workMode: agent.workMode }];
  });
}

/**
 * Makes one proactive offer in a transaction, re-checking everything under
 * the issue's lock. Returns the claim's id, or null when the issue or the
 * agent is no longer free (someone else got there first). The lapsed-offer
 * hand-over makes the same offer (`handedOver`).
 */
export async function offerIssue(
  issue: Pick<PriorityNowIssue, "id" | "priority">,
  agent: IdleAgent,
  scope: { organisationId: string; projectId: string },
  now: Date,
  options: { handedOver?: boolean } = {},
): Promise<string | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${issue.id} FOR UPDATE`;
      const workflow = await workflowFor(scope.projectId, tx);
      const fresh = await tx.bug.findFirst({
        where: { ...offerableWhere(workflow.offerWindowSeconds, now), id: issue.id, isDeleted: false, substatus: "open" },
        select: { id: true },
      });
      if (!fresh) return null;
      // #project-budget: a project that pays from a budget only offers issues with a price its budget covers.
      if (await budgetBlock(tx, issue.id)) return null;
      const locked = await tx.$queryRaw<{ pausedAt: Date | null; revokedAt: Date | null }[]>`SELECT "pausedAt", "revokedAt" FROM "Agent" WHERE "id" = ${agent.id} FOR UPDATE`;
      if (!locked[0] || locked[0].pausedAt || locked[0].revokedAt) return null;
      // Capacity is the owner's, as for an award (#bidder-capacity).
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${agent.ownerUserId} FOR UPDATE`;
      await assertUnderCapacity(tx, { organisationId: scope.organisationId, projectId: scope.projectId, userId: agent.ownerUserId }, workflow);
      const claim = await tx.issueClaim.create({
        data: {
          bugId: issue.id,
          beneficiaryUserId: agent.ownerUserId,
          agentId: agent.id,
          status: "offered",
          offeredAt: now,
        },
        select: { id: true },
      });
      await publish(tx, {
        organisationId: scope.organisationId,
        type: "claim.offered",
        actorAgentId: agent.id,
        bugId: issue.id,
        payload: {
          claimId: claim.id,
          issueId: issue.id,
          projectId: scope.projectId,
          beneficiaryUserId: agent.ownerUserId,
          proactive: true,
          ...(options.handedOver ? { handedOver: true } : {}),
          priority: issue.priority,
          expiresAt: new Date(now.getTime() + workflow.offerWindowSeconds * 1000).toISOString(),
        },
      });
      return claim.id;
    });
  } catch (error) {
    // At capacity, or another offer won the issue's one pending-offer slot: skip it.
    if (isAtCapacityError(error)) return null;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
}

/**
 * The sweep (lib/cron/runner.ts): for each organisation with idle agents,
 * each project's highest-ranked offerable issues go to its idle agents, one
 * each, at most PROACTIVE_OFFERS_PER_SWEEP in all.
 */
export async function sweepProactiveOffers(now: Date = new Date()): Promise<{ offered: number }> {
  // Organisations with an agent online now: the only ones with anyone to offer to.
  const activations = await prisma.agentActivation.findMany({
    where: {
      deactivatedAt: null,
      agent: { revokedAt: null, pausedAt: null, apiKeys: { some: { revokedAt: null, lastUsedAt: { gt: new Date(now.getTime() - STALE_AFTER_MS) } } } },
    },
    distinct: ["organisationId"],
    select: { organisationId: true },
  });
  let offered = 0;
  for (const { organisationId } of activations) {
    if (offered >= PROACTIVE_OFFERS_PER_SWEEP) break;
    let idle = await idleAgentsIn(organisationId, now);
    if (idle.length === 0) continue;
    const projects = await prisma.project.findMany({
      where: { organisationId, archivedAt: null, bugs: { some: { ...PRODUCT_TRACK, isDeleted: false, substatus: "open" } } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    for (const project of projects) {
      if (idle.length === 0 || offered >= PROACTIVE_OFFERS_PER_SWEEP) break;
      const workflow = await workflowFor(project.id);
      const top = await priorityNow(
        { organisationId, projectId: project.id, offerWindowSeconds: workflow.offerWindowSeconds },
        PROACTIVE_CANDIDATES_PER_PROJECT,
        prisma,
        offerableWhere(workflow.offerWindowSeconds, now),
      );
      if (top.length === 0) continue;
      // Never offer an agent an issue it was offered or held before: one it let lapse or let go stays with others.
      const before = await prisma.issueClaim.findMany({
        where: { bugId: { in: top.map((issue) => issue.id) }, agentId: { in: idle.map((agent) => agent.id) } },
        select: { bugId: true, agentId: true },
      });
      for (const issue of top) {
        if (idle.length === 0 || offered >= PROACTIVE_OFFERS_PER_SWEEP) break;
        const tried = new Set(before.filter((row) => row.bugId === issue.id).map((row) => row.agentId));
        const agent = pickAgent(issue, idle, tried);
        if (!agent) continue;
        const claimId = await offerIssue(issue, agent, { organisationId, projectId: project.id }, now);
        // Offered or not, this agent is done for this sweep: one offer each, and a refusal means it isn't free.
        idle = idle.filter((other) => other.id !== agent.id);
        if (claimId) {
          offered += 1;
          // Its owner's other agents wait for the next sweep, so capacity is checked afresh.
          idle = idle.filter((other) => other.ownerUserId !== agent.ownerUserId);
        }
      }
    }
  }
  return { offered };
}
