"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { SecuritySeverity } from "@prisma/client";
import "@/components/security-finding.css";
import { THREAT_LABEL, type ListFinding, type ListTab } from "@/lib/security-checks/check-list";
import type { ResultFix } from "@/lib/security-checks/report";

/** Stack the browser preview and agent results so both are visible from the same page. */
const FIX_STATE: Record<ResultFix["bucket"], string> = { fixing: "Being fixed", fixed: "Fixed", closed: "Closed" };

export function CheckList({ checkId, tabs }: { checkId: string; tabs: [ListTab, ListTab] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [quick, checks] = tabs;
  const selected = (checks.findings ?? []).filter(({ id, fix }) => !fix && picked.includes(id)).map(({ id }) => id);
  const toggle = (id: string) => setPicked((old) => old.includes(id) ? old.filter((item) => item !== id) : [...old, id]);
  const fixHref = `/security/checks/${encodeURIComponent(checkId)}/fix?ids=${selected.map(encodeURIComponent).join(",")}`;

  return (
    <div className="space-y-5 border-t border-zk-border bg-zk-bg p-4 sm:p-6">
      <details open className="overflow-hidden rounded-2xl border border-zk-border bg-zk-surface">
        <summary className="cursor-pointer px-4 py-4 font-semibold text-zk-text sm:px-6">
          Quick scan · {quick.count} {quick.count === 1 ? "finding" : "findings"}
        </summary>
        <TabRows checkId={checkId} tab={quick} selected={selected} onToggle={toggle} />
      </details>
      <section aria-labelledby="quick-checks-heading" className="overflow-hidden rounded-2xl border border-zk-border bg-zk-surface">
        <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-6">
          <h2 id="quick-checks-heading" className="font-semibold text-zk-text">Deeper scan</h2>
          <span className="rounded-full bg-zk-chip px-2.5 py-1 text-xs font-semibold text-zk-text2">{checks.state.label}</span>
        </header>
        <TabRows checkId={checkId} tab={checks} selected={selected} onToggle={toggle} />
        {selected.length ? (
          <div className="flex items-center justify-between gap-3 border-t border-zk-border bg-zk-tint px-4 py-3 sm:px-6">
            <span role="status" className="text-sm font-semibold text-zk-accent">{selected.length} selected</span>
            <Link href={fixHref} className="rounded-full bg-electric-blue-strong px-4 py-2 text-sm font-bold text-white hover:brightness-105">
              Fix {selected.length} selected
            </Link>
          </div>
        ) : null}
      </section>
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
      {findings.length ? <li className="bg-zk-bg px-4 py-2 text-sm font-semibold text-zk-text sm:px-6">Ready to fix · {findings.filter((finding) => !finding.fix).length}</li> : null}
      {findings.map((finding) => (
        <li key={finding.id}>
          <FindingRow checkId={checkId} finding={finding} checked={selected.includes(finding.id)} onToggle={() => onToggle(finding.id)} />
        </li>
      ))}
      {pending.length ? <li className="bg-zk-bg px-4 py-2 text-sm font-semibold text-zk-text sm:px-6">Still checking · {pending.length}</li> : null}
      {pending.map((part) => (
        <li key={part.id}>
          <Row severity={null} title={part.title} right={<PartState state={part.state} />} lead={null} />
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

/**
 * Tick box (or nothing), the threat, what it is, then where it stands. On a phone the threat sits above the
 * title, so the title keeps the width.
 */
function Row({ severity, title, sub, right, lead }: { severity: SecuritySeverity | null; title: ReactNode; sub?: string | null; right?: ReactNode; lead?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 sm:items-center sm:px-6">
      {/* The tick-box column only where a tab has tick boxes (the deeper scan), so the quick scan has no empty gap. */}
      {lead !== undefined ? <span className="flex w-4 shrink-0 justify-center pt-0.5 sm:pt-0">{lead}</span> : null}
      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
        <span className="block shrink-0 sm:w-[7.5rem]">
          {severity ? <ThreatChip severity={severity} /> : <span className="text-sm text-zk-muted" aria-label="Not checked yet">—</span>}
        </span>
        <div className="mt-1 min-w-0 flex-1 sm:mt-0">
          <p className={`m-0 wrap-break-word text-sm ${severity ? "font-semibold text-zk-text" : "text-zk-text2"}`}>{title}</p>
          {sub ? <p className="m-0 truncate text-xs text-zk-muted">{sub}</p> : null}
        </div>
      </div>
      {right ? <span className="shrink-0">{right}</span> : null}
    </div>
  );
}

function FindingRow({ checkId, finding, checked, onToggle }: { checkId: string; finding: ListFinding; checked: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const href = `/security/checks/${encodeURIComponent(checkId)}/findings/${encodeURIComponent(finding.id)}`;
  const lead: ReactNode = finding.fix ? null : (
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
