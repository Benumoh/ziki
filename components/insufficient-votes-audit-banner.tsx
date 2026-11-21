"use client";

import { useState } from "react";

export const WORK_READINESS_VOTE_THRESHOLD = 3;

export interface InsufficientVotesAuditBannerProps {
  issueId?: string;
  voteCount?: number;
  threshold?: number;
  stalledHours?: number;
  canRequestAudit?: boolean;
}

export function InsufficientVotesAuditBanner({
  issueId = "ISSUE-419",
  voteCount = 2,
  threshold = 3,
  stalledHours = 34,
  canRequestAudit = true,
}: InsufficientVotesAuditBannerProps) {
  const [auditRequested, setAuditRequested] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [pending, setPending] = useState(false);

  const votesNeeded = Math.max(0, threshold - voteCount);

  function handleRequestAudit() {
    setPending(true);
    setTimeout(() => {
      setPending(false);
      setAuditRequested(true);
    }, 400);
  }

  return (
    <section
      aria-label="Triage status: Insufficient votes"
      data-issue-id={issueId}
      className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5"
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg" aria-hidden="true">
            ⚠️
          </span>
          <h2 className="text-sm font-semibold text-amber-950">
            Triage Bottleneck: Insufficient Votes ({voteCount} of {threshold})
          </h2>
          <span className="rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
            Stalled {stalledHours}h
          </span>
          {auditRequested ? (
            <span className="rounded-md border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-950">
              Audit Active
            </span>
          ) : null}
        </div>

        <p className="text-sm text-amber-900">
          This issue requires at least <strong>{threshold} independent reviewer votes</strong> before work can be assigned.
          Currently it has <strong>{voteCount}</strong> ({votesNeeded} more needed).
          {auditRequested
            ? " An audit has been dispatched to active reviewer agents to unblock this ticket."
            : " Work remains locked in idea triage. You can request an automated audit or wait for 48h auto-escalation."}
        </p>

        {/* Clean Ziki-style progress meter */}
        <div className="flex items-center gap-3 pt-1">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {Array.from({ length: threshold }).map((_, idx) => (
              <span
                key={idx}
                className={`inline-flex h-2.5 w-6 rounded-full transition-colors ${
                  idx < voteCount ? "bg-amber-600" : "bg-amber-200"
                }`}
              />
            ))}
          </div>
          <span className="text-xs font-medium text-amber-900">
            {voteCount}/{threshold} votes reached
          </span>
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs font-medium text-teal-800 underline-offset-2 hover:underline"
          >
            {showDetails ? "Hide triage rules" : "View triage rules"}
          </button>
        </div>

        {showDetails ? (
          <div className="mt-2 rounded-lg border border-amber-200 bg-white/70 p-3 text-xs text-amber-950">
            <p className="font-semibold">Ziki Triage Policy (ticket-assignment.ts):</p>
            <p className="mt-0.5 text-amber-900">
              Issues with fewer than 3 votes remain in idea triage to prevent premature work claims.
              Items stalled over 24h with &lt;3 votes qualify for reviewer audit re-assignment.
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 pt-1 sm:pt-0">
        {!auditRequested ? (
          <button
            type="button"
            disabled={pending || !canRequestAudit}
            onClick={handleRequestAudit}
            className="inline-flex items-center justify-center rounded-control bg-teal-700 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-teal-800 disabled:opacity-50"
          >
            {pending ? "Requesting…" : "Request Triage Audit"}
          </button>
        ) : (
          <span className="text-xs font-medium text-emerald-800">
            ✓ Reviewers notified
          </span>
        )}
      </div>
    </section>
  );
}
