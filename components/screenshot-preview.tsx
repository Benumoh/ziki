"use client";

import { useEffect, useRef } from "react";

export type PreviewShot = { url: string; label: string };

/**
 * A screenshot opened large over the page (#screenshot-preview): the picture fitted to the window, its label, arrows (and
 * the arrow keys) to the others, a link to the original, and Esc, × or a click outside to close.
 */
export function ScreenshotPreview({
  shots,
  index,
  onIndex,
  onClose,
}: {
  shots: PreviewShot[];
  /** The one open, or null when the preview is closed. */
  index: number | null;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = index !== null && shots[index] !== undefined;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const shot = open ? shots[index] : null;
  const many = shots.length > 1;
  const step = (by: number) => {
    if (index === null) return;
    onIndex((index + by + shots.length) % shots.length);
  };

  // The arrow keys step through the screenshots while the preview is open.
  useEffect(() => {
    if (!open || shots.length < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      onIndex((index! + (event.key === "ArrowRight" ? 1 : -1) + shots.length) % shots.length);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, index, shots.length, onIndex]);

  return (
    <dialog
      ref={ref}
      aria-label={shot ? shot.label : "Screenshot"}
      onClose={onClose}
      className="m-auto max-h-none max-w-none overflow-visible bg-transparent p-0 backdrop:bg-black/70 backdrop:backdrop-blur-[2px]"
    >
      {/* A click outside the picture closes it: this button fills the screen behind it. */}
      {shot ? <button type="button" tabIndex={-1} aria-label="Close preview" onClick={onClose} className="fixed inset-0 cursor-default bg-transparent" /> : null}
      {shot ? (
        <figure className="relative m-0 flex max-h-[92vh] w-[min(1100px,94vw)] flex-col overflow-hidden rounded-2xl bg-zk-surface shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-zk-border px-4 py-2.5">
            <figcaption className="min-w-0 truncate text-[13.5px] font-semibold text-zk-text">
              {shot.label}
              {many ? <span className="ml-2 font-normal text-zk-muted">{index! + 1} of {shots.length}</span> : null}
            </figcaption>
            <div className="flex shrink-0 items-center gap-1">
              <a href={shot.url} target="_blank" rel="noopener noreferrer" className="rounded-lg px-2 py-1 text-[13px] font-medium text-zk-accent hover:bg-zk-chip">
                Open original
              </a>
              <button type="button" onClick={onClose} aria-label="Close preview" className="flex h-8 w-8 items-center justify-center rounded-lg text-zk-muted hover:bg-zk-chip hover:text-zk-text">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-zk-bg">
            {/* eslint-disable-next-line @next/next/no-img-element -- a screenshot the agent linked, any host */}
            <img src={shot.url} alt={shot.label} className="max-h-[calc(92vh-52px)] w-auto max-w-full object-contain" />
            {many ? (
              <>
                <button type="button" onClick={() => step(-1)} aria-label="Previous screenshot" className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
                </button>
                <button type="button" onClick={() => step(1)} aria-label="Next screenshot" className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                </button>
              </>
            ) : null}
          </div>
        </figure>
      ) : null}
    </dialog>
  );
}
