import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { audit } from "@/lib/agents/audit";
import { publish } from "@/lib/agent-api/events";
import { notifyApprovalNeeded } from "@/lib/agent-notifications";
import { IssueApiError } from "@/lib/agent-api/errors";
import { isOrganisationAdminRole } from "@/lib/agents/membership";

const id = z.string().trim().min(1).max(191);
/** Why a proposal without an issue is refused: every redesign belongs to the issue it redesigns. */
export const REDESIGN_ISSUE_REQUIRED = "bugId: a redesign proposal belongs to an issue; link the issue it redesigns.";
export const redesignSchema = z.object({
  projectId: id, onBehalfOfUserId: id.optional(),
  bugId: z.string({ error: REDESIGN_ISSUE_REQUIRED }).trim().min(1, REDESIGN_ISSUE_REQUIRED).max(191),
  title: z.string().trim().min(3).max(200), body: z.string().trim().min(10).max(5000),
  previewUrl: z.url().max(2048).refine((value) => new URL(value).protocol === "https:", "Preview URL must use HTTPS.").optional(),
  attachmentIds: z.array(id).max(5).refine((values) => new Set(values).size === values.length, "Attachment IDs must be unique.").default([]),
}).strict();
/** A person decides a proposal on its issue: chooses it (the others for that issue are superseded) or rejects it. */
export const redesignDecisionSchema = z.object({ decision: z.enum(["chosen", "rejected"]) }).strict();

export async function proposeRedesign(agent: AgentContext, input: z.infer<typeof redesignSchema>) {
  // #412: a project-scoped key may only propose in its own project.
  const onBehalfOfUserId = input.onBehalfOfUserId ?? agent.ownerId;
  const proposal = await prisma.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: input.projectId, organisationId: agent.organisationId }, select: { id: true } });
    if (!project) throw new IssueApiError(404, "Project not found.");
    const member = await tx.membership.findUnique({ where: { organisationId_userId: { organisationId: agent.organisationId, userId: onBehalfOfUserId } }, select: { userId: true } });
    if (!member) throw new IssueApiError(422, "The person must belong to the organisation.");
    if (!await tx.bug.findFirst({ where: { id: input.bugId, organisationId: agent.organisationId, projectId: input.projectId, isDeleted: false }, select: { id: true } })) {
      throw new IssueApiError(404, "Linked issue not found in this project.");
    }
    const { attachmentIds, ...proposalInput } = input;
    const created = await tx.redesignProposal.create({ data: {
      ...proposalInput, onBehalfOfUserId, organisationId: agent.organisationId, authorAgentId: agent.agentId, status: "proposed",
    } });
    if (attachmentIds.length) {
      const linked = await tx.attachment.updateMany({
        where: { id: { in: attachmentIds }, uploaderId: onBehalfOfUserId, bugId: null, commentId: null, redesignProposalId: null, contentType: { startsWith: "image/" } },
        data: { redesignProposalId: created.id },
      });
      if (linked.count !== attachmentIds.length) throw new IssueApiError(422, "Each mockup must be an image uploaded by the proposal beneficiary and not linked elsewhere.");
    }
    await audit(agent, "redesign.proposed", created.id, { onBehalfOfUserId }, { db: tx, bugId: created.bugId });
    await publish(tx, { organisationId: agent.organisationId, type: "redesign.proposed", actorAgentId: agent.agentId,
      bugId: created.bugId, payload: { proposalId: created.id, projectId: input.projectId, onBehalfOfUserId } });
    return created;
  });
  notifyApprovalNeeded({
    id: proposal.id,
    title: proposal.title,
    onBehalfOfUserId,
    organisationId: agent.organisationId,
    agent: { name: agent.name },
    bugId: proposal.bugId,
  });
  return proposal;
}

/** Only a person who currently belongs to this organisation may decide a pending proposal. */
export async function decideRedesign(userId: string, organisationId: string, proposalId: string, decision: "chosen" | "rejected") {
  return prisma.$transaction(async (tx) => {
    const member = await tx.membership.findUnique({ where: { organisationId_userId: { organisationId, userId } }, select: { userId: true, role: true } });
    if (!member) throw new IssueApiError(403, "Organisation membership required.");
    if (!isOrganisationAdminRole(member.role)) throw new IssueApiError(403, "An organisation admin must decide this proposal.");
    const proposal = await tx.redesignProposal.findFirst({
      where: { id: proposalId, organisationId },
      include: { authorAgent: { select: { ownerUserId: true } } },
    });
    if (!proposal) throw new IssueApiError(404, "Proposal not found.");
    if (proposal.authorAgent.ownerUserId === userId) {
      throw new IssueApiError(403, "The proposing agent's owner cannot decide this proposal.");
    }
    if (decision === "chosen" && !proposal.bugId) throw new IssueApiError(422, "A redesign is chosen for its issue, and this proposal has none.");
    const chosenAt = decision === "chosen" ? new Date() : null;
    const status = decision === "chosen" ? "approved" : decision;
    const updated = await tx.redesignProposal.updateMany({ where: { id: proposalId, organisationId, status: "proposed" },
      data: { status, approverId: chosenAt ? userId : null, approvedAt: chosenAt } });
    if (!updated.count) throw new IssueApiError(409, "This proposal has already been decided.");
    const superseded = decision === "chosen" ? await tx.redesignProposal.updateMany({
      where: { organisationId, bugId: proposal.bugId, id: { not: proposalId }, status: "proposed" },
      data: { status: "superseded" },
    }) : { count: 0 };
    await audit({ agentId: proposal.authorAgentId, organisationId }, `redesign.${decision}`, proposalId, { decision },
      { db: tx, actorUserId: userId, bugId: proposal.bugId });
    await publish(tx, { organisationId, type: `redesign.${decision}`, bugId: proposal.bugId,
      payload: decision === "chosen" ? { proposalId, winningProposalId: proposalId, supersededCount: superseded.count, actorUserId: userId } : { proposalId, decision, actorUserId: userId } });
    return { id: proposalId, status, approverId: chosenAt ? userId : null, approvedAt: chosenAt, supersededCount: superseded.count };
  }, { isolationLevel: "Serializable" });
}

/** Claim callers may pass their transaction to keep this check with assignment. */
export async function hasBlockingRedesign(bugId: string, db: PrismaClient | Prisma.TransactionClient = prisma): Promise<boolean> {
  const blocked = await db.redesignProposal.count({ where: { bugId, status: "proposed" } });
  return blocked > 0;
}

export async function assertRedesignOpen(bugId: string, db: PrismaClient | Prisma.TransactionClient = prisma): Promise<void> {
  const blocked = await hasBlockingRedesign(bugId, db);
  if (blocked) throw new IssueApiError(409, "This redesign is waiting for a person.");
}
