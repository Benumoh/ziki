"use client";

import Link from "next/link";
import type { CheckPhase } from "@/components/security-checks/check-activity";

/**
 * Where a check is, as three small steps on one line (18 Nov, Chloe; Mark's 16 Nov call: "security should be
 * in phases… you see something on the top that tells you done, not done"): Quick scan, then the Deeper scan
 * (the agents' check), then the Code scan, which opens its own page at any time: connecting the code is free and
 * shows Ziki's free check of it; agents read it once it's paid for (18 Nov call, Mark: connect first, pay later).
 * One-line steps joined by a line, as GitHub shows a run's steps. They share the full width, like the risk meter
 * under them (18 Nov, Chloe).
 */
/** One step's box (review, 18 Nov: one shared style instead of four copies). The step that's running is tinted blue so it stands out. */
const CHIP = "flex h-12 w-full min-w-0 items-center gap-2.5 rounded-xl border px-4 text-sm font-semibold";
const CHIP_REST = "border-zk-border bg-zk-surface";
const CHIP_NOW = "border-electric-blue-strong/40 bg-zk-tint";
/** Ziki's keyboard focus outline, on every control in the steps. */
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent";

export function ScanSteps({
  quickFound,
  phase,
  done,
  total,
  paymentRequired = false,
  checkId,
  codeScan = null,
  codeStep = true,
  current,
}: {
  site?: string;
  /** Problems the quick scan found, or null when no quick scan ran. */
  quickFound: number | null;
  /** Problems the agents have reported so far (kept for callers; the steps no longer show counts). */
  deepFound?: number;
  phase: CheckPhase;
  done: number;
  total: number;

  /** The deeper scan waits for payment (PR 827): the step says Not started; Start is on the deeper scan's page. */
  paymentRequired?: boolean;
  /** This website scan: each step opens its own page. */
  checkId?: string;
  /** Its code scan once the code is connected: the step says where it stands. */
  codeScan?: { checkId: string; paid: boolean; finished: boolean; stopped?: boolean; found: number } | null;
  /** False on a code scan's own page (a repo): it is the code scan, so there's no code to connect. */
  codeStep?: boolean;
  /** The page you're on, shown as the current step. */
  current?: "quick" | "deeper" | "code";
}) {
  const deepDone = phase === "done";
  // The steps say where each step stands, not how much it found (18 Nov call, Mark: don't repeat the same counts).
  const deepState = paymentRequired
    ? "Not started"
    : phase === "planning" ? "Planning" : phase === "stopped" ? "Stopped" : deepDone ? "Done" : phase === "writing" ? "Writing the report" : `Agents checking · ${done} of ${total}`;
  const base = checkId ? `/security/checks/${encodeURIComponent(checkId)}` : undefined;
  return (
    <ol aria-label="Steps of this security check" className="mt-0 flex list-none flex-col p-0 sm:flex-row sm:items-center">
      {/* Each step is its own page (18 Nov call, Mark): Quick scan is the scan's page, Deeper scan has its own. */}
      <Step state="done" name="Quick scan" detail={quickFound === null ? "Not run" : "Done"} href={base} current={current === "quick"} />
      <Joint done />
      <Step
        state={paymentRequired ? "locked" : deepDone ? "done" : phase === "stopped" ? "locked" : "now"}
        name="Deeper scan"
        detail={deepState}
        href={base ? `${base}/deeper` : undefined}
        current={current === "deeper"}
      />
      {codeStep ? <Joint done={deepDone} /> : null}
      {/* Clickable at any time (18 Nov call): its own page, where the code is connected for free, paid for and followed. */}
      {!codeStep ? null : (
        <Step
          // Connecting gives Ziki's first look, not the whole code scan (23 Nov, Sheyi): done only after the full check.
          state={!codeScan ? "todo" : codeScan.stopped ? "locked" : !codeScan.paid ? "todo" : codeScan.finished ? "done" : "now"}
          name="Code scan"
          detail={!codeScan ? "Not started" : codeScan.stopped ? "Stopped" : !codeScan.paid ? "First look done" : codeScan.finished ? "Done" : "Full check running"}
          href={base ? `${base}/code` : undefined}
          current={current === "code"}
        />
      )}
    </ol>
  );
}

/** One step: a link to its page, marked when it's the page you're on. */
function Step({ state, name, detail, href, current = false }: { state: "done" | "now" | "todo" | "locked"; name: string; detail: string; href?: string; current?: boolean }) {
  const chip = `${CHIP} ${state === "now" ? CHIP_NOW : CHIP_REST} ${current ? "ring-2 ring-electric-blue-strong/60" : ""} text-zk-text`;
  const inner = (
    <>
      {state === "done" ? (
        <span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-green-600 text-white">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
      ) : state === "now" ? (
        <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full border-2 border-electric-blue-strong border-r-zk-tint motion-safe:animate-spin" />
      ) : state === "todo" ? (
        // Not started, but open to you now (the code scan: connecting is free).
        <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full border-2 border-zk-muted/60" />
      ) : (
        <LockIcon />
      )}
      <span className="shrink-0 whitespace-nowrap">{name}</span>
      <span aria-live="polite" className={`min-w-0 truncate text-[13px] tabular-nums ${state === "now" ? "font-semibold text-zk-accent" : "font-medium text-zk-muted"}`}>{detail}</span>
      <span className="sr-only">{state === "done" ? " (done)" : state === "now" ? " (in progress)" : state === "todo" ? " (not started)" : " (locked)"}</span>
    </>
  );
  return (
    <li className="flex min-w-0 sm:flex-1">
      {href ? (
        <Link
          href={href}
          aria-current={current ? "page" : undefined}
          className={`${chip} ${current ? "" : "hover:border-electric-blue-strong/50 hover:shadow-sm"} ${state === "now" ? "hover:brightness-[0.98]" : "hover:bg-zk-chip"} ${FOCUS}`}
        >
          {inner}
        </Link>
      ) : (
        <span className={chip}>{inner}</span>
      )}
    </li>
  );
}

function Joint({ done }: { done: boolean }) {
  return <li aria-hidden="true" className={`ml-[26px] h-3 w-0.5 shrink-0 sm:ml-0 sm:h-0.5 sm:w-6 ${done ? "bg-green-600" : "bg-zk-muted/50"}`} />;
}

function LockIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
