"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { createMarketingAssetAction, type MarketingAssetResult } from "@/app/(app)/[org]/marketing/actions";
import type { ProjectRef } from "@/lib/project-paths";
import { TOOL_BUTTON } from "@/lib/ui-style";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue";

/**
 * Add an asset to the picked type (#marketing-assets): the New Landing Page button opens a small form for its
 * name (About Us, Pricing), and the new one joins the list. Work is then added on it from its row.
 */
export function AddAsset({ slug, typeId, label }: { slug: ProjectRef; typeId: string; label: string }) {
  const [result, action, pending] = useActionState<MarketingAssetResult | undefined, FormData>(createMarketingAssetAction.bind(null, slug, typeId), undefined);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputId = useId();
  const errorId = useId();

  // Saved: clear the name and close the menu.
  useEffect(() => {
    if (!result?.ok) return;
    formRef.current?.reset();
    if (detailsRef.current) detailsRef.current.open = false;
  }, [result]);

  return (
    <details ref={detailsRef} className="relative">
      <summary
        className={`${TOOL_BUTTON} ${focus}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg>
        {label}
      </summary>
      <form ref={formRef} action={action} className="absolute right-0 z-20 mt-1.5 w-72 rounded-xl border border-zk-border bg-white p-3 shadow-[0_4px_16px_-4px_rgba(16,24,40,0.12)]">
        <label htmlFor={inputId} className="mb-1.5 block text-[12px] font-semibold text-zk-text2">Name</label>
        <div className="flex gap-2">
          <input
            id={inputId}
            name="name"
            required
            minLength={2}
            maxLength={80}
            autoComplete="off"
            placeholder="e.g. About Us"
            aria-invalid={result?.error ? true : undefined}
            aria-describedby={result?.error ? errorId : undefined}
            className="min-w-0 flex-1 rounded-lg border border-zk-border px-2.5 py-1.5 text-[13.5px] text-zk-text placeholder:text-zk-muted focus:border-electric-blue focus:outline-none focus:ring-2 focus:ring-electric-blue/20"
          />
          <button type="submit" disabled={pending} className={`shrink-0 rounded-lg bg-zk-text px-3 text-[13px] font-semibold text-zk-surface transition disabled:opacity-50 ${focus}`}>
            {pending ? "Adding…" : "Add"}
          </button>
        </div>
        {result?.error ? <p id={errorId} role="alert" className="m-0 mt-2 text-[12.5px] text-zk-bad-fg">{result.error}</p> : null}
      </form>
    </details>
  );
}
