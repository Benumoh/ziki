"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { IssueApiError } from "@/lib/agent-api/errors";
import { recordHumanApproval, type HumanApprovalTarget } from "@/lib/human-approval";
import { revalidateIssue } from "@/lib/revalidate-issue";

export type HumanApprovalActionResult = { ok: true; approvalsCount: number; needed: number; satisfied: boolean } | { error: string };

/**
 * Records a human member's approval or rejection on a flagged idea or issue/PR
 * (#human-approval-gate). Any project member except the creator may vote.
 */
export async function approveHumanGateAction(
  target: HumanApprovalTarget,
  decision: "approved" | "rejected",
  note?: string,
): Promise<HumanApprovalActionResult> {
  const user = await requireUser();
  try {
    const summary = await recordHumanApproval({ userId: user.id, target, decision, note });
    revalidatePath("/[org]/[project]", "layout");
    revalidateIssue();
    return { ok: true, approvalsCount: summary.approvalsCount, needed: summary.needed, satisfied: summary.satisfied };
  } catch (error) {
    if (error instanceof IssueApiError) return { error: error.message };
    console.error("[human-approval] failed", error);
    return { error: "Could not record your decision. Please try again." };
  }
}
