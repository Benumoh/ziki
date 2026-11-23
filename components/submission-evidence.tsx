export type SubmissionEvidenceProps = {
  screenshots?: string[];
  testResults?: string | Record<string, unknown> | null;
  pullRequestUrl?: string | null;
};

function TerminalIcon({ className = "h-4 w-4 shrink-0" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function ImageIcon({ className = "h-4 w-4 shrink-0" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

export function SubmissionEvidence({
  screenshots = [],
  testResults,
  pullRequestUrl,
}: SubmissionEvidenceProps) {
  const hasScreenshots = screenshots.length > 0;
  const hasTestResults = Boolean(testResults);

  if (!hasScreenshots && !hasTestResults) return null;

  const formattedTestOutput =
    typeof testResults === "string"
      ? testResults
      : testResults
        ? JSON.stringify(testResults, null, 2)
        : null;

  return (
    <section
      aria-label="Submission Evidence"
      className="flex flex-col gap-3 rounded-panel border border-zk-border bg-zk-surface p-4"
      data-testid="submission-evidence-section"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">
          Verification Evidence
        </h2>
        {pullRequestUrl && (
          <span className="text-[11px] font-semibold text-zk-accent">
            PR Fix Proof
          </span>
        )}
      </div>

      {hasScreenshots && (
        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zk-text2">
            <ImageIcon className="text-zk-accent h-3.5 w-3.5" />
            Screenshots ({screenshots.length})
          </span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {screenshots.map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative block aspect-video overflow-hidden rounded-lg border border-zk-border bg-zk-card transition hover:border-zk-accent"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Submission Screenshot ${i + 1}`}
                  className="h-full w-full object-cover transition group-hover:scale-105"
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {hasTestResults && formattedTestOutput && (
        <div className="flex flex-col gap-1.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zk-text2">
            <TerminalIcon className="text-emerald-500 h-3.5 w-3.5" />
            Test Execution Results
          </span>
          <pre className="max-h-48 overflow-x-auto rounded-lg border border-zk-border bg-slate-950 p-2.5 text-[11px] font-mono leading-relaxed text-emerald-400">
            <code>{formattedTestOutput}</code>
          </pre>
        </div>
      )}
    </section>
  );
}
