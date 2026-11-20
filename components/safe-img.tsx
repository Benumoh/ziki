"use client";

import { useState, type ReactNode } from "react";

/**
 * A screenshot an agent linked (#safe-img): any https link is accepted, and many don't load (a page, not an image; a
 * private GitHub attachment; a localhost address; a host that is gone). When it fails, `fallback` shows in its place
 * instead of the browser's broken-image box.
 */
export function SafeImg({ src, alt, className, fallback, loading = "lazy" }: { src: string; alt: string; className?: string; fallback: ReactNode; loading?: "lazy" | "eager" }) {
  // The src it failed on, so a new src gets a fresh try.
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element -- a screenshot the agent linked, any host
  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      className={className}
      onError={() => setFailed(src)}
      // The page is drawn on the server, so the image may have failed before React listened for it: check once mounted.
      ref={(element) => {
        if (element && element.complete && element.naturalWidth === 0) setFailed(src);
      }}
    />
  );
}

/** What a screenshot that won't load shows: a quiet box saying so, the size of the picture. */
export function BrokenShot({ className = "" }: { className?: string }) {
  return (
    <span className={`flex h-full w-full flex-col items-center justify-center gap-1 bg-zk-bg px-2 text-center text-[11px] leading-4 text-zk-muted ${className}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 3l18 18" /></svg>
      Screenshot couldn&apos;t load
    </span>
  );
}
