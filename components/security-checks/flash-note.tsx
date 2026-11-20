"use client";

import { useEffect, useState } from "react";

const SHOW_MS = 5000;
const FADE_MS = 400;

/**
 * A short confirmation after paying or adding a site (#security-checks): it
 * shows for a few seconds, fades out, and takes `unlocked`/`added`/`check` off the
 * address, so reloading the page doesn't bring it back.
 */
export function FlashNote({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<"shown" | "fading" | "gone">("shown");

  useEffect(() => {
    const url = new URL(window.location.href);
    if (["unlocked", "added", "check"].some((key) => url.searchParams.has(key))) {
      for (const key of ["unlocked", "added", "check"]) url.searchParams.delete(key);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    const fade = window.setTimeout(() => setPhase("fading"), SHOW_MS);
    const gone = window.setTimeout(() => setPhase("gone"), SHOW_MS + FADE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(gone);
    };
  }, []);

  if (phase === "gone") return null;
  return (
    <p
      role="status"
      className={`mx-4 my-3 rounded-xl border border-zk-border bg-zk-ok-bg px-3 py-2 text-sm text-zk-ok-fg transition-opacity duration-[400ms] motion-reduce:transition-none sm:mx-6 ${phase === "fading" ? "opacity-0" : "opacity-100"}`}
    >
      {children}
    </p>
  );
}
