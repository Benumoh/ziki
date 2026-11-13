import type { ReactNode } from "react";
import { PREVIEW_RISK_LABEL, type PreviewRisk, type PreviewSummary } from "@/lib/security-checks/preview-summary";

const RISKS: PreviewRisk[] = ["minimal", "low", "medium", "high", "critical"];
/** Where the marker sits on the meter for each risk, in percent. */
const RISK_AT: Record<PreviewRisk, number> = { minimal: 6, low: 28, medium: 50, high: 72, critical: 94 };

/**
 * A quick scan's result (#security-checks): a status line, a risk meter from
 * Minimal to Critical, and each area with how many problems it has. What was
 * found stays hidden behind blurred bars until the site is shown to be the
 * client's; the page never receives the text. `children` holds the next step.
 */
export function PreviewResult({ summary, children }: { summary: PreviewSummary; children?: ReactNode }) {
  const { counts, total, risk } = summary;
  const breakdown = (["critical", "high", "medium", "low"] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`)
    .join(", ");
  return (
    <div className="flex w-full flex-col gap-4 rounded-2xl border border-zk-border bg-zk-surface p-4 text-left sm:p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-extrabold text-white ${total ? "bg-[#c2410c]" : "bg-[#12805c]"}`}
        >
          {total ? "!" : "✓"}
        </span>
        <div className="min-w-0">
          <p className="m-0 text-base font-bold text-zk-text">
            {total ? `${total} ${total === 1 ? "problem" : "problems"} found on ${summary.target}` : `No problems found on ${summary.target}`}
          </p>
          <p className="m-0 mt-0.5 text-sm text-zk-muted">{total ? breakdown : "In what a quick scan can see."}</p>
        </div>
      </div>

      <div aria-label={`Security risk: ${PREVIEW_RISK_LABEL[risk]}`} role="img">
        <div className="relative h-3 rounded bg-zk-chip">
          <div className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-[#f6c35b] via-[#f08a3c] to-[#e5602b]" style={{ width: `${RISK_AT[risk]}%` }} />
          <span
            aria-hidden="true"
            className="absolute -top-2 h-0 w-0 -translate-x-1/2 border-x-[7px] border-t-[10px] border-x-transparent border-t-zk-text"
            style={{ left: `${RISK_AT[risk]}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs text-zk-muted">
          {RISKS.map((level) => (
            <span key={level} className={level === risk ? "font-bold text-zk-text" : "max-sm:hidden"}>
              {PREVIEW_RISK_LABEL[level]}{level === risk && level !== "minimal" ? " risk" : ""}
            </span>
          ))}
        </div>
      </div>

      <ul className="m-0 list-none divide-y divide-zk-divider p-0">
        {summary.areas.map((area) => (
          <li key={area.area} className="flex items-center gap-3 py-2 text-sm">
            <span className="w-36 shrink-0 text-zk-text">{area.label}</span>
            {area.problems ? (
              <>
                {/* Placeholder bars, not the findings: nothing to read here until the site is proven yours. */}
                <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col gap-1 blur-[3px]">
                  <span className="h-2 w-4/5 rounded bg-zk-chip" />
                  {area.problems > 1 ? <span className="h-2 w-3/5 rounded bg-zk-chip" /> : null}
                </span>
                <span className="shrink-0 font-bold tabular-nums text-[#c2410c]">
                  {area.problems}
                  <span className="sr-only"> {area.problems === 1 ? "problem" : "problems"}, hidden until it&apos;s yours</span>
                </span>
              </>
            ) : (
              <>
                <span className="flex-1" />
                <span className="shrink-0 font-semibold text-zk-ok-fg">Fine</span>
              </>
            )}
          </li>
        ))}
      </ul>

      {children}
    </div>
  );
}
