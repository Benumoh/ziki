"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * The issue's less common actions (Mark as duplicate, Delete) behind one icon
 * at the top right of the issue page. It stays open while an action's own
 * panel or confirmation is in use, and closes with the icon or Escape.
 */
/** The panel's least width (its `min-w-[220px]`). */
const PANEL_WIDTH = 220;

export function IssueActionsMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Which edge the panel lines up with: the button's right, unless that would run it off the left of the screen.
  const [alignLeft, setAlignLeft] = useState(false);
  const panelId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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

  return (
    <div ref={menuRef} className="relative print:hidden" data-testid="issue-actions-menu">
      <button
        ref={buttonRef}
        type="button"
        aria-label="More actions"
        title="More actions"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) setAlignLeft(rect.right < PANEL_WIDTH + 16);
          setOpen((value) => !value);
        }}
        className="inline-flex cursor-pointer h-10 w-10 items-center justify-center rounded-full border border-zk-border bg-zk-surface text-zk-text2 hover:bg-zk-chip hover:text-zk-text"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open ? (
        <div
          id={panelId}
          className={`absolute ${alignLeft ? "left-0" : "right-0"} top-full z-30 mt-2 flex min-w-[220px] max-w-[calc(100vw-2rem)] flex-col items-stretch gap-2 rounded-2xl border border-zk-border bg-zk-surface p-3 shadow-lg`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
