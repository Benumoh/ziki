import type { ReactNode } from "react";
import { PREVIEW_RISK_LABEL, type PreviewRisk, type PreviewSummary } from "@/lib/security-checks/preview-summary";

const RISKS: PreviewRisk[] = ["minimal", "low", "medium", "high", "critical"];
/** Where the marker sits on the meter for each risk, in percent. */
const RISK_AT: Record<PreviewRisk, number> = { minimal: 6, low: 28, medium: 50, high: 72, critical: 94 };

/**
 * A quick scan's result (#security-checks), laid out like the agreed prototype:
 * two status lines, a risk meter from Minimal to Critical, a note on what a
 * quick scan can't see, and each area with a Fine or "N problems" pill. What
 * was found stays hidden behind blurred bars until the site is shown to be the
 * client's: the page never receives the text. `children` holds the next step.
 */
export function PreviewResult({ summary, children }: { summary: PreviewSummary; children?: ReactNode }) {
  const { counts, total, risk } = summary;
  const breakdown = (["critical", "high", "medium", "low"] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`)
    .join(", ");
  const https = summary.areas.find((area) => area.area === "https");
  const certificate = summary.areas.find((area) => area.area === "certificate");
  const secure = (https?.problems ?? 0) + (certificate?.problems ?? 0) === 0;

  return (
    <div className="flex w-full flex-col gap-5 rounded-2xl border border-zk-border bg-zk-surface p-4 text-left sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {https || certificate ? (
          <Status ok={secure} title={secure ? "HTTPS is set up" : "HTTPS needs work"} text={secure ? "The site loads securely and the certificate is valid." : "Browsers may not reach it securely every time."} />
        ) : null}
        <Status
          ok={total === 0}
          title={total ? `${total} ${total === 1 ? "problem" : "problems"} found` : "No problems found"}
          text={total ? breakdown : "In what a quick scan can see."}
        />
      </div>

      <div aria-label={`Security risk: ${PREVIEW_RISK_LABEL[risk]}`} role="img">
        <div className="relative h-3.5 rounded bg-zk-chip">
          <div className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-[#f6c35b] via-[#f08a3c] to-[#e5602b]" style={{ width: `${RISK_AT[risk]}%` }} />
          <span
            aria-hidden="true"
            className="absolute -top-2 h-0 w-0 -translate-x-1/2 border-x-[8px] border-t-[12px] border-x-transparent border-t-zk-text"
            style={{ left: `${RISK_AT[risk]}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-[13px] text-zk-muted">
          {RISKS.map((level) => (
            <span key={level} className={level === risk ? "font-bold text-zk-text" : "max-sm:hidden"}>
              {PREVIEW_RISK_LABEL[level]}{level === risk && level !== "minimal" ? " security risk" : ""}
            </span>
          ))}
        </div>
      </div>

      <p className="m-0 rounded-[10px] border border-zk-border bg-zk-bg px-4 py-3 text-sm leading-relaxed text-zk-text2">
        A quick scan only looks at what any browser can already see. Agents check much more: login, forms, code and server.
      </p>

      <div className="flex flex-col gap-4">
        {summary.areas.map((area) => (
          <section key={area.area} aria-label={area.label} className={`border-l-4 py-1 pl-4 ${area.problems ? "border-[#f0b23a]" : "border-[#7fcfa8]"}`}>
            <h4 className="m-0 flex flex-wrap items-center gap-2.5 text-[15px] font-bold text-zk-text">
              {area.label}
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${area.problems ? "bg-[#fff1e6] text-[#c2410c]" : "bg-zk-ok-bg text-zk-ok-fg"}`}>
                {area.problems ? `${area.problems} ${area.problems === 1 ? "problem" : "problems"}` : "Fine"}
              </span>
            </h4>
            {area.problems ? (
              // Placeholder bars, not the findings: nothing to read here until the site is proven yours.
              <div aria-hidden="true" className="mt-2 flex flex-col gap-2 blur-[3px]">
                {Array.from({ length: Math.min(area.problems, 4) }, (_, index) => (
                  <span key={index} className="h-2.5 rounded bg-zk-chip" style={{ width: `${[82, 64, 74, 52][index]}%` }} />
                ))}
              </div>
            ) : (
              <p className="m-0 mt-1.5 text-sm text-zk-ok-fg">✓ Nothing found here</p>
            )}
            {area.problems ? <span className="sr-only">Details hidden until it&apos;s shown to be yours.</span> : null}
          </section>
        ))}
      </div>

      {children}
    </div>
  );
}

function Status({ ok, title, text }: { ok: boolean; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-base font-extrabold text-white ${ok ? "bg-[#12805c]" : "bg-[#c2410c]"}`}>
        {ok ? "✓" : "!"}
      </span>
      <div className="min-w-0">
        <p className="m-0 text-base font-bold text-zk-text">{title}</p>
        <p className="m-0 mt-0.5 text-sm text-zk-muted">{text}</p>
      </div>
    </div>
  );
}
