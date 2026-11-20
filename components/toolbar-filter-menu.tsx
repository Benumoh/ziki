"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TOOL_BUTTON, TOOL_BUTTON_ON } from "@/lib/ui-style";

export type ToolbarFilterOption = { label: string; count?: number; href: string; selected: boolean };
export type ToolbarFilterGroup = { label?: string; options: ToolbarFilterOption[] };

/**
 * The issue list's filter, beside the search in the toolbar: a standard Filter
 * button that opens a menu. Each option is a link, so the list filters on the
 * server. The button names what is on, so the active filter shows while closed.
 */
export function ToolbarFilterMenu({ groups, summary }: {
  groups: ToolbarFilterGroup[];
  /** What is on, e.g. "My Work"; empty when nothing beyond the default is. */
  summary?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) setPosition({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
          setOpen(!open);
        }}
        className={`${TOOL_BUTTON} ${summary ? TOOL_BUTTON_ON : ""} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue`}
      >
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
        {summary ? `Filter: ${summary}` : "Filter"}
        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && position ? (
        <div
          ref={menuRef}
          role="menu"
          style={{ position: "fixed", top: position.top, right: position.right }}
          className="z-50 min-w-52 rounded-xl border border-zk-border bg-zk-surface py-1.5 text-left shadow-[0_16px_40px_rgba(11,23,51,0.18)]"
        >
          {groups.map((group, index) => (
            <div key={group.label ?? index} className={index > 0 ? "mt-1 border-t border-zk-divider pt-1" : ""}>
              {group.label ? <p className="m-0 px-3 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-zk-muted">{group.label}</p> : null}
              {group.options.map((option) => (
                <Link
                  key={option.href}
                  href={option.href}
                  role="menuitemcheckbox"
                  aria-checked={option.selected}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-zk-text hover:bg-zk-chip"
                >
                  <span className="flex w-4 justify-center text-zk-accent" aria-hidden="true">
                    {option.selected ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                    ) : null}
                  </span>
                  <span className={`flex-1 ${option.selected ? "font-semibold" : ""}`}>{option.label}</span>
                  {option.count === undefined ? null : <span className="font-mono text-[11px] tabular-nums text-zk-muted">{option.count}</span>}
                </Link>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
