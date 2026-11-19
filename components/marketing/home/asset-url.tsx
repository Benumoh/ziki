"use client";

import { useActionState, useId, useRef, useState } from "react";
import { updateMarketingAssetUrlAction, type MarketingAssetResult } from "@/app/(app)/[org]/marketing/actions";
import type { ProjectRef } from "@/lib/project-paths";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue";

/** An asset's address (#marketing-assets), right of its name: a link with an edit pencil, or "No address yet" and the pencil. */
export function AssetUrl({ slug, assetId, url }: { slug: ProjectRef; assetId: string; url: string | null }) {
  const [editing, setEditing] = useState(false);
  // Saved: the form closes; refused: it stays open with why.
  const [result, action, pending] = useActionState<MarketingAssetResult | undefined, FormData>(async (previous, form) => {
    const saved = await updateMarketingAssetUrlAction(slug, assetId, previous, form);
    if (saved.ok) setEditing(false);
    return saved;
  }, undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();

  function open() {
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  if (!editing) {
    return (
      <p className="m-0 flex min-w-0 max-w-full items-center gap-1.5 text-[13px]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-zk-muted">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className={`min-w-0 truncate text-zk-accent hover:underline ${focus}`}>{url.replace(/^https?:\/\//, "")}</a>
        ) : (
          <span className="text-zk-muted">No address yet</span>
        )}
        <button
          type="button"
          onClick={open}
          aria-label={url ? "Edit the address" : "Add its address"}
          title={url ? "Edit the address" : "Add its address"}
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zk-text2 transition hover:bg-zk-chip hover:text-zk-text ${focus}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
        </button>
      </p>
    );
  }
  return (
    <form action={action} className="flex w-full max-w-md flex-wrap items-center gap-2 sm:w-auto">
      <label htmlFor={inputId} className="sr-only">Address</label>
      <input
        id={inputId}
        name="url"
        type="url"
        inputMode="url"
        defaultValue={url ?? ""}
        ref={inputRef}
        placeholder="https://yourproduct.com/about"
        aria-invalid={result?.error ? true : undefined}
        aria-describedby={result?.error ? errorId : undefined}
        className="min-w-0 flex-1 rounded-lg border border-zk-border px-2.5 py-1.5 text-[13.5px] text-zk-text placeholder:text-zk-muted focus:border-electric-blue focus:outline-none focus:ring-2 focus:ring-electric-blue/20"
      />
      <button type="submit" disabled={pending} className={`rounded-lg bg-zk-text px-3 py-1.5 text-[13px] font-semibold text-zk-surface disabled:opacity-50 ${focus}`}>{pending ? "Saving…" : "Save"}</button>
      <button type="button" onClick={() => setEditing(false)} className={`rounded-lg px-2 py-1.5 text-[13px] font-medium text-zk-text2 hover:bg-zk-chip ${focus}`}>Cancel</button>
      {result?.error ? <p id={errorId} role="alert" className="m-0 w-full text-[12.5px] text-zk-bad-fg">{result.error}</p> : null}
    </form>
  );
}
