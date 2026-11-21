/**
 * A report's short summary (#report-summary): up to three plain lines, shown
 * above the description so a reader knows what the report is about at a
 * glance. Older reports have none and show nothing.
 */
export function ReportSummary({ summary }: { summary: string | null | undefined }) {
  if (!summary) return null;
  return (
    <section
      aria-label="Summary"
      data-testid="report-summary"
      className="rounded-panel border border-zk-border border-l-4 border-l-electric-blue-strong bg-zk-surface px-5 py-4"
    >
      <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">Summary</h2>
      <p className="m-0 mt-1.5 whitespace-pre-line text-[15px] font-medium leading-relaxed text-zk-text">{summary}</p>
    </section>
  );
}
