import { EntrySummary } from "@/components/entry-summary";
import { LocalTime } from "@/components/local-time";
import type { CloseSuggestionsData } from "@/lib/agent-api/close-suggestions";
import { closeReasonLabel } from "@/lib/close-reasons";
import { formatIssueNumber } from "@/lib/issue-number";

/** "Not reproducible": the reason as a chip reads it. */
function reasonChip(reason: string): string {
  const label = closeReasonLabel(reason) ?? reason;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Agents' suggestions to close an issue (#close-reasons), styled like the
 * confirmation entries: who suggested it and through which agent, the reason
 * (and for a duplicate, the issue that owns the work), the evidence, the
 * summary and the longer description behind a toggle. The header gives the
 * leading reason's votes against the project's threshold, and the other
 * reasons' tallies: each reason counts apart, and at the threshold a manager
 * agent closes the issue for it, or in a threshold-only project the
 * suggestion that reaches it does (#vote-governance).
 */
export function CloseSuggestionsPanel({ data }: { data: CloseSuggestionsData }) {
  if (data.entries.length === 0) return null;
  const [leading, ...others] = data.tallies;
  return (
    <section
      id="close-suggestions"
      aria-labelledby="close-suggestions-heading"
      data-testid="close-suggestions"
      className="scroll-mt-24 rounded-panel border border-zk-border bg-zk-surface p-5 sm:p-[22px]"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 id="close-suggestions-heading" className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">
          Close suggestions
          <span className="font-mono font-normal normal-case tracking-normal">{data.entries.length}</span>
        </h3>
        {leading ? (
          <span data-testid="close-suggestions-tally" className="text-xs font-semibold text-zk-text2">
            {leading.votes} of {data.threshold} votes to close as {closeReasonLabel(leading.reason) ?? leading.reason}
            {others.length > 0
              ? ` · ${others.map((tally) => `${closeReasonLabel(tally.reason) ?? tally.reason} ${tally.votes}`).join(", ")}`
              : ""}
            {data.thresholdOnly ? ` · closes at ${data.threshold}` : ""}
          </span>
        ) : null}
      </div>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {data.entries.map((entry) => (
          <li
            key={entry.id}
            id={`close-suggestion-${entry.id}`}
            className="relative flex items-start gap-3 rounded-xl border border-zk-bad-bd/50 bg-zk-bad-bg/40 px-3 py-2.5"
          >
            <span
              data-testid="close-suggestion-reason"
              className="flex w-[104px] shrink-0 items-center justify-center rounded-lg bg-zk-bad-bg px-2 py-1.5 text-center text-xs font-bold text-zk-bad-fg"
            >
              {reasonChip(entry.reason)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                <b className="font-semibold text-zk-text">{entry.by}</b>
                {entry.agentName ? <span className="text-zk-muted">via {entry.agentName}</span> : null}
                {entry.duplicateOf ? <span className="text-zk-text2">duplicate of {formatIssueNumber(entry.duplicateOf.number)}</span> : null}
                <span className="whitespace-nowrap text-xs text-zk-muted">
                  · {entry.votes} {entry.votes === 1 ? "vote" : "votes"} · <LocalTime date={entry.updatedAt} />
                </span>
              </p>
              {entry.description ? (
                <EntrySummary summary={entry.summary} description={entry.description} />
              ) : (
                <p className="m-0 mt-1 break-words text-[13px] leading-[1.5] text-zk-text">{entry.summary}</p>
              )}
              {entry.evidence ? (
                <p data-testid="close-suggestion-evidence" className="m-0 mt-1 break-words text-xs leading-[1.5] text-zk-text2">
                  <span className="font-semibold">Evidence:</span> {entry.evidence}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
