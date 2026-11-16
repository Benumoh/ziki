import type { SecuritySeverity } from "@prisma/client";
import type { CheckReport, ReportPart, ResultFix } from "@/lib/security-checks/report";
import { shortLine } from "@/lib/security-checks/short-line";
import { SECURITY_SEVERITIES } from "@/lib/security-severity";

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
  pending?: ListPending[];
  clear?: string[];
  /** Shown when the tab has nothing else to show. */
  note: string;
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

function quickScanTab(report: CheckReport): ListTab {
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
  if (!parts.length) {
    const planning = report.status !== "cancelled" && report.status !== "done";
    return planning
      ? { ...base, count: 0, state: { label: "Planning", tone: "working" }, note: "Ziki is planning the checks." }
      : { ...base, count: 0, state: { label: "None", tone: "waiting" }, note: "No checks were run." };
  }
  const findings = report.findings.map((finding) => ({
    id: finding.id,
    severity: finding.severity,
    title: finding.title,
    line: shortLine(finding.description),
    area: finding.area,
    howToFix: finding.howToFix ? shortLine(finding.howToFix) : null,
    fix: finding.fix,
  }));
  const withFindings = new Set(report.findings.map((finding) => finding.partId));
  const finished = (part: ReportPart) => part.status === "done" || part.status === "skipped";
  const done = parts.filter(finished).length;
  // A cancelled check doesn't list its unfinished parts as still being checked.
  const pending =
    report.status === "cancelled"
      ? []
      : parts.filter((part) => !finished(part)).map((part) => ({ id: part.id, title: part.title, state: part.status === "checking" ? ("checking" as const) : ("waiting" as const) }));
  const clear = parts.filter((part) => part.status === "done" && !withFindings.has(part.id)).map((part) => part.title);
  const state: ListTab["state"] =
    done === parts.length
      ? { label: "Done", tone: "done" }
      : done === 0 && !parts.some((part) => part.status === "checking")
        ? { label: "Waiting", tone: "waiting" }
        : { label: `${done} of ${parts.length} done`, tone: "working" };
  return { ...base, count: findings.length, state, findings, pending, clear, note: "No threats found yet." };
}
