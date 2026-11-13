import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ON_CALL_CANDIDATE_HOURS_PER_DAY, ON_CALL_CANDIDATE_WINDOW_DAYS, isQuiet } from "@/lib/security-checks";

/**
 * On-call agents (#on-call, 12 Nov plan H2): normal working agents from very
 * active owners, invited by a super admin and accepted by their owner. They get
 * priority work. A super admin may also clear them for security checks.
 *
 * - Ziki recommends candidates from activity (`onCallCandidates`).
 * - A super admin invites (`inviteToOnCall`), optionally clearing for security.
 * - The agent's owner accepts or declines (`respondToOnCallInvite`) on My agents
 *   or from their inbox. Accepting sets `onCallAt`, and `securityClearedAt` when
 *   the invite clears it.
 */

type Db = PrismaClient | Prisma.TransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Fixes counted over this many days for a candidate. */
export const CANDIDATE_FIXES_WINDOW_DAYS = 30;
/** How many candidates the page shows. */
export const CANDIDATES_SHOWN = 10;

export class OnCallError extends Error {
  constructor(
    readonly code: "not_found" | "revoked" | "already_on_call" | "already_invited" | "not_yours" | "not_pending",
    message: string,
  ) {
    super(message);
    this.name = "OnCallError";
  }
}

// ---------------------------------------------------------------------------
// Recommendations

export type CandidateActivity = {
  agentId: string;
  /** Distinct hours with activity over the window. */
  activeHours: number;
  /** Distinct days with activity over the window. */
  activeDays: number;
  /** Issues it fixed and was paid for over CANDIDATE_FIXES_WINDOW_DAYS. */
  fixes: number;
  rating: number | null;
};

export type Candidate = CandidateActivity & {
  name: string;
  username: string;
  ownerName: string | null;
  /** Average active hours a day over the window. */
  hoursPerDay: number;
  /** Meets the bar: ON_CALL_CANDIDATE_HOURS_PER_DAY a day on average. */
  meetsBar: boolean;
};

/**
 * Ranks candidates: those meeting the bar first, then by active hours a day,
 * then fixes, then rating. Activity counts the hours an agent did something
 * Ziki records (an audited action), so it understates agents that only read;
 * the bar is a guide for the super admin, not a gate.
 */
export function rankCandidates<T extends CandidateActivity>(rows: readonly T[]): (T & { hoursPerDay: number; meetsBar: boolean })[] {
  return rows
    .map((row) => {
      const hoursPerDay = Math.round((row.activeHours / ON_CALL_CANDIDATE_WINDOW_DAYS) * 10) / 10;
      return { ...row, hoursPerDay, meetsBar: hoursPerDay >= ON_CALL_CANDIDATE_HOURS_PER_DAY };
    })
    .sort(
      (a, b) =>
        Number(b.meetsBar) - Number(a.meetsBar) ||
        b.hoursPerDay - a.hoursPerDay ||
        b.fixes - a.fixes ||
        (b.rating ?? 0) - (a.rating ?? 0),
    );
}

/**
 * The agents Ziki recommends for on call: active, not revoked or paused, not
 * already on call and without a pending invite, ranked by `rankCandidates`.
 */
export async function onCallCandidates(db: Db = prisma, now = new Date()): Promise<Candidate[]> {
  const since = new Date(now.getTime() - ON_CALL_CANDIDATE_WINDOW_DAYS * DAY_MS);
  const activity = await db.$queryRaw<{ agentId: string; hours: bigint; days: bigint }[]>`
    SELECT "agentId",
           COUNT(DISTINCT date_trunc('hour', "createdAt")) AS hours,
           COUNT(DISTINCT date_trunc('day', "createdAt")) AS days
    FROM "AgentAuditEvent"
    WHERE "createdAt" >= ${since} AND "actorUserId" IS NULL
    GROUP BY "agentId"
    ORDER BY hours DESC
    LIMIT 60`;
  if (activity.length === 0) return [];
  const ids = activity.map((row) => row.agentId);
  const agents = await db.agent.findMany({
    where: {
      id: { in: ids },
      revokedAt: null,
      pausedAt: null,
      onCallAt: null,
      onCallInvites: { none: { status: "pending" } },
    },
    select: { id: true, name: true, username: true, rating: true, owner: { select: { name: true } } },
  });
  const fixesSince = new Date(now.getTime() - CANDIDATE_FIXES_WINDOW_DAYS * DAY_MS);
  const fixes = await db.pointEntry.groupBy({
    by: ["agentId"],
    where: { agentId: { in: agents.map((a) => a.id) }, role: "solver", points: { gt: 0 }, createdAt: { gte: fixesSince } },
    _count: { _all: true },
  });
  const fixesBy = new Map(fixes.map((row) => [row.agentId, row._count._all]));
  const activityBy = new Map(activity.map((row) => [row.agentId, row]));
  return rankCandidates(
    agents.map((agent) => {
      const row = activityBy.get(agent.id)!;
      return {
        agentId: agent.id,
        name: agent.name,
        username: agent.username,
        ownerName: agent.owner.name,
        activeHours: Number(row.hours),
        activeDays: Number(row.days),
        fixes: fixesBy.get(agent.id) ?? 0,
        rating: agent.rating,
      };
    }),
  ).slice(0, CANDIDATES_SHOWN);
}

// ---------------------------------------------------------------------------
// Invites

/**
 * A super admin invites an agent to go on call, by id or username. Refused for
 * a revoked agent, one already on call, or one with a pending invite. Its
 * owner gets an inbox note pointing to My agents.
 */
export async function inviteToOnCall(
  db: Db,
  input: { agentId?: string; username?: string; invitedById: string; clearForSecurity: boolean },
): Promise<{ inviteId: string }> {
  const where = input.agentId ? { id: input.agentId } : { username: (input.username ?? "").trim().replace(/^@/, "").toLowerCase() };
  const agent = await db.agent.findUnique({
    where: where as Prisma.AgentWhereUniqueInput,
    select: { id: true, name: true, ownerUserId: true, revokedAt: true, onCallAt: true, onCallInvites: { where: { status: "pending" }, select: { id: true } } },
  });
  if (!agent) throw new OnCallError("not_found", "No agent with that username.");
  if (agent.revokedAt) throw new OnCallError("revoked", "That agent is revoked.");
  if (agent.onCallAt) throw new OnCallError("already_on_call", "That agent is already on call.");
  if (agent.onCallInvites.length > 0) throw new OnCallError("already_invited", "That agent already has a pending invite.");
  const invite = await db.onCallInvite.create({
    data: { agentId: agent.id, invitedById: input.invitedById, clearForSecurity: input.clearForSecurity },
    select: { id: true },
  });
  await db.notification.create({
    data: {
      userId: agent.ownerUserId,
      kind: "on_call_invite",
      title: `${agent.name} is invited to go on call${input.clearForSecurity ? " and do security checks" : ""}`,
      url: "/agents/mine#on-call-invites",
    },
  });
  return { inviteId: invite.id };
}

/** A super admin withdraws a pending invite. */
export async function cancelOnCallInvite(db: Db, inviteId: string, now = new Date()): Promise<void> {
  const { count } = await db.onCallInvite.updateMany({
    where: { id: inviteId, status: "pending" },
    data: { status: "cancelled", respondedAt: now },
  });
  if (count !== 1) throw new OnCallError("not_pending", "That invite isn't pending any more.");
}

/**
 * The agent's owner accepts or declines. Accepting puts the agent on call, and
 * clears it for security checks when the invite says so. Only the owner may
 * answer, once.
 */
export async function respondToOnCallInvite(
  db: Db & Pick<PrismaClient, "$transaction">,
  input: { inviteId: string; userId: string; accept: boolean },
  now = new Date(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const invite = await tx.onCallInvite.findUnique({
      where: { id: input.inviteId },
      select: { id: true, status: true, clearForSecurity: true, agentId: true, agent: { select: { ownerUserId: true, revokedAt: true } } },
    });
    if (!invite || invite.agent.ownerUserId !== input.userId) throw new OnCallError("not_yours", "That invite isn't for one of your agents.");
    const { count } = await tx.onCallInvite.updateMany({
      where: { id: invite.id, status: "pending" },
      data: { status: input.accept ? "accepted" : "declined", respondedAt: now },
    });
    if (count !== 1) throw new OnCallError("not_pending", "That invite was already answered or withdrawn.");
    if (!input.accept) return;
    if (invite.agent.revokedAt) throw new OnCallError("revoked", "That agent is revoked.");
    await tx.agent.update({
      where: { id: invite.agentId },
      data: { onCallAt: now, ...(invite.clearForSecurity ? { securityClearedAt: now } : {}) },
    });
  });
}

/** Pending invites for one person's agents, newest first, for My agents. */
export async function pendingInvitesFor(userId: string, db: Db = prisma) {
  return db.onCallInvite.findMany({
    where: { status: "pending", agent: { ownerUserId: userId, revokedAt: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, clearForSecurity: true, createdAt: true, agent: { select: { name: true, username: true } } },
  });
}

/** Pending invites across the site, for the super admin page. */
export async function pendingInvites(db: Db = prisma) {
  return db.onCallInvite.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      clearForSecurity: true,
      createdAt: true,
      agent: { select: { name: true, username: true, owner: { select: { name: true } } } },
      invitedBy: { select: { name: true } },
    },
  });
}

/** A super admin takes an agent off call. Its security clearance is separate and stays. */
export async function removeFromOnCall(db: Db, agentId: string): Promise<void> {
  await db.agent.updateMany({ where: { id: agentId }, data: { onCallAt: null } });
}

/** A super admin grants or takes away an agent's site-wide security clearance. */
export async function setSecurityClearance(db: Db, agentId: string, cleared: boolean, now = new Date()): Promise<void> {
  await db.agent.updateMany({ where: { id: agentId }, data: { securityClearedAt: cleared ? now : null } });
}

// ---------------------------------------------------------------------------
// The on-call list

export type OnCallState = "Online" | "Quiet" | "Paused" | "Revoked";

/** The on-call agents for the super admin page, with their state, open work and guest stays. */
export async function listOnCallAgents(now = new Date(), db: Db = prisma) {
  const agents = await db.agent.findMany({
    where: { onCallAt: { not: null } },
    orderBy: { onCallAt: "asc" },
    select: {
      id: true,
      name: true,
      username: true,
      revokedAt: true,
      pausedAt: true,
      securityClearedAt: true,
      onCallAt: true,
      owner: { select: { name: true } },
      apiKeys: { where: { revokedAt: null }, select: { lastUsedAt: true } },
      activations: { where: { guestUntilFirstDelivery: true, guestEndedAt: null, deactivatedAt: null }, select: { id: true } },
      _count: { select: { securityCheckItems: { where: { status: "checking" } } } },
    },
  });
  return agents.map((agent) => {
    const lastSeen = agent.apiKeys.reduce<Date | null>((latest, key) => (key.lastUsedAt && (!latest || key.lastUsedAt > latest) ? key.lastUsedAt : latest), null);
    const state: OnCallState = agent.revokedAt ? "Revoked" : agent.pausedAt ? "Paused" : isQuiet(lastSeen, now) ? "Quiet" : "Online";
    return {
      id: agent.id,
      name: agent.name,
      username: agent.username,
      ownerName: agent.owner.name,
      state,
      lastSeen,
      cleared: agent.securityClearedAt !== null,
      onCallSince: agent.onCallAt,
      openParts: agent._count.securityCheckItems,
      guestWorkspaces: agent.activations.length,
    };
  });
}
