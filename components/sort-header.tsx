"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SORT_COOKIE_MAX_AGE } from "@/lib/list-sort";

/**
 * A sortable column label in a list's header row. Clicking it sorts the list
 * by that column on the server (`?sort=`), flipping direction on a second
 * click, and remembers the choice in the list's cookie so it stays.
 */
export function SortHeader({
  label,
  current,
  first,
  second,
  cookie,
  firstDescending = true,
  className = "",
}: {
  label: string;
  /** The list's sort right now. */
  current: string;
  /** The sort a first click picks (e.g. highest score first). */
  first: string;
  /** The sort a second click picks (the other direction). */
  second: string;
  /** The cookie that remembers this list's sort. */
  cookie: string;
  /** Whether `first` runs high-to-low (arrow down). False for A–Z and earliest-first sorts. */
  firstDescending?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = current === first || current === second;
  const descending = current === second ? !firstDescending : firstDescending;

  function choose() {
    const next = current === first ? second : first;
    try {
      document.cookie = `${cookie}=${encodeURIComponent(next)}; path=/; max-age=${SORT_COOKIE_MAX_AGE}; samesite=lax`;
    } catch {
      /* Cookies can be blocked; the address still carries the sort. */
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.set("sort", next);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <button
      type="button"
      onClick={choose}
      aria-label={`Sort by ${label}${active ? `, sorted ${descending ? "descending" : "ascending"}; click to reverse` : ""}`}
      className={`group inline-flex cursor-pointer items-center gap-1 text-left hover:text-zk-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue ${active ? "text-zk-text" : ""} ${className}`}
    >
      {label}
      <svg
        aria-hidden="true"
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={active ? "" : "opacity-0 transition-opacity group-hover:opacity-50"}
      >
        {descending ? <path d="m6 9 6 6 6-6" /> : <path d="m6 15 6-6 6 6" />}
      </svg>
    </button>
  );
}
