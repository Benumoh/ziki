"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { getSiteUrl } from "@/lib/site-url";
import { activateAgent, createAgent } from "@/lib/agents/registry";
import { agentBootstrapMessage } from "@/lib/agents/bootstrap-message";
import { loadGetStarted, type GetStartedState } from "@/app/(app)/agent/[username]/get-started-data";
import { pickFirstThing } from "@/lib/join-first-thing";
import type { FirstThing, JoinAgent } from "@/lib/join-questions";
import { joinAgentConnectSchema, joinAnswersSchema } from "@/lib/validations/join-questions";

/**
 * The join questions (#join-questions): agent first. Each action is the
 * member's own, in an organisation they belong to; the agent steps reuse what
 * the agent's own page does (Connect, Bring into, Get started), so the card,
 * the agent's page and the agent's terminal stay in step. Nothing here
 * revalidates the layout, so the open card isn't redrawn mid-way.
 */

async function membershipOf(userId: string, organisationId: unknown) {
  if (typeof organisationId !== "string" || !organisationId) return null;
  return prisma.membership.findFirst({
    where: { organisationId, userId, organisation: { archivedAt: null } },
    select: { id: true, organisation: { select: { id: true, name: true } } },
  });
}

export type JoinAgentsResult = { ok: true; platform: boolean; agents: JoinAgent[] } | { error: string };

/** Step 1: the member's own live agents, and whether each already works and has called in here. */
export async function listJoinAgentsAction(organisationId: unknown): Promise<JoinAgentsResult> {
  const user = await requireUser();
  const membership = await membershipOf(user.id, organisationId);
  if (!membership) return { error: "You're not a member of this organisation." };
  if (!isAgentPlatformEnabled()) return { ok: true, platform: false, agents: [] };
  const orgId = membership.organisation.id;
  const rows = await prisma.agent.findMany({
    where: { ownerUserId: user.id, revokedAt: null, pausedAt: null },
    orderBy: [{ createdAt: "asc" }],
    take: 20,
    select: {
      id: true,
      name: true,
      activations: { where: { organisationId: orgId, deactivatedAt: null }, select: { id: true } },
      apiKeys: { where: { organisationId: orgId, revokedAt: null, lastUsedAt: { not: null } }, select: { id: true }, take: 1 },
    },
  });
  return {
    ok: true,
    platform: true,
    agents: rows.map((agent) => ({
      id: agent.id,
      name: agent.name,
      activeHere: agent.activations.length > 0,
      connectedHere: agent.activations.length > 0 && agent.apiKeys.length > 0,
    })),
  };
}

export type JoinConnectResult = { ok: true; agentId: string; name: string; setupText: string; since: string } | { error: string };

/**
 * Step 2: bring one of your agents into this organisation, or connect a new one,
 * and hand back the text to paste into it (its key for this organisation, shown
 * once). A new agent is created where you are and brought in here if that is
 * somewhere else, so the key it gets is this organisation's.
 */
export async function joinAgentConnectAction(input: unknown): Promise<JoinConnectResult> {
  if (!isAgentPlatformEnabled()) return { error: "The agent platform is turned off on this site." };
  const user = await requireUser();
  const parsed = joinAgentConnectSchema.safeParse(input);
  if (!parsed.success) return { error: "Give your agent a name." };
  const membership = await membershipOf(user.id, parsed.data.organisationId);
  if (!membership) return { error: "You're not a member of this organisation." };
  const orgId = membership.organisation.id;
  const since = new Date().toISOString();

  let agentId: string;
  if ("agentId" in parsed.data) {
    agentId = parsed.data.agentId;
  } else {
    const created = await createAgent(user, { name: parsed.data.name });
    if (!created.ok) return { error: created.error };
    agentId = created.key.agentId;
    // Created in this organisation already: its first key is this organisation's.
    const here = await prisma.agentApiKey.findFirst({ where: { agentId, organisationId: orgId, revokedAt: null }, select: { id: true } });
    if (here) return { ok: true, agentId, name: created.key.name, setupText: bootstrap(created.key.rawKey, membership.organisation.name), since };
  }
  const activated = await activateAgent(user, agentId, orgId);
  if (!activated.ok) return { error: activated.error };
  return { ok: true, agentId, name: activated.key.name, setupText: bootstrap(activated.key.rawKey, membership.organisation.name), since };
}

function bootstrap(apiKey: string, organisationName: string) {
  return agentBootstrapMessage({ origin: getSiteUrl(), apiKey, organisationName });
}

/** Steps 3 to 5: where the agent's setup stands here (work mode, pace, the work picked for it). Its owner only. */
export async function joinAgentStateAction(organisationId: unknown, agentId: unknown): Promise<GetStartedState | null> {
  const user = await requireUser();
  const membership = await membershipOf(user.id, organisationId);
  if (!membership || typeof agentId !== "string") return null;
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, ownerUserId: user.id, revokedAt: null, activations: { some: { organisationId: membership.organisation.id, deactivatedAt: null } } },
    select: { id: true, name: true },
  });
  return agent ? loadGetStarted(agent, membership.organisation.id) : null;
}

export type JoinAnswersResult = { ok: true; firstThing: FirstThing | null } | { error: string };

/**
 * The end, either way: saves what a member without an agent is good at (empty
 * with an agent, or skipped) and marks the questions asked on their membership,
 * so they aren't asked again on any device; and, without an agent, hands back
 * one real thing to do.
 */
export async function saveJoinAnswersAction(input: unknown, pickFirst = true): Promise<JoinAnswersResult> {
  const user = await requireUser();
  const parsed = joinAnswersSchema.safeParse(input);
  if (!parsed.success) return { error: "Pick one of the answers shown." };
  const { organisationId, strengths } = parsed.data;
  const membership = await membershipOf(user.id, organisationId);
  if (!membership) return { error: "You're not a member of this organisation." };

  await prisma.membership.update({ where: { id: membership.id }, data: { strengths, joinAnsweredAt: new Date() } });
  if (!pickFirst) return { ok: true, firstThing: null };
  try {
    return { ok: true, firstThing: await pickFirstThing(organisationId, user.id, strengths) };
  } catch (error) {
    // The answers are saved either way; the card then only says where replies arrive.
    console.error("[join-questions] first thing failed", error);
    return { ok: true, firstThing: null };
  }
}
