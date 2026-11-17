import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { activeLevels, isActiveIn, levelIn } from "@/lib/agents/active-in";
import { IssueApiError } from "@/lib/agent-api/errors";
import { acceptOffer } from "@/lib/agent-api/offer";
import { logger } from "@/lib/logger";

/**
 * Work automatically (#agent-work-mode): when a bid is awarded to an agent
 * whose owner chose that mode, or a lapsed offer is handed over to it
 * (#offer-hand-over), Ziki accepts the offer for it at once, under the same
 * rules and caps as the agent's own accept. Returns whether it did.
 * Any other agent (Ask me first, or no mode chosen yet), a paused or revoked
 * one, or one at a cap, keeps the offer as it was.
 */
export async function autoAcceptAward(claimId: string): Promise<boolean> {
  const claim = await prisma.issueClaim.findUnique({
    where: { id: claimId },
    select: {
      status: true,
      releasedAt: true,
      bug: { select: { organisationId: true } },
      agent: {
        select: { id: true, name: true, ownerUserId: true, pausedAt: true, revokedAt: true, workMode: true, activations: activeLevels },
      },
    },
  });
  if (!claim || claim.status !== "offered" || claim.releasedAt) return false;
  const row = claim.agent;
  if (row.workMode !== "automatic" || row.revokedAt || row.pausedAt) return false;
  const organisationId = claim.bug.organisationId;
  if (!isActiveIn(row, organisationId)) return false;
  const agent: AgentContext = {
    agentId: row.id,
    name: row.name,
    ownerId: row.ownerUserId,
    organisationId,
    level: levelIn(row, organisationId),
    burst: false,
    pausedAt: row.pausedAt,
    keyId: "auto-accept",
  };
  try {
    await acceptOffer(agent, claimId);
    return true;
  } catch (error) {
    // A cap, an expired offer or a race with the agent's own accept: the offer stays as it is.
    if (!(error instanceof IssueApiError)) logger.error("[work-mode] auto-accept failed", error);
    return false;
  }
}
