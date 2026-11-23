"use client";

import { useOptimistic, useState, useTransition } from "react";
import { quickIdeaVerdictAction } from "@/app/actions/idea-verdicts";
import { toggleVoteAction } from "@/app/actions/issues";
import { voteNoteCommentAction } from "@/app/(app)/[org]/[project]/notes/actions";

type Direction = "up" | "down";

/** A raised hand: an agent putting its hand up for the work (the bids' mark). */
function RaisedHandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[0.9em] w-[0.9em] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 11V6a2 2 0 0 0-4 0v5" />
      <path d="M14 10V4a2 2 0 0 0-4 0v6" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  );
}

/**
 * The one vote box on a list row, everywhere a row shows votes (the issue
 * list and the ideas list): up votes over down votes, coloured by
 * where the row stands, red when the down votes are at least the up votes.
 * When only one side has votes only that count shows,
 * larger and centred; hovering or focusing it shows both. A box that counts
 * one thing (importance, a score) has no down side at all. When the row takes
 * votes a person taps either one, with no text to write. The count changes at
 * once and pops, with a +1 floating off it; the saved counts then replace it,
 * or it goes back on an error. Touch screens have no hover, so both always show.
 */
function VoteBadge({ up, down, voted, myVote, label, positive, votable, words, act, testId, icon = "arrow", caption }: {
  up: number;
  /** Null: the box counts one thing and has no down side. */
  down: number | null;
  /** A toggle such as importance: whether the person's mark is on, so a second tap takes it off. */
  voted?: boolean;
  /**
   * One vote per person, up or down (note comments): the person's vote now.
   * Tapping it again takes it back; tapping the other side switches it.
   */
  myVote?: 1 | -1 | 0;
  /** The whole box's name for a screen reader, e.g. "2 confirms, 0 rejects; 3 needed". */
  label: (counts: { up: number; down: number; voted: boolean }) => string;
  /** Green: the row has got where its votes lead (confirmed, accepted, a bid). */
  positive: boolean;
  votable: boolean;
  /** What a tap on each side does, e.g. { up: "confirm", down: "reject" }, and what it counts. */
  words: { up: string; down: string; upCount: string; downCount: string; noun: string };
  /** `next` is the person's vote after the tap, in the one-vote mode. */
  act: (direction: Direction, next: 1 | -1 | 0) => Promise<{ error?: string }>;
  testId: { box: string; up: string; down: string };
  /** The mark beside the up count: the vote arrow, or a raised hand for bids. */
  icon?: "arrow" | "hand";
  /** A word under the count saying what it counts, e.g. "Bids". */
  caption?: string;
}) {
  const toggle = voted !== undefined;
  const oneVote = myVote !== undefined;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Which count to animate, whether it went down, and a key that restarts the animation on every tap.
  const [burst, setBurst] = useState<{ direction: Direction; minus: boolean; key: number } | null>(null);
  const [counts, addVote] = useOptimistic({ up, down: down ?? 0, voted: voted ?? false, mine: myVote ?? 0 }, (current, direction: Direction) => {
    if (oneVote) {
      const value = direction === "up" ? 1 : -1;
      // Back out the person's current vote, then add the new one unless it was the same.
      const next = { ...current, mine: current.mine === value ? 0 : value } as typeof current;
      if (current.mine === 1) next.up = Math.max(0, next.up - 1);
      if (current.mine === -1) next.down = Math.max(0, next.down - 1);
      if (next.mine === 1) next.up += 1;
      if (next.mine === -1) next.down += 1;
      return next;
    }
    return direction === "down"
      ? { ...current, down: current.down + 1 }
      : !toggle
        ? { ...current, up: current.up + 1 }
        : { ...current, up: Math.max(0, current.up + (current.voted ? -1 : 1)), voted: !current.voted };
  });

  const name = label(counts);
  const single = down === null;
  // One side with votes and the other at 0: that side alone, big, until
  // hovered; touch screens always show both.
  const onlyDown = !single && counts.up === 0 && counts.down > 0;
  const onlyUp = single || (!onlyDown && counts.down === 0);
  const both = "group-hover:inline-flex group-focus-within:inline-flex [@media(hover:none)]:inline-flex";
  const big = "inline-flex text-[15px] group-hover:text-[11.5px] group-focus-within:text-[11.5px] [@media(hover:none)]:text-[11.5px]";
  const small = "inline-flex text-[11.5px]";
  const hidden = `hidden text-[11.5px] ${both}`;

  function vote(direction: Direction) {
    setError(null);
    const value = direction === "up" ? 1 : -1;
    const next = oneVote ? (counts.mine === value ? 0 : value) : 0;
    const minus = (direction === "up" && toggle && counts.voted) || (oneVote && next === 0);
    setBurst((previous) => ({ direction, minus, key: (previous?.key ?? 0) + 1 }));
    startTransition(async () => {
      addVote(direction);
      const result = await act(direction, next);
      if (result.error) setError(result.error);
    });
  }

  const part = (direction: Direction, count: number, className: string, partTestId: string) => {
    const isUp = direction === "up";
    const animated = burst?.direction === direction;
    const content = (
      <>
        {isUp && icon === "hand" ? (
          <RaisedHandIcon />
        ) : (
          <svg aria-hidden="true" viewBox="0 0 10 10" className="h-[0.7em] w-[0.7em]" fill="currentColor"><path d={isUp ? "M5 1.5 9 8H1z" : "M5 8.5 1 2h8z"} /></svg>
        )}
        <span key={animated ? burst.key : 0} className={`inline-block ${animated ? "motion-safe:animate-[zk-vote-pop_450ms_ease-out]" : ""}`}>{count}</span>
        {animated ? (
          <span
            key={`float-${burst.key}`}
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 opacity-0 text-[12px] font-bold motion-safe:animate-[zk-vote-float_700ms_ease-out_forwards]"
          >
            {burst.minus ? "−1" : "+1"}
          </span>
        ) : null}
      </>
    );
    const color = isUp ? "text-zk-ok-fg" : "text-zk-bad-fg";
    if (!votable) return <span className={`items-center gap-0.5 ${color} ${className}`} data-testid={partTestId}>{content}</span>;
    const verb = isUp ? words.up : words.down;
    return (
      <button
        type="button"
        onClick={() => vote(direction)}
        disabled={pending}
        // The visible count is part of the name (label-content-name-mismatch).
        aria-label={`${count} ${isUp ? words.upCount : words.downCount}: ${verb} this ${words.noun}`}
        aria-pressed={oneVote ? counts.mine === (isUp ? 1 : -1) : isUp && toggle ? counts.voted : undefined}
        title={verb.charAt(0).toUpperCase() + verb.slice(1)}
        className={`relative items-center gap-0.5 rounded px-0.5 ${color} hover:bg-zk-chip focus-visible:outline-2 focus-visible:outline-electric-blue disabled:cursor-wait ${className}`}
        data-testid={partTestId}
      >
        {content}
      </button>
    );
  };

  // Red only when down votes are above 0 and at least the up votes; nothing else makes it red.
  const tone = counts.down > 0 && counts.down >= counts.up ? "bad" : positive ? "ok" : "neutral";
  const box = tone === "ok"
    ? "border-transparent bg-zk-ok-bg text-zk-ok-fg"
    : tone === "bad"
      ? "border-zk-bad-fg bg-zk-bad-bg text-zk-bad-fg"
      : "border-zk-border bg-zk-surface text-zk-text2";
  return (
    <span className="group relative inline-flex">
      <span
        data-testid={testId.box}
        data-tone={tone}
        role="group"
        aria-label={name}
        title={error ?? name}
        className={`inline-flex h-[42px] w-[42px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-control border-[1.5px] font-mono font-semibold tabular-nums leading-none ${box} ${error ? "border-zk-bad-fg" : ""}`}
      >
        {part("up", counts.up, single ? `inline-flex ${caption ? "text-[13px]" : "text-[15px]"}` : onlyDown ? hidden : onlyUp ? big : small, testId.up)}
        {single ? null : part("down", counts.down, onlyUp ? hidden : onlyDown ? big : small, testId.down)}
        {caption ? <span aria-hidden="true" className="font-sans text-[9px] font-semibold uppercase tracking-wide text-zk-muted">{caption}</span> : null}
      </span>
    </span>
  );
}

/**
 * An idea's verdicts on its row: good votes over bad, green once its score
 * reaches the threshold.
 * While it is open a tap gives a good or bad verdict (quickIdeaVerdictAction).
 */
export function IdeaVoteBadge({ ideaId, good, bad, score, threshold, votable }: {
  ideaId: string;
  good: number;
  bad: number;
  score: number;
  threshold: number | null;
  /** The idea is still open, so a tap records a verdict. */
  votable: boolean;
}) {
  const passed = threshold !== null && score >= threshold;
  return (
    <VoteBadge
      up={good}
      down={bad}
      label={({ up, down }) =>
        `${up} good, ${down} bad; idea score ${score}${threshold === null ? "" : ` of ${threshold}`}${passed ? ", idea accepted" : ""}`}
      positive={passed}
      votable={votable}
      words={{ up: "vote good on", down: "vote bad on", upCount: "good", downCount: "bad", noun: "idea" }}
      act={(direction) => quickIdeaVerdictAction(ideaId, direction === "up" ? "good" : "bad")}
      testId={{ box: "idea-score-badge", up: "idea-good-votes-badge", down: "idea-bad-votes-badge" }}
    />
  );
}

/**
 * An issue's importance (#importance): one count with no down side, green
 * once an Open issue has a bid. Importance is a toggle, so where it is
 * votable a tap marks it important and a second tap takes the mark off.
 */
export function ImportanceVoteBadge({ bugId, count, voted = false, highlighted = false, votable }: {
  bugId: string;
  count: number;
  voted?: boolean;
  /** Green: someone wants to do it (an Open issue with a bid). */
  highlighted?: boolean;
  votable: boolean;
}) {
  return (
    <VoteBadge
      up={Math.max(0, count)}
      down={null}
      voted={voted}
      label={({ up, voted: marked }) => `Importance ${up}${marked ? ", marked important by you" : ""}`}
      positive={highlighted}
      votable={votable}
      words={{ up: "mark important", down: "", upCount: "importance", downCount: "", noun: "issue" }}
      act={async () => {
        const result = await toggleVoteAction(bugId, 1);
        return { error: result.error };
      }}
      testId={{ box: "importance-count", up: "importance-up", down: "importance-down" }}
    />
  );
}

/**
 * The bids on an Open-tab row: how many open bids it has, under a raised
 * hand, green once there is one. Bids are placed on the issue page (and by
 * agents), so nothing here is tapped.
 */
export function BidsVoteBadge({ count }: { count: number }) {
  return (
    <VoteBadge
      up={count}
      down={null}
      label={({ up }) => `${up} ${up === 1 ? "bid" : "bids"}`}
      positive={count > 0}
      votable={false}
      words={{ up: "", down: "", upCount: "bids", downCount: "", noun: "issue" }}
      act={async () => ({})}
      testId={{ box: "bid-count", up: "bid-count-up", down: "bid-count-down" }}
      icon="hand"
      caption="Bids"
    />
  );
}

/**
 * A note comment's votes (#732): up over down, one vote per person. A tap
 * votes that way, a second tap takes it back, the other side switches it.
 */
export function NoteCommentVoteBadge({ projectId, commentId, upvotes, downvotes, myVote }: {
  projectId: string;
  commentId: string;
  upvotes: number;
  downvotes: number;
  myVote: 1 | -1 | 0;
}) {
  return (
    <VoteBadge
      up={upvotes}
      down={downvotes}
      myVote={myVote}
      label={({ up, down }) => `${up} up, ${down} down`}
      positive={upvotes > downvotes}
      votable
      words={{ up: "vote up", down: "vote down", upCount: "up", downCount: "down", noun: "note" }}
      act={(_direction, next) => voteNoteCommentAction(projectId, commentId, next)}
      testId={{ box: "note-vote-count", up: "note-upvotes", down: "note-downvotes" }}
    />
  );
}
