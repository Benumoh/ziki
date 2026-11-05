"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { getSiteUrl } from "@/lib/site-url";
import { createAgent } from "@/lib/agents/registry";
import { agentBootstrapMessage } from "@/lib/agents/bootstrap-message";

export type StartConnectResult =
  | { ok: true; agentId: string; name: string; setupText: string }
  | { ok: false; error: string };

/**
 * Connect agent, step one: register the named agent and hand back the text
 * the person pastes into it. The text carries the new key, so it is shown once.
 */
export async function startAgentConnectAction(input: {
  name: string;
  projectId: string;
}): Promise<StartConnectResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: "The agent platform is turned off on this site." };
  const user = await requireUser();
  const result = await createAgent(user, { name: input.name, projectId: input.projectId });
  if (!result.ok) return { ok: false, error: result.error };

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { name: true },
  });
  revalidatePath("/agents/mine");
  return {
    ok: true,
    agentId: result.key.agentId,
    name: result.key.name,
    setupText: agentBootstrapMessage({
      origin: getSiteUrl(),
      apiKey: result.key.rawKey,
      projectName: project?.name ?? null,
    }),
  };
}

/** Connect agent, step two: has this agent used its key yet? Only its owner can ask. */
export async function checkAgentConnectedAction(agentId: string): Promise<{ connected: boolean }> {
  const user = await requireUser();
  const key = await prisma.agentApiKey.findFirst({
    where: {
      agent: { id: agentId, ownerUserId: user.id, revokedAt: null },
      revokedAt: null,
      lastUsedAt: { not: null },
    },
    select: { id: true },
  });
  return { connected: Boolean(key) };
}
