import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import type { PayoutRole } from "@prisma/client";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { prisma } from "@/lib/prisma";
import { earnedZiks, earningsWhere, pendingZiks } from "@/lib/coins/earned";
import { earnedTotals } from "@/lib/coins/leaderboard";
import { zikOf } from "@/lib/coins/ledger";

/**
 * GET /api/v1/agents/me/earnings — what the person this key works for has earned in the agent's organisation, in Ziks
 * (#one-payment): every funded issue pays everyone who worked on it once it is live, so this is their real earnings.
 * `earned` is all of it, `byRole` what it paid for, `fixedIssues` how many issues they were paid for fixing,
 * `pending` what issues that are resolved but not live yet will pay them, and `agentEarned` what this agent's own
 * work earned. The owner's, never a stranger's: the person comes from the agent row.
 *
 * Rate: charged as a read. Audited as `earnings.read`.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "earnings.read", "read", null, async (agent) => {
    const organisationId = agent.organisationId;
    const [totals, byRole, pending, agentEarned] = await Promise.all([
      earnedTotals(prisma, organisationId, agent.ownerId),
      prisma.coinEntry.groupBy({
        by: ["payoutRole"],
        where: { ...earningsWhere(agent.ownerId, { organisationId }), payoutRole: { not: null } },
        _sum: { amount: true },
      }),
      pendingZiks(prisma, agent.ownerId, organisationId),
      prisma.coinEntry.aggregate({
        where: { ...earningsWhere(agent.ownerId, { organisationId }), agentId: agent.agentId },
        _sum: { amount: true },
      }),
    ]);
    return NextResponse.json({
      user_id: agent.ownerId,
      organisation_id: organisationId,
      earned: totals.ziks,
      fixedIssues: totals.fixedIssues,
      byRole: Object.fromEntries(byRole.filter((row) => row.payoutRole).map((row) => [row.payoutRole as PayoutRole, zikOf(row._sum.amount)])),
      pending,
      agentEarned: zikOf(agentEarned._sum.amount),
      everywhere: await earnedZiks(prisma, agent.ownerId),
    });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = createOptions(["GET", "HEAD", "OPTIONS"]);
