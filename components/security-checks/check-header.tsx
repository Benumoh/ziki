import { Badge } from "@/components/ui/badge";
import { LocalTime } from "@/components/local-time";
import { CheckActivity, type CheckPhase } from "@/components/security-checks/check-activity";
import { statusClass, substatusClass } from "@/lib/labels";
import { CHECK_STATUS_LABEL, FINISHED_CHECK_STATUSES } from "@/lib/security-checks";
import type { CheckReport } from "@/lib/security-checks/report";

/** Ziki's issue status colours, by meaning: waiting on someone like Requires confirmation, working like In progress, finished like Live. */
const STATUS_CLASS: Record<CheckReport["status"], string> = {
  awaiting_ownership: substatusClass.requires_confirmation,
  queued: substatusClass.requires_confirmation,
  splitting: statusClass.in_progress,
  checking: statusClass.in_progress,
  done: statusClass.resolved,
  cancelled: statusClass.closed,
};

/** What the check is doing: planning its parts, agents checking them, writing the report, finished or stopped. */
export function phaseOf(report: Pick<CheckReport, "status" | "parts" | "progress" | "posted">): CheckPhase {
  if (report.status === "cancelled") return "stopped";
  if (report.posted || FINISHED_CHECK_STATUSES.has(report.status)) return "done";
  if (report.parts.length === 0) return "planning";
  return report.progress.done >= report.progress.total ? "writing" : "checking";
}

/**
 * The top of a check's page (16 Nov, Hamzat): where it stands, the lively strip (a wandering magnifier and a
 * line that changes while agents work), and the progress bar with the numbers.
 */
export function CheckHeader({ report }: { report: CheckReport }) {
  const phase = phaseOf(report);
  const moving = phase !== "done" && phase !== "stopped";
  const { done, total, percent } = report.progress;
  return (
    <div className="space-y-5 bg-linear-to-b from-zk-tint/60 to-transparent p-4 sm:p-6">
      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zk-text2">
        <Badge className={STATUS_CLASS[report.status]}>{CHECK_STATUS_LABEL[report.status]}</Badge>
        <span>
          <LocalTime date={report.createdAt} absolute />
          {total ? ` · ${total} ${total === 1 ? "check" : "checks"}` : ""}
        </span>
      </p>
      <CheckActivity site={report.target.value} phase={phase} done={done} total={total} />
      <div>
        <div
          role="progressbar"
          aria-label="Check progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={total ? `${done} of ${total} parts done` : "Planning the checks"}
          className="relative h-2 w-full overflow-hidden rounded-full bg-zk-chip"
        >
          <div className="h-full rounded-full bg-electric-blue-strong transition-[width]" style={{ width: `${total ? percent : 0}%` }} />
          {moving ? (
            <div aria-hidden="true" className="absolute inset-y-0 left-0 w-1/4 rounded-full bg-white/40 motion-safe:[animation:zk-check-slide_1.8s_ease-in-out_infinite]" />
          ) : null}
        </div>
        <p className="mt-1.5 text-xs font-semibold tabular-nums text-zk-text">
          {total ? `${done} of ${total} parts done · ${percent}%` : "Planning the checks…"}
        </p>
      </div>
    </div>
  );
}
