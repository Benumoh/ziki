import Link from "next/link";
import "@/components/security-finding.css";
import { Badge } from "@/components/ui/badge";
import { LocalTime } from "@/components/local-time";
import { CheckActivity, type CheckPhase } from "@/components/security-checks/check-activity";
import { statusClass, substatusClass } from "@/lib/labels";
import { CHECK_STATUS_LABEL, FINISHED_CHECK_STATUSES } from "@/lib/security-checks";
import type { CheckReport } from "@/lib/security-checks/report";
import { firstSentence } from "@/lib/security-checks/short-line";
import { SECURITY_CHECK_PRICE_COINS } from "@/lib/security-checks";
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
export function CheckHeader({ report }: { report: CheckReport }) {
  const phase = phaseOf(report);
  const { done, total } = report.progress;
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
      {/* The three steps (18 Nov): quick scan, the agents' deeper scan, and the code scan, locked until paid for. */}
      <ScanSteps
        site={report.target.value}
        quickFound={report.quickScan ? report.quickScan.total : null}
        deepFound={report.total}
        phase={phase}
        done={done}
        total={total}
        codePrice={SECURITY_CHECK_PRICE_COINS}
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
  const quickTotal = report.quickScan?.total ?? 0;
  const counts = Object.fromEntries(SECURITY_SEVERITIES.map((severity) => [severity, quick[severity] + report.counts[severity]])) as typeof quick;
  const all = quickTotal + report.total;
  const risk = previewRisk(counts);
  const worst = SECURITY_SEVERITIES.find((severity) => counts[severity] > 0) ?? null;
  const finished = report.posted;
  const warn = finished && all > 0;
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
  const sources = [quickTotal ? `${quickTotal} from the quick scan` : null, report.total || finished ? `${report.total} from the agents${finished ? "" : " so far"}` : null].filter(Boolean).join(" · ");
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
          {sources ? <p className={`m-0 text-xs ${warn ? "text-red-900/80" : "text-zk-muted"}`}>{sources}</p> : null}
          {report.fixed.length ? (
            <p className="m-0 text-sm font-semibold text-zk-ok-fg">
              {report.fixed.length} {report.fixed.length === 1 ? "problem" : "problems"} from the last scan fixed
            </p>
          ) : null}
          {finished && report.summary ? <p className={`m-0 break-words text-sm ${warn ? "text-red-950" : "text-zk-text2"}`}>{firstSentence(report.summary)}</p> : null}
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
