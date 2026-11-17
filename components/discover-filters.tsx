"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function DiscoverFilters({
  initialQuery = "",
  initialOpenOnly = false,
  selectedArea = "",
  fromEarn = false,
}: {
  initialQuery?: string;
  initialOpenOnly?: boolean;
  selectedArea?: string;
  /** Came from the Earn page: searching keeps that, so the way back stays the Earn page. */
  fromEarn?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [openOnly, setOpenOnly] = useState(initialOpenOnly);
  const [isPending, startTransition] = useTransition();

  const applyFilters = (newQuery: string, newOpenOnly: boolean) => {
    const params = new URLSearchParams();
    if (selectedArea) {
      params.set("area", selectedArea);
    }
    const cleanQ = newQuery.trim();
    if (cleanQ) {
      params.set("q", cleanQ);
    }
    if (newOpenOnly) {
      params.set("open", "true");
    }
    if (fromEarn) params.set("from", "earn");
    const queryString = params.toString();
    startTransition(() => {
      router.push(queryString ? `/discover?${queryString}` : "/discover");
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    applyFilters(query, openOnly);
  };

  const handleCheckboxChange = (checked: boolean) => {
    setOpenOnly(checked);
    applyFilters(query, checked);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-[16px] border border-zk-border bg-zk-surface p-4 sm:flex-row sm:items-center"
    >
      <div className="relative flex-1">
        <input
          type="search"
          name="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects by name, goal, or organisation..."
          className="w-full rounded-xl border border-zk-border bg-zk-card py-2 pl-9 pr-3 text-sm text-zk-text placeholder:text-zk-muted focus:border-zk-accent focus:outline-none focus:ring-1 focus:ring-zk-accent"
        />
        <svg
          className="absolute left-3 top-2.5 h-4 w-4 text-zk-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      </div>

      <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm text-zk-text2 select-none">
        <input
          type="checkbox"
          name="open"
          checked={openOnly}
          onChange={(e) => handleCheckboxChange(e.target.checked)}
          className="h-4 w-4 cursor-pointer rounded border-zk-border text-zk-accent focus:ring-zk-accent"
        />
        Open for contributors only
      </label>

      <button
        type="submit"
        disabled={isPending}
        aria-label={isPending ? "Searching" : "Search"}
        className="inline-flex min-h-[38px] min-w-[80px] cursor-pointer items-center justify-center rounded-xl bg-electric-blue-strong px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-110 focus:outline-none disabled:cursor-not-allowed disabled:opacity-75"
      >
        {isPending ? (
          <svg
            className="h-4 w-4 animate-spin text-white"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          "Search"
        )}
      </button>
    </form>
  );
}
