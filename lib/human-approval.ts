import { prisma } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@prisma/client";
import { IssueApiError } from "@/lib/agent-api/errors";
import { workflowFor } from "@/lib/workflow";
import {
  DEFAULT_HUMAN_APPROVAL_GUIDELINES,
  effectiveHumanApprovalGuidelines,
} from "@/lib/human-approval-defaults";

export { DEFAULT_HUMAN_APPROVAL_GUIDELINES, effectiveHumanApprovalGuidelines };

type Db = PrismaClient | Prisma.TransactionClient;

export type HumanApprovalTarget =
  | { kind: "idea"; id: string }
  | { kind: "issue"; id: string };

export type HumanApprovalSummary = {
  required: boolean;
  reason: string | null;
  approvalsCount: number;
  rejectionsCount: number;
  needed: number;
  satisfied: boolean;
  approvedByUserIds: string[];
  rejectedByUserIds: string[];
};

export async function getHumanApprovalSummary(
  db: Db,
  target: HumanApprovalTarget,
  needed?: number,
): Promise<HumanApprovalSummary> {
  const canQuery =
    target.kind === "idea"
      ? typeof db.idea?.findUnique === "function"
      : typeof db.bug?.findUnique === "function";

  const record = !canQuery
    ? null
    : target.kind === "idea"
      ? await db.idea.findUnique({
          where: { id: target.id },
          select: {
            projectId: true,
            requiresHumanApproval: true,
            humanApprovalReason: true,
            humanApprovals: { select: { userId: true, decision: true } },
          },
        })
      : await db.bug.findUnique({
          where: { id: target.id },
          select: {
            projectId: true,
            requiresHumanApproval: true,
            humanApprovalReason: true,
            humanApprovals: { select: { userId: true, decision: true } },
          },
        });

  if (!record || !record.requiresHumanApproval) {
    return {
      required: false,
      reason: null,
      approvalsCount: 0,
      rejectionsCount: 0,
      needed: needed ?? 1,
      satisfied: true,
      approvedByUserIds: [],
      rejectedByUserIds: [],
    };
  }

  const requiredCount = needed ?? (await workflowFor(record.projectId, db)).humanApprovalsNeeded;
  const approvals = record.humanApprovals ?? [];
  const approvedByUserIds = approvals.filter((a) => a.decision === "approved").map((a) => a.userId);
  const rejectedByUserIds = approvals.filter((a) => a.decision === "rejected").map((a) => a.userId);
  const approvalsCount = approvedByUserIds.length;
  const rejectionsCount = rejectedByUserIds.length;
  const satisfied = !record.requiresHumanApproval || approvalsCount >= requiredCount;

  return {
    required: record.requiresHumanApproval,
    reason: record.humanApprovalReason ?? null,
    approvalsCount,
    rejectionsCount,
    needed: requiredCount,
    satisfied,
    approvedByUserIds,
    rejectedByUserIds,
  };
}

/**
 * Throws 409 `human_approval_required` if the idea or issue is flagged for
 * human approval and has fewer than `humanApprovalsNeeded` approvals.
 */
export async function assertHumanApprovalSatisfied(
  db: Db,
  target: HumanApprovalTarget,
  needed?: number,
): Promise<HumanApprovalSummary> {
  const summary = await getHumanApprovalSummary(db, target, needed);
  if (summary.required && !summary.satisfied) {
    const noun = target.kind === "idea" ? "idea" : "issue";
    const reason = summary.reason ? ` Reason: ${summary.reason}` : "";
    const message = `This ${noun} requires human approval (${summary.approvalsCount}/${summary.needed} human approvals so far).${reason}`;
    throw new IssueApiError(409, message, {
      error: "human_approval_required",
      message,
      approvalsCount: summary.approvalsCount,
      needed: summary.needed,
      reason: summary.reason,
    });
  }
  return summary;
}

/**
 * Returns whether a human user may approve/reject a flagged idea or issue:
 * must be a member of the project (or org) and NOT the creator (`reporterId`).
 */
export async function canUserApproveHumanGate(
  db: Db,
  input: { userId: string; creatorId: string; organisationId: string; projectId: string },
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  if (input.userId === input.creatorId) {
    return { allowed: false, reason: "The creator cannot approve their own human-approval gate." };
  }
  const [orgMember, projectMember] = await Promise.all([
    db.membership.findUnique({
      where: { organisationId_userId: { organisationId: input.organisationId, userId: input.userId } },
      select: { userId: true },
    }),
    db.projectMembership.findUnique({
      where: { projectId_userId: { projectId: input.projectId, userId: input.userId } },
      select: { id: true },
    }),
  ]);
  if (!orgMember && !projectMember) {
    return { allowed: false, reason: "Only project members can approve this gate." };
  }
  return { allowed: true };
}

/**
 * Records a human member's approval or rejection on a flagged idea or issue.
 * When an issue reaches `humanApprovalsNeeded`, any open `human_approval`
 * escalations on that issue are resolved so the Inbox clears automatically.
 */
export async function recordHumanApproval(input: {
  userId: string;
  target: HumanApprovalTarget;
  decision: "approved" | "rejected";
  note?: string | null;
}): Promise<HumanApprovalSummary> {
  const cleanNote = input.note?.trim() || null;

  return prisma.$transaction(async (tx) => {
    const meta =
      input.target.kind === "idea"
        ? await tx.idea.findFirst({
            where: { id: input.target.id, isDeleted: false },
            select: { id: true, organisationId: true, projectId: true, reporterId: true, requiresHumanApproval: true },
          })
        : await tx.bug.findFirst({
            where: { id: input.target.id, isDeleted: false },
            select: { id: true, organisationId: true, projectId: true, reporterId: true, requiresHumanApproval: true },
          });

    if (!meta) {
      throw new IssueApiError(404, input.target.kind === "idea" ? "Idea not found." : "Issue not found.");
    }
    if (!meta.requiresHumanApproval) {
      throw new IssueApiError(409, "This item does not require human approval.");
    }

    const eligibility = await canUserApproveHumanGate(tx, {
      userId: input.userId,
      creatorId: meta.reporterId,
      organisationId: meta.organisationId,
      projectId: meta.projectId,
    });
    if (!eligibility.allowed) {
      throw new IssueApiError(403, eligibility.reason);
    }

    if (input.target.kind === "idea") {
      await tx.humanApproval.upsert({
        where: { ideaId_userId: { ideaId: meta.id, userId: input.userId } },
        create: { ideaId: meta.id, userId: input.userId, decision: input.decision, note: cleanNote },
        update: { decision: input.decision, note: cleanNote },
      });
    } else {
      await tx.humanApproval.upsert({
        where: { bugId_userId: { bugId: meta.id, userId: input.userId } },
        create: { bugId: meta.id, userId: input.userId, decision: input.decision, note: cleanNote },
        update: { decision: input.decision, note: cleanNote },
      });
    }

    const { humanApprovalsNeeded } = await workflowFor(meta.projectId, tx);
    const summary = await getHumanApprovalSummary(tx, input.target, humanApprovalsNeeded);

    if (input.target.kind === "issue" && summary.satisfied) {
      await tx.agentQuestion.updateMany({
        where: {
          bugId: meta.id,
          answeredAt: null,
          body: { startsWith: "[human_approval]" },
        },
        data: {
          answeredAt: new Date(),
          answer: cleanNote ? `Approved by human (${summary.approvalsCount}/${summary.needed}): ${cleanNote}` : `Approved by human (${summary.approvalsCount}/${summary.needed}).`,
        },
      });
    }

    return summary;
  });
}
