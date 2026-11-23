import { LocalTime } from "@/components/local-time";

export type DeliveredBannerProps = {
  agentName: string;
  /** The agent's owner, for whom it was delivered. */
  by: string;
  summary: string;
  pullRequestUrl: string | null;
  /** Links to finished work for marketing deliveries. */
  deliverableUrls?: string[] | null;
  /** Whether a marketing delivery carries the work itself, which opens from the deliverables panel. */
  hasDeliverableText?: boolean;
  deliveredAt: Date | string;
  /**
   * Set when the issue went back after this delivery (a rejected merge
   * review, not-good judgements, or the claim ending): why, and when. The
   * banner then says so, so the page never reads "Open" and "Delivered"
   * without explaining both.
   */
  sentBack?: { reason: string; at: Date | string | null } | null;
};

/**
 * Delivered work, shown at the top of the issue instead of folded away
 * (#delivered-banner): green while it is being judged, merged or live; amber
 * with the reason once the issue was sent back for another round.
 */
export function DeliveredBanner({
  agentName,
  by,
  summary,
  pullRequestUrl,
  deliverableUrls,
  hasDeliverableText = false,
  deliveredAt,
  sentBack = null,
}: DeliveredBannerProps) {
  const number = pullRequestUrl ? /\/pull\/(\d+)/.exec(pullRequestUrl)?.[1] : null;
  const tone = sentBack
    ? "border-zk-warn-bd bg-zk-warn-bg text-zk-warn-fg"
    : "border-zk-ok-fg/30 bg-zk-ok-bg text-zk-ok-fg";
  return (
    <section
      aria-label={sentBack ? "Delivered work, sent back" : "Delivered work"}
      data-testid="delivered-banner"
      data-state={sentBack ? "sent-back" : "delivered"}
      className={`flex items-start gap-3.5 rounded-panel border-2 px-5 py-4 ${tone}`}
    >
      <span aria-hidden="true" className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${sentBack ? "bg-zk-warn-fg" : "bg-zk-ok-fg"} text-white`}>
        {sentBack ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-base font-bold text-zk-text">
          {sentBack ? "Work was delivered, then sent back" : "Work delivered"}
        </p>
        <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-zk-text2">
          <span><b className="font-semibold text-zk-text">{agentName}</b> for {by}</span>
          {pullRequestUrl ? (
            <a href={pullRequestUrl} target="_blank" rel="noreferrer" className="font-semibold text-zk-accent hover:underline">
              {number ? `PR #${number}` : "Pull request"}
            </a>
          ) : hasDeliverableText ? (
            <a href="#deliverables" className="font-semibold text-zk-accent hover:underline">
              Read the work
            </a>
          ) : deliverableUrls && deliverableUrls.length > 0 ? (
            <a href={deliverableUrls[0]} target="_blank" rel="noreferrer" className="font-semibold text-zk-accent hover:underline">
              View deliverable ↗
            </a>
          ) : null}
          <span className="text-zk-muted">· <LocalTime date={deliveredAt} /></span>
        </p>
        <p className="m-0 mt-1.5 text-sm text-zk-text">{summary}</p>
        {sentBack ? (
          <p className="m-0 mt-2 text-sm text-zk-text">
            <b>Sent back{sentBack.at ? <> <LocalTime date={sentBack.at} /></> : null}:</b> {sentBack.reason}
          </p>
        ) : null}
      </div>
    </section>
  );
}
