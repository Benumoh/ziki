import { prisma } from "@/lib/prisma";
import { auditWhere } from "@/lib/agent-audit/visibility";
import { agentPicturePath, readAgentProfile } from "@/lib/agents/profile";
import type { AgentActivityItem, AgentProfileData } from "./agent-profile";
import type { AgentReview } from "./agent-reviews";
import type { AgentTab } from "./agent-tabs";

/** The agent pages' data (#agent-profile): the public profile at /agent/{username} and its edit page. */

/** Called "active now" when its key was used this recently. */
const ACTIVE_NOW_MS = 5 * 60_000;

/** How many recent actions the profile lists. */
const ACTIVITY_LIMIT = 20;

/** The username as it arrived, decoded in case it arrived still encoded, lowercased. */
function usernameFrom(raw: string): string {
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    // A stray "%" that isn't an escape: use it as it came.
    return raw.toLowerCase();
  }
}

/** The agent this address names, by its username, which is unique across the platform (#agent-profile). */
export async function findAgentByUsername(raw: string): Promise<{ id: string; tenantId: string; ownerUserId: string; username: string } | null> {
  return prisma.agent.findUnique({
    where: { username: usernameFrom(raw) },
    select: { id: true, tenantId: true, ownerUserId: true, username: true },
  });
}

/**
 * The agent's profile and latest activity. Call it only after the viewer has
 * passed listAgentThread's check (owner or team admin), the same people the
 * audit log shows this agent's actions to.
 */
export async function loadAgentProfile(
  agentId: string,
  viewerId: string | null,
): Promise<{ agent: AgentProfileData; activity: AgentActivityItem[]; tenantId: string; deliveredBugIds: string[] } | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      tenantId: true,
      name: true,
      model: true,
      avatar: true,
      level: true,
      revokedAt: true,
      createdAt: true,
      ownerUserId: true,
      reputation: true,
      owner: { select: { name: true, email: true } },
      apiKeys: { select: { lastUsedAt: true, revokedAt: true, project: { select: { name: true } } } },
    },
  });
  if (!agent) return null;

  const [filed, claims, comments, deliveries, events, profile] = await Promise.all([
    prisma.bug.count({ where: { createdByAgentId: agentId } }),
    prisma.issueClaim.count({ where: { agentId } }),
    prisma.comment.count({ where: { agentId } }),
    prisma.delivery.findMany({ where: { agentId }, select: { bugId: true } }),
    prisma.agentAuditEvent.findMany({
      where: auditWhere({ kind: "own-agents", tenantId: agent.tenantId, agentIds: [agentId] }, { agentId }),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: ACTIVITY_LIMIT,
      select: {
        id: true,
        createdAt: true,
        action: true,
        target: true,
        undoneAt: true,
        bug: { select: { id: true, number: true, title: true, project: { select: { slug: true } } } },
      },
    }),
    readAgentProfile(agentId, "web"),
  ]);

  const lastUsed = agent.apiKeys
    .map((key) => key.lastUsedAt?.getTime() ?? 0)
    .reduce((latest, time) => Math.max(latest, time), 0);
  const projects = [
    ...new Set(agent.apiKeys.filter((key) => !key.revokedAt && key.project).map((key) => key.project!.name)),
  ];

  return {
    tenantId: agent.tenantId,
    deliveredBugIds: deliveries.map((delivery) => delivery.bugId),
    agent: {
      id: agent.id,
      name: agent.name,
      model: agent.model,
      avatar: agent.avatar,
      level: agent.level,
      revokedAt: agent.revokedAt,
      createdAt: agent.createdAt,
      ownerName: agent.ownerUserId === viewerId ? null : (agent.owner.name ?? agent.owner.email),
      lastActiveAt: lastUsed ? new Date(lastUsed) : null,
      activeNow: !agent.revokedAt && lastUsed > 0 && Date.now() - lastUsed < ACTIVE_NOW_MS,
      projects,
      counts: { filed, claims, comments, delivered: deliveries.length },
      reputation: agent.reputation,
      username: profile?.username ?? null,
      tagline: profile?.tagline ?? null,
      about: profile?.about ?? null,
      services: profile?.services ?? null,
      rating: profile?.rating ?? null,
      pictureUrl: profile?.picture_url ?? null,
      skills: profile?.skills ?? [],
    },
    activity: events.map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      action: event.action,
      target: event.target,
      bug: event.bug,
      undone: event.undoneAt !== null,
    })),
  };
}

/** How many reviews the page loads; the list pages through them. */
const REVIEW_LIMIT = 200;

/**
 * Other agents' reviews of the work this agent delivered: testers' judgements
 * and managers' merge reviews on the issues it delivered, newest first. The
 * agent's own entries on those issues aren't reviews of it.
 */
export async function loadReviews(agentId: string, bugIds: string[]): Promise<AgentReview[]> {
  if (bugIds.length === 0) return [];
  const where = { bugId: { in: bugIds }, NOT: { agentId } };
  const reviewer = { select: { id: true, name: true, avatar: true, username: true, picture: { select: { updatedAt: true } } } };
  const owner = { select: { name: true, email: true } };
  const bug = { select: { id: true, number: true, title: true, project: { select: { slug: true } } } };
  const [verdicts, merges] = await Promise.all([
    prisma.testVerdict.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: REVIEW_LIMIT,
      select: { id: true, goodToMerge: true, summary: true, description: true, updatedAt: true, agent: reviewer, onBehalfOf: owner, bug },
    }),
    prisma.mergeReview.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: REVIEW_LIMIT,
      select: { id: true, verdict: true, summary: true, description: true, updatedAt: true, agent: reviewer, onBehalfOf: owner, bug },
    }),
  ]);
  const reviews: AgentReview[] = [
    ...verdicts.map((v) => ({
      id: `judgement-${v.id}`,
      kind: "judgement" as const,
      positive: v.goodToMerge,
      summary: v.summary,
      description: v.description,
      at: v.updatedAt.toISOString(),
      reviewer: reviewerView(v.agent, v.onBehalfOf),
      bug: v.bug,
    })),
    ...merges.map((m) => ({
      id: `merge-${m.id}`,
      kind: "merge" as const,
      positive: m.verdict === "accept",
      summary: m.summary,
      description: m.description,
      at: m.updatedAt.toISOString(),
      reviewer: reviewerView(m.agent, m.onBehalfOf),
      bug: m.bug,
    })),
  ];
  return reviews.sort((a, b) => b.at.localeCompare(a.at)).slice(0, REVIEW_LIMIT);
}

function reviewerView(
  agent: { id: string; name: string; avatar: string | null; username: string | null; picture: { updatedAt: Date } | null },
  owner: { name: string | null; email: string },
): AgentReview["reviewer"] {
  return {
    id: agent.id,
    name: agent.name,
    avatar: agent.avatar,
    pictureUrl: agent.picture ? agentPicturePath(agent, agent.picture.updatedAt, "web") : null,
    ownerName: owner.name ?? owner.email,
  };
}

/** The viewer's own agents in this workspace, for the tabs: active ones, plus this one if it is theirs. */
export async function loadOwnAgents(viewerId: string, tenantId: string, currentId: string): Promise<AgentTab[]> {
  const agents = await prisma.agent.findMany({
    where: { tenantId, ownerUserId: viewerId, OR: [{ revokedAt: null }, { id: currentId }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, avatar: true, revokedAt: true, username: true, picture: { select: { updatedAt: true } } },
  });
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    username: agent.username,
    avatar: agent.avatar,
    pictureUrl: agent.picture ? agentPicturePath(agent, agent.picture.updatedAt, "web") : null,
    revoked: agent.revokedAt !== null,
  }));
}
