"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";

const HASH = "#activity";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** Closes the drawer: drops the #activity hash without adding a history entry. */
function close() {
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/**
 * The issue's activity in a sidebar sliding in from the right (#activity-drawer). The ⋯ menu's Activity item opens it
 * with the #activity hash, so a link to `…#activity` opens it too; ×, Esc or a click beside it closes it.
 */
export function ActivityDrawer({ children }: { children: ReactNode }) {
  const open = useSyncExternalStore(subscribe, () => location.hash === HASH, () => false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 print:hidden">
      <button type="button" tabIndex={-1} aria-label="Close activity" onClick={close} className="absolute inset-0 cursor-default bg-black/30" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Activity"
        className="zk-drawer absolute inset-y-0 right-0 flex w-[min(440px,100vw)] flex-col border-l border-zk-border bg-zk-bg shadow-2xl"
      >
        <style>{`@keyframes zk-drawer-in{from{transform:translateX(100%)}to{transform:none}}.zk-drawer{animation:zk-drawer-in .22s ease-out}@media (prefers-reduced-motion:reduce){.zk-drawer{animation:none}}`}</style>
        <div className="flex items-center justify-between gap-3 border-b border-zk-border bg-zk-surface px-5 py-3">
          <h2 className="m-0 text-[15px] font-semibold text-zk-text">Activity</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close activity"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the drawer takes focus when it opens, so Esc and Tab work in it
            autoFocus
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zk-muted hover:bg-zk-chip hover:text-zk-text"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>
  );
}
