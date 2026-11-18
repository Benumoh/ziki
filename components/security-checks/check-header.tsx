import Link from "next/link";
import "@/components/security-finding.css";
import { Badge } from "@/components/ui/badge";
import { LocalTime } from "@/components/local-time";
import { CheckActivity, type CheckPhase } from "@/components/security-checks/check-activity";
import { statusClass, substatusClass } from "@/lib/labels";
import { CHECK_STATUS_LABEL, DEEPER_SCAN_COVERS, DEEPER_SCAN_PRICE_ZIKS, FINISHED_CHECK_STATUSES } from "@/lib/security-checks";
import { DeeperScanStart } from "@/components/security-checks/deeper-scan-offer";
import type { CheckReport } from "@/lib/security-checks/report";
import { firstSentence } from "@/lib/security-checks/short-line";
import { CODE_SCAN_PRICE_ZIKS } from "@/lib/security-checks";
import { SECURITY_SEVERITIES } from "@/lib/security-severity";
import { PREVIEW_RISK_LABEL, previewRisk, type PreviewRisk } from "@/lib/security-checks/preview-summary";
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
 * The top of a check's page (16 Nov, Hamzat): where it stands, the lively strip (a wandering magnifier and a
 * line that changes while agents work), and the progress bar with the numbers.
 */
export function CheckHeader({ report, backFromBuying = false }: { report: CheckReport; backFromBuying?: boolean }) {
  const phase = phaseOf(report);
  const { done, total } = report.progress;
  return (
    <div className="space-y-5 bg-linear-to-b from-zk-tint/60 to-transparent p-4 sm:p-6">
      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zk-text2">
        {/* Waiting for the deeper scan's payment (#deeper-scan-gate): "Quick scan done", not "Waiting to start". */}
        <Badge className={STATUS_CLASS[report.status]}>{report.paymentRequired ? "Quick scan done" : CHECK_STATUS_LABEL[report.status]}</Badge>
        <span>
          <LocalTime date={report.createdAt} absolute />
          {total ? ` · ${total} ${total === 1 ? "check" : "checks"}` : ""}
        </span>
      </p>
      {/* Waiting for the deeper scan's payment (#deeper-scan-gate): nothing is moving yet, so instead of "Ziki is
          planning" it says the quick scan is done; Start in the steps below opens the checkout. */}
      {report.paymentRequired ? (
        <DeeperScanStart checkId={report.checkId} site={report.target.value} price={DEEPER_SCAN_PRICE_ZIKS} covers={DEEPER_SCAN_COVERS[report.target.kind]} backFromBuying={backFromBuying} />
      ) : (
        <CheckActivity site={report.target.value} phase={phase} done={done} total={total} />
      )}
      {/* The three steps (18 Nov): quick scan, the agents' deeper scan, and the code scan, locked until paid for. */}
      <ScanSteps
        site={report.target.value}
        quickFound={report.codeInList ? report.codeFound : report.quickScan ? report.quickScan.total : null}
        // Once the quick scan's findings are in the list (18 Nov), the agents' count leaves them out.
        deepFound={report.total - report.codeFound}
        phase={phase}
        done={done}
        total={total}
        codePrice={CODE_SCAN_PRICE_ZIKS}
        checkId={report.checkId}
        codeScan={report.codeScan}
        // A repo's own scan is the code scan: no Connect code step on it.
        codeStep={report.target.kind !== "repo"}
        // Set once the deeper scan needs paying for (PR 827); false until then.
        paymentRequired={"paymentRequired" in report ? Boolean(report.paymentRequired) : false}
      />
      {/* One box for the result (18 Nov): how many, from where, the risk on the meter, and Fix once the check is done. */}
      <FindingsSummary report={report} />
    </div>
  );
}

/** Where each level sits on the meter, in percent: the middle of its fifth. */
const RISK_AT: Record<PreviewRisk, number> = { minimal: 10, low: 30, medium: 50, high: 70, critical: 90 };
const RISKS: PreviewRisk[] = ["minimal", "low", "medium", "high", "critical"];
/** Ziki's severity colours across the whole meter (Minimal green, Low blue, Medium amber, High orange, Critical red); the fill shows it up to the risk, so the higher, the redder its end. */
const RISK_GRADIENT = "linear-gradient(90deg, #16a34a 0%, #16a34a 12%, #0ea5e9 26%, #0ea5e9 34%, #f59e0b 46%, #f59e0b 54%, #ea580c 66%, #ea580c 74%, #dc2626 86%, #b91c1c 100%)";

/**
 * The result in one box (18 Nov, Chloe): how many problems (the quick scan's and the agents'), where they came
 * from, the risk on the meter, and, once the check is done, Fix. While the agents work the box is white and the
 * meter only climbs (it sits on the worst problem found so far); when the check is done and anything was found
 * it turns red (Hamzat's rule, 17 Nov: any problem gets the warning look).
 */
function FindingsSummary({ report }: { report: CheckReport }) {
  const quick = report.quickScan?.counts ?? { critical: 0, high: 0, medium: 0, low: 0 };
  // Once the quick scan's findings are saved in the list (18 Nov, codeInList), report.total and report.counts already
  // hold them: counting the quick scan on top would count every one of them twice.
  const quickTotal = report.codeInList ? report.codeFound : report.quickScan?.total ?? 0;
  const agentTotal = report.total - report.codeFound;
  const counts = report.codeInList
    ? report.counts
    : (Object.fromEntries(SECURITY_SEVERITIES.map((severity) => [severity, quick[severity] + report.counts[severity]])) as typeof quick);
  const all = quickTotal + agentTotal;
  const risk = previewRisk(counts);
  const worst = SECURITY_SEVERITIES.find((severity) => counts[severity] > 0) ?? null;
  const finished = report.posted;
  const warn = finished && all > 0;
  const rescan = report.previousCheckId !== null;
  // Every finding not already in the app, a rescan's earlier ones still there included (18 Nov, Tolu).
  const remaining = report.findings.filter((finding) => !finding.fix);
  const criticalRemaining = remaining.filter((finding) => finding.severity === "critical");
  const selection = criticalRemaining.length ? criticalRemaining : remaining;
  const fixLabel = criticalRemaining.length === 1 ? "Fix the critical one"
    : criticalRemaining.length > 1 ? "Fix critical findings" : "Fix remaining findings";
  // Back to this page with them ticked and the fix panel open, under the Deeper scan.
  const fixHref = `/security/checks/${encodeURIComponent(report.checkId)}?fix=${selection.map(({ id }) => encodeURIComponent(id)).join(",")}#fix-panel`;
  const title = all === 0
    ? (finished ? "No problems found" : "Nothing found yet")
    : `${all} ${all === 1 ? "problem" : "problems"} ${finished ? "found" : "found so far"}`;
  const breakdown = SECURITY_SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => `${counts[severity]} ${severity}`).join(", ");
  const areas = report.quickScan?.areas ?? [];
  const httpsArea = areas.find((area) => area.area === "https");
  const certificate = areas.find((area) => area.area === "certificate");
  const secure = httpsArea || certificate ? (httpsArea?.problems ?? 0) + (certificate?.problems ?? 0) === 0 : null;
  const sources = [quickTotal ? `${quickTotal} from the quick scan` : null, agentTotal || finished ? `${agentTotal} from the agents${finished ? "" : " so far"}` : null].filter(Boolean).join(" · ");
  const at = RISK_AT[risk];

  return (
    <section aria-label="Findings summary" className={`rounded-[20px] border p-4 sm:p-6 ${warn ? "border-2 border-red-400 bg-red-100" : "border-zk-border bg-zk-surface"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          {/* The same top line as the quick scan's meter on the front page (preview-result.tsx). */}
          <h2 className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${worst ? `security-severity security-severity--${worst}` : "bg-zk-ok-fg"}`}
              style={worst ? { background: "var(--sev-dot)" } : undefined}
            />
            <span className={`font-semibold ${warn ? "text-red-800" : "text-zk-text"}`}>{title}</span>
            {breakdown ? <span className={warn ? "text-red-900/80" : "text-zk-muted"}>· {breakdown}</span> : null}
            {secure === null ? null : (
              <span className={`ml-auto inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${secure ? "bg-zk-ok-bg text-zk-ok-fg" : "security-severity security-severity--high"}`}>
                {secure ? "✓ HTTPS set up" : "! HTTPS needs work"}
              </span>
            )}
          </h2>
          {/* A rescan keeps the box to one line under the title (18 Nov, Tolu: "too clustered"): new, still there and
              fixed. Where they came from and the summary sentence show on a first scan only. */}
          {sources && !rescan ? <p className={`m-0 text-xs ${warn ? "text-red-900/80" : "text-zk-muted"}`}>{sources}</p> : null}
          {/* A rescan says what's new, still there and fixed in one line (18 Nov); New ones carry a blue label below. */}
          {rescan ? <RescanCounts report={report} /> : null}
          {finished && report.summary && !rescan ? <p className={`m-0 break-words text-sm ${warn ? "text-red-950" : "text-zk-text2"}`}>{firstSentence(report.summary)}</p> : null}
        </div>
        {finished && selection.length ? (
          <Link href={fixHref} className="hidden min-h-11 shrink-0 items-center justify-center self-start rounded-full bg-electric-blue-strong px-5 py-2 text-sm font-bold text-white hover:brightness-105 sm:inline-flex">
            {fixLabel}
          </Link>
        ) : null}
      </div>
      {/* The risk so far on the quick scan's meter: it sits on the worst problem found, so it only climbs while agents work. */}
      <div className="mt-5">
        <p className={`m-0 text-xs font-semibold ${warn ? "text-red-900/80" : "text-zk-muted"}`}>Security risk</p>
        <div
          role="meter"
          aria-label="Security risk"
          aria-valuemin={0}
          aria-valuemax={RISKS.length - 1}
          aria-valuenow={RISKS.indexOf(risk)}
          aria-valuetext={PREVIEW_RISK_LABEL[risk]}
          className={`relative mt-4 h-2.5 rounded-full ${warn ? "bg-white/70" : "bg-zk-chip"}`}
        >
          <span aria-hidden="true" className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${at}%`, backgroundImage: RISK_GRADIENT, backgroundSize: `${(100 / at) * 100}% 100%` }} />
          <span aria-hidden="true" className="absolute -top-2 h-0 w-0 -translate-x-1/2 border-x-[7px] border-t-[9px] border-x-transparent border-t-zk-text" style={{ left: `${at}%` }} />
        </div>
        <div className={`mt-2 grid grid-cols-5 text-center text-[11px] sm:text-xs ${warn ? "text-red-900/70" : "text-zk-muted"}`}>
          {RISKS.map((level) => (
            <span key={level} className={level === risk ? `font-bold ${warn ? "text-red-950" : "text-zk-text"}` : undefined}>
              {PREVIEW_RISK_LABEL[level]}
            </span>
          ))}
        </div>
      </div>
      {/* On a phone, Fix comes last and full width: the result, the risk, then what to do. */}
      {finished && selection.length ? (
        <Link href={fixHref} className="mt-5 flex min-h-11 w-full items-center justify-center rounded-full bg-electric-blue-strong px-5 py-2 text-sm font-bold text-white hover:brightness-105 sm:hidden">
          {fixLabel}
        </Link>
      ) : null}
    </section>
  );
}

/**
 * On a rescan (18 Nov): how many findings are new since the last scan, still there, and fixed, in one line.
 * New ones carry the blue New label in the list; parts left out when there are none.
 */
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
