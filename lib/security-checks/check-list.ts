import type { SecuritySeverity } from "@prisma/client";
import type { CheckReport, RecheckStatus, ReportFinding, ReportPart, ResultFix } from "@/lib/security-checks/report";
import { shortLine } from "@/lib/security-checks/short-line";
import { siteChangeSentence } from "@/lib/security-checks/site-change";
import { SECURITY_SEVERITIES } from "@/lib/security-severity";
import { DEEPER_SCAN_COVERS } from "@/lib/security-checks";

/** How a severity reads on the check's list and a finding's page (16 Nov): "Critical threat", not just "Critical". */
export const THREAT_LABEL: Record<SecuritySeverity, string> = {
  critical: "Critical threat",
  high: "High threat",
  medium: "Medium threat",
  low: "Low threat",
};

export type ListFinding = {
  id: string;
  severity: SecuritySeverity;
  title: string;
  /** One short line, shown when the row is opened. */
  line: string;
  area: string;
  howToFix: string | null;
  fix: ResultFix | null;
  /** The scan that found it; an earlier scan's finding on a rescan opens, and is moved to the app, from there. */
  checkId: string;
  /** On a rescan: an earlier finding still being rechecked, or still there. Null for this scan's own findings. */
  recheck: RecheckStatus | null;
  /** On a rescan, a finding this scan found for the first time (18 Nov): shown with a New label. */
  isNew: boolean;
  /** On a rescan, what its Rechecking, Still there or New label says on hover (18 Nov, Tolu); null otherwise. */
  hint: string | null;
  /** What sending it to the app costs now, in Ziks. */
  price: number;
};

export type ListPending = { id: string; title: string; state: "checking" | "waiting" };

/** One tab of the check's list. */
export type ListTab = {
  key: "quick" | "deep";
  title: string;
  /** How many threats it lists so far, for the tab's count. */
  count: number;
  /** "Done", "4 of 6 done", "Waiting" or "Planning". */
  state: { label: string; tone: "done" | "working" | "waiting" };
  /** Quick-scan rows: seen by a browser, not agents' findings, so they can't be ticked. */
  scanRows?: { severity: SecuritySeverity; title: string; line: string | null; area: string | null }[];
  findings?: ListFinding[];
  /** On a rescan, the earlier findings its agents found fixed. */
  fixed?: ListFinding[];
  pending?: ListPending[];
  /** Before the deeper scan is paid for (#deeper-scan-gate): what it will check, each not checked yet. */
  notChecked?: { title: string; why: string }[];
  clear?: string[];
  /** Shown when the tab has nothing else to show. */
  note: string;
  /** The quick scan's findings are in the main list (18 Nov), so this tab isn't shown. */
  merged?: boolean;
};

/**
 * The check's list as two tabs (16 Nov, Hamzat): the **Quick scan** (what any
 * browser saw when the asset was added) and the **Deeper scan** (every part the
 * agents check). The deeper scan lists its findings worst first, then the parts
 * still being checked, then the ones that found nothing.
 */
export function checkListTabs(report: CheckReport): [ListTab, ListTab] {
  return [quickScanTab(report), deeperScanTab(report)];
}

/** "Automatic check: Security headers" → "Security headers": the area a code check's finding came from. */
function codeArea(area: string): string {
  return area.replace(/^Automatic check:\s*/, "");
}

/** A finding from Ziki's own code checks (the quick scan), saved in the list since 18 Nov, rather than an agent's. */
function isQuickScanFinding(finding: ReportFinding): boolean {
  return /^Automatic check:/.test(finding.area);
}

/** One finding as a row of the list, tickable to fix. */
function rowOf(report: CheckReport, finding: ReportFinding): ListFinding {
  return {
    id: finding.id,
    severity: finding.severity,
    title: finding.title,
    line: finding.recheckNote ? shortLine(finding.recheckNote) : shortLine(finding.description),
    area: isQuickScanFinding(finding) ? codeArea(finding.area) : finding.area,
    howToFix: finding.howToFix ? shortLine(finding.howToFix) : null,
    fix: finding.fix,
    price: finding.price,
    checkId: finding.checkId,
    recheck: finding.recheck,
    isNew: report.previousCheckId !== null && finding.recheck === null,
    hint: rescanHint(report, finding),
  };
}

function quickScanTab(report: CheckReport): ListTab {
  // Saved as real findings (18 Nov, Tolu's change): the quick scan's findings keep their own section at the top, before
  // and after the deeper scan is paid for, with the same tick box, See the fix and Fix selected as the agents' (18 Nov,
  // Seyi). They can be fixed without buying the deeper scan. The Deeper scan below lists only what the agents check.
  if (report.codeInList) {
    const findings = report.findings.filter(isQuickScanFinding).map((finding) => rowOf(report, finding));
    const fixed = report.fixed.filter(isQuickScanFinding).map((finding) => rowOf(report, finding));
    return { key: "quick", title: "Quick scan", count: findings.length, state: { label: "Done", tone: "done" }, findings, fixed, note: "No threats found by what any browser can see." };
  }
  const scan = report.quickScan;
  if (!scan) return { key: "quick", title: "Quick scan", count: 0, state: { label: "Not run", tone: "waiting" }, note: "No quick scan was run when this was added." };
  const label = new Map(scan.areas.map((area) => [area.area, area.label]));
  const rank = (severity: SecuritySeverity) => SECURITY_SEVERITIES.indexOf(severity);
  const rows = [...(scan.rows ?? [])]
    .sort((a, b) => rank(a.severity) - rank(b.severity))
    .map((row) => ({ severity: row.severity, title: row.title ?? "A problem in this area", line: null, area: label.get(row.area) ?? null }));
  return { key: "quick", title: "Quick scan", count: rows.length, state: { label: "Done", tone: "done" }, scanRows: rows, note: "No threats found by what any browser can see." };
}

function deeperScanTab(report: CheckReport): ListTab {
  const base = { key: "deep" as const, title: "Deeper scan" };
  const parts = report.parts;
  // Waiting for its payment (#deeper-scan-gate): agents haven't started, and won't until it's paid for. The quick
  // scan's findings show in the Quick scan section above.
  if (report.paymentRequired) {
    return { ...base, count: 0, state: { label: "Not started", tone: "waiting" }, notChecked: DEEPER_SCAN_COVERS[report.target.kind], note: "Agents start once you run the deeper scan." };
  }
  // The agents' own findings: the quick scan's are in the Quick scan section above (18 Nov).
  const agents = (finding: ReportFinding) => !report.codeInList || !isQuickScanFinding(finding);
  const agentFindings = report.findings.filter(agents);
  const agentFixed = report.fixed.filter(agents);
  const findings = agentFindings.map((finding) => rowOf(report, finding));
  const fixed = agentFixed.map((finding) => rowOf(report, finding));
  // No agent parts yet: say so, but still list any findings already in, instead of hiding them behind "Planning".
  if (!parts.length) {
    const planning = report.status !== "cancelled" && report.status !== "done";
    const state: ListTab["state"] = planning ? { label: "Planning", tone: "working" } : { label: "None", tone: "waiting" };
    return { ...base, count: findings.length, state, findings, fixed, note: planning ? "Ziki is planning the checks." : "No checks were run." };
  }
  const withFindings = new Set([...agentFindings, ...agentFixed].map((finding) => finding.partId));
  const finished = (part: ReportPart) => part.status === "done" || part.status === "skipped";
  const done = parts.filter(finished).length;
  // A cancelled check doesn't list its unfinished parts as still being checked. Nor does a rescan (18 Nov, Tolu):
  // its list is the earlier findings, each Rechecking until answered, with anything new added as agents find it;
  // the parts still to do are only the progress bar's count.
  const pending =
    report.status === "cancelled" || report.previousCheckId !== null
      ? []
      : parts.filter((part) => !finished(part)).map((part) => ({ id: part.id, title: part.title, state: part.status === "checking" ? ("checking" as const) : ("waiting" as const) }));
  const clear = parts.filter((part) => part.status === "done" && !withFindings.has(part.id)).map((part) => part.title);
  const state: ListTab["state"] =
    done === parts.length
      ? { label: "Done", tone: "done" }
      : done === 0 && !parts.some((part) => part.status === "checking")
        ? { label: "Waiting", tone: "waiting" }
        : { label: `${done} of ${parts.length} done`, tone: "working" };
  return { ...base, count: findings.length, state, findings, fixed, pending, clear, note: "No threats found yet." };
}

/**
 * On a rescan, the hover text of a finding's label (18 Nov, Tolu: instead of a note at the top of the page). A New
 * one also says whether the site changed since the last scan, when that can be told.
 */
function rescanHint(report: CheckReport, finding: ReportFinding): string | null {
  if (report.previousCheckId === null) return null;
  if (finding.recheck === "checking") return "Found on the earlier scan, being checked again now.";
  if (finding.recheck === "still_there") return "Found on the earlier scan and found again on this one.";
  if (finding.recheck === "fixed") return "Found on the earlier scan, and gone now.";
  return `Found for the first time on this scan.${report.siteChange ? ` ${siteChangeSentence(report.siteChange)}` : ""}`;
}
