"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { SecuritySeverity } from "@prisma/client";
import "@/components/security-finding.css";
import { THREAT_LABEL, type ListFinding, type ListTab } from "@/lib/security-checks/check-list";
import type { ResultFix } from "@/lib/security-checks/report";

/**
 * A check's results under its header (16 Nov, Hamzat): two horizontal tabs, the
 * **Quick scan** (open by default) and the **Deeper scan**. Each row puts the
 * threat on the left and where it stands on the right. Agents' findings can be
 * ticked for "Fix selected", opened with the arrow for a short line, or opened
 * as their own page ("See the fix").
 */

const FIX_STATE: Record<ResultFix["bucket"], string> = { fixing: "Being fixed", fixed: "Fixed", closed: "Closed" };

export function CheckList({ checkId, tabs }: { checkId: string; tabs: [ListTab, ListTab] }) {
  const [active, setActive] = useState<ListTab["key"]>("quick");
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) => setSelected((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
  const tab = tabs.find((t) => t.key === active) ?? tabs[0];
  const fixHref = `/security/checks/${encodeURIComponent(checkId)}/fix?ids=${selected.map(encodeURIComponent).join(",")}`;

  return (
    <div className="border-t border-zk-border">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-b border-zk-border px-4 sm:px-6">
        <div role="tablist" aria-label="Scan results" className="-mb-px flex gap-1">
          {tabs.map((t) => {
            const on = t.key === active;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`tab-${t.key}`}
                aria-selected={on}
                aria-controls={`panel-${t.key}`}
                onClick={() => setActive(t.key)}
                className={`flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-zk-accent ${
                  on ? "border-electric-blue-strong text-zk-text" : "border-transparent text-zk-text2 hover:text-zk-text"
                }`}
              >
                {t.title}
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${on ? "bg-electric-blue-strong text-white" : "bg-zk-chip text-zk-text2"}`}>{t.count}</span>
              </button>
            );
          })}
        </div>
        {selected.length ? (
          <Link
            href={fixHref}
            className="mb-2 inline-flex h-9 items-center justify-center rounded-full bg-electric-blue-strong px-4 text-sm font-bold text-white hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2"
          >
            Fix selected ({selected.length})
          </Link>
        ) : null}
      </div>

      <div role="tabpanel" id={`panel-${tab.key}`} aria-labelledby={`tab-${tab.key}`}>
        <p className="m-0 px-4 pt-3 text-xs text-zk-muted sm:px-6">
          {tab.key === "quick"
            ? "What any browser can see, checked the moment you added it."
            : tab.state.tone === "done"
              ? "Agents checked each part. Tick the threats you want fixed."
              : `Agents are checking each part (${tab.state.label.toLowerCase()}). Threats show here as each part finishes.`}
        </p>
        <TabRows checkId={checkId} tab={tab} selected={selected} onToggle={toggle} />
      </div>
    </div>
  );
}

function TabRows({ checkId, tab, selected, onToggle }: { checkId: string; tab: ListTab; selected: string[]; onToggle: (id: string) => void }) {
  const scanRows = tab.scanRows ?? [];
  const findings = tab.findings ?? [];
  const pending = tab.pending ?? [];
  const clear = tab.clear ?? [];
  const empty = !scanRows.length && !findings.length && !pending.length && !clear.length;
  return (
    <ul className="m-0 mt-2 list-none divide-y divide-zk-border border-t border-zk-border p-0">
      {scanRows.map((row, i) => (
        <li key={`scan-${i}`}>
          <Row severity={row.severity} title={row.title} sub={row.area} />
        </li>
      ))}
      {findings.map((finding) => (
        <li key={finding.id}>
          <FindingRow checkId={checkId} finding={finding} checked={selected.includes(finding.id)} onToggle={() => onToggle(finding.id)} />
        </li>
      ))}
      {pending.map((part) => (
        <li key={part.id}>
          <Row severity={null} title={part.title} right={<PartState state={part.state} />} />
        </li>
      ))}
      {clear.length ? (
        <li>
          <ClearLine titles={clear} />
        </li>
      ) : null}
      {empty ? (
        <li>
          <p className="m-0 px-4 py-4 text-sm text-zk-text2 sm:px-6">{tab.note}</p>
        </li>
      ) : null}
    </ul>
  );
}

/** Tick box (or nothing), the threat, what it is, then where it stands. */
function Row({ severity, title, sub, right, lead }: { severity: SecuritySeverity | null; title: ReactNode; sub?: string | null; right?: ReactNode; lead?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
      <span className="flex w-4 shrink-0 justify-center">{lead}</span>
      <span className="w-[7.5rem] shrink-0">
        {severity ? <ThreatChip severity={severity} /> : <span className="text-sm text-zk-muted" aria-label="Not checked yet">—</span>}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`m-0 wrap-break-word text-sm ${severity ? "font-semibold text-zk-text" : "text-zk-text2"}`}>{title}</p>
        {sub ? <p className="m-0 truncate text-xs text-zk-muted">{sub}</p> : null}
      </div>
      {right ? <span className="shrink-0">{right}</span> : null}
    </div>
  );
}

function FindingRow({ checkId, finding, checked, onToggle }: { checkId: string; finding: ListFinding; checked: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const href = `/security/checks/${encodeURIComponent(checkId)}/findings/${encodeURIComponent(finding.id)}`;
  const lead = finding.fix ? null : (
    <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Fix ${finding.title}`} className="size-4 cursor-pointer accent-electric-blue-strong" />
  );
  const right = (
    <span className="flex items-center gap-2">
      {finding.fix ? (
        <Link href={finding.fix.issue?.href ?? finding.fix.findingHref} className="whitespace-nowrap text-xs font-semibold text-zk-accent hover:underline">
          {finding.fix.issue ? `Issue #${finding.fix.issue.number}` : "In your app"} · {FIX_STATE[finding.fix.bucket]}
        </Link>
      ) : (
        <Link href={href} className="whitespace-nowrap text-xs font-semibold text-zk-accent hover:underline">
          See the fix
        </Link>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? `Hide details of ${finding.title}` : `Show details of ${finding.title}`}
        className="grid size-7 place-items-center rounded-full text-zk-text2 hover:bg-zk-chip focus-visible:outline-2 focus-visible:outline-zk-accent"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </span>
  );
  return (
    <div>
      <Row severity={finding.severity} title={finding.title} sub={finding.area} right={right} lead={lead} />
      {open ? (
        <div className="space-y-1 px-4 pb-3 sm:pl-[calc(1.5rem+1rem+7.5rem+1.5rem)] sm:pr-6">
          <p className="m-0 text-sm text-zk-text2">{finding.line}</p>
          {finding.howToFix ? (
            <p className="m-0 text-sm text-zk-text">
              <span className="font-semibold">How to fix:</span> {finding.howToFix}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PartState({ state }: { state: "checking" | "waiting" }) {
  return state === "checking" ? (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-violet-800">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-violet-600 motion-safe:animate-pulse" />
      Checking…
    </span>
  ) : (
    <span className="whitespace-nowrap text-xs font-semibold text-zk-muted">Waiting</span>
  );
}

function ClearLine({ titles }: { titles: string[] }) {
  const named = titles.slice(0, 3);
  const rest = titles.length - named.length;
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-sm sm:px-6">
        <span className="rounded-full bg-zk-ok-bg px-2.5 py-0.5 text-xs font-bold text-zk-ok-fg">{titles.length} clear</span>
        <span className="min-w-0 flex-1 text-zk-text2">
          {named.join(", ")}
          {rest > 0 ? ` and ${rest} more` : ""} found no threats.
        </span>
        <span className="text-xs font-semibold text-zk-accent group-open:hidden">Show</span>
        <span className="hidden text-xs font-semibold text-zk-accent group-open:inline">Hide</span>
      </summary>
      <ul className="m-0 list-disc px-10 pb-3 text-sm text-zk-text2">
        {titles.map((title) => (
          <li key={title}>{title}</li>
        ))}
      </ul>
    </details>
  );
}

function ThreatChip({ severity }: { severity: SecuritySeverity }) {
  return (
    <span className={`security-severity security-severity--${severity} inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold`}>
      {THREAT_LABEL[severity]}
    </span>
  );
}
