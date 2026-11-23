import type { ReactNode } from "react";
import type { SecuritySeverity } from "@prisma/client";
import "@/components/security-finding.css";
import { SECURITY_SEVERITIES, SEVERITY_LABEL } from "@/lib/security-severity";
import { PREVIEW_RISK_LABEL, type PreviewRisk, type PreviewSummary } from "@/lib/security-checks/preview-summary";

const CHIP = "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-bold";
const OK_CHIP = `bg-zk-ok-bg text-zk-ok-fg ${CHIP}`;

/**
 * A quick scan's result (#security-checks): whether HTTPS is set up, how many
 * problems and of what kind, and the risk level, red when anything was found.
 * Just the summary (23 Nov, Sheyi): each area and its problems are on the
 * scan's page, opened with See progress. Drawn in the app's own look (the
 * report's card and headings). The agents' report replaces it once it's
 * ready. `children` holds the next step.
 */
export function PreviewResult({ summary, children }: { summary: PreviewSummary; children?: ReactNode }) {
  const { counts, total, risk } = summary;
  const https = summary.areas.find((area) => area.area === "https");
  const certificate = summary.areas.find((area) => area.area === "certificate");
  const secure = (https?.problems ?? 0) + (certificate?.problems ?? 0) === 0;
  const worst = SECURITY_SEVERITIES.find((severity) => counts[severity] > 0) ?? null;
  const breakdown = SECURITY_SEVERITIES.filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`)
    .join(", ");

  return (
    <section aria-label="Scan summary" className={`w-full overflow-hidden rounded-panel text-left ${total ? "border-2 border-zk-bad-bd bg-zk-surface" : "border border-zk-border bg-zk-surface"}`}>
      {/* Problems found: the top turns red, as the scan page's findings box did (18 Nov call, moved here from the scan page). */}
      <div className={`px-4 py-4 sm:px-6 sm:py-5 ${total ? "bg-zk-bad-bg" : ""}`}>
        {/* Named after the site, like other scanners' results ("SSL Report: go.dev", "Website test: go.dev"). */}
        <h3 className={`m-0 wrap-break-word text-base font-semibold ${total ? "text-zk-bad-fg" : "text-zk-text"}`}>Scan summary: {summary.target}</h3>
        <p className="m-0 text-xs text-zk-muted">What any browser can see. The agents check much more, and their report replaces this.</p>
        {summary.ip ? (
          // The site's facts the way other scanners write them: a bold label, then the value, on one line
          // (SecurityHeaders' "IP Address: …" and "Report Time: …" rows, Sucuri's "IP address: …" box).
          <dl className="m-0 mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
            <div className="flex gap-1.5">
              <dt className="font-semibold text-zk-text">IP address:</dt>
              <dd className="m-0 tabular-nums text-zk-text2">{summary.ip}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="font-semibold text-zk-text">Checked:</dt>
              <dd className="m-0 text-zk-text2">
                {new Date(summary.checkedAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </dd>
            </div>
          </dl>
        ) : null}

        {/* One summary: how many problems, whether HTTPS is set up, and the risk on a meter. */}
        <RiskMeter
          risk={risk}
          headline={total ? `${total} ${total === 1 ? "problem" : "problems"} found` : "No problems found"}
          breakdown={total ? breakdown : "In what a quick scan can see."}
          tone={worst}
          https={https || certificate ? secure : null}
        />
      </div>

      {children ? <div className="border-t border-zk-border px-4 py-3 sm:px-6">{children}</div> : null}
    </section>
  );
}


/**
 * The quick scan on the scan's own page, before the agents' report: just its
 * problems, worst first, laid out like the report's "What we found"
 * (report-results.tsx) so the page reads the same before and after. The
 * agents' report replaces it once it's ready.
 */
export function QuickScanList({ summary }: { summary: PreviewSummary }) {
  const { counts, total } = summary;
  const rank = (severity: SecuritySeverity) => SECURITY_SEVERITIES.indexOf(severity);
  const rows = [...(summary.rows ?? [])].sort((a, b) => rank(a.severity) - rank(b.severity));
  const areaLabel = new Map(summary.areas.map((area) => [area.area, area.label]));

  return (
    <section aria-labelledby="quick-scan-heading" className="overflow-hidden rounded-panel border border-zk-border bg-zk-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="min-w-0">
          <h2 id="quick-scan-heading" className="text-base font-semibold text-zk-text">Scan summary</h2>
          <p className="text-xs text-zk-muted">What any browser can see, worst first. The agents&apos; report replaces this.</p>
        </div>
        <ul aria-label="Results by severity" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {total ? (
            SECURITY_SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => (
              <li key={severity}>
                <span className={`security-severity security-severity--${severity} ${CHIP}`}>
                  {counts[severity]} {SEVERITY_LABEL[severity].toLowerCase()}
                </span>
              </li>
            ))
          ) : (
            <li>
              <span className={OK_CHIP}>No problems found</span>
            </li>
          )}
        </ul>
      </div>
      {rows.length ? (
        <ol className="m-0 mt-3 list-none divide-y divide-zk-border border-t border-zk-border p-0">
          {rows.map((row, index) => (
            <li key={index} className="grid gap-1.5 px-4 py-3 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-4 sm:px-6">
              <div>
                <span className={`security-severity security-severity--${row.severity} ${CHIP}`}>{SEVERITY_LABEL[row.severity]}</span>
              </div>
              <div className="min-w-0">
                <p className="m-0 wrap-break-word text-sm font-semibold text-zk-text">{row.title ?? "A problem in this area"}</p>
                {areaLabel.get(row.area) ? <p className="m-0 text-xs text-zk-muted">{areaLabel.get(row.area)}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="m-0 mt-3 border-t border-zk-border px-4 py-4 text-sm text-zk-text2 sm:px-6">
          {total ? "Scan again to see what was found." : "Nothing a browser can see needs fixing."}
        </p>
      )}
    </section>
  );
}

const RISKS: PreviewRisk[] = ["minimal", "low", "medium", "high", "critical"];
/** Where each level sits on the meter, in percent: the middle of its fifth. */
/** Ziki's severity colours across the whole meter (Minimal green, Low blue, Medium amber, High orange, Critical red), from Minimal to Critical (the same as check-header.tsx). */
const RISK_GRADIENT = "linear-gradient(90deg, #16a34a 0%, #16a34a 12%, #0ea5e9 26%, #0ea5e9 34%, #f59e0b 46%, #f59e0b 54%, #ea580c 66%, #ea580c 74%, #dc2626 86%, #b91c1c 100%)";
const RISK_AT: Record<PreviewRisk, number> = { minimal: 10, low: 30, medium: 50, high: 70, critical: 90 };

/**
 * The security risk on a meter from Minimal to Critical, as the first design had it and as public
 * scanners like Sucuri SiteCheck show it: one bar filled up to this site's risk, in that level's
 * severity colour, with a pointer where it stops and the levels named underneath.
 */
function RiskMeter({ risk, headline, breakdown, tone, https }: {
  risk: PreviewRisk;
  headline: string;
  breakdown: string;
  /** The worst severity found, for the headline's dot; null when nothing was found. */
  tone: SecuritySeverity | null;
  /** Whether HTTPS is set up, or null when it wasn't looked at. */
  https: boolean | null;
}) {
  const at = RISK_AT[risk];
  return (
    <div className="mt-4 rounded-xl border border-zk-border px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="m-0 flex min-w-0 items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone ? `security-severity security-severity--${tone}` : "bg-zk-ok-fg"}`}
            style={tone ? { background: "var(--sev-dot)" } : undefined}
          />
          <span className="font-semibold text-zk-text">{headline}</span>
          <span className="text-zk-muted">· {breakdown}</span>
        </p>
        {https === null ? null : (
          <span className={`${CHIP} ${https ? "bg-zk-ok-bg text-zk-ok-fg" : "security-severity security-severity--high"}`}>
            {https ? "✓ HTTPS set up" : "! HTTPS needs work"}
          </span>
        )}
      </div>
      <p className="m-0 mt-3 text-xs font-semibold text-zk-muted">Security risk</p>
      <div
        role="meter"
        aria-label="Security risk"
        aria-valuemin={0}
        aria-valuemax={RISKS.length - 1}
        aria-valuenow={RISKS.indexOf(risk)}
        aria-valuetext={PREVIEW_RISK_LABEL[risk]}
        className="relative mt-3 h-2.5 rounded-full bg-zk-chip"
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 rounded-full"
          // Green to red across the whole scale, shown up to the risk, the same as the scan page's meter (check-header.tsx).
          style={{ width: `${at}%`, backgroundImage: RISK_GRADIENT, backgroundSize: `${(100 / at) * 100}% 100%` }}
        />
        {/* The pointer where the fill stops. */}
        <span
          aria-hidden="true"
          className="absolute -top-2 h-0 w-0 -translate-x-1/2 border-x-[7px] border-t-[9px] border-x-transparent border-t-zk-text"
          style={{ left: `${at}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-5 text-center text-[11px] text-zk-muted sm:text-xs">
        {RISKS.map((level) => (
          <span key={level} className={level === risk ? "font-bold text-zk-text" : undefined}>
            {PREVIEW_RISK_LABEL[level]}
          </span>
        ))}
      </div>
    </div>
  );
}
