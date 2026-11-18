"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { copyText } from "@/lib/clipboard";
import { publicOrgFeedbackPath } from "@/lib/public-project-paths";

export function FeedbackPortalPopover({
  orgSlug,
  projectName,
}: {
  orgSlug: string;
  projectSlug: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const portalPath = publicOrgFeedbackPath(orgSlug);
  const displayUrl = `ziki.dev${portalPath}`;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function handleCopy() {
    const origin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "https://ziki.dev";
    const fullUrl = `${origin}${portalPath}`;
    const ok = await copyText(fullUrl);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-zk-accent ${
          open
            ? "border-electric-blue-strong bg-electric-blue-strong/10 text-electric-blue-strong"
            : "border-zk-border bg-zk-surface text-zk-text hover:bg-zk-chip"
        }`}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        Feedback portal
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Project feedback portal"
          className="absolute right-0 z-30 mt-2 w-80 rounded-2xl border border-zk-border bg-zk-surface p-5 shadow-xl sm:w-96"
        >
          <h3 className="text-base font-bold text-zk-text">Project feedback portal</h3>
          <p className="mt-1 text-xs text-zk-text2">
            Share this portal for {projectName} and other projects with customers and testers.
          </p>

          <div className="mt-3 flex items-center gap-2 rounded-xl border border-zk-border bg-zk-card px-3 py-2 text-xs text-zk-text">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-zk-muted"
              aria-hidden="true"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span className="truncate font-medium">{displayUrl}</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-electric-blue-strong px-3 py-2 text-xs font-bold text-white transition hover:brightness-110"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
              {copied ? "Copied link" : "Copy link"}
            </button>

            <Link
              href={portalPath}
              onClick={() => setOpen(false)}
              className="inline-flex min-h-9 items-center justify-center gap-1 rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-xs font-semibold text-zk-text transition hover:bg-zk-chip"
            >
              Open portal <span aria-hidden="true">↗</span>
            </Link>
          </div>

          <div className="mt-3.5 border-t border-zk-divider pt-3">
            <Link
              href={portalPath}
              onClick={() => setOpen(false)}
              className="inline-block text-xs font-semibold text-electric-blue-strong hover:underline"
            >
              Organization feedback portal
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
