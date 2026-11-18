"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { startFromOutside } from "@/app/actions/security-assistant";

/**
 * Arriving from the public page's Try now (signed in, or just signed up), after the workspace is picked
 * when there's more than one: the site is added and its progress page opens, where the agents are already
 * at work. Someone coming from outside never lands in the chat box. While it's added, the same Scanning
 * card as the public page.
 */
export function OutsideStart({ site }: { site: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // Once only, even when React runs the effect twice in development.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startFromOutside(site)
      .then((answer) => {
        if (answer.ok) router.replace(`/security/checks/${answer.checkId}`);
        else setError(answer.error);
      })
      .catch(() => setError("Ziki couldn't add it just now. Try again in a moment."));
  }, [router, site]);

  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-zk-border bg-zk-surface p-5 text-left">
        <p className="m-0 text-[15px] font-bold text-zk-text">{site} wasn&apos;t added</p>
        <p className="m-0 mt-1 text-sm text-zk-text2">{error}</p>
        <Link href="/security" className="mt-3 inline-block text-sm font-semibold text-zk-accent hover:underline">
          Go to Security
        </Link>
      </div>
    );
  }

  return (
    <div aria-live="polite" className="rounded-2xl border border-zk-border bg-zk-surface p-5 text-left">
      <p className="m-0 text-[15px] font-bold text-zk-text">Adding {site} to your scans…</p>
      <p className="m-0 mt-1 text-sm text-zk-text2">Your quick scan opens in a moment. The deeper scan starts only after payment.</p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zk-chip">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-electric-blue-strong" />
      </div>
    </div>
  );
}
