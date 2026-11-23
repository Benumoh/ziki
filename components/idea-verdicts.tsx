import { EntrySummary } from "@/components/entry-summary";
import { LocalTime } from "@/components/local-time";
import { AddVerdictDialog } from "@/components/add-verdict-dialog";
import { trackRules } from "@/lib/marketing/track";
import type { WorkTrack } from "@prisma/client";


export type IdeaOpinionName = "good" | "bad" | "neutral";

export type IdeaVerdictView = {
  id: string;
  opinion: IdeaOpinionName;
  votes: number;
  summary: string;
  description: string;
  onBehalfOfUserId: string;
  by: string;
  agentName: string | null;
  updatedAt: Date | string;
};

export type IdeaVerdictsData = {
  ideaScore: number;
  ideaThreshold: number;
  votes: Record<IdeaOpinionName, number>;
  verdicts: IdeaVerdictView[];
};

/** Why the viewer can't give a verdict, or null when they can. */
export type IdeaVerdictBlock = "closed" | "deleted" | null;

const BLOCK_REASON: Record<Exclude<IdeaVerdictBlock, null>, string> = {
  closed: "This idea is no longer open (converted or rejected), so it takes no more verdicts.",
  deleted: "This idea is deleted.",
};

export const opinionLabels: Record<IdeaOpinionName, string> = { good: "Good", bad: "Bad", neutral: "Neutral" };

export const opinionChipClass: Record<IdeaOpinionName, string> = {
  good: "bg-zk-ok-bg text-zk-ok-fg",
  bad: "bg-zk-bad-bg text-zk-bad-fg",
  neutral: "bg-zk-chip text-zk-text2",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Score 2 of 3": the idea's net score against the project's threshold. */
export function ideaScoreText(score: number, threshold: number): string {
  return `Score ${score} of ${threshold}`;
}

/** Good, bad and neutral vote totals, as compact chips. */
export function IdeaVoteTotals({ votes, className = "" }: { votes: Record<IdeaOpinionName, number>; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-mono text-[13px] font-semibold tabular-nums ${className}`}>
      <span className="text-zk-ok-fg" title={`${plural(votes.good, "good vote")}`}>
        <span aria-hidden="true">▲</span>
        {votes.good}
        <span className="sr-only"> good</span>
      </span>
      <span className="text-zk-bad-fg" title={`${plural(votes.bad, "bad vote")}`}>
        <span aria-hidden="true">▼</span>
        {votes.bad}
        <span className="sr-only"> bad</span>
      </span>
      <span className="text-zk-muted" title={`${plural(votes.neutral, "neutral vote")}`}>
        <span aria-hidden="true">●</span>
        {votes.neutral}
        <span className="sr-only"> neutral</span>
      </span>
    </span>
  );
}

/**
 * The idea stage (#idea-verdicts), in the place an issue's conversation takes:
 * ideas take only verdicts. The score against the threshold, the vote totals
 * and every verdict, each with its summary and its full description behind a
 * toggle. "Add verdict" opens the form.
 */
export function IdeaVerdictsPanel({
  ideaId,
  track = "product",
  data,
  viewerId,
  block,
  summaryMaxChars,
}: {
  ideaId: string;
  track?: WorkTrack;
  data: IdeaVerdictsData;
  viewerId: string | null;
  block: IdeaVerdictBlock;
  summaryMaxChars: number;
}) {
  const reached = data.ideaScore >= data.ideaThreshold;
  const mine = viewerId ? data.verdicts.find((v) => v.onBehalfOfUserId === viewerId) ?? null : null;

  return (
    <section
      id="idea-verdicts"
      aria-labelledby="idea-verdicts-heading"
      className="scroll-mt-24 rounded-panel border border-zk-border bg-zk-surface p-5 sm:p-[22px]"
    >
      {/* Links to an issue's conversation land here on an idea. */}
      <span id="conversation" className="sr-only" aria-hidden="true" />
      <span id="comments" className="sr-only" aria-hidden="true" />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="idea-verdicts-heading" className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">
          {reached ? (
            <span data-testid="idea-passed" className="text-zk-ok-fg" title="It has passed the threshold">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.7 7.7a1 1 0 0 0-1.4-1.4L10.5 13l-1.8-1.8a1 1 0 0 0-1.4 1.4l2.5 2.5a1 1 0 0 0 1.4 0l5.5-5.4Z" clipRule="evenodd" />
              </svg>
              <span className="sr-only">Passed the threshold.</span>
            </span>
          ) : null}
          Idea verdicts
          <span className="font-mono font-normal normal-case tracking-normal">{data.verdicts.length}</span>
        </h2>
        <div className="flex items-center gap-2">
          <span
            data-testid="idea-score"
            aria-label="Idea score"
            className={`rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${reached ? "bg-zk-ok-bg text-zk-ok-fg" : "bg-zk-tint text-zk-accent"}`}
          >
            {ideaScoreText(data.ideaScore, data.ideaThreshold)}
          </span>
          {block ? null : viewerId ? (
            <AddVerdictDialog
              ideaId={ideaId}
              summaryMaxChars={summaryMaxChars}
              mine={mine ? { opinion: mine.opinion, summary: mine.summary, description: mine.description } : null}
            />
          ) : null}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-zk-text2">
        <span>
          {trackRules(track).opensAtThreshold
            ? "Good adds a vote, bad takes one away. The verdict that reaches the threshold opens it as a task."
            : reached
              ? "It has reached the threshold. Any agent can convert it to an issue."
              : "Good adds a vote, bad takes one away. Any agent can convert it at the threshold."}
        </span>
        <IdeaVoteTotals votes={data.votes} />
      </div>
      {block ? (
        <p className="mb-3 text-[13px] text-zk-muted" data-testid="idea-verdict-blocked">
          {BLOCK_REASON[block]}
        </p>
      ) : !viewerId ? (
        <p className="mb-3 text-[13px] text-zk-muted">Sign in to give a verdict.</p>
      ) : null}

      {data.verdicts.length === 0 ? (
        <p className="m-0 text-[13px] text-zk-muted">No verdicts yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {data.verdicts.map((verdict) => (
            <li key={verdict.id} id={`verdict-${verdict.id}`} className="rounded-xl border border-zk-divider px-3 py-2.5">
              <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${opinionChipClass[verdict.opinion]}`}>
                  {opinionLabels[verdict.opinion]}
                </span>
                <b className="font-semibold text-zk-text">{verdict.by}</b>
                {verdict.agentName ? <span className="text-zk-muted">via {verdict.agentName}</span> : null}
                {verdict.votes > 1 ? <span className="text-zk-muted">· {plural(verdict.votes, "vote")}</span> : null}
                <span className="whitespace-nowrap text-xs text-zk-muted">
                  · <LocalTime date={verdict.updatedAt} />
                </span>
              </p>
              <EntrySummary summary={verdict.summary} description={verdict.description} />

            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
