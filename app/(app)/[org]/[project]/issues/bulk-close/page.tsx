import { PRODUCT_TRACK } from "@/lib/marketing/track";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireProject } from "@/lib/project-route";
import { awardingAgentOf } from "@/lib/bid-award-permission";
import { POSSIBLY_DELIVERED_WHERE, deliverySignals } from "@/lib/possibly-delivered";
import { VOTED_CLOSE_REASONS } from "@/lib/close-reasons";
import { closeReasonLabel } from "@/lib/close-reasons";
import { issuesPath } from "@/lib/project-paths";
import { issuePath } from "@/lib/issue-ref";
import { workflowFor } from "@/lib/workflow";
import { LocalTime } from "@/components/local-time";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { bulkCloseAction } from "@/app/actions/bulk-close";

export const metadata = { title: "Review and close" };

/**
 * The reviewed bulk close (#bulk-close): the Possibly delivered issues, each
 * with its proposed reason and the evidence found, for a manager to check and
 * close together. Each close is still the manager agent's weighted suggestion
 * and then the close once the votes reach the threshold.
 */
export default async function BulkClosePage({ params, searchParams }: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ closed?: string; waiting?: string; error?: string }>;
}) {
  const { org, project: slugParam } = await params;
  const query = await searchParams;
  const { user, organisationId, project } = await requireProject(org, slugParam);
  const agent = await awardingAgentOf(user.id, organisationId);
  const canClose = agent?.level === "manager" || agent?.level === "merger";
  const [bugs, workflow] = await Promise.all([
    prisma.bug.findMany({
      where: { organisationId, projectId: project.id, ...PRODUCT_TRACK, isDeleted: false, ...POSSIBLY_DELIVERED_WHERE },
      orderBy: { number: "asc" },
      take: 100,
      select: { id: true, number: true, title: true },
    }),
    workflowFor(project.id),
  ]);
  const signals = await deliverySignals(prisma, bugs.map((bug) => bug.id));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">Review and close</h1>
          <p className="mt-1 max-w-3xl text-sm text-zk-text2">
            Open issues that may already be done. Check each one, tick the ones you verified, and close them together.
            Each close is your manager agent&apos;s suggestion (it counts {workflow.managerVoteWeight}) and closes the issue once
            the votes for its reason reach {workflow.closeThreshold}; one still short of that keeps your suggestion and stays open.
          </p>
        </div>
        <Link href={issuesPath(project.ref, "possibly_delivered")} className="text-sm font-semibold text-zk-accent hover:underline">← Possibly delivered</Link>
      </div>

      {query.closed || query.waiting ? (
        <p role="status" className="rounded-xl bg-zk-ok-bg px-4 py-2.5 text-sm text-zk-ok-fg">
          Closed {query.closed ?? 0}. {Number(query.waiting ?? 0) > 0 ? `${query.waiting} got your suggestion and wait for more votes.` : ""}
        </p>
      ) : null}
      {query.error ? <p role="alert" className="rounded-xl bg-zk-bad-bg px-4 py-2.5 text-sm text-zk-bad-fg">{query.error}</p> : null}
      {!canClose ? (
        <p className="rounded-xl bg-zk-warn-bg px-4 py-2.5 text-sm text-zk-warn-fg">
          You can review this list, but closing needs a manager agent in this organisation.
        </p>
      ) : null}

      {bugs.length === 0 ? (
        <p className="rounded-panel border border-zk-border bg-zk-surface px-5 py-10 text-center text-sm text-zk-text2">Nothing to review: no Open issue shows signs of being done.</p>
      ) : (
        <form action={bulkCloseAction} className="space-y-3">
          <input type="hidden" name="slug" value={project.slug} />
          <input type="hidden" name="projectId" value={project.id} />
          <ul className="m-0 list-none space-y-3 p-0">
            {bugs.map((bug) => {
              const signal = signals.get(bug.id);
              const evidence = [
                ...(signal?.reasons ?? []),
                ...(signal?.links ?? []),
              ].join("\n");
              return (
                <li key={bug.id} className="rounded-panel border border-zk-border bg-zk-surface p-4">
                  <input type="hidden" name={`number:${bug.id}`} value={bug.number} />
                  <div className="flex flex-wrap items-start gap-3">
                    <input id={`pick-${bug.id}`} type="checkbox" name="issue" value={bug.id} disabled={!canClose} className="mt-1 h-4 w-4" />
                    <label htmlFor={`pick-${bug.id}`} className="min-w-0 flex-1 text-sm font-semibold text-zk-text">
                      #{bug.number} {bug.title}
                    </label>
                    <Link href={issuePath(project.ref, bug.number)} className="text-xs font-semibold text-zk-accent hover:underline">Open issue</Link>
                  </div>
                  {signal ? (
                    <p className="mt-1 pl-7 text-xs text-zk-text2">
                      <span className="font-semibold text-zk-warn-fg">{signal.reasons.join(" · ")}</span>
                      {" · "}Still Open: {signal.stillOpenBecause}
                      {signal.lastActivityAt ? <> · Last activity <LocalTime date={signal.lastActivityAt} /></> : null}
                    </p>
                  ) : null}
                  <div className="mt-3 grid gap-2 pl-7 sm:grid-cols-[180px_1fr]">
                    <label className="text-xs font-semibold text-zk-text2" htmlFor={`reason-${bug.id}`}>Reason</label>
                    <select id={`reason-${bug.id}`} name={`reason:${bug.id}`} defaultValue="already_implemented" disabled={!canClose} className="rounded-lg border border-zk-border bg-zk-surface px-2 py-1.5 text-sm text-zk-text">
                      {VOTED_CLOSE_REASONS.filter((reason) => reason !== "duplicate").map((reason) => (
                        <option key={reason} value={reason}>{closeReasonLabel(reason)}</option>
                      ))}
                    </select>
                    <label className="text-xs font-semibold text-zk-text2" htmlFor={`summary-${bug.id}`}>Summary</label>
                    <input id={`summary-${bug.id}`} name={`summary:${bug.id}`} defaultValue="Already done: the work was merged elsewhere." maxLength={300} disabled={!canClose} className="rounded-lg border border-zk-border bg-zk-surface px-2 py-1.5 text-sm text-zk-text" />
                    <label className="text-xs font-semibold text-zk-text2" htmlFor={`evidence-${bug.id}`}>Evidence</label>
                    <textarea id={`evidence-${bug.id}`} name={`evidence:${bug.id}`} defaultValue={evidence} rows={3} disabled={!canClose} className="rounded-lg border border-zk-border bg-zk-surface px-2 py-1.5 font-mono text-xs text-zk-text" />
                  </div>
                </li>
              );
            })}
          </ul>
          {canClose ? (
            <ConfirmSubmitButton
              variant="primary"
              confirm={{
                title: "Close the ticked issues?",
                body: "For each one your manager agent suggests closing it with the reason and evidence shown, and closes it once the votes reach the threshold.",
                confirmLabel: "Close them",
              }}
            >
              Close ticked issues
            </ConfirmSubmitButton>
          ) : null}
        </form>
      )}
    </div>
  );
}
