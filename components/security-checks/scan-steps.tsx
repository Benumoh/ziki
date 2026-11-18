"use client";

import { useRef, useState } from "react";
import type { CheckPhase } from "@/components/security-checks/check-activity";

/**
 * Where a check is, as three small steps on one line (18 Nov, Chloe; Mark's 16 Nov call: "security should be
 * in phases… you see something on the top that tells you done, not done"): Quick scan, then the Deeper scan
 * (the agents' check), then the Code scan, which is locked until the person connects their code and pays.
 * Small one-line chips joined by a line, as GitHub shows a run's steps.
 */
export function ScanSteps({
  site,
  quickFound,
  deepFound,
  phase,
  done,
  total,
  codePrice,
  paymentRequired = false,
}: {
  site: string;
  /** Problems the quick scan found, or null when no quick scan ran. */
  quickFound: number | null;
  /** Problems the agents have reported so far. */
  deepFound: number;
  phase: CheckPhase;
  done: number;
  total: number;
  /** What the code scan costs, in Ziks. */
  codePrice: number;
  /** The deeper scan waits for payment (PR 827): the step is locked with a Start button. */
  paymentRequired?: boolean;
}) {
  const deepDone = phase === "done";
  const deepState =
    phase === "planning" ? "Planning" : phase === "stopped" ? "Stopped" : deepDone ? `Done · ${deepFound} found` : phase === "writing" ? "Writing the report" : `Agents checking · ${done} of ${total}`;
  return (
    <ol aria-label="Steps of this security check" className="mt-0 flex list-none flex-col gap-1.5 p-0 sm:flex-row sm:flex-wrap sm:items-center sm:gap-0">
      <Step state="done" name="Quick scan" detail={quickFound === null ? "Not run" : `Done · ${quickFound} found`} />
      <Joint done />
      {paymentRequired ? (
        <li className="flex">
          <span className="inline-flex h-9 w-full items-center gap-2 rounded-[10px] border border-zk-border bg-zk-surface px-3 text-[13px] font-semibold text-zk-text sm:w-auto">
            <LockIcon />
            Deeper scan
            {/* The price shows only once the start pop-up opens (18 Nov, Chloe). The pop-up and payment are the
                deeper-scan checkout's (PR 827): it opens on this button's "zk:start-deeper-scan" event. */}
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => window.dispatchEvent(new CustomEvent("zk:start-deeper-scan"))}
              className="ml-auto inline-flex h-6 items-center rounded-full bg-electric-blue-strong px-3 text-xs font-bold text-white hover:brightness-105 sm:ml-1"
            >
              Start
            </button>
          </span>
        </li>
      ) : (
        <Step state={deepDone ? "done" : phase === "stopped" ? "locked" : "now"} name="Deeper scan" detail={deepState} />
      )}
      <Joint done={deepDone} />
      <li className="flex">
        <span className="inline-flex h-9 w-full items-center gap-2 rounded-[10px] border border-zk-border bg-zk-surface px-3 text-[13px] font-semibold text-zk-muted sm:w-auto">
          <LockIcon />
          Code scan
          <ConnectCode site={site} price={codePrice} />
        </span>
      </li>
    </ol>
  );
}

function Step({ state, name, detail }: { state: "done" | "now" | "locked"; name: string; detail: string }) {
  return (
    <li className="flex">
      <span className="inline-flex h-9 w-full items-center gap-2 rounded-[10px] border border-zk-border bg-zk-surface px-3 text-[13px] font-semibold text-zk-text sm:w-auto">
        {state === "done" ? (
          <span aria-hidden="true" className="grid h-4 w-4 place-items-center rounded-full bg-green-600 text-white">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          </span>
        ) : state === "now" ? (
          <span aria-hidden="true" className="h-4 w-4 rounded-full border-2 border-electric-blue-strong border-r-zk-tint motion-safe:animate-spin" />
        ) : (
          <LockIcon />
        )}
        {name}
        <span className={`text-xs ${state === "now" ? "font-semibold text-zk-accent" : "font-medium text-zk-muted"}`}>{detail}</span>
        <span className="sr-only">{state === "done" ? " (done)" : state === "now" ? " (in progress)" : " (locked)"}</span>
      </span>
    </li>
  );
}

function Joint({ done }: { done: boolean }) {
  return <li aria-hidden="true" className={`hidden h-0.5 w-7 sm:block ${done ? "bg-green-600" : "bg-zk-border"}`} />;
}

function LockIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** "Connect code": a pop-up with the two ways to connect, and what the code scan costs (Mark, 16 Nov: read-only, or GitHub). */
function ConnectCode({ site, price }: { site: string; price: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<"read" | "github">("read");
  const option = (value: "read" | "github") =>
    `flex w-full gap-3 rounded-xl border p-3.5 text-left ${mode === value ? "border-electric-blue-strong ring-2 ring-electric-blue-strong/15" : "border-zk-border hover:bg-zk-chip/50"}`;
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="ml-auto inline-flex h-6 items-center rounded-full border border-electric-blue-strong/25 bg-zk-tint px-2.5 text-xs font-bold text-zk-accent hover:brightness-95 sm:ml-1"
      >
        Connect code
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="connect-code-title"
        className="m-auto w-[min(520px,calc(100vw-32px))] rounded-[20px] border-0 bg-zk-surface p-0 text-left shadow-[0_30px_80px_rgba(11,23,51,0.35)] backdrop:bg-zk-text/45"
      >
        <form method="dialog" className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 id="connect-code-title" className="m-0 text-lg font-extrabold text-zk-text">Connect your code</h2>
            <button aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-zk-muted hover:bg-zk-chip">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <p className="m-0 mt-1.5 text-sm leading-relaxed text-zk-text2">
            The code scan reads {site}&apos;s code to find what a browser can&apos;t: leaked keys, weak logins, unsafe packages. It costs{" "}
            <b className="text-zk-text">{price} Ziks</b>.
          </p>
          <div className="mt-4 flex flex-col gap-2.5">
            <button type="button" onClick={() => setMode("read")} aria-pressed={mode === "read"} className={option("read")}>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-bold text-zk-text">
                  Read-only <span className="rounded-full bg-zk-ok-bg px-2 py-px text-[10px] font-extrabold uppercase tracking-wide text-zk-ok-fg">Safest</span>
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-zk-muted">Ziki reads the code and tells you each fix to copy. Nothing in your repo is changed.</span>
              </span>
            </button>
            {mode === "read" ? (
              <input
                type="url"
                aria-label="Your GitHub repo"
                placeholder="github.com/your-team/your-repo"
                className="h-10 rounded-[10px] border border-zk-border bg-zk-surface px-3 text-sm text-zk-text placeholder:text-zk-muted focus:border-electric-blue-strong/60 focus:outline-none"
              />
            ) : null}
            <button type="button" onClick={() => setMode("github")} aria-pressed={mode === "github"} className={option("github")}>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-zk-text">Connect GitHub and fix for me</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-zk-muted">Agents open pull requests with the fixes, for you to review and merge. Best for sites that aren&apos;t critical.</span>
              </span>
            </button>
          </div>
          <p className="m-0 mt-3 flex items-center gap-1.5 text-xs text-zk-muted">
            <LockIcon /> Ziki never pushes to your main branch. You can disconnect any time.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="h-10 rounded-full border border-zk-border bg-zk-surface px-4 text-sm font-bold text-zk-text hover:bg-zk-chip">Cancel</button>
            {/* Paying and connecting aren't built yet: the button says so instead of pretending. */}
            <button type="button" disabled title="Coming soon" className="h-10 rounded-full bg-electric-blue-strong px-5 text-sm font-bold text-white opacity-60">
              Pay {price} Ziks and connect · soon
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
