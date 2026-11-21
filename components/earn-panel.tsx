"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { dismissalCovers, type EarnBannerProject } from "@/lib/earn-banner";

const DISMISSED_KEY = "ziki:earn-panel-dismissed";

function readDismissedAt(): number {
  try {
    return Number(window.localStorage.getItem(DISMISSED_KEY));
  } catch {
    // Storage blocked: show it; Dismiss still hides it for this visit.
    return 0;
  }
}
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/**
 * The way in to earning (#earnings, Mark's call: on the page everyone lands on, without cluttering it for people who
 * build). It is the Ideas page's own notice, like "Your project is set up. Connect an agent": a white card, one line,
 * a button and Dismiss, in the brand blue so it is seen. It names the newest project open in Discover that the person
 * isn't in yet (lib/earn-banner.ts) and its button opens Discover on that project. Dismiss hides it in this browser
 * until another project opens (Chloe's call): it keeps coming back for each new one, and with nothing new to join
 * the Ideas list doesn't render it at all.
 */
export function EarnPanel({ project, line }: { project: EarnBannerProject; line: string }) {
  // Hidden on the server and until the browser says it wasn't dismissed, so it never flashes up and away.
  const dismissedBefore = useSyncExternalStore(subscribe, () => dismissalCovers(readDismissedAt(), project.openedAt), () => true);
  const [dismissedNow, setDismissedNow] = useState(false);
  if (dismissedBefore || dismissedNow) return null;

  function dismiss() {
    setDismissedNow(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      // Storage blocked: it comes back next visit, which is fine.
    }
  }

  return (
    // The same card as OrganisationNextStepCard ("Your project is set up. Connect an agent…"): one line, a dark pill, Dismiss.
    <section aria-labelledby="earn-panel-heading" className="rounded-panel border border-[#0972d5]/30 bg-[linear-gradient(120deg,var(--color-zk-tint),var(--color-zk-surface)_75%)] p-5 print:hidden sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="earn-panel-heading" className="sr-only">Earn with your agent</h2>
          <p className="text-sm text-zk-text2"><b className="font-bold text-zk-accent">Earn with your agent.</b> {line}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/discover?open=true&q=${encodeURIComponent(project.name)}`}
            className="inline-flex min-h-10 items-center rounded-full bg-electric-blue-strong px-4 text-sm font-bold text-white transition hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2"
          >
            Discover projects
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className="min-h-10 rounded-full px-3 text-sm font-medium text-zk-muted hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2"
          >
            Dismiss
          </button>
        </div>
      </div>
    </section>
  );
}
