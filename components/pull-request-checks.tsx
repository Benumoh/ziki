import { CopyAgentInstructions } from "@/components/copy-agent-instructions";

/**
 * #pr-checks: the checks on an issue's linked pull request, in the side rail
 * under Links. Ziki never calls GitHub: an independent agent reports what it
 * saw (`POST /api/v1/issues/{id}/pull-request-status`) and the latest report is
 * what this card shows, with who reported it and when.
 *
 * The card never guesses. A check Ziki has no state for reads as `Unavailable`,
 * a report with no per-check detail shows only the summary it carries, and no
 * report at all says so instead of implying everything passed.
 */

export type PullRequestCheckRow = {
  name: string;
  status: string;
  url?: string | null;
  summary?: string | null;
};

export type PullRequestChecksReport = {
  state: string;
  /** The summary the reporter sent: passing, failing, pending or none. */
  checks: string | null;
  /** The checks by name, when the reporter sent them. */
  checkRuns: PullRequestCheckRow[] | null;
  /** False when GitHub says it conflicts with its base branch. */
  mergeable: boolean | null;
  note: string;
  /** Whole minutes since the report was filed. */
  ageMinutes: number;
  /** The agent and its owner; null when Ziki read it on GitHub itself (#github-status). */
  reportedBy: { agentName: string; name: string } | null;
};

export type PullRequestChecksProps = {
  /** The latest report on the issue's linked pull request; null when nobody reported it. */
  report: PullRequestChecksReport | null;
  /** The linked pull request, for its Checks tab on GitHub. */
  pullRequestUrl: string;
  /** Why an independent agent should look again (stale, head moved); null when the report is current. */
  refreshHint?: string | null;
  /** A brief an agent can follow to report the checks again. */
  refreshInstructions?: string;
  /** The report could not be read. */
  failed?: boolean;
};

type Tone = "ok" | "bad" | "warn" | "muted";

const TONE_STRIP: Record<Tone, string> = {
  ok: "bg-zk-ok-bg text-zk-ok-fg",
  bad: "bg-zk-bad-bg text-zk-bad-fg",
  warn: "bg-zk-warn-bg text-zk-warn-fg",
  muted: "bg-zk-chip text-zk-muted",
};

const TONE_CHIP: Record<Tone, string> = {
  ok: "bg-zk-ok-bg text-zk-ok-fg",
  bad: "bg-zk-bad-bg text-zk-bad-fg",
  warn: "bg-zk-warn-bg text-zk-warn-fg",
  muted: "bg-zk-chip text-zk-muted",
};

/**
 * What each check state is called and coloured. Any state this build does not
 * know falls back to `Unavailable`: a check we cannot read is never shown as a
 * pass (#pr-checks).
 */
const CHECK_LOOK: Record<string, { label: string; tone: Tone }> = {
  passed: { label: "Passed", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "bad" },
  pending: { label: "Running", tone: "warn" },
  skipped: { label: "Skipped", tone: "muted" },
  neutral: { label: "Neutral", tone: "muted" },
  unavailable: { label: "Unavailable", tone: "muted" },
};

function look(status: string) {
  return CHECK_LOOK[status] ?? CHECK_LOOK.unavailable;
}

function StatusIcon({ status, className }: { status: string; className: string }) {
  if (status === "passed") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m5 12 5 5L20 7" />
      </svg>
    );
  }
  if (status === "failed" || status === "cancelled") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    );
  }
  if (status === "pending") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3a9 9 0 1 0 9 9" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}

/** The GitHub Checks tab for a pull request, from its own URL. */
export function pullRequestChecksUrl(pullRequestUrl: string): string {
  return `${pullRequestUrl.replace(/\/+$/, "")}/checks`;
}

function countBy(rows: readonly PullRequestCheckRow[]) {
  // Normalize unknown statuses to unavailable before counting, so unrecognized
  // states like "timed_out" are treated as unavailable, not as passed.
  const normalized = rows.map((row) => {
    const known = ["passed", "failed", "cancelled", "pending", "skipped", "neutral", "unavailable"];
    return { ...row, status: known.includes(row.status) ? row.status : "unavailable" };
  });
  const count = (status: string) => normalized.filter((row) => row.status === status).length;
  return {
    total: rows.length,
    failed: count("failed"),
    cancelled: count("cancelled"),
    pending: count("pending"),
    unavailable: count("unavailable"),
  };
}

/** The one line at the top of the card: what needs attention, if anything. */
function summarise(rows: readonly PullRequestCheckRow[], checks: string | null): { text: string; tone: Tone } {
  if (!rows.length) {
    switch (checks) {
      case "failing":
        return { text: "The reporter says checks are failing", tone: "bad" };
      case "pending":
        return { text: "The reporter says checks are still running", tone: "warn" };
      case "none":
        return { text: "No checks are configured on this pull request", tone: "muted" };
      case "passing":
        return { text: "The reporter says all checks passed", tone: "ok" };
      default:
        return { text: "The reporter didn't say how the checks went", tone: "muted" };
    }
  }

  const { total, failed, cancelled, pending, unavailable } = countBy(rows);
  if (failed) {
    return {
      text: `${failed} of ${total} ${total === 1 ? "check" : "checks"} failed${cancelled ? `, ${cancelled} cancelled` : ""}`,
      tone: "bad",
    };
  }
  if (cancelled) {
    return { text: `${cancelled} of ${total} ${total === 1 ? "check" : "checks"} cancelled: a re-run is needed`, tone: "bad" };
  }
  if (pending) return { text: `${pending} of ${total} ${total === 1 ? "check is" : "checks are"} still running`, tone: "warn" };
  if (unavailable === total) return { text: "Checks can't be read", tone: "muted" };
  if (unavailable) return { text: `${unavailable} of ${total} ${total === 1 ? "check" : "checks"} can't be read`, tone: "warn" };
  return { text: total === 1 ? "The check passed" : `All ${total} checks passed`, tone: "ok" };
}

/**
 * The Checks card (#pr-checks). One card, same shell as every other side-rail
 * card: the summary strip first, then each check by name with a link to it on
 * GitHub, then what an agent should do next when the report has gone stale.
 */
export function PullRequestChecks({
  report,
  pullRequestUrl,
  refreshHint = null,
  refreshInstructions,
  failed = false,
}: PullRequestChecksProps) {
  const card = "flex flex-col gap-2.5 rounded-panel border border-zk-border border-l-[3px] border-l-electric-blue bg-zk-surface px-4 py-3.5";
  const heading = <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">Pull request checks</h2>;
  const checksUrl = pullRequestChecksUrl(pullRequestUrl);

  const footer = (
    <>
      <a
        href={checksUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={checksUrl}
        className="inline-flex items-center gap-1.5 self-start break-all text-xs font-medium leading-5 text-zk-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue"
      >
        <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0 text-zk-muted" />
        {report && countBy(report.checkRuns ?? []).failed ? "View failed checks on GitHub" : "View checks on GitHub"}
      </a>
      {refreshInstructions ? <CopyAgentInstructions text={refreshInstructions} /> : null}
    </>
  );

  if (failed) {
    return (
      <section aria-label="Pull request checks" data-testid="pr-checks-card" className={card}>
        {heading}
        <p role="alert" className="m-0 text-xs leading-5 text-zk-muted">
          The check status couldn&apos;t be loaded. That is not the same as passing: look at the pull
          request on GitHub before merging.
        </p>
        {footer}
      </section>
    );
  }

  if (!report) {
    return (
      <section aria-label="Pull request checks" data-testid="pr-checks-card" className={card}>
        {heading}
        <p className="m-0 text-xs leading-5 text-zk-muted">
          No check status reported yet. An agent independent of this issue checks the pull request on
          GitHub and reports what it saw.
        </p>
        {refreshHint ? <p className="m-0 text-[11px] leading-4 text-zk-muted">{refreshHint}</p> : null}
        {footer}
      </section>
    );
  }

  if (report.state === "not_found") {
    return (
      <section aria-label="Pull request checks" data-testid="pr-checks-card" className={card}>
        {heading}
        <p className="m-0 text-xs leading-5 text-zk-muted">
          The linked pull request isn&apos;t on GitHub (404), so its checks can&apos;t be read.
        </p>
        {footer}
      </section>
    );
  }

  const rows = report.checkRuns ?? [];
  const summary = summarise(rows, report.checks);
  const reported = report.ageMinutes < 60
    ? `${Math.max(1, report.ageMinutes)} min ago`
    : `${Math.floor(report.ageMinutes / 60)} h ago`;

  return (
    <section aria-label="Pull request checks" data-testid="pr-checks-card" className={card}>
      {heading}

      {/* The summary first: whether anything here needs doing. */}
      <p
        data-testid="pr-checks-summary"
        data-tone={summary.tone}
        className={`m-0 inline-flex items-start gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold leading-4 ${TONE_STRIP[summary.tone]}`}
      >
        <StatusIcon status={summary.tone === "ok" ? "passed" : summary.tone === "bad" ? "failed" : summary.tone === "warn" ? "pending" : "unavailable"} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{summary.text}</span>
      </p>

      {rows.length ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="pr-check-list">
          {rows.map((row, index) => {
            const { label, tone } = look(row.status);
            const name = (
              <>
                <StatusIcon status={row.status} className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone === "ok" ? "text-zk-ok-fg" : tone === "bad" ? "text-zk-bad-fg" : tone === "warn" ? "text-zk-warn-fg" : "text-zk-muted"}`} />
                <span className="min-w-0 break-words text-xs leading-5 text-zk-text">{row.name}</span>
              </>
            );
            return (
              <li key={`${index}-${row.name}`} data-testid="pr-check-row" data-status={row.status} className="flex min-w-0 items-start gap-2">
                {row.url ? (
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={row.url}
                    className="flex min-w-0 flex-1 items-start gap-1.5 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue"
                  >
                    {name}
                  </a>
                ) : (
                  <span className="flex min-w-0 flex-1 items-start gap-1.5">{name}</span>
                )}
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 ${TONE_CHIP[tone]}`}>
                  {label}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Failure context, when the reporter had any: one line per failed check. */}
      {rows.some((row) => row.summary && row.status !== "passed") ? (
        <ul className="m-0 flex list-none flex-col gap-1 border-t border-zk-border pt-2 text-[11px] leading-4 text-zk-muted">
          {rows
            .filter((row) => row.summary && row.status !== "passed")
            .map((row, index) => (
              <li key={`${index}-${row.name}-summary`} className="break-words">
                <span className="font-semibold text-zk-text2">{row.name}:</span> {row.summary}
              </li>
            ))}
        </ul>
      ) : null}

      {/* A conflict is not a failed check, and a green check is not an accepted fix. */}
      {report.mergeable === false ? (
        <p data-testid="pr-checks-conflict" className="m-0 text-[11px] leading-4 text-zk-warn-fg">
          This pull request also conflicts with its base branch. That is a merge conflict, not a
          failed check: the author resolves it and pushes.
        </p>
      ) : null}

      {summary.tone === "ok" && report.mergeable !== false ? (
        <p className="m-0 text-[11px] leading-4 text-zk-muted">
          Passing checks don&apos;t accept the fix on their own: Ziki&apos;s review and manager gates
          still apply.
        </p>
      ) : null}

      <p className="m-0 text-[11px] leading-4 text-zk-muted" data-testid="pr-checks-provenance">
        {report.reportedBy
          ? <>Reported {reported} by {report.reportedBy.agentName} for {report.reportedBy.name}</>
          : <>Read {reported} on GitHub by Ziki</>}
        {report.ageMinutes >= 6 * 60 ? <span className="font-semibold text-zk-warn-fg"> · may be out of date</span> : null}
      </p>

      {refreshHint ? <p className="m-0 text-[11px] leading-4 text-zk-muted">{refreshHint}</p> : null}

      {footer}
    </section>
  );
}
