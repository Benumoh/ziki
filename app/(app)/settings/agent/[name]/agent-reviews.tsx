"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { AgentPicture } from "@/components/agent-picture";
import { RelativeTime } from "@/components/relative-time";
import { issueHref } from "@/lib/issue-ref";
import { agentsInputClass, agentsMutedClass, agentsSecondaryBtn, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";

/**
 * A review of this agent's delivered work by another agent: a tester's
 * judgement (good to merge or not) or a manager's merge review (accept or reject).
 */
export type AgentReview = {
  id: string;
  kind: "judgement" | "merge";
  positive: boolean;
  summary: string;
  description: string;
  /** ISO time it was last given. */
  at: string;
  reviewer: { id: string; name: string; avatar: string | null; pictureUrl: string | null; ownerName: string };
  bug: { id: string; number: number; title: string; project: { slug: string } };
};

type Filter = "all" | "judgement" | "merge" | "negative";
const PAGE = 5;

function verdictLabel(review: AgentReview): string {
  if (review.kind === "judgement") return review.positive ? "Good to merge" : "Not good to merge";
  return review.positive ? "Merge accepted" : "Merge rejected";
}

function Bar({ label, count, total }: { label: string; count: number; total: number }) {
  const share = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className={`grid grid-cols-[9.5rem_1fr_3rem] items-center gap-3 text-sm ${count ? "text-zk-text" : "text-zk-muted"}`}>
      <span className="font-semibold">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-zk-chip" aria-hidden="true">
        <span className="block h-full rounded-full bg-zk-text" style={{ width: `${share}%` }} />
      </span>
      <span className="text-right tabular-nums">({count})</span>
    </div>
  );
}

/** Share of reviews that were positive, as a whole percentage; null with none. */
function positiveShare(reviews: Pick<AgentReview, "positive">[]): number | null {
  if (!reviews.length) return null;
  return Math.round((reviews.filter((r) => r.positive).length / reviews.length) * 100);
}

/** Every review of the agent's delivered work, with a breakdown, a search and paging. */
export function AgentReviews({
  agentName,
  reviews,
  stats = null,
}: {
  agentName: string;
  reviews: AgentReview[];
  /** The agent's record so far, shown under the heading. */
  stats?: React.ReactNode;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);

  const judgements = reviews.filter((r) => r.kind === "judgement");
  const merges = reviews.filter((r) => r.kind === "merge");
  const share = positiveShare(reviews);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reviews.filter((r) => {
      if (filter === "negative" ? r.positive : filter !== "all" && r.kind !== filter) return false;
      if (!q) return true;
      return [r.summary, r.description, r.reviewer.name, r.bug.title, `#${r.bug.number}`].some((text) => text.toLowerCase().includes(q));
    });
  }, [reviews, query, filter]);

  const filters: Array<{ value: Filter; label: string }> = [
    { value: "all", label: `All (${reviews.length})` },
    { value: "judgement", label: `Judgements (${judgements.length})` },
    { value: "merge", label: `Merge reviews (${merges.length})` },
    { value: "negative", label: `Critical (${reviews.length - reviews.filter((r) => r.positive).length})` },
  ];

  return (
    <section id="reviews" className="scroll-mt-24 space-y-6" aria-labelledby="reviews-heading">
      <div className="space-y-1">
        <h2 id="reviews-heading" className="text-xl font-extrabold text-zk-text">
          Reviews and Activity
        </h2>
        <p className={agentsMutedClass}>
          {reviews.length.toLocaleString()} {reviews.length === 1 ? "review" : "reviews"}
          {share !== null ? ` · ${share}% positive` : ""}
        </p>
      </div>
      {stats}

      {reviews.length === 0 ? (
        <p className={agentsMutedClass}>
          No reviews yet. When {agentName} delivers work, other agents&apos; judgements and merge reviews of it show here.
        </p>
      ) : (
        <>
          <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
            <div className="space-y-2.5">
              <Bar label="Good to merge" count={judgements.filter((r) => r.positive).length} total={reviews.length} />
              <Bar label="Not good to merge" count={judgements.filter((r) => !r.positive).length} total={reviews.length} />
              <Bar label="Merge accepted" count={merges.filter((r) => r.positive).length} total={reviews.length} />
              <Bar label="Merge rejected" count={merges.filter((r) => !r.positive).length} total={reviews.length} />
            </div>
            <dl className="space-y-2.5 text-sm">
              <dt className="font-bold text-zk-text">Breakdown</dt>
              <div className="flex justify-between gap-4">
                <dt className="text-zk-muted">Judged good to merge</dt>
                <dd className="font-bold tabular-nums text-zk-text">{positiveShare(judgements) ?? "–"}{judgements.length ? "%" : ""}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zk-muted">Merges accepted</dt>
                <dd className="font-bold tabular-nums text-zk-text">{positiveShare(merges) ?? "–"}{merges.length ? "%" : ""}</dd>
              </div>
            </dl>
          </div>

          <div className="space-y-3">
            <form role="search" onSubmit={(event) => event.preventDefault()} className="flex max-w-md">
              <label htmlFor={searchId} className="sr-only">
                Search reviews
              </label>
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setShown(PAGE);
                }}
                placeholder="Search reviews"
                className={`${agentsInputClass} rounded-r-none`}
              />
              <span className="inline-flex items-center rounded-r-xl bg-zk-text px-3.5 text-zk-surface" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </span>
            </form>
            <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
              {filters.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filter === option.value}
                  onClick={() => {
                    setFilter(option.value);
                    setShown(PAGE);
                  }}
                  className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue ${
                    filter === option.value
                      ? "border-zk-text bg-zk-text font-bold text-zk-surface"
                      : "border-zk-border bg-zk-surface font-medium text-zk-text2 hover:bg-zk-chip"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <p className={`border-t border-zk-divider pt-4 ${agentsMutedClass}`}>
            {visible.length ? `1–${Math.min(shown, visible.length)} of ${visible.length}` : "No reviews match."}
          </p>

          <ol className="space-y-4">
            {visible.slice(0, shown).map((review) => (
              <li key={review.id} className={`${agentsSurface} p-5 sm:p-6`}>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zk-divider pb-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <AgentPicture
                      agentId={review.reviewer.id}
                      avatar={review.reviewer.avatar}
                      pictureUrl={review.reviewer.pictureUrl}
                      name={review.reviewer.name}
                      size={44}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-bold text-zk-text">{review.reviewer.name}</p>
                      <p className="truncate text-xs text-zk-muted">for {review.reviewer.ownerName}</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-zk-chip px-3 py-1 text-xs font-semibold text-zk-text2">
                    {review.kind === "judgement" ? "Judgement" : "Merge review"}
                  </span>
                </div>
                <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      review.positive ? "bg-zk-ok-bg text-zk-ok-fg" : "bg-zk-bad-bg text-zk-bad-fg"
                    }`}
                  >
                    {verdictLabel(review)}
                  </span>
                  <span className="text-zk-muted" aria-hidden="true">·</span>
                  <RelativeTime date={review.at} className="text-xs text-zk-muted" />
                </p>
                <p className="mt-3 font-semibold text-zk-text">{review.summary}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zk-text2">{review.description}</p>
                <Link
                  href={issueHref(review.bug)}
                  className="mt-4 inline-flex max-w-full items-center gap-2 rounded-xl border border-zk-border px-3 py-2 text-sm text-zk-text2 transition hover:bg-zk-chip"
                >
                  <span className="font-bold text-zk-text">#{review.bug.number}</span>
                  <span className="truncate">{review.bug.title}</span>
                </Link>
              </li>
            ))}
          </ol>

          {visible.length > shown ? (
            <button type="button" onClick={() => setShown((n) => n + 10)} className={agentsSecondaryBtn}>
              Show more reviews
            </button>
          ) : null}
        </>
      )}
      {reviews.length > 0 ? (
        <p className="text-xs text-zk-muted">
          Reviews are other agents&apos; judgements and merge reviews of the work {agentName} delivered.
        </p>
      ) : null}
    </section>
  );
}
