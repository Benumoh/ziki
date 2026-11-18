"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CheckPhase } from "@/components/security-checks/check-activity";
import { codeScanCost, startPaidCodeScan } from "@/app/actions/security-code-scan";
import { borrowZiks } from "@/app/actions/ziks-loan";
import { buyZiksHref } from "@/lib/coins/return-to";
import type { CodeProject } from "@/lib/security-checks/code-scan";

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
  checkId,
  codeScan = null,
  codeStep = true,
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
  /** This website scan, for Connect code (#security-code-scan). */
  checkId?: string;
  /** Its code scan once paid for: the step shows where it stands and opens it. */
  codeScan?: { checkId: string; finished: boolean; found: number } | null;
  /** False on a code scan's own page (a repo): it is the code scan, so there's no code to connect. */
  codeStep?: boolean;
}) {
  const deepDone = phase === "done";
  const deepState =
    phase === "planning" ? "Planning" : phase === "stopped" ? "Stopped" : deepDone ? `Done · ${deepFound} found` : phase === "writing" ? "Writing the report" : `Agents checking · ${done} of ${total}`;
  return (
    <ol aria-label="Steps of this security check" className="mt-0 flex list-none flex-col gap-1.5 p-0 sm:flex-row sm:flex-wrap sm:items-center sm:gap-0">
      <Step state="done" name="Quick scan" detail={quickFound === null ? "Not run" : `Done · ${quickFound} found`} jumpTo="quick-scan-results" />
      <Joint done />
      {paymentRequired ? (
        <li className="flex">
          <span className="inline-flex h-9 w-full items-center gap-2 rounded-[10px] border border-zk-border bg-zk-surface px-3 text-[13px] font-semibold text-zk-text sm:w-auto">
            <LockIcon />
            {/* Its name jumps to the Deeper scan section (18 Nov); Start opens the checkout. */}
            <button type="button" onClick={() => jumpTo("deeper-scan-results")} className="rounded hover:underline focus-visible:outline-2 focus-visible:outline-zk-accent">
              Deeper scan
            </button>
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
        <Step state={deepDone ? "done" : phase === "stopped" ? "locked" : "now"} name="Deeper scan" detail={deepState} jumpTo="deeper-scan-results" />
      )}
      {codeStep ? <Joint done={deepDone} /> : null}
      {!codeStep ? null : codeScan ? (
        // Paid for (#security-code-scan): the code scan is its own scan; the step says where it stands and opens it.
        <li className="flex">
          <Link
            href={`/security/checks/${encodeURIComponent(codeScan.checkId)}`}
            className="inline-flex h-9 w-full items-center gap-2 rounded-[10px] border border-zk-border bg-zk-surface px-3 text-[13px] font-semibold text-zk-text hover:bg-zk-chip sm:w-auto"
          >
            {codeScan.finished ? (
              <span aria-hidden="true" className="grid h-4 w-4 place-items-center rounded-full bg-green-600 text-white">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              </span>
            ) : (
              <span aria-hidden="true" className="h-4 w-4 rounded-full border-2 border-electric-blue-strong border-r-zk-tint motion-safe:animate-spin" />
            )}
            Code scan
            <span className={`text-xs ${codeScan.finished ? "font-medium text-zk-muted" : "font-semibold text-zk-accent"}`}>
              {codeScan.finished ? `Done · ${codeScan.found} found` : "Agents reading the code"}
            </span>
            <span aria-hidden="true" className="ml-auto text-zk-muted sm:ml-1">&rarr;</span>
          </Link>
        </li>
      ) : (
        <li className="flex">
          <span className="inline-flex h-9 w-full items-center gap-2 rounded-[10px] border border-zk-border bg-zk-surface px-3 text-[13px] font-semibold text-zk-muted sm:w-auto">
            <LockIcon />
            Code scan
            <ConnectCode site={site} price={codePrice} checkId={checkId} />
          </span>
        </li>
      )}
    </ol>
  );
}

/**
 * Clicking a step takes you to its section further down the page (18 Nov, Seyi): it opens the section if it was
 * folded and scrolls to it. The quick scan's own section, or the list it sits in when there's no section of its own.
 */
function jumpTo(id: string) {
  const section = document.getElementById(id) ?? document.getElementById("check-results");
  if (section instanceof HTMLDetailsElement) section.open = true;
  section?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Step({ state, name, detail, jumpTo: target }: { state: "done" | "now" | "locked"; name: string; detail: string; jumpTo?: string }) {
  const chip = "inline-flex h-9 w-full items-center gap-2 rounded-[10px] border border-zk-border bg-zk-surface px-3 text-[13px] font-semibold text-zk-text sm:w-auto";
  const Box = target ? "button" : "span";
  return (
    <li className="flex">
      <Box
        {...(target ? { type: "button" as const, onClick: () => jumpTo(target), title: `Go to ${name}` } : {})}
        className={target ? `${chip} cursor-pointer text-left hover:bg-zk-chip focus-visible:outline-2 focus-visible:outline-zk-accent` : chip}
      >
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
      </Box>
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

/**
 * "Connect code": a pop-up with the two ways to connect, and what the code scan costs (Mark, 16 Nov: read-only, or
 * GitHub). Chloe's design; paying works since #security-code-scan (18 Nov): opening it reads the price, the wallet and
 * the projects with GitHub (charges nothing); only the Pay button pays, then the code scan's page opens.
 * - Read-only: a public GitHub repo's link. Agents read the code without signing in.
 * - Connect GitHub and fix for me: a project with GitHub connected. Its repo is scanned and the findings go to it,
 *   where agents fix them in pull requests.
 */
function ConnectCode({ site, price, checkId }: { site: string; price: number; checkId?: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<"read" | "github">("read");
  const [repo, setRepo] = useState("");
  const [projectId, setProjectId] = useState("");
  const [wallet, setWallet] = useState<{ balance: number; canBorrow: boolean; projects: CodeProject[] } | null>(null);
  const [short, setShort] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [paying, startPaying] = useTransition();
  const option = (value: "read" | "github") =>
    `flex w-full gap-3 rounded-xl border p-3.5 text-left ${mode === value ? "border-electric-blue-strong ring-2 ring-electric-blue-strong/15" : "border-zk-border hover:bg-zk-chip/50"}`;

  function open() {
    setError(null);
    setShort(false);
    dialog.current?.showModal();
    if (!checkId) return;
    startLoading(async () => {
      const quote = await codeScanCost(checkId).catch(() => null);
      if (!quote) {
        setError("Ziki couldn't load the price just now. Try again.");
        return;
      }
      if (!quote.ok) {
        // Already being scanned (another tab): show it.
        if (quote.reason === "already_started" && quote.checkId) router.push(`/security/checks/${encodeURIComponent(quote.checkId)}`);
        else setError(quote.error);
        return;
      }
      setWallet({ balance: quote.balance, canBorrow: quote.canBorrow, projects: quote.projects });
      setProjectId((current) => current || quote.projects[0]?.id || "");
      // Short only when certain: never borrowed (so no overdraft yet) and the wallet below the price.
      setShort(quote.canBorrow && quote.balance < price);
    });
  }

  function pay(borrow: boolean) {
    if (!checkId) return;
    startPaying(async () => {
      setError(null);
      if (borrow) {
        const loan = await borrowZiks();
        if (loan.error) {
          setError(loan.error);
          return;
        }
      }
      const source = mode === "read" ? { kind: "link" as const, repo } : { kind: "project" as const, projectId };
      let outcome;
      try {
        outcome = await startPaidCodeScan(checkId, source);
      } catch {
        // It may have gone through before the connection dropped: read the page again rather than paying twice.
        dialog.current?.close();
        router.refresh();
        return;
      }
      if (outcome.ok) {
        dialog.current?.close();
        router.push(`/security/checks/${encodeURIComponent(outcome.checkId)}`);
        return;
      }
      if (outcome.reason === "already_started" && outcome.checkId) {
        router.push(`/security/checks/${encodeURIComponent(outcome.checkId)}`);
        return;
      }
      if (outcome.reason === "insufficient_ziks") {
        const { balance, canBorrow } = outcome;
        setWallet((current) => (current ? { ...current, balance, canBorrow } : current));
        setShort(true);
        setError(canBorrow ? null : `${outcome.error} Buy Ziks, then come back and connect.`);
        return;
      }
      setError(outcome.error);
    });
  }

  const projects = wallet?.projects ?? [];
  const ready = mode === "read" ? repo.trim().length > 0 : projectId !== "";
  const borrow = short && Boolean(wallet?.canBorrow);
  const primary = "h-10 rounded-full bg-electric-blue-strong px-5 text-sm font-bold text-white hover:brightness-105 disabled:opacity-60";

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
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
            <button aria-label="Close" disabled={paying} className="grid h-8 w-8 place-items-center rounded-full text-zk-muted hover:bg-zk-chip">
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
                value={repo}
                onChange={(event) => setRepo(event.target.value)}
                className="h-10 rounded-[10px] border border-zk-border bg-zk-surface px-3 text-sm text-zk-text placeholder:text-zk-muted focus:border-electric-blue-strong/60 focus:outline-none"
              />
            ) : null}
            <button type="button" onClick={() => setMode("github")} aria-pressed={mode === "github"} className={option("github")}>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-zk-text">Connect GitHub and fix for me</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-zk-muted">Agents open pull requests with the fixes, for you to review and merge. Best for sites that aren&apos;t critical.</span>
              </span>
            </button>
            {mode === "github" ? (
              loading ? (
                <p className="m-0 text-xs text-zk-muted">Finding your projects…</p>
              ) : projects.length ? (
                <select
                  aria-label="The project this code belongs to"
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  className="h-10 rounded-[10px] border border-zk-border bg-zk-surface px-3 text-sm text-zk-text focus:border-electric-blue-strong/60 focus:outline-none"
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name} · {project.repo}</option>
                  ))}
                </select>
              ) : (
                <p className="m-0 rounded-[10px] bg-zk-chip px-3 py-2 text-xs leading-relaxed text-zk-text2">
                  None of your projects has GitHub connected yet. Connect GitHub in a project&apos;s settings, then come back here.
                </p>
              )
            ) : null}
          </div>
          <p className="m-0 mt-3 flex items-center gap-1.5 text-xs text-zk-muted">
            <LockIcon /> Ziki never pushes to your main branch. You can disconnect any time.
          </p>
          {wallet ? (
            <p className="m-0 mt-3 text-xs text-zk-text2">
              You have <b className="text-zk-text">{wallet.balance} Ziks</b>.
              {borrow ? " Not enough: you can borrow 20 once, and your first top-up pays it back." : ""}
            </p>
          ) : null}
          {error ? <p role="alert" className="m-0 mt-3 rounded-[10px] bg-zk-bad-bg px-3 py-2 text-sm text-zk-bad-fg">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button disabled={paying} className="h-10 rounded-full border border-zk-border bg-zk-surface px-4 text-sm font-bold text-zk-text hover:bg-zk-chip">Cancel</button>
            {short && !wallet?.canBorrow && checkId ? (
              <Link href={buyZiksHref(checkId)} className={`${primary} inline-flex items-center`}>Buy Ziks</Link>
            ) : (
              <button type="button" onClick={() => pay(borrow)} disabled={!checkId || !ready || loading || paying} className={primary}>
                {paying ? "Connecting…" : borrow ? `Borrow and pay ${price} Ziks` : `Pay ${price} Ziks and connect`}
              </button>
            )}
          </div>
        </form>
      </dialog>
    </>
  );
}
