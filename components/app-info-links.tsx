"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveProjectLinksAction, type ProjectActionResult } from "@/app/(app)/projects/actions";

type Field = "siteUrl" | "repoUrl";

const FIELDS: Record<Field, { icon: string; empty: string; placeholder: string; label: string }> = {
  siteUrl: {
    icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20",
    empty: "No site yet",
    placeholder: "https://example.com",
    label: "the site address",
  },
  repoUrl: {
    icon: "m16 18 6-6-6-6M8 6l-6 6 6 6",
    empty: "No code linked",
    placeholder: "https://github.com/owner/repository",
    label: "the code address",
  },
};

/** An address as it reads: no scheme, no `www.`, no `.git` or trailing slash. */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\.git$/, "").replace(/\/$/, "");
}

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue";

/**
 * The Overview's app card (#work-feed): where the app runs and where its code is, each with a pencil beside it (for
 * the organisation's owners and admins) that edits that address in place. Saving sends both, as the project's links
 * are saved together; the other stays as it was.
 */
export function AppInfoLinks({ slug, siteUrl, repoUrl, canEdit }: { slug: string; siteUrl: string | null; repoUrl: string | null; canEdit: boolean }) {
  // The field being edited, and the save result it was opened after: a newer successful save closes it.
  const [opened, setOpened] = useState<{ field: Field; after: ProjectActionResult | undefined } | null>(null);
  const [result, action, pending] = useActionState<ProjectActionResult | undefined, FormData>(saveProjectLinksAction, undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const values: Record<Field, string | null> = { siteUrl, repoUrl };

  // Saved: the editor closes (the page's data refreshes with the new address).
  const saved = opened !== null && result !== opened.after && Boolean(result?.message) && !result?.error;
  const editing = opened && !saved ? opened.field : null;
  const setEditing = (field: Field | null) => setOpened(field ? { field, after: result } : null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-zk-muted">
      {(Object.keys(FIELDS) as Field[]).map((field) => {
        const meta = FIELDS[field];
        const value = values[field];
        const icon = (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
            <path d={meta.icon} />
          </svg>
        );
        if (editing === field) {
          return (
            <form key={field} action={action} className="flex min-w-0 flex-wrap items-center gap-1.5">
              {icon}
              <input type="hidden" name="slug" value={slug} />
              {/* The other address goes too, unchanged. */}
              {(Object.keys(FIELDS) as Field[]).filter((other) => other !== field).map((other) => (
                <input key={other} type="hidden" name={other} value={values[other] ?? ""} />
              ))}
              <input
                ref={inputRef}
                name={field}
                type="url"
                inputMode="url"
                aria-label={`Edit ${meta.label}`}
                placeholder={meta.placeholder}
                defaultValue={value ?? ""}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setEditing(null);
                }}
                className="h-7 w-64 max-w-full rounded-md border border-zk-border bg-zk-surface px-2 text-[13px] text-zk-text"
              />
              <button type="submit" disabled={pending} className={`h-7 rounded-md bg-electric-blue-strong px-2.5 text-[12px] font-medium text-white disabled:opacity-60 ${focus}`}>
                {pending ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => setEditing(null)} className={`h-7 rounded-md px-2 text-[12px] font-medium text-zk-muted hover:text-zk-text ${focus}`}>
                Cancel
              </button>
              {result?.error ? <span role="alert" className="w-full text-[12px] text-red-600">{result.fieldErrors?.[field] ?? result.error}</span> : null}
            </form>
          );
        }
        return (
          <span key={field} className="inline-flex min-w-0 items-center gap-1.5">
            {icon}
            {value ? (
              <a href={value} target="_blank" rel="noopener noreferrer" className="truncate hover:text-zk-accent hover:underline">{shortUrl(value)}</a>
            ) : (
              <span>{meta.empty}</span>
            )}
            {canEdit ? (
              <button
                type="button"
                onClick={() => setEditing(field)}
                aria-label={`Edit ${meta.label}`}
                title={`Edit ${meta.label}`}
                className={`-ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-zk-muted transition hover:bg-zk-surface hover:text-zk-text ${focus}`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
