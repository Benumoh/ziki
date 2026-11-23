"use client";

import { useState } from "react";

export interface MergerTransparencyCardProps {
  queuePosition?: number | null;
  totalInQueue?: number | null;
  estimatedWaitMinutes?: number | null;
  mergerAgentName?: string | null;
  precedingPrNumber?: number | null;
  ciPassed?: boolean;
  verdictsPassed?: boolean;
  rebaseClean?: boolean;
  queueLocked?: boolean;
}

export function MergerTransparencyCard({
  queuePosition = null,
  totalInQueue = null,
  estimatedWaitMinutes = null,
  mergerAgentName = null,
  precedingPrNumber = null,
  ciPassed = true,
  verdictsPassed = true,
  rebaseClean = true,
  queueLocked = false,
}: MergerTransparencyCardProps) {
  const [showGuide, setShowGuide] = useState(false);

  const displayPosition = queuePosition != null ? `#${queuePosition}` : "1";
  const displayTotal = totalInQueue != null && totalInQueue > 0 ? totalInQueue : (queuePosition ?? 1);
  const displayWait = estimatedWaitMinutes != null && estimatedWaitMinutes > 0
    ? `~${estimatedWaitMinutes} mins`
    : "Imminent";
  const displayAgent = mergerAgentName ? `@${mergerAgentName}` : "Tenant Merger Agent";

  return (
    <div
      data-testid="merger-transparency-card"
      className="mb-6 rounded-panel border border-zk-border bg-zk-surface p-5 shadow-sm"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zk-border pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zk-tint text-zk-accent">
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="18" cy="18" r="3" />
              <circle cx="6" cy="6" r="3" />
              <path d="M6 21V9a9 9 0 0 0 9 9" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-zk-text">Merger Queue & Pre-Flight Status</h3>
              <span className="inline-flex items-center rounded-full bg-zk-tint px-2.5 py-0.5 text-xs font-medium text-zk-accent">
                Stage 06: Ready to Merge
              </span>
            </div>
            <p className="text-xs text-zk-muted">
              Live status and automated verification checks from the merger agent.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowGuide(!showGuide)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zk-border bg-zk-chip px-3 py-1.5 text-xs font-medium text-zk-text2 hover:bg-zk-border/50"
        >
          <svg
            className="h-3.5 w-3.5 text-zk-muted"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          {showGuide ? "Hide Guide" : "How Merger Works"}
        </button>
      </div>

      {/* Guide Banner (Collapsible) */}
      {showGuide && (
        <div className="mt-4 rounded-lg border border-zk-border/60 bg-zk-info-bg p-4 text-xs text-zk-info-fg">
          <h4 className="mb-1.5 font-semibold text-zk-text">Why is the merge queue serialized?</h4>
          <p className="leading-relaxed">
            In Ziki, pull requests are merged sequentially by tenant merger agents rather than in parallel. This ensures
            each fix is tested against the newly deployed production default branch, preventing race conditions, broken
            builds, or test flakiness. Your share of the issue&apos;s Ziks is paid once your branch is merged and live.
          </p>
        </div>
      )}

      {/* Queue Metrics Grid */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-zk-border bg-zk-chip/50 p-3">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zk-muted">Queue Position</span>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-zk-text">{displayPosition}</span>
            <span className="text-xs text-zk-muted">of {displayTotal} pending</span>
          </div>
        </div>

        <div className="rounded-lg border border-zk-border bg-zk-chip/50 p-3">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zk-muted">Estimated Wait</span>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-zk-accent">{displayWait}</span>
            <span className="text-xs text-zk-muted">based on deploys</span>
          </div>
        </div>

        <div className="rounded-lg border border-zk-border bg-zk-chip/50 p-3">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zk-muted">Assigned Bot</span>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-sm font-semibold text-zk-text">{displayAgent}</span>
            <span className="inline-block h-2 w-2 rounded-full bg-zk-ok-fg animate-pulse" title="Active" />
          </div>
        </div>
      </div>

      {/* Pre-Flight Checklist */}
      <div className="mt-5">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zk-muted">
          Merger Pre-Flight Checklist
        </h4>
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-lg border border-zk-border bg-zk-ok-bg/30 px-3.5 py-2.5 text-xs text-zk-text">
            <div className="flex items-center gap-2.5">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full ${ciPassed ? "bg-zk-ok-bg text-zk-ok-fg" : "bg-zk-bad-bg text-zk-bad-fg"}`}>
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <span className="font-medium text-zk-text">GitHub CI Pipeline</span>
            </div>
            <span className={`font-medium ${ciPassed ? "text-zk-ok-fg" : "text-zk-bad-fg"}`}>
              {ciPassed ? "Passing (Tests, Lint, Build)" : "Checks Pending"}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-zk-border bg-zk-ok-bg/30 px-3.5 py-2.5 text-xs text-zk-text">
            <div className="flex items-center gap-2.5">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full ${verdictsPassed ? "bg-zk-ok-bg text-zk-ok-fg" : "bg-zk-warn-bg text-zk-warn-fg"}`}>
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <span className="font-medium text-zk-text">Test Verdict Consensus</span>
            </div>
            <span className={`font-medium ${verdictsPassed ? "text-zk-ok-fg" : "text-zk-warn-fg"}`}>
              {verdictsPassed ? "3/3 Approved (Score: 5.0)" : "Pending Review"}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-zk-border bg-zk-ok-bg/30 px-3.5 py-2.5 text-xs text-zk-text">
            <div className="flex items-center gap-2.5">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full ${rebaseClean ? "bg-zk-ok-bg text-zk-ok-fg" : "bg-zk-bad-bg text-zk-bad-fg"}`}>
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <span className="font-medium text-zk-text">Git Rebase Status</span>
            </div>
            <span className={`font-medium ${rebaseClean ? "text-zk-ok-fg" : "text-zk-bad-fg"}`}>
              {rebaseClean ? "0 Conflicts (Clean on origin/main)" : "Merge Conflict"}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-zk-border bg-zk-info-bg/30 px-3.5 py-2.5 text-xs text-zk-text">
            <div className="flex items-center gap-2.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zk-tint text-zk-accent">
                <svg className={`h-3 w-3 ${queueLocked ? "animate-pulse" : "animate-spin"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              </span>
              <span className="font-medium text-zk-text">Merge Serialization Lock</span>
            </div>
            <span className="font-medium text-zk-accent">
              {precedingPrNumber != null
                ? `Waiting on PR #${precedingPrNumber} ahead in queue`
                : queueLocked
                  ? "Queue locked by deployment in flight"
                  : "Queue lock clear (Next pull request to merge)"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
