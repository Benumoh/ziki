"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  mergePullRequestAction,
  refreshGitHubStatusAction,
  rerunFailedChecksAction,
  sendBackToFixerAction,
  updatePullRequestBranchAction,
  type GitHubActionResult,
} from "@/app/actions/github-status";
import type { Blocker, Diagnosis } from "@/lib/github/merge-blockers";
import type { PullRequestSnapshot, SnapshotCheck } from "@/lib/github/snapshot-types";
import type { GitHubStatusPowers } from "@/lib/github/status-access";

export type GitHubStatusPanelProps = {
  bugId: string;
  pullRequestUrl: string;
  /** The issue's main status: decides whether merge and send back are offered. */
  issueStatus: string;
  status: { snapshot: PullRequestSnapshot; diagnosis: Diagnosis; checkedAt: string } | null;
  powers: GitHubStatusPowers;
  /** An agent's report newer than Ziki's read, when there is one. */
  newerAgentReport: { agentName: string; note: string; at: string } | null;
};

/** Read again on open when Ziki's last read is older than this. */
const STALE_MS = 60_000;

const BUTTON = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-zk-border bg-zk-surface px-3 text-[13px] font-semibold text-zk-text hover:bg-zk-chip disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent";
const PRIMARY = "inline-flex h-8 items-center gap-1.5 rounded-lg bg-zk-ok-fg px-3 text-[13px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent";
const WARN = "inline-flex h-8 items-center gap-1.5 rounded-lg bg-zk-warn-fg px-3 text-[13px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent";

const VERDICT_TONE: Record<Diagnosis["verdict"], string> = {
  ready: "border-zk-ok-fg/30 bg-zk-ok-bg text-zk-ok-fg",
  merged: "border-zk-ok-fg/30 bg-zk-ok-bg text-zk-ok-fg",
  blocked: "border-zk-bad-bd bg-zk-bad-bg text-zk-bad-fg",
  closed: "border-zk-bad-bd bg-zk-bad-bg text-zk-bad-fg",
  not_found: "border-zk-bad-bd bg-zk-bad-bg text-zk-bad-fg",
  waiting: "border-zk-warn-bd bg-zk-warn-bg text-zk-warn-fg",
};

const LEVEL_DOT: Record<Blocker["level"], string> = {
  blocking: "bg-zk-bad-fg",
  waiting: "bg-zk-warn-fg",
  warning: "bg-zk-info-fg",
};

const WHO: Record<Blocker["who"], string> = { fixer: "Fixer", reviewer: "Reviewer", merger: "Merger" };

const CHECK_DOT: Record<SnapshotCheck["status"], string> = {
  failing: "bg-zk-bad-fg",
  pending: "bg-zk-warn-fg animate-pulse",
  passing: "bg-zk-ok-fg",
  skipped: "bg-zk-muted",
};

function ago(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function stateChip(snapshot: PullRequestSnapshot) {
  if (snapshot.state === "merged") return { label: "Merged", tone: "bg-zk-ok-bg text-zk-ok-fg" };
  if (snapshot.state === "closed") return { label: "Closed", tone: "bg-zk-bad-bg text-zk-bad-fg" };
  if (snapshot.state === "not_found") return { label: "Not found", tone: "bg-zk-bad-bg text-zk-bad-fg" };
  if (snapshot.draft) return { label: "Draft", tone: "bg-zk-chip text-zk-text2" };
  return { label: "Open", tone: "bg-zk-info-bg text-zk-info-fg" };
}

/**
 * An issue's pull request as GitHub sees it (#github-status): whether it can
 * merge, everything in the way and who has to act on each, its checks and
 * reviews, and the buttons that act on it from Ziki.
 */
export function GitHubStatusPanel({ bugId, pullRequestUrl, issueStatus, status, powers, newerAgentReport }: GitHubStatusPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const autoRead = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const run = (key: string, action: () => Promise<GitHubActionResult>) => {
    setBusy(key);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setBusy(null);
      setMessage(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
      router.refresh();
    });
  };

  // Opening the issue reads GitHub again when Ziki's read is old.
  useEffect(() => {
    if (autoRead.current || !powers.refresh) return;
    const stale = !status || Date.now() - Date.parse(status.checkedAt) > STALE_MS;
    if (!stale) return;
    autoRead.current = true;
    startTransition(async () => {
      await refreshGitHubStatusAction(bugId);
      router.refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bugId]);

  const snapshot = status?.snapshot;
  const diagnosis = status?.diagnosis;
  const number = /\/pull\/(\d+)/.exec(pullRequestUrl)?.[1];
  const canSendBack = powers.act && (issueStatus === "done" || issueStatus === "merge");
  const chip = snapshot ? stateChip(snapshot) : null;

  return (
    <section aria-label="GitHub status" data-testid="github-status" data-verdict={diagnosis?.verdict ?? "unknown"} className="flex flex-col gap-3 rounded-panel border border-zk-border bg-zk-surface p-5 sm:p-[22px]">
      <header className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-zk-text">
          <GitHubMark /> GitHub
        </span>
        <a href={pullRequestUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-zk-accent hover:underline">
          {number ? `PR #${number}` : "Pull request"}
        </a>
        {chip ? <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${chip.tone}`}>{chip.label}</span> : null}
        {snapshot?.headRef && snapshot.baseRef ? (
          <span className="truncate font-mono text-xs text-zk-muted" title={`${snapshot.headRepo ?? ""}:${snapshot.headRef} → ${snapshot.baseRef}`}>
            {snapshot.headRef} → {snapshot.baseRef}
            {snapshot.headSha ? ` @ ${snapshot.headSha.slice(0, 7)}` : ""}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-2 text-xs text-zk-muted">
          {status ? <span>Checked {ago(status.checkedAt, now)}</span> : null}
          {powers.refresh ? (
            <button type="button" className={BUTTON} disabled={pending} onClick={() => run("refresh", () => refreshGitHubStatusAction(bugId))} aria-label="Check GitHub again">
              <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${busy === "refresh" ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
              {busy === "refresh" ? "Checking…" : "Check GitHub"}
            </button>
          ) : null}
        </span>
      </header>

      {!status ? (
        <p className="m-0 rounded-xl border border-dashed border-zk-border px-4 py-3 text-sm text-zk-text2">
          {pending ? "Reading the pull request on GitHub…" : "Ziki hasn't read this pull request on GitHub yet."}
        </p>
      ) : (
        <>
          <p role="status" className={`m-0 rounded-xl border px-4 py-3 text-sm font-semibold ${VERDICT_TONE[diagnosis!.verdict]}`}>
            {diagnosis!.headline}
          </p>

          {diagnosis!.blockers.length > 0 ? (
            <ul aria-label="What's in the way" className="m-0 flex list-none flex-col gap-2 p-0">
              {diagnosis!.blockers.map((blocker) => (
                <li key={blocker.id} data-kind={blocker.kind} className="flex gap-3 rounded-xl border border-zk-border bg-zk-bg px-3.5 py-3">
                  <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[blocker.level]}`} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 flex flex-wrap items-center gap-2 text-sm font-semibold text-zk-text">
                      {blocker.title}
                      <span className="rounded-full bg-zk-chip px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-zk-text2">{WHO[blocker.who]}</span>
                    </p>
                    <p className="m-0 mt-0.5 whitespace-pre-line break-words text-[13px] text-zk-text2">{blocker.detail}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden">
                      {blocker.links.map((link) => (
                        <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="text-[13px] font-semibold text-zk-accent hover:underline">
                          {link.label} ↗
                        </a>
                      ))}
                      {powers.act && blocker.actions.includes("update_branch") ? (
                        <button type="button" className={BUTTON} disabled={pending} onClick={() => run("update", () => updatePullRequestBranchAction(bugId))}>
                          {busy === "update" ? "Updating…" : "Update branch"}
                        </button>
                      ) : null}
                      {powers.act && blocker.actions.includes("rerun_checks") ? (
                        <button type="button" className={BUTTON} disabled={pending} onClick={() => run("rerun", () => rerunFailedChecksAction(bugId))}>
                          {busy === "rerun" ? "Starting…" : "Re-run failed checks"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {snapshot!.checks.length > 0 || snapshot!.reviews.length > 0 ? (
            <details className="group rounded-xl border border-zk-border px-3.5 py-2.5">
              <summary className="cursor-pointer list-none text-[13px] font-semibold text-zk-text2 marker:hidden">
                <span className="inline-block transition-transform group-open:rotate-90">›</span>{" "}
                {snapshot!.checks.length} {snapshot!.checks.length === 1 ? "check" : "checks"}
                {snapshot!.checks.length ? ` (${summaryCounts(snapshot!.checks)})` : ""}
                {snapshot!.reviews.length ? ` · ${snapshot!.reviews.length} ${snapshot!.reviews.length === 1 ? "review" : "reviews"}` : ""}
              </summary>
              <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
                {snapshot!.checks.map((check) => (
                  <li key={`${check.kind}:${check.name}`} className="flex items-center gap-2 text-[13px]">
                    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${CHECK_DOT[check.status]}`} />
                    <span className="sr-only">{check.status}: </span>
                    {check.url ? (
                      <a href={check.url} target="_blank" rel="noreferrer" className="truncate text-zk-text hover:underline">{check.name}</a>
                    ) : (
                      <span className="truncate text-zk-text">{check.name}</span>
                    )}
                    <span className="ml-auto shrink-0 text-xs text-zk-muted">{(check.conclusion ?? check.status).replace(/_/g, " ")}</span>
                  </li>
                ))}
                {snapshot!.reviews.map((review) => (
                  <li key={`review:${review.login}`} className="flex items-center gap-2 text-[13px]">
                    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${review.state === "APPROVED" ? "bg-zk-ok-fg" : review.state === "CHANGES_REQUESTED" ? "bg-zk-bad-fg" : "bg-zk-muted"}`} />
                    <a href={review.url} target="_blank" rel="noreferrer" className="truncate text-zk-text hover:underline">{review.login}</a>
                    <span className="ml-auto shrink-0 text-xs text-zk-muted">{review.state.toLowerCase().replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {newerAgentReport ? (
            <p className="m-0 text-xs text-zk-muted">
              Newer report from {newerAgentReport.agentName} ({ago(newerAgentReport.at, now)}): {newerAgentReport.note}
            </p>
          ) : null}

          {(canSendBack && diagnosis!.verdict !== "ready" && diagnosis!.verdict !== "merged") || (powers.merge && issueStatus === "merge" && diagnosis!.canMerge) ? (
            <footer className="flex flex-wrap items-center gap-2 border-t border-zk-divider pt-3">
              {powers.merge && issueStatus === "merge" && diagnosis!.canMerge ? (
                <MergeButton disabled={pending} busy={busy === "merge"} onConfirm={() => run("merge", () => mergePullRequestAction(bugId))} baseRef={snapshot!.baseRef} />
              ) : null}
              {canSendBack && diagnosis!.verdict !== "ready" && diagnosis!.verdict !== "merged" ? (
                <SendBackButton
                  draft={diagnosis!.sendBackNote ?? `GitHub can't merge pull request #${snapshot!.number} yet: ${diagnosis!.headline}`}
                  disabled={pending}
                  onSend={(text) =>
                    new Promise<GitHubActionResult>((resolve) => {
                      setBusy("send");
                      startTransition(async () => {
                        const result = await sendBackToFixerAction(bugId, text);
                        setBusy(null);
                        setMessage(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
                        resolve(result);
                        router.refresh();
                      });
                    })
                  }
                />
              ) : null}
            </footer>
          ) : null}
        </>
      )}

      {message ? (
        <p role={message.ok ? "status" : "alert"} className={`m-0 text-[13px] font-semibold ${message.ok ? "text-zk-ok-fg" : "text-zk-bad-fg"}`}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}

function summaryCounts(checks: readonly SnapshotCheck[]): string {
  const count = (status: SnapshotCheck["status"]) => checks.filter((check) => check.status === status).length;
  return [
    count("failing") ? `${count("failing")} failing` : null,
    count("pending") ? `${count("pending")} running` : null,
    count("passing") ? `${count("passing")} passing` : null,
  ].filter(Boolean).join(", ");
}

function MergeButton({ onConfirm, disabled, busy, baseRef }: { onConfirm: () => void; disabled: boolean; busy: boolean; baseRef: string | null }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={PRIMARY} disabled={disabled} onClick={() => setAsking(true)}>
        {busy ? "Merging…" : "Merge on GitHub"}
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-[13px] text-zk-text">
      Merge into <b>{baseRef ?? "the base branch"}</b>?
      <button type="button" className={PRIMARY} disabled={disabled} onClick={() => { setAsking(false); onConfirm(); }}>Yes, merge</button>
      <button type="button" className={BUTTON} onClick={() => setAsking(false)}>Cancel</button>
    </span>
  );
}

function SendBackButton({ draft, disabled, onSend }: { draft: string; disabled: boolean; onSend: (text: string) => Promise<GitHubActionResult> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const open = () => {
    setText(draft);
    setError(null);
    dialogRef.current?.showModal();
  };
  const send = async () => {
    setSending(true);
    setError(null);
    const result = await onSend(text);
    setSending(false);
    if (result.ok) dialogRef.current?.close();
    else setError(result.error);
  };

  return (
    <>
      <button type="button" className={WARN} disabled={disabled} onClick={open}>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
        Send back to fixer
      </button>
      <dialog
        ref={dialogRef}
        aria-label="Send back to fixer"
        className="m-auto w-[min(36rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-zk-border bg-zk-surface p-0 text-zk-text shadow-[0_24px_56px_rgba(11,23,51,0.22)] backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-3 p-5 sm:p-6">
          <h2 className="m-0 text-base font-bold">Send back to the fixer</h2>
          <p className="m-0 text-sm text-zk-text2">
            The issue goes back to In progress. This note goes on the issue and to the person the fix is for, so their agent knows what GitHub needs.
          </p>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            What the fixer has to change
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={9}
              maxLength={4000}
              className="w-full rounded-xl border border-zk-border bg-zk-bg px-3 py-2 font-mono text-[13px] font-normal text-zk-text focus-visible:outline-2 focus-visible:outline-zk-accent"
            />
          </label>
          {error ? <p role="alert" className="m-0 text-[13px] font-semibold text-zk-bad-fg">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className={BUTTON} onClick={() => dialogRef.current?.close()}>Cancel</button>
            <button type="button" className={WARN} disabled={sending || text.trim().length < 10} onClick={send}>
              {sending ? "Sending…" : "Send back"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
