import type { SecurityCheckItemStatus, SecurityTargetKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findingPrice } from "./payment";
import { feeOf } from "@/lib/coins/math";

/**
 * Your work on Security (#security-checks, plan C1): the parts of security
 * checks that agents this person owns are checking or have checked. Splitting
 * and writing the report are Ziki's own AI, not agent jobs, so only `check`
 * parts show. For each, what its findings earned: a finding pays its price, less
 * Ziki's fee, to its finder once the client unlocks it. Never the client's payments, and
 * never what was found.
 */

export type AgentJobRow = {
  id: string;
  title: string;
  status: SecurityCheckItemStatus;
  agentName: string;
  targetKind: SecurityTargetKind;
  targetValue: string;
  /** When the agent was given the job; null while it waits. */
  assignedAt: Date | null;
  /** When the agent reported back; null until then. */
  reportedAt: Date | null;
  /** Findings the agent reported for this part. */
  findings: number;
  /** What its unlocked findings earned, in Ziks. */
  earned: number;
  /** Whether any of that has been paid out. */
  paid: boolean;
};

/** Jobs of agents this person owns; with a workspace, only checks in that workspace (23 Nov, Chloe). */
function agentJobs(userId: string, organisationId?: string | null) {
  return {
    kind: "check" as const,
    agent: { ownerUserId: userId },
    status: { in: ["checking" as const, "done" as const] },
    ...(organisationId ? { check: { organisationId } } : {}),
  };
}

/** Parts checked by the agents this person owns, those in progress first, then the newest. */
export async function listAgentJobs(userId: string, organisationId?: string | null, take = 50): Promise<AgentJobRow[]> {
  const rows = await prisma.securityCheckItem.findMany({
    where: agentJobs(userId, organisationId),
    orderBy: [{ updatedAt: "desc" }],
    take,
    select: {
      id: true,
      title: true,
      status: true,
      assignedAt: true,
      reportedAt: true,
      agent: { select: { name: true } },
      check: { select: { target: { select: { kind: true, value: true } } } },
      // Only what the earnings need: never the finding's text.
      results: { select: { severity: true, priceCoins: true, unlockedAt: true, payoutReleasedAt: true } },
    },
  });
  return rows
    .map((row) => {
      const unlocked = row.results.filter((result) => result.unlockedAt !== null);
      return {
        id: row.id,
        title: row.title,
        status: row.status,
        agentName: row.agent?.name ?? "Your agent",
        targetKind: row.check.target.kind,
        targetValue: row.check.target.value,
        assignedAt: row.assignedAt,
        reportedAt: row.reportedAt,
        findings: row.results.length,
        earned: unlocked.reduce((sum, result) => { const price = findingPrice(result); return sum + price - feeOf(price); }, 0),
        paid: unlocked.some((result) => result.payoutReleasedAt !== null),
      };
    })
    .sort((a, b) => Number(b.status === "checking") - Number(a.status === "checking"));
}

/** How many parts this person's agents are checking or have checked, for the Your work tab. */
export async function countAgentJobs(userId: string, organisationId?: string | null): Promise<number> {
  return prisma.securityCheckItem.count({ where: agentJobs(userId, organisationId) });
}

/**
 * The workspaces this person owns or runs, other than the one they are in: where their own security checks
 * live. Shown to a plain member on Your work so they can switch there on purpose (15 Nov call), instead of
 * being moved without being asked.
 */
export async function listOwnWorkspaces(userId: string, exceptOrganisationId: string | null, take = 3): Promise<{ id: string; name: string }[]> {
  const rows = await prisma.membership.findMany({
    where: {
      userId,
      role: { in: ["owner", "admin"] },
      organisation: { archivedAt: null },
      ...(exceptOrganisationId ? { organisationId: { not: exceptOrganisationId } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take,
    select: { organisation: { select: { id: true, name: true } } },
  });
  return rows.map((row) => row.organisation);
}
