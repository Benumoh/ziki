"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { setThemeAction } from "@/app/actions/settings";
import { THEMES, themeAttribute, themeLabels, type Theme } from "@/lib/theme";

/** The theme the server already wrote onto `<html>`. The first client paint must use this same value. */
const ServerThemeContext = createContext<Theme>("system");

export function ThemePreference({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <ServerThemeContext.Provider value={theme}>{children}</ServerThemeContext.Provider>;
}

/**
 * Apply theme to documentElement immediately on client, and persist to localStorage (#659).
 */
export function applyThemeClient(next: Theme) {
  const root = document.documentElement;
  const attr = themeAttribute(next);
  if (attr) {
    root.setAttribute("data-theme", attr);
  } else {
    root.removeAttribute("data-theme");
  }
  try {
    localStorage.setItem("theme", next);
  } catch {}
}

function subscribeTheme(callback: () => void) {
  if (typeof window === "undefined") return () => {};

  let observer: MutationObserver | null = null;
  if (typeof MutationObserver !== "undefined") {
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === "data-theme") {
          callback();
        }
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }

  const media =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  const onMedia = () => callback();
  media?.addEventListener("change", onMedia);

  return () => {
    observer?.disconnect();
    media?.removeEventListener("change", onMedia);
  };
}

function getClientTheme(): Theme {
  if (typeof document === "undefined") return "system";
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" || attr === "light" ? attr : "system";
}

export function useTheme(): [Theme, (next: Theme) => void, boolean] {
  const serverTheme = useContext(ServerThemeContext);
  const [pending, startTransition] = useTransition();
  // The server snapshot is the theme rendered on <html>. Reading a different
  // value here (or asking the device) makes the button hydrate the other icon.
  const theme = useSyncExternalStore(subscribeTheme, getClientTheme, () => serverTheme);

  const setTheme = (next: Theme) => {
    const previous = theme;
    applyThemeClient(next);
    startTransition(async () => {
      const result = await setThemeAction(next);
      if (result.error) {
        applyThemeClient(previous);
      }
    });
  };

  return [theme, setTheme, pending];
}

export function SunIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
      />
    </svg>
  );
}

export function MoonIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
      />
    </svg>
  );
}

/**
 * Whether a system theme is currently dark. Starts false so the first paint
 * matches the server; the device setting is applied after hydration.
 */
function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setPrefersDark(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return prefersDark;
}

/**
 * Navbar Dark Mode Toggle button (#659).
 * Switches directly between light and dark themes on click with instant client update.
 */
export function ThemeToggle({
  className = "",
}: {
  className?: string;
}) {
  const [theme, setTheme, pending] = useTheme();
  const prefersDark = usePrefersDark();
  const isDark = theme === "dark" || (theme === "system" && prefersDark);

  const toggle = () => {
    const next: Theme = isDark ? "light" : "dark";
    setTheme(next);
  };

  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      className={`relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-zk-border bg-zk-surface text-zk-text transition-colors hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 ${className}`}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/** Small icons for the theme buttons: a screen for System, a sun for Light, a moon for Dark. */
const THEME_ICONS: Record<(typeof THEMES)[number], string> = {
  system: "M3 4h18v12H3zM8 20h8M12 16v4",
  light: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42",
  dark: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
};

/**
 * Compact theme selector for the account menu and mobile menu (#659): one row,
 * "Theme" and three small icon buttons, each named for screen readers.
 */
export function AccountThemeSelector() {
  const [theme, setTheme, pending] = useTheme();

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2" role="group" aria-label="Theme preference">
      <span className="text-sm font-medium text-zk-text2">Theme</span>
      <div className="flex gap-0.5 rounded-lg bg-zk-seg p-0.5">
        {THEMES.map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={pending}
            onClick={() => setTheme(opt)}
            aria-pressed={theme === opt}
            aria-label={themeLabels[opt]}
            title={themeLabels[opt]}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${
              theme === opt ? "bg-zk-surface text-zk-text shadow-sm" : "text-zk-muted hover:text-zk-text"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={THEME_ICONS[opt]} />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
