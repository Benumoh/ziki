"use client";

import { useState } from "react";
import { ScreenshotPreview } from "@/components/screenshot-preview";
import { BrokenShot, SafeImg } from "@/components/safe-img";

/**
 * The issue's screenshots, in the side rail apart from its Links (#screenshots-panel): the delivery's screenshots and
 * any image links, as thumbnails that open large in the preview box.
 */
export function ScreenshotsPanel({ screenshots }: { screenshots: string[] }) {
  const [opened, setOpened] = useState<number | null>(null);
  if (screenshots.length === 0) return null;
  const shots = screenshots.map((url, index) => ({ url, label: `Screenshot ${index + 1}` }));
  return (
    <section aria-label="Screenshots" className="rounded-panel border border-zk-border bg-zk-surface px-4 py-3.5">
      <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">
        Screenshots <span className="font-mono font-normal normal-case tracking-normal">{screenshots.length}</span>
      </h2>
      <ScreenshotPreview shots={shots} index={opened} onIndex={setOpened} onClose={() => setOpened(null)} />
      <div className={`mt-3 grid gap-2 ${screenshots.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
        {shots.map((shot, index) => (
          <button
            key={shot.url}
            type="button"
            onClick={() => setOpened(index)}
            aria-label={`Preview ${shot.label.toLowerCase()}`}
            className="block w-full cursor-zoom-in overflow-hidden rounded-lg border border-zk-border bg-zk-bg transition hover:border-zk-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue"
          >
            <SafeImg src={shot.url} alt={shot.label} className="aspect-[4/3] w-full object-cover object-top" fallback={<BrokenShot className="aspect-[4/3]" />} />
          </button>
        ))}
      </div>
    </section>
  );
}
