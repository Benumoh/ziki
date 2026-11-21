import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { IssueApiError } from "@/lib/agent-api/errors";
import { HOLD_MS, itemKey, workAlertView, type AlertLine, type AlertSummary, type WorkAlertView } from "@/lib/agents/work-alerts";
import type { WorkAlertAnswerInput } from "@/lib/validations/work-alert";

/** Until when an alert's share is still held for its agent, or null. */
async function heldUntilOf(alertId: string, now: Date, db: Pick<typeof prisma, "workAlertItem"> = prisma): Promise<Date | null> {
  const row = await db.workAlertItem.findFirst({ where: { alertId, heldUntil: { gt: now } }, orderBy: { heldUntil: "desc" }, select: { heldUntil: true } });
  return row?.heldUntil ?? null;
}

/**
 * This agent's alert in a project while it is with the agent (sent, not
 * ended), as its work feed shows it: answered yes too, so the agent can see
 * what it agreed to clear.
 */
export async function openAlertFor(agentId: string, project: { id: string; name: string }, now: Date = new Date()): Promise<WorkAlertView | null> {
  const alert = await prisma.workAlert.findFirst({
    where: { agentId, projectId: project.id, endedAt: null, status: "sent" },
    orderBy: { createdAt: "desc" },
  });
  return alert ? workAlertView(alert, project, await heldUntilOf(alert.id, now)) : null;
}

/**
 * Records the person's answer to a work alert (#work-alerts). Only the agent
 * the alert was sent to may answer it (or its owner on its page, through it),
 * and only while it is waiting for an answer: a yes settles the ask until
 * Ziki asks again. Every answer restarts the count of unanswered asks.
 *
 * - yes: the share is held for the agent for another HOLD_MS while it works.
 *   With `items`, only those are kept (the alert then lists only them) and the
 *   rest go back to the pool at once. A key not in the share is refused (422).
 * - later: asked again in 15 minutes; the share goes back to the pool meanwhile.
 * - no: the alert passes; the share goes back to the pool.
 */
export async function answerWorkAlert(
  agent: Pick<AgentContext, "agentId" | "organisationId">,
  alertId: string,
  input: WorkAlertAnswerInput,
  now: Date = new Date(),
): Promise<WorkAlertView> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "WorkAlert" WHERE "id" = ${alertId} FOR UPDATE`;
    const alert = await tx.workAlert.findFirst({
      where: { id: alertId, agentId: agent.agentId, organisationId: agent.organisationId },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!alert) throw new IssueApiError(404, "Alert not found.");
    if (alert.endedAt || alert.status !== "sent") {
      throw new IssueApiError(409, "This alert is no longer waiting for an answer.", {
        error: "alert_not_open",
        message: "This alert is no longer waiting for an answer.",
      });
    }
    // The agent asks in the terminal while its owner sees the same question on its page
    // (#agent-get-started): a yes given in either place settles this ask for both.
    if (alert.answer === "yes") {
      const message = "Your person already said yes to this (on your page or in your conversation). Start on your share; don't ask again.";
      throw new IssueApiError(409, message, { error: "alert_already_answered", message, answer: "yes" });
    }

    const held = await tx.workAlertItem.findMany({ where: { alertId: alert.id, heldUntil: { gt: now } }, select: { id: true, itemType: true, number: true } });
    const keyOf = (row: { itemType: string; number: number }) => itemKey(row.itemType === "idea" ? "idea" : "issue", row.number);
    let summary = alert.summary as unknown as AlertSummary;
    let heldUntil: Date | null = null;

    if (input.answer === "yes") {
      const picked = input.items ? new Set(input.items) : null;
      if (picked) {
        const heldKeys = new Set(held.map(keyOf));
        const unknown = [...picked].filter((key) => !heldKeys.has(key));
        if (unknown.length) {
          const message = `Not in this alert's share: ${unknown.join(", ")}. Pick from the keys in share.`;
          throw new IssueApiError(422, message, { error: "item_not_in_share", message, items: unknown });
        }
        const dropped = held.filter((row) => !picked.has(keyOf(row))).map((row) => row.id);
        if (dropped.length) await tx.workAlertItem.updateMany({ where: { id: { in: dropped } }, data: { heldUntil: now } });
        summary = {
          ...summary,
          lines: summary.lines.map((line): AlertLine => ({ ...line, share: (line.share ?? []).filter((item) => picked.has(item.key)) })),
        };
      }
      heldUntil = new Date(now.getTime() + HOLD_MS);
      const keep = held.filter((row) => !picked || picked.has(keyOf(row))).map((row) => row.id);
      if (keep.length) await tx.workAlertItem.updateMany({ where: { id: { in: keep } }, data: { heldUntil } });
      else heldUntil = null;
    } else if (held.length) {
      await tx.workAlertItem.updateMany({ where: { id: { in: held.map((row) => row.id) } }, data: { heldUntil: now } });
    }

    const updated = await tx.workAlert.update({
      where: { id: alert.id },
      data: {
        answer: input.answer,
        answeredAt: now,
        asks: 0,
        ...(input.items ? { summary: summary as unknown as Prisma.InputJsonObject } : {}),
        ...(input.answer === "no" ? { status: "passed" } : {}),
      },
    });
    return workAlertView(updated, alert.project, heldUntil);
  });
}
