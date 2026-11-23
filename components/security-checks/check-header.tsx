import "@/components/security-finding.css";
import { Badge } from "@/components/ui/badge";
import { LocalTime } from "@/components/local-time";
import { CheckActivity, type CheckPhase } from "@/components/security-checks/check-activity";
import { statusClass, substatusClass } from "@/lib/labels";
import { CHECK_STATUS_LABEL, DEEPER_SCAN_COVERS, DEEPER_SCAN_PRICE_ZIKS, FINISHED_CHECK_STATUSES } from "@/lib/security-checks";
import { DeeperScanStart } from "@/components/security-checks/deeper-scan-offer";
import type { CheckReport } from "@/lib/security-checks/report";
import { firstSentence } from "@/lib/security-checks/short-line";
import { ScanSteps } from "@/components/security-checks/scan-steps";

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
 * The top of a scan's two pages (18 Nov call, Mark: the quick scan and the deeper scan on separate pages, saying
 * each thing once). `view`:
 * - **quick**: the scan's page. What the quick scan is, and the steps.
 * - **deeper**: the deeper scan's own page. Before payment, what it is (Start is in its list); while agents work,
 *   the lively strip and how many agents are online; once done, Ziki's one-sentence summary.
 * The steps link the two pages. No summary box: each list counts its own findings once.
 */
export function CheckHeader({
  report,
  view,
  agentsOnline = null,
  backFromBuying = false,
}: {
  report: CheckReport;
  view: "quick" | "deeper";
  /** Security agents online now, for the deeper scan's page (18 Nov call: show agents ready or at work). */
  agentsOnline?: number | null;
  backFromBuying?: boolean;
}) {
  const phase = phaseOf(report);
  const { done, total } = report.progress;
  const site = report.target.value;
  const working = !report.paymentRequired && phase !== "done" && phase !== "stopped";
  const rescan = report.previousCheckId !== null;
  return (
    <div className="space-y-5 bg-linear-to-b from-zk-tint/60 to-transparent p-4 sm:p-6">
      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zk-text2">
        <Badge className={STATUS_CLASS[report.status]}>
          {view === "quick" ? "Quick scan done" : report.paymentRequired ? "Not started" : CHECK_STATUS_LABEL[report.status]}
        </Badge>
        <span>
          <LocalTime date={report.createdAt} absolute />
        </span>
      </p>

      {view === "quick" ? (
        <div className="min-w-0">
          <h1 id="check-headline" className="m-0 wrap-break-word text-2xl font-extrabold tracking-[-0.02em] text-zk-text sm:text-[28px]">
            Quick scan of {site}
          </h1>
          <p className="m-0 mt-1 text-[15px] text-zk-text2">What any browser can see of {site}, checked in seconds.</p>
        </div>
      ) : report.paymentRequired ? (
        // Not paid for yet: what the deeper scan is; Start in the list below opens the checkout (#deeper-scan-gate).
        <DeeperScanStart checkId={report.checkId} site={site} price={DEEPER_SCAN_PRICE_ZIKS} covers={DEEPER_SCAN_COVERS[report.target.kind]} backFromBuying={backFromBuying} />
      ) : (
        <CheckActivity site={site} phase={phase} done={done} total={total} />
      )}

      {/* Agents ready, before payment and while agents work (18 Nov call, Mark: "13 agents are online, waiting to work on your thing"). */}
      {view === "deeper" && (report.paymentRequired || working) && agentsOnline !== null ? (
        <p className="m-0 flex items-center gap-2 text-sm font-semibold text-zk-text">
          <span aria-hidden="true" className={`size-2 rounded-full ${agentsOnline ? "bg-zk-ok-fg motion-safe:animate-pulse" : "bg-zk-muted"}`} />
          {agentsOnline
            ? `${agentsOnline} security ${agentsOnline === 1 ? "agent is" : "agents are"} online${report.paymentRequired ? ", ready to check your site" : ""}`
            : "No security agent is online right now. Ziki's own agent steps in after a few minutes."}
        </p>
      ) : null}

      {/* The three steps (18 Nov): each opens its own page, and says where it stands. A little more room above them,
          so the title doesn't crowd them. */}
      <div className="pt-3">
      <ScanSteps
        quickFound={report.codeInList ? report.codeFound : report.quickScan ? report.quickScan.total : null}
        phase={phase}
        done={done}
        total={total}
        checkId={report.checkId}
        codeScan={report.codeScan}
        // A repo's own scan is the code scan: no Code scan step on it.
        codeStep={report.target.kind !== "repo"}
        paymentRequired={Boolean(report.paymentRequired)}
        current={view}
      />
      </div>

      {/* Once the deeper scan is done: Ziki's one-sentence summary, said once (a rescan says what's new instead). */}
      {view === "deeper" && report.posted ? (
        rescan ? <RescanCounts report={report} /> : report.summary ? <p className="m-0 wrap-break-word text-[15px] text-zk-text">{firstSentence(report.summary)}</p> : null
      ) : null}
    </div>
  );
}

/** A rescan's one line: what's new, still there and fixed since the last scan (18 Nov, Tolu). */
function RescanCounts({ report }: { report: CheckReport }) {
  const fresh = report.findings.filter((finding) => finding.recheck === null).length;
  const still = report.findings.filter((finding) => finding.recheck === "still_there").length;
  const fixed = report.fixed.length;
  if (!fresh && !still && !fixed) return null;
  const parts = [
    fresh ? <span key="new" className="text-zk-info-fg">{fresh} new since the last scan</span> : null,
    still ? <span key="still">{still} still there</span> : null,
    fixed ? <span key="fixed" className="text-zk-ok-fg">{fixed} fixed</span> : null,
  ].filter(Boolean);
  return (
    <p className="m-0 text-sm font-semibold text-zk-text2">
      {parts.map((part, i) => (
        <span key={i}>
          {i ? " · " : null}
          {part}
        </span>
      ))}
    </p>
  );
}
