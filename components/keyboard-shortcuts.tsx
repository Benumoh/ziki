"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useListRef, useProjectRef } from "@/lib/use-project-ref";
import { newIssueHref } from "@/lib/reported-from";
import { issuesPath } from "@/lib/project-paths";
import {
  IDLE,
  SHOW_SHORTCUTS_EVENT,
  shortcutFor,
  shortcutGroups,
  stepRow,
  type SequenceState,
} from "@/lib/keyboard-shortcuts";

const ROW_SELECTOR = "[data-issue-link]";
const SEARCH_ID = "q";

function focusSearch(): boolean {
  const input = document.getElementById(SEARCH_ID) as HTMLInputElement | null;
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}

/**
 * Site-wide shortcuts (#287), mounted once in the app layout. `enabled`
 * comes from the user's setting; the cheat sheet can still be opened from
 * Settings when they're off.
 */
export function KeyboardShortcuts({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  // The project the page belongs to (#project-urls): the shortcuts go to its lists.
  const slug = useProjectRef();
  const listSlug = useListRef();
  const [helpOpen, setHelpOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sequence = useRef<SequenceState>(IDLE);
  const searchAfterNavigation = useRef(false);

  // "/" pressed away from the list: go there, then focus its search box.
  useEffect(() => {
    if (!searchAfterNavigation.current) return;
    let tries = 0;
    const tick = () => {
      if (focusSearch() || ++tries > 30) {
        searchAfterNavigation.current = false;
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  }, [pathname]);

  useEffect(() => {
    const open = () => setHelpOpen(true);
    window.addEventListener(SHOW_SHORTCUTS_EVENT, open);
    return () => window.removeEventListener(SHOW_SHORTCUTS_EVENT, open);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (helpOpen && !dialog.open) dialog.showModal();
    if (!helpOpen && dialog.open) dialog.close();
  }, [helpOpen]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      // Escape leaves the search box (after it has closed its own menu).
      if (event.key === "Escape" && target?.id === SEARCH_ID && !event.defaultPrevented) {
        target.blur();
        return;
      }

      const result = shortcutFor(event, target, sequence.current, Date.now());
      sequence.current = result.state;
      if (!result.action) return;

      switch (result.action) {
        case "focus-search":
          event.preventDefault(); // or the "/" lands in the box
          if (!focusSearch()) {
            if (!listSlug) break;
            searchAfterNavigation.current = true;
            router.push(issuesPath(listSlug, "all"));
          }
          break;
        case "next-row":
        case "previous-row": {
          const rows = Array.from(document.querySelectorAll<HTMLElement>(ROW_SELECTOR));
          if (rows.length === 0) return;
          event.preventDefault();
          const current = rows.findIndex((row) => row === document.activeElement);
          const next = rows[stepRow(current, rows.length, result.action === "next-row" ? 1 : -1)];
          // Real focus, so Enter opens it natively and screen readers follow.
          next.focus({ preventScroll: true });
          next.scrollIntoView({ block: "nearest" });
          break;
        }
        case "new-issue":
          event.preventDefault();
          if (slug) router.push(newIssueHref(slug, pathname));
          break;
        case "go-issues":
          event.preventDefault();
          if (listSlug) router.push(issuesPath(listSlug, "all"));
          break;
        case "go-notifications":
          event.preventDefault();
          router.push("/inbox");
          break;
        case "show-help":
          event.preventDefault();
          setHelpOpen(true);
          break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, router, pathname, slug]);

  return (
    // <dialog> dismisses on Escape natively, so this has keyboard support
    // already; the click handler is just backdrop-to-close.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialogRef}
      aria-labelledby="shortcuts-title"
      onClose={() => setHelpOpen(false)}
      onClick={(event) => {
        if (event.target === event.currentTarget) setHelpOpen(false);
      }}
      className="m-auto max-h-[85vh] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-slate-200 bg-card p-0 text-slate-900 shadow-xl backdrop:bg-black/50"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id="shortcuts-title" className="text-base font-semibold">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={() => setHelpOpen(false)}
            className="rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            Close
          </button>
        </div>
        {!enabled ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Shortcuts are turned off. Turn them on in{" "}
            <Link href="/settings" className="font-medium underline" onClick={() => setHelpOpen(false)}>
              Settings
            </Link>
            .
          </p>
        ) : null}
        {shortcutGroups().map((group) => (
          <section key={group.title} className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.title}</h3>
            <dl className="mt-2 space-y-1.5">
              {group.items.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="text-slate-700">{item.label}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {item.keys.map((k, i) => (
                      <span key={k} className="flex items-center gap-1">
                        {i > 0 ? (
                          <span className="text-xs text-slate-500">{item.joiner === "or" ? "or" : "then"}</span>
                        ) : null}
                        <kbd className="min-w-[1.75rem] rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-center font-mono text-xs text-slate-800 shadow-[inset_0_-1px_0_rgb(203_213_225)]">
                          {k}
                        </kbd>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="mt-4 text-xs text-slate-500">
          Shortcuts never fire while you&apos;re typing.{" "}
          {enabled ? (
            <>
              You can turn them off in{" "}
              <Link href="/settings" className="text-teal-700 underline" onClick={() => setHelpOpen(false)}>
                Settings
              </Link>
              .
            </>
          ) : null}
        </p>
      </div>
    </dialog>
  );
}

/** Opens the cheat sheet; used from Settings. */
export function ShowShortcutsButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(SHOW_SHORTCUTS_EVENT))}
      className="text-sm font-medium text-teal-700 hover:underline"
    >
      View all shortcuts
    </button>
  );
}
