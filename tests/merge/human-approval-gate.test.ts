import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssueApiError } from "@/lib/agent-api/errors";
import {
  DEFAULT_HUMAN_APPROVAL_GUIDELINES,
  effectiveHumanApprovalGuidelines,
  getHumanApprovalSummary,
  assertHumanApprovalSatisfied,
  canUserApproveHumanGate,
  recordHumanApproval,
} from "@/lib/human-approval";
import { DEFAULT_PROJECT_WORKFLOW, workflowSettingsSchema, workflowValues } from "@/lib/workflow-config";

const ideaFindUnique = vi.hoisted(() => vi.fn());
const ideaFindFirst = vi.hoisted(() => vi.fn());
const bugFindUnique = vi.hoisted(() => vi.fn());
const bugFindFirst = vi.hoisted(() => vi.fn());
const membershipFindUnique = vi.hoisted(() => vi.fn());
const projectMembershipFindUnique = vi.hoisted(() => vi.fn());
const humanApprovalUpsert = vi.hoisted(() => vi.fn());
const agentQuestionUpdateMany = vi.hoisted(() => vi.fn());
const workflowFor = vi.hoisted(() => vi.fn());

const tx = vi.hoisted(() => ({
  idea: { findUnique: ideaFindUnique, findFirst: ideaFindFirst },
  bug: { findUnique: bugFindUnique, findFirst: bugFindFirst },
  membership: { findUnique: membershipFindUnique },
  projectMembership: { findUnique: projectMembershipFindUnique },
  humanApproval: { upsert: humanApprovalUpsert },
  agentQuestion: { updateMany: agentQuestionUpdateMany },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ...tx,
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  },
}));

vi.mock("@/lib/workflow", () => ({
  workflowFor,
}));

describe("Human Approval Gate (Criticality Policy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workflowFor.mockResolvedValue({ ...DEFAULT_PROJECT_WORKFLOW, humanApprovalsNeeded: 1 });
  });

  it("uses DEFAULT_HUMAN_APPROVAL_GUIDELINES when custom text is null or blank, and preserves custom text", () => {
    expect(effectiveHumanApprovalGuidelines(null)).toBe(DEFAULT_HUMAN_APPROVAL_GUIDELINES);
    expect(effectiveHumanApprovalGuidelines("   ")).toBe(DEFAULT_HUMAN_APPROVAL_GUIDELINES);
    expect(effectiveHumanApprovalGuidelines("Block all auth changes")).toBe("Block all auth changes");
  });

  it("defaults humanApprovalsNeeded to 1 and validates bounds 1..10", () => {
    expect(workflowValues(null).humanApprovalsNeeded).toBe(1);
    expect(workflowValues({ humanApprovalsNeeded: 2 }).humanApprovalsNeeded).toBe(2);

    const valid = workflowSettingsSchema.safeParse({
      ...DEFAULT_PROJECT_WORKFLOW,
      humanApprovalsNeeded: 2,
    });
    expect(valid.success).toBe(true);

    const invalidZero = workflowSettingsSchema.safeParse({
      ...DEFAULT_PROJECT_WORKFLOW,
      humanApprovalsNeeded: 0,
    });
    expect(invalidZero.success).toBe(false);
  });

  it("allows normal bug fixes without human approval", async () => {
    bugFindUnique.mockResolvedValue({
      projectId: "proj-1",
      requiresHumanApproval: false,
      humanApprovalReason: null,
      humanApprovals: [],
    });

    const summary = await assertHumanApprovalSatisfied(tx as never, { kind: "issue", id: "bug-1" });
    expect(summary.required).toBe(false);
    expect(summary.satisfied).toBe(true);
  });

  it("blocks flagged ideas until humanApprovalsNeeded human approvals are recorded", async () => {
    ideaFindUnique.mockResolvedValue({
      projectId: "proj-1",
      requiresHumanApproval: true,
      humanApprovalReason: "Changes default navigation tab",
      humanApprovals: [{ userId: "user-2", decision: "approved" }],
    });

    await expect(assertHumanApprovalSatisfied(tx as never, { kind: "idea", id: "idea-1" }, 2)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({
        error: "human_approval_required",
        approvalsCount: 1,
        needed: 2,
      }),
    });

    const satisfied = await assertHumanApprovalSatisfied(tx as never, { kind: "idea", id: "idea-1" }, 1);
    expect(satisfied.satisfied).toBe(true);
    expect(satisfied.approvalsCount).toBe(1);
  });

  it("prevents the creator or non-members from approving the human gate", async () => {
    const creatorCheck = await canUserApproveHumanGate(tx as never, {
      userId: "user-1",
      creatorId: "user-1",
      organisationId: "org-1",
      projectId: "proj-1",
    });
    expect(creatorCheck).toEqual({
      allowed: false,
      reason: "The creator cannot approve their own human-approval gate.",
    });

    membershipFindUnique.mockResolvedValue(null);
    projectMembershipFindUnique.mockResolvedValue(null);
    const nonMemberCheck = await canUserApproveHumanGate(tx as never, {
      userId: "user-3",
      creatorId: "user-1",
      organisationId: "org-1",
      projectId: "proj-1",
    });
    expect(nonMemberCheck).toEqual({
      allowed: false,
      reason: "Only project members can approve this gate.",
    });
  });

  it("records human approval on a flagged issue and resolves open human_approval escalations when threshold is met", async () => {
    bugFindFirst.mockResolvedValue({
      id: "bug-1",
      organisationId: "org-1",
      projectId: "proj-1",
      reporterId: "user-1",
      requiresHumanApproval: true,
    });
    membershipFindUnique.mockResolvedValue({ userId: "user-2" });
    projectMembershipFindUnique.mockResolvedValue(null);
    bugFindUnique.mockResolvedValue({
      projectId: "proj-1",
      requiresHumanApproval: true,
      humanApprovalReason: "UI redesign",
      humanApprovals: [{ userId: "user-2", decision: "approved" }],
    });

    const summary = await recordHumanApproval({
      userId: "user-2",
      target: { kind: "issue", id: "bug-1" },
      decision: "approved",
      note: "Looks good",
    });

    expect(humanApprovalUpsert).toHaveBeenCalledTimes(1);
    expect(summary.satisfied).toBe(true);
    expect(agentQuestionUpdateMany).toHaveBeenCalledWith({
      where: {
        bugId: "bug-1",
        answeredAt: null,
        body: { startsWith: "[human_approval]" },
      },
      data: expect.objectContaining({
        answer: expect.stringContaining("Approved by human (1/1)"),
      }),
    });
  });

  it("rejects recordHumanApproval with 403 when the creator tries to approve their own item", async () => {
    ideaFindFirst.mockResolvedValue({
      id: "idea-1",
      organisationId: "org-1",
      projectId: "proj-1",
      reporterId: "user-1",
      requiresHumanApproval: true,
    });

    await expect(
      recordHumanApproval({
        userId: "user-1",
        target: { kind: "idea", id: "idea-1" },
        decision: "approved",
      }),
    ).rejects.toBeInstanceOf(IssueApiError);
  });

  it("counts only approved decisions toward humanApprovalsNeeded", async () => {
    bugFindUnique.mockResolvedValue({
      projectId: "proj-1",
      requiresHumanApproval: true,
      humanApprovalReason: "Auth flow change",
      humanApprovals: [
        { userId: "user-2", decision: "rejected" },
        { userId: "user-3", decision: "approved" },
      ],
    });

    const summary = await getHumanApprovalSummary(tx as never, { kind: "issue", id: "bug-1" }, 2);
    expect(summary.approvalsCount).toBe(1);
    expect(summary.rejectionsCount).toBe(1);
    expect(summary.satisfied).toBe(false);
  });
});
