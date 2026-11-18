import "server-only";
import type { AgentLevel, AgentWorkMode, Status } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { activeIn, activeLevels, levelIn } from "@/lib/agents/active-in";
import { agentsLastActed, agentsLastSeen, isStale } from "@/lib/agents/last-seen";
import { ACTING_WINDOW_MS } from "@/lib/agents/work-alerts";
import { AGENT_IDLE_WINDOW_MS, AGENT_WORKING_WINDOW_MS, isClaimStalled } from "@/lib/dashboard-overview";
import { isDeliveryOverdue } from "@/lib/claim-deadline";
import { workflowFor } from "@/lib/workflow";

/**
 * Active agents (#active-agents): every agent at work in one project, with
 * the bids it has open there, what it has been awarded or offered, and
 * whether it is stuck or not responding. Statuses come from real signals
 * only (claims, heartbeats, questions, key use and events), read the same
 * way the agents bar reads them (lib/dashboard-overview.ts).
 */

/**
 * An offer the agent hasn't come back for in this long, with no sign of it
 * since the offer was made, is "not responding". Agents poll their work feed
 * about every 30 seconds, so five minutes is ten missed polls.
 */
export const NOT_RESPONDING_AFTER_MS = 5 * 60 * 1000;

export type ProjectAgentStatus =
  | "paused"
  | "stuck"
  | "not_responding"
  | "waiting"
  | "working"
  | "planning"
  | "offered"
  | "delivered"
  | "bidding"
  | "idle"
  | "away"
  | "offline";

/**
 * Whether the Active agents page lists the agent. One whose only part is delivered work and that isn't
 * online (not seen within the stale window) is left off: its issue waits on testers and reviewers, not
 * on it, and it isn't around. It shows again once it checks in or takes on something else.
 */
export function isListedOnPage(agent: { status: ProjectAgentStatus; lastSeenAt: Date | null }, now: Date): boolean {
  return !(agent.status === "delivered" && isStale(agent.lastSeenAt, now));
}

/** The order agents are listed in: whatever needs attention first. */
export const PROJECT_AGENT_RANK: Record<ProjectAgentStatus, number> = {
  stuck: 0,
  not_responding: 1,
  waiting: 2,
  paused: 3,
  working: 4,
  planning: 5,
  offered: 6,
  delivered: 7,
  bidding: 8,
  idle: 9,
  away: 10,
  offline: 11,
};

/** One claim the agent holds in the project, as the status rule reads it. */
export type HeldClaimSignal = {
  status: "offered" | "planning" | "active";
  issueNumber: number;
  /** The issue's main status: an active claim on an issue past In progress is delivered work. */
  issueStatus: Status;
  offeredAt: Date | null;
  claimedAt: Date | null;
  lastHeartbeatAt: Date | null;
  deliverBy: Date | null;
  waitingOnOwnerSince: Date | null;
  pullRequestUrl: string | null;
};

/** "40m", "3h", "2d": how long, in the largest unit that fits. */
export function spanText(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Whether an active claim on in-progress work has gone quiet or run past its deadline, with nothing pausing its clocks. */
export function claimIsStuck(claim: HeldClaimSignal, now: Date): boolean {
  if (claim.status !== "active" || claim.issueStatus !== "in_progress") return false;
  const heartbeat = claim.lastHeartbeatAt ?? claim.claimedAt;
  const quiet = heartbeat === null || heartbeat.getTime() < now.getTime() - AGENT_WORKING_WINDOW_MS;
  return isClaimStalled({ quiet, deliverBy: claim.deliverBy, waitingOnOwnerSince: claim.waitingOnOwnerSince, pullRequestUrl: claim.pullRequestUrl, now });
}

/** Whether an offer has sat unanswered past NOT_RESPONDING_AFTER_MS with no sign of the agent since it was made. */
export function offerUnanswered(claim: HeldClaimSignal, lastSeenAt: Date | null, now: Date): boolean {
  if (claim.status !== "offered" || !claim.offeredAt) return false;
  if (now.getTime() - claim.offeredAt.getTime() < NOT_RESPONDING_AFTER_MS) return false;
  return lastSeenAt === null || lastSeenAt.getTime() < claim.offeredAt.getTime();
}

/**
 * One agent's status in a project, and a line saying why. Paused comes
 * first (its clocks are frozen, so nothing else applies); then stuck work,
 * an offer it isn't answering, a question to its owner, live work, a plan in
 * review, an offer it is deciding on, delivered work, open bids, and last
 * whether it has been seen in the last day.
 */
export function projectAgentState({
  claims,
  openBids,
  paused,
  hasUnansweredQuestion,
  lastSeenAt,
  lastActedAt = null,
  now,
}: {
  claims: HeldClaimSignal[];
  openBids: number;
  paused: boolean;
  hasUnansweredQuestion: boolean;
  lastSeenAt: Date | null;
  /** Its last step in the project (a vote, confirmation, bid, judgement, report…), lib/agents/last-seen.ts. */
  lastActedAt?: Date | null;
  now: Date;
}): { status: ProjectAgentStatus; detail: string } {
  if (paused) return { status: "paused", detail: "Paused by its owner: its clocks are frozen" };

  const stuck = claims.find((claim) => claimIsStuck(claim, now));
  if (stuck) {
    if (isDeliveryOverdue(stuck.deliverBy, now)) {
      return { status: "stuck", detail: `Past its delivery deadline on #${stuck.issueNumber}` };
    }
    const heartbeat = stuck.lastHeartbeatAt ?? stuck.claimedAt;
    return {
      status: "stuck",
      detail: heartbeat ? `No word on #${stuck.issueNumber} for ${spanText(now.getTime() - heartbeat.getTime())}` : `No word on #${stuck.issueNumber} since it was awarded`,
    };
  }

  const unanswered = claims.find((claim) => offerUnanswered(claim, lastSeenAt, now));
  if (unanswered) {
    return {
      status: "not_responding",
      detail: `Hasn't checked in since it was offered #${unanswered.issueNumber} ${spanText(now.getTime() - unanswered.offeredAt!.getTime())} ago`,
    };
  }

  if (hasUnansweredQuestion) return { status: "waiting", detail: "Waiting for its owner to answer a question" };

  const working = claims.find((claim) => claim.status === "active" && claim.issueStatus === "in_progress");
  if (working) {
    const heartbeat = working.lastHeartbeatAt ?? working.claimedAt;
    const checkedIn = heartbeat ? `, checked in ${spanText(now.getTime() - heartbeat.getTime())} ago` : "";
    return { status: "working", detail: `Working on #${working.issueNumber}${working.pullRequestUrl ? " (pull request open)" : checkedIn}` };
  }

  const planning = claims.find((claim) => claim.status === "planning");
  if (planning) return { status: "planning", detail: `Its plan for #${planning.issueNumber} is waiting for review` };

  const offered = claims.find((claim) => claim.status === "offered");
  if (offered) return { status: "offered", detail: `Offered #${offered.issueNumber}, not accepted yet` };

  // Working without a claim (#work-alerts): voting, confirming, judging, reviewing or merging right now.
  if (lastActedAt && now.getTime() - lastActedAt.getTime() <= ACTING_WINDOW_MS) {
    return { status: "working", detail: `Clearing the project's queue: last step ${spanText(now.getTime() - lastActedAt.getTime())} ago` };
  }

  const delivered = claims.find((claim) => claim.status === "active");
  if (delivered) return { status: "delivered", detail: `Delivered #${delivered.issueNumber}, waiting for review` };

  if (openBids > 0) return { status: "bidding", detail: `${openBids} open ${openBids === 1 ? "bid" : "bids"}, waiting for an award` };

  // Idle means free and online now (seen within the stale window): the agents proactive offers and
  // the lapsed-offer hand-over go to. One seen earlier today is away: it gets no work until it checks in.
  if (lastSeenAt && !isStale(lastSeenAt, now)) {
    return { status: "idle", detail: "Online, with nothing in hand in this project: it can be offered work" };
  }
  if (lastSeenAt && now.getTime() - lastSeenAt.getTime() <= AGENT_IDLE_WINDOW_MS) {
    return { status: "away", detail: `Nothing in hand, last seen ${spanText(now.getTime() - lastSeenAt.getTime())} ago: it gets no offers until it checks in` };
  }
  return { status: "offline", detail: "Not seen in the last day" };
}

export type ProjectAgentBid = { id: string; issueNumber: number; issueTitle: string; placedAt: Date };

export type ProjectAgentClaim = {
  id: string;
  status: "offered" | "planning" | "active";
  issueNumber: number;
  issueTitle: string;
  issueStatus: Status;
  /** When an offer lapses if the agent doesn't accept it; null for anything but an offer. */
  offerExpiresAt: Date | null;
  claimedAt: Date | null;
  lastHeartbeatAt: Date | null;
  deliverBy: Date | null;
  pullRequestUrl: string | null;
  stuck: boolean;
  unanswered: boolean;
};

export type ProjectAgent = {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  ownerName: string | null;
  level: AgentLevel;
  /** How its owner said it takes work (#agent-work-mode); null until they choose. */
  workMode: AgentWorkMode | null;
  status: ProjectAgentStatus;
  detail: string;
  lastSeenAt: Date | null;
  bids: ProjectAgentBid[];
  claims: ProjectAgentClaim[];
};

/**
 * The agents active in a project right now: every agent with an open bid,
 * an offer or a claim there, and every agent active in the organisation seen
 * in the last day. `hidden` counts the organisation's agents left out
 * because they have nothing here and haven't been seen in a day.
 */
export async function loadProjectAgents({
  projectId,
  organisationId,
  now = new Date(),
}: {
  projectId: string;
  organisationId: string;
  now?: Date;
}): Promise<{ agents: ProjectAgent[]; hidden: number; offerWindowSeconds: number }> {
  const [claims, bids, workflow] = await Promise.all([
    prisma.issueClaim.findMany({
      where: { releasedAt: null, status: { in: ["offered", "planning", "active"] }, bug: { projectId, isDeleted: false } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        agentId: true,
        status: true,
        offeredAt: true,
        claimedAt: true,
        lastHeartbeatAt: true,
        deliverBy: true,
        waitingOnOwnerSince: true,
        bug: { select: { number: true, title: true, status: true, pullRequestUrl: true } },
      },
    }),
    // Open bids: not withdrawn or awarded, on issues still open for bids.
    prisma.issueBid.findMany({
      where: { withdrawnAt: null, awardedAt: null, bug: { projectId, isDeleted: false, status: "open" } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true, agentId: true, updatedAt: true, bug: { select: { number: true, title: true } } },
    }),
    workflowFor(projectId),
  ]);

  const workingIds = new Set([...claims.map((claim) => claim.agentId), ...bids.map((bid) => bid.agentId)]);
  const agents = await prisma.agent.findMany({
    where: { revokedAt: null, OR: [{ id: { in: [...workingIds] } }, activeIn(organisationId)] },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      username: true,
      avatar: true,
      pausedAt: true,
      workMode: true,
      owner: { select: { name: true } },
      activations: activeLevels,
      questions: { where: { answeredAt: null }, take: 1, select: { id: true } },
    },
  });
  if (agents.length === 0) return { agents: [], hidden: 0, offerWindowSeconds: workflow.offerWindowSeconds };

  const [seenBy, actedBy] = await Promise.all([
    agentsLastSeen(agents.map((agent) => agent.id)),
    agentsLastActed(agents.map((agent) => agent.id), projectId, new Date(now.getTime() - ACTING_WINDOW_MS)),
  ]);
  const offerWindowMs = workflow.offerWindowSeconds * 1000;

  let hidden = 0;
  const rows: ProjectAgent[] = [];
  for (const agent of agents) {
    const own = claims.filter((claim) => claim.agentId === agent.id);
    const ownBids = bids.filter((bid) => bid.agentId === agent.id);
    const lastSeenAt = seenBy.get(agent.id) ?? null;
    const seenToday = lastSeenAt !== null && now.getTime() - lastSeenAt.getTime() <= AGENT_IDLE_WINDOW_MS;
    if (own.length === 0 && ownBids.length === 0 && !seenToday) {
      hidden += 1;
      continue;
    }
    const signals = own.map((claim) => ({
      status: claim.status as HeldClaimSignal["status"],
      issueNumber: claim.bug.number,
      issueStatus: claim.bug.status,
      offeredAt: claim.offeredAt,
      claimedAt: claim.claimedAt,
      lastHeartbeatAt: claim.lastHeartbeatAt,
      deliverBy: claim.deliverBy,
      waitingOnOwnerSince: claim.waitingOnOwnerSince,
      pullRequestUrl: claim.bug.pullRequestUrl,
    }));
    const state = projectAgentState({
      claims: signals,
      openBids: ownBids.length,
      paused: agent.pausedAt !== null,
      hasUnansweredQuestion: agent.questions.length > 0,
      lastSeenAt,
      lastActedAt: actedBy.get(agent.id) ?? null,
      now,
    });
    rows.push({
      id: agent.id,
      name: agent.name,
      username: agent.username,
      avatar: agent.avatar,
      ownerName: agent.owner.name,
      level: levelIn(agent, organisationId),
      workMode: agent.workMode,
      ...state,
      lastSeenAt,
      bids: ownBids.map((bid) => ({ id: bid.id, issueNumber: bid.bug.number, issueTitle: bid.bug.title, placedAt: bid.updatedAt })),
      claims: own.map((claim, index) => ({
        id: claim.id,
        status: signals[index]!.status,
        issueNumber: claim.bug.number,
        issueTitle: claim.bug.title,
        issueStatus: claim.bug.status,
        offerExpiresAt: claim.status === "offered" && claim.offeredAt ? new Date(claim.offeredAt.getTime() + offerWindowMs) : null,
        claimedAt: claim.claimedAt,
        lastHeartbeatAt: claim.lastHeartbeatAt,
        deliverBy: claim.deliverBy,
        pullRequestUrl: claim.bug.pullRequestUrl,
        stuck: claimIsStuck(signals[index]!, now),
        unanswered: offerUnanswered(signals[index]!, lastSeenAt, now),
      })),
    });
  }
  rows.sort((a, b) => PROJECT_AGENT_RANK[a.status] - PROJECT_AGENT_RANK[b.status] || a.name.localeCompare(b.name));
  return { agents: rows, hidden, offerWindowSeconds: workflow.offerWindowSeconds };
}
