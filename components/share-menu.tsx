"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { copyText } from "@/lib/clipboard";
import { publicOrgFeedbackPath } from "@/lib/public-project-paths";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue";

/**
 * The share icon beside a project's lists: a drop menu to invite your team (for those who may invite) or to share
 * the organisation's feedback portal, whose address you can copy or open.
 */
export function ShareMenu({ orgSlug, inviteHref }: { orgSlug: string; /** Where owners and admins invite people; none for others. */ inviteHref?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const portalPath = publicOrgFeedbackPath(orgSlug);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function copyPortal() {
    const origin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "https://ziki.dev";
    if (await copyText(`${origin}${portalPath}`)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }

  const item = `flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-zk-chip ${focus}`;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Share"
        title="Share"
        className={`relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border bg-zk-surface transition ${focus} ${
          open ? "border-electric-blue-strong text-electric-blue-strong" : "border-zk-border text-zk-text2 hover:bg-zk-chip hover:text-zk-text"
        }`}
      >
        {/* Share: three joined dots. */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
        </svg>
      </button>

      {open ? (
        <div role="menu" aria-label="Share" className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-zk-border bg-zk-surface p-1.5 shadow-[0_16px_40px_rgba(11,23,51,0.18)]">
          {inviteHref ? (
            <Link role="menuitem" href={inviteHref} onClick={() => setOpen(false)} className={item}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0 text-zk-text2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M19 8v6M22 11h-6" />
              </svg>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium text-zk-text">Invite your team</span>
                <span className="block text-[12px] text-zk-muted">Add people to work on this with you.</span>
              </span>
            </Link>
          ) : null}
          <button role="menuitem" type="button" onClick={copyPortal} className={item}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0 text-zk-text2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium text-zk-text">{copied ? "Copied the feedback portal link" : "Share the feedback portal"}</span>
              <span className="block truncate text-[12px] text-zk-muted">ziki.dev{portalPath}</span>
            </span>
          </button>
          <Link role="menuitem" href={portalPath} target="_blank" onClick={() => setOpen(false)} className={`${item} items-center py-2 text-[12.5px] font-medium text-zk-accent`}>
            <span className="w-4 shrink-0" aria-hidden="true" />
            Open the feedback portal ↗
          </Link>
        </div>
      ) : null}
    </div>
  );
}
