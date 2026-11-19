"use client";

import { useActionState, useId, useRef, useState } from "react";
import { rateMarketingAssetAction, type MarketingAssetResult } from "@/app/(app)/[org]/marketing/actions";
import { LocalTime } from "@/components/local-time";
import type { ProjectRef } from "@/lib/project-paths";
import { ScoreBar } from "./score-bar";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue";
const field = "rounded-lg border border-zk-border px-2.5 py-1.5 text-[13.5px] text-zk-text placeholder:text-zk-muted focus:border-electric-blue focus:outline-none focus:ring-2 focus:ring-electric-blue/20";

/**
 * How good the asset is now (#asset-score) on its page: the bar, why, and when it was rated, with a pencil to rate
 * it again (a score 0-100 and a sentence on why). Agents rate it the same way through the API.
 */
export function AssetScore({ slug, assetId, score, note, scoredAt }: { slug: ProjectRef; assetId: string; score: number | null; note: string | null; scoredAt: Date | null }) {
  const [editing, setEditing] = useState(false);
  // Saved: the form closes; refused: it stays open with why.
  const [result, action, pending] = useActionState<MarketingAssetResult | undefined, FormData>(async (previous, form) => {
    const saved = await rateMarketingAssetAction(slug, assetId, previous, form);
    if (saved.ok) setEditing(false);
    return saved;
  }, undefined);
  const scoreRef = useRef<HTMLInputElement>(null);
  const scoreId = useId();
  const noteId = useId();
  const errorId = useId();

  function open() {
    setEditing(true);
    requestAnimationFrame(() => scoreRef.current?.focus());
  }

  if (editing) {
    return (
      <form action={action} className="flex flex-wrap items-end gap-2 rounded-xl border border-zk-border bg-zk-bg p-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={scoreId} className="text-[12px] font-semibold text-zk-text2">Score (0-100)</label>
          <input id={scoreId} name="score" type="number" min={0} max={100} step={1} inputMode="numeric" defaultValue={score ?? ""} ref={scoreRef} className={`w-24 ${field}`} />
        </div>
        <div className="flex min-w-[200px] flex-1 flex-col gap-1">
          <label htmlFor={noteId} className="text-[12px] font-semibold text-zk-text2">Why</label>
          <input id={noteId} name="scoreNote" maxLength={300} defaultValue={note ?? ""} placeholder="e.g. Clear headline, but no proof or call to action" className={field} />
        </div>
        <button type="submit" disabled={pending} className={`rounded-lg bg-zk-text px-3 py-1.5 text-[13px] font-semibold text-zk-surface disabled:opacity-50 ${focus}`}>{pending ? "Saving…" : "Save"}</button>
        <button type="button" onClick={() => setEditing(false)} className={`rounded-lg px-2 py-1.5 text-[13px] font-medium text-zk-text2 hover:bg-zk-chip ${focus}`}>Cancel</button>
        {result?.error ? <p id={errorId} role="alert" className="m-0 w-full text-[12.5px] text-zk-bad-fg">{result.error}</p> : null}
      </form>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-[12.5px] font-semibold text-zk-text2">How good it is</span>
      <ScoreBar score={score} note={note} className="max-w-[220px] flex-1" />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-zk-muted">
        {score === null ? "Not rated yet" : <>{note ? `${note} · ` : ""}<LocalTime date={scoredAt ?? new Date()} /></>}
      </span>
      <button
        type="button"
        onClick={open}
        aria-label={score === null ? "Rate it" : "Rate it again"}
        title={score === null ? "Rate it" : "Rate it again"}
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zk-text2 transition hover:bg-zk-chip hover:text-zk-text ${focus}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
      </button>
    </div>
  );
}
