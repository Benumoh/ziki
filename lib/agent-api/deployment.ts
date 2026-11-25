import type { Substatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/agents/audit";
import { IssueApiError } from "@/lib/agent-api/errors";
import { publish } from "@/lib/agent-api/events";
import { statusChangedSummary } from "@/lib/activity-log";
import { parseIssueRef } from "@/lib/issue-ref";
import { ENVIRONMENTS, LIVE_SUBSTATUS, moveTo } from "@/lib/issue-substatus";
import { PRODUCT_STEP_ONLY_MESSAGE, trackRules } from "@/lib/marketing/track";
import { LIVE_REPORTS_NEEDED, liveReporters, releasePayoutIfLive } from "@/lib/coins/issue-payout";
import { prodReporters } from "@/lib/live-confirm-data";

/**
 * Deployment reports (#substatus). A Live issue's substatus says where its
 * merged work is deployed: On dev (merged into the default branch, where
 * resolving puts it), On staging or On prod. Ziki never checks a deployment
 * itself: an agent checks where the work is running and reports it, and the
 * latest report is where it is. Any agent may report, on any Live issue.
 *
 * #live-payout: each person's latest report is kept. Once `LIVE_REPORTS_NEEDED`
 * (3) people other than the solver have reported the work deployed, what
 * its funded Ziks pay everyone who worked on it (lib/coins/issue-payout.ts).
 *
 * #live-confirm: the same rule decides On prod. A prod report moves the issue
 * there only once that many people other than the solver have reported prod;
 * until then it stays where it was. Dev and staging still move at once.
 */
export const deploymentSchema = z
  .object({
    environment: z.enum(ENVIRONMENTS),
    /** What the agent checked: the URL, version or commit it saw deployed. */
    note: z.string().trim().min(1, "Say what you checked: the URL, version or commit you saw deployed.").max(2000),
    /**
     * The live link (#live-link): the address where the fix can be seen running, shown on the issue's card as
     * "See it live". Optional, but merger agents add it when the issue has none yet.
     */
    url: z.string().trim().max(2000).regex(/^https?:\/\/\S+$/i, "url must be a web address (http or https) where the fix can be seen running.").optional(),
  })
  .strict();

const NOT_FOUND = "No such issue in this project.";

export async function reportDeployment(
  agent: { agentId: string; ownerId: string; organisationId: string },
  scope: { organisationId: string; projectId: string },
  issueRef: string,
  rawBody: unknown,
): Promise<{ issueId: string; status: "resolved"; substatus: Substatus; previousSubstatus: Substatus; changed: boolean; liveReports: number; liveReportsNeeded: number; prodReports: number; payoutReleased: boolean }> {
  const parsed = deploymentSchema.safeParse(rawBody ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid deployment report.";
    throw new IssueApiError(400, message, { error: "invalid_request", message });
  }
  const { environment, note, url } = parsed.data;
  const ref = parseIssueRef(issueRef);
  return prisma.$transaction(async (tx) => {
    const bug = await tx.bug.findFirst({
      where: { ...scope, isDeleted: false, ...(ref.kind === "number" ? { number: ref.number } : { id: ref.id }) },
      select: { id: true, organisationId: true, status: true, substatus: true, assigneeId: true, track: true },
    });
    if (!bug) throw new IssueApiError(404, NOT_FOUND, { error: "not_found", message: NOT_FOUND });
    if (!trackRules(bug.track).hasProductSteps) {
      throw new IssueApiError(409, PRODUCT_STEP_ONLY_MESSAGE, { error: "wrong_track", message: PRODUCT_STEP_ONLY_MESSAGE });
    }
    if (bug.status !== "resolved") {
      const message = "Deployments are reported on Live issues: resolve the merged work first.";
      throw new IssueApiError(409, message, { error: "not_live", message, status: bug.status, substatus: bug.substatus });
    }
    // #live-payout: this person's report counts once, and enough of them pay what resolving it earned.
    await tx.deploymentReport.upsert({
      where: { bugId_onBehalfOfUserId: { bugId: bug.id, onBehalfOfUserId: agent.ownerId } },
      // A report without a link keeps the link this person gave before.
      create: { bugId: bug.id, onBehalfOfUserId: agent.ownerId, agentId: agent.agentId, environment, note, url: url ?? null },
      update: { agentId: agent.agentId, environment, note, ...(url ? { url } : {}) },
    });
    // #live-confirm: one person's prod report doesn't make it On prod.
    const prodReports = (await prodReporters(tx, bug.id, bug.assigneeId)).length;
    const to = environment === "prod" && prodReports < LIVE_REPORTS_NEEDED ? bug.substatus : LIVE_SUBSTATUS[environment];
    const changed = to !== bug.substatus;
    if (changed) {
      await tx.bug.update({ where: { id: bug.id }, data: moveTo(to) });
      await tx.bugActivity.create({
        data: {
          bugId: bug.id,
          actorId: agent.ownerId,
          type: "status_changed",
          summary: statusChangedSummary(bug.substatus, to),
          metadata: { field: "status", from: bug.substatus, to, via: "deployment", environment, note, ...(environment === "prod" ? { prodReports } : {}) },
        },
      });
    }
    const payload = { issueId: bug.id, environment, note, ...(url ? { url } : {}), from: bug.substatus, to };
    await audit({ agentId: agent.agentId, organisationId: bug.organisationId }, "issue.deployed", `bug:${bug.id}`, payload, { bugId: bug.id, db: tx });
    if (changed) {
      await publish(tx, { organisationId: bug.organisationId, type: "issue.updated", actorAgentId: agent.agentId, bugId: bug.id, payload: { ...payload, values: moveTo(to) } });
    }
    const payoutReleased = await releasePayoutIfLive(tx, bug.id);
    const liveReports = (await liveReporters(tx, bug.id, bug.assigneeId)).length;
    return { issueId: bug.id, status: "resolved" as const, substatus: to, previousSubstatus: bug.substatus, changed, liveReports, liveReportsNeeded: LIVE_REPORTS_NEEDED, prodReports, payoutReleased };
  });
}
