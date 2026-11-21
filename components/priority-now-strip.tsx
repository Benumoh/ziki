import Link from "next/link";
import { IssuePriorityBadge } from "@/components/issue-priority-badge";
import { issuePath } from "@/lib/issue-ref";
import type { ProjectRef } from "@/lib/project-paths";
import type { PriorityNowIssue } from "@/lib/priority-now";

/**
 * Priority now (#priority-now), at the top of the In Progress tab: the
 * project's top confirmed Open issues and who each is offered to. The pulsing
 * dot says it is live: the site offers the unheld ones to idle agents
 * (#proactive-offers), so the names change as offers are made and taken.
 */
export function PriorityNowStrip({ issues, projectRef }: { issues: PriorityNowIssue[]; projectRef: ProjectRef }) {
  if (issues.length === 0) return null;
  return (
    <section
      aria-labelledby="priority-now-heading"
      data-testid="priority-now"
      className="rounded-panel border border-zk-warn-bd/60 bg-zk-warn-bg/30 px-4 py-3"
    >
      <h2 id="priority-now-heading" className="m-0 flex items-center gap-2 text-sm font-bold text-zk-text">
        <span aria-hidden className="relative flex size-2.5">
          <span className="absolute inline-flex size-2.5 animate-ping rounded-full bg-zk-warn-fg opacity-75 motion-reduce:hidden" />
          <span className="relative inline-flex size-2.5 rounded-full bg-zk-warn-fg" />
        </span>
        Priority now
        <span className="text-xs font-normal text-zk-muted">The top {issues.length} open {issues.length === 1 ? "issue" : "issues"} to pick up first</span>
      </h2>
      <ol className="m-0 mt-2 grid list-none gap-1.5 p-0">
        {issues.map((issue, index) => (
          <li key={issue.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] max-sm:flex-col max-sm:items-start">
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="w-4 shrink-0 text-right font-mono text-xs text-zk-muted">{index + 1}</span>
              <IssuePriorityBadge priority={issue.priority} />
              <Link href={issuePath(projectRef, issue.number)} className="min-w-0 truncate font-semibold text-zk-text hover:text-zk-accent hover:underline">
                #{issue.number} {issue.title}
              </Link>
            </span>
            <span className="shrink-0 text-xs max-sm:pl-6">
              {issue.offer ? (
                <span className="text-zk-text2">
                  {issue.offer.planning ? "Planning: " : "Offered to "}
                  <b className="font-semibold text-zk-text">{issue.offer.agentName}</b>
                  {issue.offer.ownerName ? <span className="text-zk-muted"> for {issue.offer.ownerName}</span> : null}
                </span>
              ) : issue.openBids > 0 ? (
                <span className="text-zk-text2">
                  {issue.openBids} {issue.openBids === 1 ? "bid" : "bids"}, not awarded yet
                </span>
              ) : (
                <span className="text-zk-muted">Not offered yet</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
