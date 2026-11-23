"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveProjectLinksAction, type ProjectActionResult } from "@/app/(app)/projects/actions";
import { asksFor, readProductKinds } from "@/lib/product-kinds";

/** The app's own addresses, store pages and download page; the marketing site is set on the Marketing side (#marketing-url). */
type Field = "siteUrl" | "repoUrl" | "appStoreUrl" | "playStoreUrl" | "downloadUrl";

/** A phone, for the app's store pages. */
const PHONE_ICON = "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2";

const FIELDS: Record<Field, { icon: string; empty: string; placeholder: string; label: string; name?: string }> = {
  siteUrl: {
    icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20",
    empty: "No site yet",
    placeholder: "https://example.com",
    label: "the app's address",
  },
  repoUrl: {
    icon: "m16 18 6-6-6-6M8 6l-6 6 6 6",
    empty: "No code linked",
    placeholder: "https://github.com/owner/repository",
    label: "the code address",
  },
  // A mobile app's store pages (#app-links), shown by their store's name rather than the long address.
  appStoreUrl: {
    icon: PHONE_ICON,
    empty: "Not on the App Store",
    placeholder: "https://apps.apple.com/app/id123456789",
    label: "the App Store link",
    name: "App Store",
  },
  playStoreUrl: {
    icon: PHONE_ICON,
    empty: "Not on Google Play",
    placeholder: "https://play.google.com/store/apps/details?id=…",
    label: "the Google Play link",
    name: "Google Play",
  },
  // A desktop app's or other product's download or store page (#product-kinds).
  downloadUrl: {
    icon: "M12 3v12M7 10l5 5 5-5M5 21h14",
    empty: "No download page",
    placeholder: "https://store.steampowered.com/app/123456",
    label: "the download page",
  },
};

/** The site and code addresses always go with a save; a store link only when it's the one edited. */
const ALWAYS_SENT: Field[] = ["siteUrl", "repoUrl"];

/** An address as it reads: no scheme, no `www.`, no `.git` or trailing slash. */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\.git$/, "").replace(/\/$/, "");
}

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue";

/**
 * The Overview's app card (#work-feed): where the app runs and where its code is, each with a pencil beside it (for
 * the organisation's owners and admins) that edits that address in place. Saving sends the site and code addresses
 * together, as the project's links are saved together; the other stays as it was.
 *
 * A mobile app (#app-links): once the project has an App Store or Google Play link, both stores show in place of
 * "No site yet" (a site address still shows when it has one), so an app's card speaks of the app, not a website.
 *
 * Once the project says what it is (#product-kinds), the card shows that: the site for a website, the stores for
 * a mobile app, the download page for a desktop app or something else, and the code for everything. A link already set
 * always shows.
 */
export function AppInfoLinks({
  slug,
  siteUrl,
  repoUrl,
  appStoreUrl = null,
  playStoreUrl = null,
  downloadUrl = null,
  productKinds = [],
  canEdit,
}: {
  slug: string;
  siteUrl: string | null;
  repoUrl: string | null;
  appStoreUrl?: string | null;
  playStoreUrl?: string | null;
  downloadUrl?: string | null;
  productKinds?: readonly string[];
  canEdit: boolean;
}) {
  // The field being edited, and the save result it was opened after: a newer successful save closes it.
  const [opened, setOpened] = useState<{ field: Field; after: ProjectActionResult | undefined } | null>(null);
  const [result, action, pending] = useActionState<ProjectActionResult | undefined, FormData>(saveProjectLinksAction, undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const values: Record<Field, string | null> = { siteUrl, repoUrl, appStoreUrl, playStoreUrl, downloadUrl };
  const kinds = readProductKinds(productKinds).filter((kind) => kind !== "idea");
  const asks = asksFor(kinds);
  const isApp = asks.stores || Boolean(appStoreUrl || playStoreUrl);
  // Without kinds: a website unless it has store links, as before.
  const showSite = kinds.length > 0 ? asks.site || Boolean(siteUrl) : !isApp || Boolean(siteUrl);
  const shown: Field[] = [
    ...(showSite ? (["siteUrl"] as const) : []),
    ...(isApp ? (["appStoreUrl", "playStoreUrl"] as const) : []),
    ...(asks.download || downloadUrl ? (["downloadUrl"] as const) : []),
    "repoUrl",
  ];

  // Saved: the editor closes (the page's data refreshes with the new address).
  const saved = opened !== null && result !== opened.after && Boolean(result?.message) && !result?.error;
  const editing = opened && !saved ? opened.field : null;
  const setEditing = (field: Field | null) => setOpened(field ? { field, after: result } : null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-zk-muted">
      {shown.map((field) => {
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
              {ALWAYS_SENT.filter((other) => other !== field).map((other) => (
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
              <a href={value} target="_blank" rel="noopener noreferrer" className="truncate hover:text-zk-accent hover:underline">{meta.name ?? shortUrl(value)}</a>
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
