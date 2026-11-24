"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { SecuritySeverity } from "@prisma/client";
import "@/components/security-finding.css";
import { FixPanel } from "@/components/security-checks/fix-panel";
import { ZikAmount } from "@/components/zik-symbol";
import { MakeFixable } from "@/components/security-checks/make-fixable";
import { type ListFinding, type ListTab } from "@/lib/security-checks/check-list";
import { SEVERITY_LABEL } from "@/lib/security-severity";
import type { ResultFix } from "@/lib/security-checks/report";


const FIX_STATE: Record<ResultFix["bucket"], string> = { fixing: "Being fixed", fixed: "Fixed", closed: "Closed" };

/**
 * One section of a check's list, on its own page (18 Nov call, Mark: the quick scan and the deeper scan on separate
 * pages): the **Quick scan** on the scan's page, the **Deeper scan** on its own page. Its findings can be ticked and
 * sent with Fix selected, which opens the fix panel right under the list.
 *
 * `initialFix`: findings to tick with the fix panel already open, when a finding's "Fix it for me" brings the person
 * here (`?fix=id1,id2`).
 */
export function CheckList({
  checkId,
  tab,
  show,
  initialFix = [],
  code = false,
  price,
}: {
  checkId: string;
  tab: ListTab;
  show: "quick" | "deeper";
  initialFix?: string[];
  /**
   * A code scan's lists, on its website's Code scan page (18 Nov call): Ziki's first look at the code, then what the
   * full check covers, not checked yet until it's paid for (23 Nov, Sheyi: show there's more to find).
   */
  code?: boolean;
  /** The full code check's price, on its button. */
  price?: number;
}) {
  const [picked, setPicked] = useState<string[]>(initialFix);
  const [fixOpen, setFixOpen] = useState(initialFix.length > 0);
  // Every finding not already in the app can be sent from here, a rescan's earlier ones still there included (18 Nov, Tolu).
  const fixable = (tab.findings ?? []).filter(({ id, fix }) => !fix && picked.includes(id));
  const selected = fixable.map(({ id }) => id);
  const toggle = (id: string) => {
    const next = picked.includes(id) ? picked.filter((item) => item !== id) : [...picked, id];
    setPicked(next);
    // Nothing ticked: the panel closes, and the next tick starts again from the blue bar.
    if (!next.length) setFixOpen(false);
  };
  const panelOpen = fixOpen && selected.length > 0;
  // "Select all" on the Ready to fix row (17 Nov, Hamzat): ticks every finding still to fix, or clears them all.
  const selectAll = (ids: string[]) => {
    const all = ids.every((id) => picked.includes(id));
    const next = all ? picked.filter((id) => !ids.includes(id)) : [...new Set([...picked, ...ids])];
    setPicked(next);
    if (!next.length) setFixOpen(false);
  };
  // Arriving with findings to fix: bring the panel into view once it has loaded its projects.
  useEffect(() => {
    if (!initialFix.length) return;
    const timer = setTimeout(() => document.getElementById("fix-panel")?.scrollIntoView({ block: "center", behavior: "smooth" }), 400);
    return () => clearTimeout(timer);
  }, [initialFix.length]);
  const quick = show === "quick";

  return (
    <div className="border-t border-zk-border bg-zk-bg p-4 sm:p-6">
      <section
        id={quick ? "quick-scan-results" : "deeper-scan-results"}
        aria-labelledby={quick ? "quick-scan-heading" : "deeper-scan-heading"}
        className="scroll-mt-24 overflow-hidden rounded-2xl border border-zk-border bg-zk-surface"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-6">
          <h2 id={quick ? "quick-scan-heading" : "deeper-scan-heading"} className="m-0 text-base font-semibold text-zk-text">
            {/* On the Code scan page, Ziki's first look has no count: there's more to find, and the full check gives its
                count once it's done (23 Nov, Sheyi). Before it's paid for, the full check's list is what's not checked yet. */}
            {quick
              ? code
                ? "First look · what Ziki found so far"
                : `Quick scan · ${tab.count} ${tab.count === 1 ? "finding" : "findings"}`
              : code
                ? tab.startable
                  ? `Not checked yet · ${tab.notChecked?.length ?? 0}`
                  : tab.state.tone === "done"
                    ? `Full code check · ${tab.count} ${tab.count === 1 ? "finding" : "findings"}`
                    : "Full code check"
                : "Deeper scan"}
          </h2>
          {quick ? null : tab.startable ? (
            // Not started: the one Start on this page (18 Nov call, Mark: one call to action). It opens the checkout.
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-zk-text2">
              <LockIcon />
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => window.dispatchEvent(new CustomEvent("zk:start-deeper-scan"))}
                className="inline-flex h-9 items-center rounded-xl bg-electric-blue-strong px-4 text-sm font-semibold text-white hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent"
              >
                {code ? (
                  <>
                    Get the full check{price !== undefined ? <>&nbsp;·&nbsp;<ZikAmount amount={price} /></> : null}
                  </>
                ) : (
                  "Run deeper scan"
                )}
              </button>
            </span>
          ) : (
            <span className="rounded-full bg-zk-chip px-2.5 py-1 text-xs font-semibold text-zk-text2">{tab.state.label}</span>
          )}
        </div>
        {/* An older scan (before 18 Nov) has only titles here: make them real, fixable findings once. */}
        {quick && tab.scanRows?.length && !tab.findings?.length ? <MakeFixable checkId={checkId} /> : null}
        <TabRows tab={tab} selected={selected} onToggle={toggle} onSelectAll={tab.findings?.length ? selectAll : undefined} code={code} />
        {/* Ticking shows the blue bar; "Fix N selected" swaps it for the panel, which keeps the count (17 Nov, Hamzat). */}
        {selected.length && !panelOpen ? (
          <div className="flex items-center justify-between gap-3 border-t border-zk-border bg-zk-tint px-4 py-3 sm:px-6">
            <span role="status" className="text-sm font-semibold text-zk-accent">{selected.length} selected</span>
            <button
              type="button"
              onClick={() => setFixOpen(true)}
              className="h-9 rounded-xl bg-electric-blue-strong px-4 text-sm font-semibold text-white hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent"
            >
              Fix {selected.length} selected
            </button>
          </div>
        ) : null}
        {/* Choosing the project and paying happen right here, under the list (17 Nov, Hamzat). */}
        {panelOpen ? (
          <FixPanel
            checkId={checkId}
            findings={fixable.map(({ id, price }) => ({ id, price }))}
            onDone={() => { setPicked([]); setFixOpen(false); }}
          />
        ) : null}
      </section>
    </div>
  );
}

function TabRows({ tab, selected, onToggle, onSelectAll, code = false }: { tab: ListTab; selected: string[]; onToggle: (id: string) => void; onSelectAll?: (ids: string[]) => void; code?: boolean }) {
  const scanRows = tab.scanRows ?? [];
  const findings = tab.findings ?? [];
  const fixed = tab.fixed ?? [];
  const pending = tab.pending ?? [];
  const clear = tab.clear ?? [];
  const notChecked = tab.notChecked ?? [];
  const empty = !scanRows.length && !findings.length && !fixed.length && !pending.length && !clear.length && !notChecked.length;
  return (
    <ul className="m-0 mt-2 list-none divide-y divide-zk-border border-t border-zk-border p-0">
      {scanRows.map((row, i) => (
        <li key={`scan-${i}`}>
          <Row severity={row.severity} title={row.title} sub={row.area} />
        </li>
      ))}
      {findings.length ? <ReadyRow findings={findings} selected={selected} onSelectAll={onSelectAll} /> : null}
      {findings.map((finding) => (
        <li key={finding.id}>
          <FindingRow finding={finding} checked={selected.includes(finding.id)} onToggle={() => onToggle(finding.id)} />
        </li>
      ))}
      {/* A rescan's earlier findings its agents found gone (#security-rescan): kept in view, never counted or priced. */}
      {fixed.length ? <li className="bg-zk-bg px-4 py-2 text-sm font-semibold text-zk-text sm:px-6">Fixed since the last scan · {fixed.length}</li> : null}
      {fixed.map((finding) => (
        <li key={finding.id}>
          <Row
            severity={finding.severity}
            title={finding.title}
            sub={finding.line}
            lead={null}
            right={<span title={finding.hint ?? undefined} className="whitespace-nowrap rounded-full bg-zk-ok-bg px-2.5 py-0.5 text-xs font-bold text-zk-ok-fg">Fixed</span>}
          />
        </li>
      ))}
      {pending.length ? <li className="bg-zk-bg px-4 py-2 text-sm font-semibold text-zk-text sm:px-6">Still checking · {pending.length}</li> : null}
      {pending.map((part) => (
        <li key={part.id}>
          {/* Who is checking it, while it's being checked (18 Nov call, Mark: show the work happening). */}
          <Row severity={null} title={part.title} sub={part.state === "checking" && part.agent ? `${part.agent} is checking this` : null} right={<PartState state={part.state} />} lead={null} />
        </li>
      ))}
      {/* Before the deeper scan is paid for (#deeper-scan-gate): what the deeper scan's price buys, each not checked yet. */}
      {/* On the Code scan page the section's own heading already says "Not checked yet". */}
      {notChecked.length && !code ? <li className="bg-zk-bg px-4 py-2 text-sm font-semibold text-zk-text sm:px-6">What agents check that the quick scan can&apos;t · {notChecked.length}</li> : null}
      {notChecked.map((item) => (
        <li key={item.title}>
          <Row
            severity={null}
            title={item.title}
            sub={item.why}
            lead={null}
            right={<span className="whitespace-nowrap rounded-full bg-zk-chip px-2.5 py-0.5 text-xs font-bold text-zk-text2">Not checked</span>}
          />
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

/** "Ready to fix · 21", with Select all (or Clear selection) on the right when there is anything left to fix. */
function ReadyRow({ findings, selected, onSelectAll }: { findings: ListFinding[]; selected: string[]; onSelectAll?: (ids: string[]) => void }) {
  const open = findings.filter((finding) => !finding.fix).map((finding) => finding.id);
  const all = open.length > 0 && open.every((id) => selected.includes(id));
  return (
    <li className="flex items-center justify-between gap-3 bg-zk-bg px-4 py-2 text-sm font-semibold text-zk-text sm:px-6">
      <span>Ready to fix · {open.length}</span>
      {onSelectAll && open.length ? (
        <button type="button" onClick={() => onSelectAll(open)} className="text-sm font-semibold text-zk-accent hover:underline focus-visible:outline-2 focus-visible:outline-zk-accent">
          {all ? "Clear selection" : "Select all"}
        </button>
      ) : null}
    </li>
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
        <span className="block shrink-0 sm:w-[5.5rem]">
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

function FindingRow({ finding, checked, onToggle }: { finding: ListFinding; checked: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  // An earlier scan's finding (a rescan rechecking it) opens under the scan that found it, and is ticked here like any other.
  const href = `/security/checks/${encodeURIComponent(finding.checkId)}/findings/${encodeURIComponent(finding.id)}`;
  const lead: ReactNode = finding.fix ? null : (
    <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Fix ${finding.title}`} className="size-4 cursor-pointer accent-electric-blue-strong" />
  );
  const right = (
    <span className="flex items-center gap-2">
      {finding.recheck === "checking" ? (
        <span title={finding.hint ?? undefined} className="whitespace-nowrap rounded-full bg-zk-chip px-2.5 py-0.5 text-xs font-semibold text-zk-text2">Rechecking</span>
      ) : finding.recheck === "still_there" ? (
        <span title={finding.hint ?? undefined} className="whitespace-nowrap rounded-full bg-zk-warn-bg px-2.5 py-0.5 text-xs font-semibold text-zk-warn-fg">Still there</span>
      ) : finding.isNew ? (
        // Found for the first time by this rescan (18 Nov): calm blue, in the same place as Still there.
        <span title={finding.hint ?? undefined} className="whitespace-nowrap rounded-full bg-zk-info-bg px-2.5 py-0.5 text-xs font-semibold text-zk-info-fg">New</span>
      ) : null}
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
  // A click anywhere on a fixable row ticks it (17 Nov, Hamzat): the row is the box's label, so the browser does
  // it, and the links and the details button inside keep their own clicks.
  const row = <Row severity={finding.severity} title={finding.title} sub={finding.area} right={right} lead={lead} />;
  return (
    <div>
      {finding.fix ? row : <label className={`block cursor-pointer ${checked ? "bg-zk-tint" : "hover:bg-zk-tint/60"}`}>{row}</label>}
      {open ? (
        <div className="space-y-1 px-4 pb-3 sm:pl-[calc(1.5rem+1rem+5.5rem+1.5rem)] sm:pr-6">
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
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

/** The same small lock as the steps box's locked Deeper scan. */
function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
