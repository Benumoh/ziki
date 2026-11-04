"use server";

import { addCommentAction } from "@/app/actions/issues";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantAccess } from "@/lib/tenant-access";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { isOrganizationAdmin } from "@/lib/organization-role";
import { DECISION_MARKER, PLAIN, type YourCallAnswer } from "@/lib/your-call-shared";

const NOTE_MAX_CHARS = 1000;

/**
 * A person's answer on the Your call list (#your-call), when the agents could
 * not agree: one plain choice and, if they like, a note. It is posted as a
 * comment on the issue that starts with a fixed line, so the agents polling
 * the issue's events read it like any other comment from a person. It does not
 * change any confirmation or judgement: those stay with the agents.
 *
 * Only the person who filed the issue (or it is for), or an admin of the
 * workspace, may answer for it, and only while the agents are still split on it.
 */
export async function answerYourCallAction(
  bugId: string,
  kind: "confirm" | "merge",
  answer: YourCallAnswer,
  note: string,
): Promise<{ ok?: true; error?: string }> {
  if (kind !== "confirm" && kind !== "merge") return { error: "Pick yes or no." };
  if (answer !== "yes" && answer !== "no") return { error: "Pick yes or no." };
  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  const bug = typeof bugId === "string" && tenantId
    ? await prisma.bug.findFirst({
        where: { id: bugId, tenantId, isDeleted: false },
        select: { reporterId: true, beneficiaryUserId: true, substatus: true },
      })
    : null;
  if (!bug) return { error: "Issue not found" };
  const access = await currentTenantAccess(user.id, user.role);
  const mayAnswer = bug.reporterId === user.id || bug.beneficiaryUserId === user.id
    || Boolean(access.membershipRole && isOrganizationAdmin(access.membershipRole, user.role));
  if (!mayAnswer) return { error: "Only the person this issue is for, or an admin, can answer for it." };
  if (bug.substatus !== (kind === "merge" ? "requires_review" : "requires_confirmation")) return { error: "The agents are no longer split on this one." };
  const words = PLAIN[kind];
  const extra = typeof note === "string" ? note.trim().slice(0, NOTE_MAX_CHARS) : "";
  const data = new FormData();
  data.set("body", `${DECISION_MARKER} ${answer === "yes" ? words.yesSentence : words.noSentence}${extra ? `\n\n${extra}` : ""}`);
  const result = await addCommentAction(bugId, data);
  return result.error ? { error: result.error } : { ok: true };
}
