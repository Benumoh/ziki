"use client";

import { useState, useTransition } from "react";
import { setKeyboardShortcutsAction } from "@/app/actions/settings";
import { SHOW_SHORTCUTS_EVENT } from "@/lib/keyboard-shortcuts";

const PREVIEW_SHORTCUTS = [
  { key: "?", label: "Show shortcuts" },
  { key: "/", label: "Search" },
  { key: "N", label: "New issue" },
  { key: "G I", label: "Go to issues" },
] as const;

/** Settings → Keyboard shortcuts (#287): the off switch and the cheat sheet. */
export function KeyboardShortcutSettings({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="m-0 text-lg font-bold text-zk-text">Keyboard shortcuts</h2>
          <p id="keyboard-shortcuts-help" className="m-0 text-[13px] text-zk-muted">
            Press{" "}
            <kbd className="rounded-md border border-zk-border bg-zk-chip px-1.5 py-px font-inherit text-xs font-bold text-zk-text">
              ?
            </kbd>{" "}
            anywhere to see them. They never fire while you&apos;re typing.
          </p>
        </div>
        <button
          type="button"
          id="keyboard-shortcuts"
          role="switch"
          aria-checked={enabled}
          aria-label="Use keyboard shortcuts"
          aria-describedby="keyboard-shortcuts-help"
          disabled={pending}
          onClick={() => {
            const next = !enabled;
            setEnabled(next);
            setMessage(null);
            startTransition(async () => {
              const result = await setKeyboardShortcutsAction(next);
              if (result.error) {
                setEnabled(!next);
                setMessage(result.error);
              } else {
                setMessage(next ? "Keyboard shortcuts turned on." : "Keyboard shortcuts turned off.");
              }
            });
          }}
          className={`relative h-7 w-[46px] shrink-0 rounded-full border-0 p-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 ${
            enabled ? "bg-electric-blue-strong" : "bg-zk-chip"
          } ${pending ? "cursor-not-allowed opacity-45" : ""}`}
        >
          <span
            className={`pointer-events-none absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-[left] motion-reduce:transition-none ${
              enabled ? "left-[21px]" : "left-[3px]"
            }`}
          />
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {PREVIEW_SHORTCUTS.map((item) => (
          <span
            key={item.key}
            className="inline-flex items-center gap-2 rounded-control bg-zk-chip px-2.5 py-1.5 text-xs text-zk-text2"
          >
            <kbd className="min-w-[18px] rounded-md border border-zk-border bg-zk-surface px-1.5 py-px text-center font-inherit font-extrabold text-zk-text">
              {item.key}
            </kbd>
            {item.label}
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(SHOW_SHORTCUTS_EVENT))}
        className="inline-flex min-h-8 items-center self-start text-sm font-bold text-zk-accent hover:underline"
      >
        View all shortcuts
      </button>

      <p role="status" aria-live="polite" className="text-sm text-zk-ok-fg empty:hidden">
        {message ?? ""}
      </p>
    </div>
  );
}
