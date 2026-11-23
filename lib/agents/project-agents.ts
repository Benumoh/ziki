import "server-only";
import type { Status } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { activeIn } from "@/lib/agents/active-in";
import { agentsLastActed, agentsLastSeen, isStale } from "@/lib/agents/last-seen";
import { ACTING_WINDOW_MS } from "@/lib/agents/work-alerts";
import { AGENT_IDLE_WINDOW_MS, AGENT_WORKING_WINDOW_MS, isClaimStalled } from "@/lib/dashboard-overview";
import { isDeliveryOverdue } from "@/lib/claim-deadline";
import { issueHref } from "@/lib/issue-ref";

/**
 * Agents online now (#online-agents): every agent at work in one project (or
 * every project of an organisation), what it holds there, and whether it is
 * stuck or not responding. The Work queue's Online tab lists the ones online
 * now, what each is on, and the one thing the viewer can do about it.
 * Statuses come from real signals only (claims, heartbeats, questions, key
 * use and events), read the same way the agents bar reads them
 * (lib/dashboard-overview.ts).
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

export type ProjectAgentClaim = {
  id: string;
  /** The issue's id. */
  bugId: string;
  status: "offered" | "planning" | "active";
  issueNumber: number;
  issueTitle: string;
  issueStatus: Status;
  /** The issue's page. */
  href: string;
  stuck: boolean;
  unanswered: boolean;
};

export type ProjectAgent = {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  ownerUserId: string;
  ownerName: string | null;
  status: ProjectAgentStatus;
  detail: string;
  lastSeenAt: Date | null;
  /** Its open bids, waiting for an award. */
  openBids: number;
  claims: ProjectAgentClaim[];
};

/** Online now: checked in within the stale window (agents poll about every 30 seconds), and not paused. */
export function isOnlineNow(agent: Pick<ProjectAgent, "status" | "lastSeenAt">, now: Date): boolean {
  return agent.status !== "paused" && !isStale(agent.lastSeenAt, now);
}

/** Whether it holds work that waits on it: an offer, a plan, or work in progress. Delivered work waits on testers and reviewers. */
export function holdsWork(agent: Pick<ProjectAgent, "claims">): boolean {
  return agent.claims.some((claim) => claim.status !== "active" || claim.issueStatus === "in_progress");
}

/** Claims in the order they need attention: stuck or unanswered first, then live work, plans, offers, and delivered work. */
function claimOrder(claim: ProjectAgentClaim): number {
  if (claim.stuck || claim.unanswered) return 0;
  if (claim.status === "active" && claim.issueStatus === "in_progress") return 1;
  if (claim.status === "planning") return 2;
  if (claim.status === "offered") return 3;
  return 4;
}

/** What it is on, in a few words, then the issue it is on when there is one ("Working on" #12). */
export function focusOf(agent: ProjectAgent): { text: string; claim: ProjectAgentClaim | null } {
  const claim = [...agent.claims].sort((a, b) => claimOrder(a) - claimOrder(b))[0] ?? null;
  switch (agent.status) {
    case "paused":
      return claim ? { text: "Paused on", claim } : { text: "Paused by its owner", claim: null };
    case "stuck":
      return { text: "Stuck on", claim };
    case "not_responding":
      return { text: "Hasn't answered its offer of", claim };
    case "waiting":
      return { text: "Waiting for its owner to answer a question", claim: null };
    case "working":
      // Working without a claim: voting, confirming, testing or reviewing (projectAgentState).
      return claim?.status === "active" && claim.issueStatus === "in_progress"
        ? { text: "Working on", claim }
        : { text: "Helping clear the queue: voting, testing and reviewing", claim: null };
    case "planning":
      return { text: "Plan in review for", claim };
    case "offered":
      return { text: "Offered", claim };
    case "delivered":
      return { text: "Delivered, waiting for review:", claim };
    case "bidding":
      return { text: `Bidding on ${agent.openBids} ${agent.openBids === 1 ? "issue" : "issues"}, waiting for an award`, claim: null };
    case "idle":
      return { text: "Free: it can be offered work", claim: null };
    default:
      return { text: agent.detail, claim: null };
  }
}

/** Where an owner answers their agents' questions. */
export const QUESTIONS_HREF = "/inbox?tab=escalations";

/** The note a nudge sends a stuck agent: a steer note (sendIssueSteer), read on its next poll. */
export function nudgeNote(issueNumber: number): string {
  return `You've gone quiet on #${issueNumber}. Send a heartbeat saying where you are and what's next, or release the issue if you can't finish it.`;
}

/** The viewer's one step: a link to where it is taken, or a nudge sent from the row itself. */
export type AgentStep = { kind: "link"; label: string; href: string } | { kind: "nudge"; label: string; claim: ProjectAgentClaim };

/**
 * The one thing the viewer can do about the agent, if any (#owner-control: people act through their agents).
 * Its owner answers its question, accepts an offer it hasn't, or nudges it when it is stuck (a steer note,
 * as on the issue page: only the owner may steer their agent); anyone else can review work it delivered.
 * The links go where each step already lives: the inbox, or the issue's Your turn card.
 */
export function stepFor(agent: ProjectAgent, viewerId: string): AgentStep | null {
  const own = agent.ownerUserId === viewerId;
  if (own && agent.status === "waiting") return { kind: "link", label: "Answer it", href: QUESTIONS_HREF };
  const { claim } = focusOf(agent);
  if (!claim) return null;
  if (own && claim.status === "offered") return { kind: "link", label: "Accept the offer", href: claim.href };
  if (own && claim.stuck) return { kind: "nudge", label: "Nudge it", claim };
  if (!own && agent.status === "delivered") return { kind: "link", label: "Review it", href: claim.href };
  return null;
}

/**
 * The agents at work in a project right now, or (with no project) in every
 * project of the organisation: every agent with an open bid, an offer or a
 * claim there, and every agent active in the organisation seen in the last
 * day. Whatever needs attention comes first.
 */
export async function loadProjectAgents({
  projectId,
  organisationId,
  now = new Date(),
}: {
  /** Null for every project of the organisation. */
  projectId: string | null;
  organisationId: string;
  now?: Date;
}): Promise<ProjectAgent[]> {
  const issues = { ...(projectId ? { projectId } : { organisationId }), isDeleted: false };
  const [claims, bids] = await Promise.all([
    prisma.issueClaim.findMany({
      where: { releasedAt: null, status: { in: ["offered", "planning", "active"] }, bug: issues },
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
        bug: {
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            pullRequestUrl: true,
            project: { select: { slug: true, organisation: { select: { slug: true } } } },
          },
        },
      },
    }),
    // Open bids: not withdrawn or awarded, on issues still open for bids.
    prisma.issueBid.findMany({
      where: { withdrawnAt: null, awardedAt: null, bug: { ...issues, status: "open" } },
      select: { agentId: true },
    }),
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
      ownerUserId: true,
      owner: { select: { name: true } },
      questions: { where: { answeredAt: null }, take: 1, select: { id: true } },
    },
  });
  if (agents.length === 0) return [];

  const [seenBy, actedBy] = await Promise.all([
    agentsLastSeen(agents.map((agent) => agent.id)),
    agentsLastActed(agents.map((agent) => agent.id), projectId ? { projectId } : { organisationId }, new Date(now.getTime() - ACTING_WINDOW_MS)),
  ]);

  const rows: ProjectAgent[] = [];
  for (const agent of agents) {
    const own = claims.filter((claim) => claim.agentId === agent.id);
    const openBids = bids.filter((bid) => bid.agentId === agent.id).length;
    const lastSeenAt = seenBy.get(agent.id) ?? null;
    const seenToday = lastSeenAt !== null && now.getTime() - lastSeenAt.getTime() <= AGENT_IDLE_WINDOW_MS;
    // Nothing here and not seen in a day: left out.
    if (own.length === 0 && openBids === 0 && !seenToday) continue;
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
      openBids,
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
      ownerUserId: agent.ownerUserId,
      ownerName: agent.owner.name,
      ...state,
      lastSeenAt,
      openBids,
      claims: own.map((claim, index) => ({
        id: claim.id,
        bugId: claim.bug.id,
        status: signals[index]!.status,
        issueNumber: claim.bug.number,
        issueTitle: claim.bug.title,
        issueStatus: claim.bug.status,
        href: issueHref({ number: claim.bug.number, project: claim.bug.project }),
        stuck: claimIsStuck(signals[index]!, now),
        unanswered: offerUnanswered(signals[index]!, lastSeenAt, now),
      })),
    });
  }
  rows.sort((a, b) => PROJECT_AGENT_RANK[a.status] - PROJECT_AGENT_RANK[b.status] || a.name.localeCompare(b.name));
  return rows;
}
