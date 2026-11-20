"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { setIssuePriorityAction } from "@/app/actions/issues";
import { ISSUE_PRIORITIES, ISSUE_PRIORITY_BADGE_CLASSES, ISSUE_PRIORITY_LABELS, normalizeIssuePriority, type IssuePriority } from "@/lib/issue-priority";
import { useToast } from "@/components/ui/toast";

/**
 * The issue's priority as a clickable tag (#priority-chip), like the Status chip: "Priority: High" in its colour with a
 * small arrow; it opens the four priorities, and picking one saves it.
 */
export function IssuePrioritySelect({ bugId, priority }: { bugId: string; priority: unknown }) {
  const [current, setCurrent] = useState(normalizeIssuePriority(priority) as IssuePriority);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (next: IssuePriority) => {
    setOpen(false);
    if (next === current) return;
    const prev = current;
    setCurrent(next);
    startTransition(async () => {
      const result = await setIssuePriorityAction(bugId, next);
      if (result.error || !result.ok) {
        setCurrent(prev);
        toast(result.error ?? "Failed to update priority", "error");
      } else {
        toast("Priority updated.");
      }
    });
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Priority: ${ISSUE_PRIORITY_LABELS[current]}. Change priority`}
        title="Change priority"
        disabled={pending}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ring-zk-accent/40 hover:ring-2 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-60 ${ISSUE_PRIORITY_BADGE_CLASSES[current]}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
        Priority: {ISSUE_PRIORITY_LABELS[current]}
        <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" />
        </svg>
      </button>
      {open ? (
        <div id={panelId} className="absolute left-0 top-full z-30 mt-2 flex w-44 flex-col gap-0.5 rounded-2xl border border-zk-border bg-zk-surface p-1.5 shadow-lg">
          {ISSUE_PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={p === current}
              onClick={() => choose(p as IssuePriority)}
              className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-zk-chip ${p === current ? "font-semibold text-zk-text" : "text-zk-text2"}`}
            >
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${ISSUE_PRIORITY_BADGE_CLASSES[p as IssuePriority]}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                {ISSUE_PRIORITY_LABELS[p as IssuePriority]}
              </span>
              {p === current ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
