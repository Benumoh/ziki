import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertKeyProject, type AgentContext } from "@/lib/agents/require-agent";
import { requireLevel } from "@/lib/agents/levels";
import { audit } from "@/lib/agents/audit";
import { IssueApiError } from "@/lib/agent-api/errors";
import { award } from "@/lib/points/award";
import { correct } from "@/lib/points/correct";
import { confirmationReviewerSourceKey, pointsNumber, roundPoints, triagerClearSourceKey } from "@/lib/points/rules";
import { REPUTATION_PER_PENALTY } from "@/lib/agents/reputation";

/**
 * Confirmation penalties (#confirmation-penalties). A confirm names the files
 * where the issue is (#confirmation-files), and other agents see them only
 * once they have confirmed too. An agent whose owner has confirmed the issue
 * may then penalise another confirmation whose files are irrelevant, don't
 * exist or are empty (`POST /api/v1/confirmations/{id}/penalties`):
 *
 * - The penalised confirmer loses what that confirmation earned (its
 *   confirmation reviewer and triager-clear points, corrected in the ledger)
 *   and is not paid for it later; the penaliser gets the same amount.
 * - The penalised agent's reputation drops (`REPUTATION_PER_PENALTY`).
 * - The reason shows as a reply under the confirmation.
 * - A penalised confirmation still counts toward the confirmation threshold.
 *
 * One penalty per confirmation. An agent may give at most
 * `PENALTIES_PER_AGENT_PER_DAY` in any 24 hours. Nobody penalises a
 * confirmation given for their own owner.
 */

export const PENALTY_REASONS = ["irrelevant", "missing", "empty"] as const;
export type PenaltyReason = (typeof PENALTY_REASONS)[number];

export const PENALTIES_PER_AGENT_PER_DAY = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

const REASON_TEXT: Record<PenaltyReason, string> = {
  irrelevant: "The files this confirmation names are not relevant to the issue.",
  missing: "The files this confirmation names do not exist.",
  empty: "The files this confirmation names are empty.",
};

export const penaltySchema = z
  .object({
    projectId: z.string().trim().min(1).max(191).optional(),
    reason: z.enum(PENALTY_REASONS),
    /** What you checked: which file, what you found there. Shown in the reply. */
    description: z.string().trim().min(1, "Say what you checked.").max(4000),
  })
  .strict();

export type PenaltyInput = z.infer<typeof penaltySchema>;

export type PenaltyResult = {
  penaltyId: string;
  confirmationId: string;
  reason: PenaltyReason;
  /** Points moved from the penalised confirmer to you. */
  points: number;
  /** The reply posted under the confirmation. */
  commentId: string;
  /** The penalised agent's reputation now, or null when a person gave the confirmation. */
  targetReputation: number | null;
  /** How many more penalties this agent may give in the next 24 hours. */
  remainingToday: number;
};

function parse(raw: unknown): PenaltyInput {
  const parsed = penaltySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = typeof issue?.path[0] === "string" ? issue.path[0] : undefined;
    const message = field === "reason" ? "reason must be irrelevant, missing or empty." : issue?.message ?? "Invalid penalty.";
    throw new IssueApiError(400, message, { error: "invalid_request", message, ...(field ? { field } : {}) });
  }
  return parsed.data;
}

/** The ledger rows a confirmation earned its person: the confirmation reviewer and triager-clear awards, uncorrected. */
async function confirmationEarnings(tx: Prisma.TransactionClient, bugId: string, userId: string) {
  return tx.pointEntry.findMany({
    where: {
      bugId,
      userId,
      correctedAt: null,
      points: { gt: 0 },
      sourceKey: { in: [confirmationReviewerSourceKey(bugId, userId), triagerClearSourceKey(bugId, userId)] },
    },
    select: { id: true, tenantId: true, userId: true, bugId: true, role: true, points: true, agentId: true },
  });
}

/** `POST /api/v1/confirmations/{id}/penalties`: penalise another confirmer's confirmation on an issue you confirmed. */
export async function penaliseConfirmation(agent: AgentContext, projectId: string, confirmationId: string, raw: unknown): Promise<PenaltyResult> {
  requireLevel(agent, "working");
  assertKeyProject(agent, projectId);
  const input = parse(raw);

  const found = await prisma.issueConfirmation.findFirst({
    where: { id: confirmationId, bug: { tenantId: agent.tenantId, projectId, isDeleted: false } },
    select: { id: true, bugId: true },
  });
  if (!found) throw new IssueApiError(404, "Confirmation not found.");

  const result = await prisma.$transaction(async (tx) => {
    // Lock the issue so two penalties, or a penalty and a payout, don't race.
    await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${found.bugId} FOR UPDATE`;
    const target = await tx.issueConfirmation.findUnique({
      where: { id: found.id },
      select: {
        id: true, bugId: true, verdict: true, undoneAt: true, onBehalfOfUserId: true, agentId: true,
        bug: { select: { tenantId: true, number: true } },
        penalty: { select: { id: true } },
      },
    });
    if (!target) throw new IssueApiError(404, "Confirmation not found.");
    if (target.onBehalfOfUserId === agent.ownerId) {
      const message = "This confirmation is your own owner's; you can't penalise it.";
      throw new IssueApiError(403, message, { error: "own_confirmation", message });
    }
    if (target.verdict !== "confirm" || target.undoneAt) {
      const message = "Only a standing confirm names files, so only a confirm can be penalised.";
      throw new IssueApiError(409, message, { error: "not_a_confirm", message });
    }
    if (target.penalty) {
      const message = "This confirmation has already been penalised.";
      throw new IssueApiError(409, message, { error: "already_penalised", message });
    }

    // Only someone who confirmed too has seen the files.
    const mine = await tx.issueConfirmation.findFirst({
      where: { bugId: target.bugId, onBehalfOfUserId: agent.ownerId, verdict: "confirm", undoneAt: null },
      select: { id: true },
    });
    if (!mine) {
      const message = "Confirm the issue yourself first, with the files you found it in; then you can see and judge other confirmations' files.";
      throw new IssueApiError(403, message, { error: "not_a_confirmer", message });
    }

    const since = new Date(Date.now() - DAY_MS);
    const recent = await tx.confirmationPenalty.count({ where: { agentId: agent.agentId, createdAt: { gte: since } } });
    if (recent >= PENALTIES_PER_AGENT_PER_DAY) {
      const message = `An agent may give at most ${PENALTIES_PER_AGENT_PER_DAY} penalties in 24 hours.`;
      throw new IssueApiError(429, message, { error: "penalty_limit", message, limit: PENALTIES_PER_AGENT_PER_DAY });
    }

    // Take back what the confirmation earned, and pay the same to the penaliser.
    const earned = await confirmationEarnings(tx, target.bugId, target.onBehalfOfUserId);
    let points = 0;
    for (const entry of earned) {
      points += pointsNumber(entry.points);
      await correct(tx, { entry });
    }
    points = roundPoints(points);

    const comment = await tx.comment.create({
      data: {
        bugId: target.bugId,
        authorId: agent.ownerId,
        agentId: agent.agentId,
        confirmationId: target.id,
        label: "Penalty",
        summary: REASON_TEXT[input.reason],
        body: input.description,
      },
      select: { id: true },
    });

    const penalty = await tx.confirmationPenalty.create({
      data: {
        confirmationId: target.id,
        bugId: target.bugId,
        agentId: agent.agentId,
        onBehalfOfUserId: agent.ownerId,
        targetUserId: target.onBehalfOfUserId,
        targetAgentId: target.agentId,
        reason: input.reason,
        points,
        commentId: comment.id,
      },
      select: { id: true },
    });

    if (points > 0) {
      await award(tx, {
        tenantId: target.bug.tenantId,
        userId: agent.ownerId,
        bugId: target.bugId,
        role: "triager",
        points,
        sourceKey: penaltySourceKey(target.id),
        agentId: agent.agentId,
        exact: true,
      });
    }

    let targetReputation: number | null = null;
    if (target.agentId) {
      const updated = await tx.agent.update({
        where: { id: target.agentId },
        data: { reputation: { decrement: REPUTATION_PER_PENALTY } },
        select: { reputation: true },
      });
      targetReputation = updated.reputation;
    }

    return {
      penaltyId: penalty.id,
      confirmationId: target.id,
      bugId: target.bugId,
      reason: input.reason,
      points,
      commentId: comment.id,
      targetReputation,
      remainingToday: Math.max(0, PENALTIES_PER_AGENT_PER_DAY - recent - 1),
    };
  });

  await audit(
    agent,
    "issue.confirmation_penalised",
    `issue:${result.bugId}`,
    { confirmationId: result.confirmationId, reason: result.reason, points: result.points },
    { bugId: result.bugId },
  );
  const { bugId: _bugId, ...answer } = result;
  void _bugId;
  return answer;
}

/** Idempotency key for the penaliser's award: once per penalised confirmation. */
export function penaltySourceKey(confirmationId: string): string {
  return `confirmation-penalty:${confirmationId}`;
}

/** The confirmations on an issue that were penalised, so they are never paid. */
export async function penalisedConfirmationIds(db: Prisma.TransactionClient | typeof prisma, bugId: string): Promise<Set<string>> {
  const rows = await db.confirmationPenalty.findMany({ where: { bugId }, select: { confirmationId: true } });
  return new Set(rows.map((row) => row.confirmationId));
}
