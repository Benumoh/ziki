"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { getSiteUrl } from "@/lib/site-url";
import { createAgent } from "@/lib/agents/registry";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { agentBootstrapMessage } from "@/lib/agents/bootstrap-message";

export type StartConnectResult =
  | { ok: true; agentId: string; name: string; setupText: string }
  | { ok: false; error: string };

/**
 * Connect agent, step one: register the named agent and hand back the text
 * the person pastes into it. The text carries the new key, so it is shown once.
 */
export async function startAgentConnectAction(input: { name: string }): Promise<StartConnectResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: "The agent platform is turned off on this site." };
  const user = await requireUser();
  // #user-agents: created active in the organisation you are in.
  const result = await createAgent(user, { name: input.name });
  if (!result.ok) return { ok: false, error: result.error };

  const organisationId = await currentOrganisationIdFor(user.id);
  const organisation = organisationId
    ? await prisma.organisation.findUnique({ where: { id: organisationId }, select: { name: true } })
    : null;
  revalidatePath("/agents/mine");
  return {
    ok: true,
    agentId: result.key.agentId,
    name: result.key.name,
    setupText: agentBootstrapMessage({
      origin: getSiteUrl(),
      apiKey: result.key.rawKey,
      organisationName: organisation?.name ?? null,
    }),
  };
}

/** A key's last use is saved at most once a minute (lib/agents/require-agent.ts): a call that recent may not show. */
const LAST_USED_SLACK_MS = 60_000;

/**
 * Connect agent, step two: has this agent used its key yet? Only its owner can
 * ask. With `since` (when the person opened Connect), only a call from then on
 * counts, less the minute a last use can lag, so an agent connected long ago
 * doesn't look freshly connected. Once connected it also gives the agent's
 * username, so the page can go straight on to the agent's own page.
 */
export async function checkAgentConnectedAction(
  agentId: string,
  since?: string,
): Promise<{ connected: false } | { connected: true; username: string }> {
  const user = await requireUser();
  const from = since ? new Date(Date.parse(since) - LAST_USED_SLACK_MS) : null;
  const key = await prisma.agentApiKey.findFirst({
    where: {
      agent: { id: agentId, ownerUserId: user.id, revokedAt: null },
      revokedAt: null,
      lastUsedAt: from && !Number.isNaN(from.getTime()) ? { gt: from } : { not: null },
    },
    select: { agent: { select: { username: true } } },
  });
  return key ? { connected: true, username: key.agent.username } : { connected: false };
}
