"use client";

import { useState, useTransition } from "react";
import { setThemeAction } from "@/app/actions/settings";
import { THEMES, themeAttribute, themeLabels, type Theme } from "@/lib/theme";

/** Shows a choice on this page at once, before the server has saved it, and syncs localStorage (#659). */
function showTheme(theme: Theme) {
  const root = document.documentElement;
  const attr = themeAttribute(theme);
  if (attr) root.setAttribute("data-theme", attr);
  else root.removeAttribute("data-theme");
  try {
    localStorage.setItem("theme", theme);
  } catch {}
}

const themeHints: Record<Theme, string> = {
  system: "Match this device",
  light: "Always light",
  dark: "Always dark",
};

const preview: Record<Theme, { bg: string; line: string; bar: string }> = {
  system: {
    bg: "linear-gradient(90deg, #FFFFFF 50%, #0E1A33 50%)",
    line: "#8FA3C4",
    bar: "#0972D5",
  },
  light: { bg: "#FFFFFF", line: "#E3E8F2", bar: "#0972D5" },
  dark: { bg: "#0E1A33", line: "#22324F", bar: "#0972D5" },
};

/** Settings → Appearance (#277): System / Light / Dark. */
export function ThemeSettings({ initialTheme }: { initialTheme: Theme }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const apply = (next: Theme) => {
    if (next === theme) return;
    const previous = theme;
    setTheme(next);
    setMessage(null);
    setError(null);
    showTheme(next);
    startTransition(async () => {
      const result = await setThemeAction(next);
      if (result.error) {
        setTheme(previous);
        showTheme(previous);
        setError(result.error);
      } else {
        setMessage(`Appearance set to ${themeLabels[next].toLowerCase()}.`);
      }
    });
  };

  return (
    <fieldset className="space-y-4" disabled={pending}>
      <legend className="sr-only">Appearance</legend>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]"
      >
        {THEMES.map((option) => {
          const on = theme === option;
          const pv = preview[option];
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => apply(option)}
              className={`flex flex-col gap-3 rounded-2xl p-3 text-left font-inherit transition ${
                on
                  ? "border-2 border-electric-blue-strong bg-zk-tint"
                  : "m-px border border-zk-border bg-zk-surface"
              }`}
            >
              <span
                className="box-border flex h-[72px] w-full flex-col gap-1.5 rounded-control border border-zk-border p-2.5"
                style={{ background: pv.bg }}
                aria-hidden="true"
              >
                <span className="h-2 w-[40%] rounded-full" style={{ background: pv.bar }} />
                <span className="h-1.5 w-[80%] rounded-full" style={{ background: pv.line }} />
                <span className="h-1.5 w-[60%] rounded-full" style={{ background: pv.line }} />
              </span>
              <span className="flex w-full items-center justify-between gap-2">
                <span className="flex min-w-0 flex-col gap-0.5 text-left">
                  <span className="text-sm font-bold text-zk-text">{themeLabels[option]}</span>
                  <span className="text-xs text-zk-muted">{themeHints[option]}</span>
                </span>
                <span
                  className={`box-border h-[18px] w-[18px] shrink-0 rounded-full ${
                    on ? "border-[5px] border-electric-blue-strong bg-white" : "border-2 border-zk-border"
                  }`}
                  aria-hidden="true"
                />
              </span>
            </button>
          );
        })}
      </div>
      <p role="status" aria-live="polite" className="text-sm text-zk-ok-fg empty:hidden">
        {message ?? ""}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-zk-bad-fg">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
