import type { Prisma, PrismaClient } from "@prisma/client";
import { audit } from "@/lib/agents/audit";
import { releaseWorkOfRevokedAgent } from "@/lib/agent-api/revoke-release";
import { LIVE_GUEST } from "@/lib/agents/guest-access";
import { ON_CALL_GUESTS_PER_NEW_WORKSPACE, ON_CALL_QUIET_AFTER_MS } from "@/lib/security-checks";

/**
 * On-call guests (12 Nov security and on-call plan, part D2).
 *
 * When a workspace is created, a few free on-call agents join it as guests to
 * give the new client a quick win. A guest is a working agent there: it sees
 * the work feed and issues, bids, takes work and delivers. Its owner does not
 * become a member and can't open the workspace in the app. The guest uses its
 * own key from home (see lib/agents/guest-access.ts), and leaves on its own after
 * delivering its first task there; the workspace's owner can also remove it
 * early from the Agents page.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** A free on-call agent takes at most this many guest stays at once, so one agent isn't spread thin. */
export const GUEST_STAYS_PER_AGENT = 3;

/**
 * Up to `n` free on-call agents, at random, one per owner. Free means on call,
 * not revoked or paused, seen in the last ON_CALL_QUIET_AFTER_MS (not quiet),
 * and with room for another guest stay. `excludeOwnerIds` keeps, for example,
 * the workspace's own creator out.
 *
 * Hamzat's H2 owns on-call picking; this lives here until it moves to
 * lib/security-checks/on-call.ts.
 */
export async function pickFreeOnCallAgents(
  db: Db,
  n: number,
  { excludeOwnerIds = [], now = new Date(), random = Math.random }: { excludeOwnerIds?: string[]; now?: Date; random?: () => number } = {},
): Promise<{ id: string; ownerUserId: string }[]> {
  if (n <= 0) return [];
  const since = new Date(now.getTime() - ON_CALL_QUIET_AFTER_MS);
  const candidates = await db.agent.findMany({
    where: {
      onCallAt: { not: null },
      revokedAt: null,
      pausedAt: null,
      ownerUserId: { notIn: excludeOwnerIds },
      apiKeys: { some: { revokedAt: null, lastUsedAt: { gte: since } } },
    },
    select: { id: true, ownerUserId: true, _count: { select: { activations: { where: LIVE_GUEST } } } },
  });
  const free = candidates.filter((agent) => agent._count.activations < GUEST_STAYS_PER_AGENT);
  // Shuffle (Fisher-Yates), then keep the first agent of each owner.
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [free[i], free[j]] = [free[j]!, free[i]!];
  }
  const owners = new Set<string>();
  const picked: { id: string; ownerUserId: string }[] = [];
  for (const agent of free) {
    if (owners.has(agent.ownerUserId)) continue;
    owners.add(agent.ownerUserId);
    picked.push({ id: agent.id, ownerUserId: agent.ownerUserId });
    if (picked.length === n) break;
  }
  return picked;
}

/**
 * Adds free on-call agents to a new workspace as guests. Returns the agent ids
 * added; none when none are free. Never throws: a workspace is never held up
 * or lost because guests couldn't be added.
 */
export async function addOnCallGuests(
  db: Db,
  workspace: { organisationId: string; creatorId: string },
  options: { now?: Date; random?: () => number } = {},
): Promise<string[]> {
  try {
    const picked = await pickFreeOnCallAgents(db, ON_CALL_GUESTS_PER_NEW_WORKSPACE, { excludeOwnerIds: [workspace.creatorId], ...options });
    if (picked.length === 0) return [];
    await db.agentActivation.createMany({
      data: picked.map((agent) => ({ agentId: agent.id, organisationId: workspace.organisationId, level: "working" as const, guestUntilFirstDelivery: true })),
      skipDuplicates: true,
    });
    for (const agent of picked) {
      await audit({ agentId: agent.id, organisationId: workspace.organisationId }, "agent.on_call_guest_added", `agent:${agent.id}`, {}, { actorUserId: workspace.creatorId, db });
    }
    return picked.map((agent) => agent.id);
  } catch (error) {
    console.error("[on-call-guests] couldn't add guests to a new workspace", error);
    return [];
  }
}

/**
 * Ends a guest's stay in one workspace: it is switched off there and its open
 * claims and bids there are handed back (a delivered fix stays where it got
 * to). Its work elsewhere is untouched. Run inside the caller's transaction.
 * Returns false when it wasn't a live guest there.
 */
export async function endGuestStay(
  tx: Prisma.TransactionClient,
  input: {
    agentId: string;
    organisationId: string;
    actorUserId: string;
    reason: "first_delivery" | "removed";
    /** The task just delivered: its claim stays so the delivery can be judged, merged and paid. */
    deliveredIssueId?: string;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const ended = await tx.agentActivation.updateMany({
    where: { agentId: input.agentId, organisationId: input.organisationId, ...LIVE_GUEST },
    data: { guestEndedAt: now, deactivatedAt: now },
  });
  if (ended.count === 0) return false;
  const handedBack = await releaseWorkOfRevokedAgent(tx, {
    agentId: input.agentId,
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    now,
    keepIssueIds: input.deliveredIssueId ? [input.deliveredIssueId] : [],
  });
  await audit(
    { agentId: input.agentId, organisationId: input.organisationId },
    "agent.on_call_guest_ended",
    `agent:${input.agentId}`,
    { reason: input.reason, ...handedBack },
    { actorUserId: input.actorUserId, db: tx },
  );
  return true;
}
