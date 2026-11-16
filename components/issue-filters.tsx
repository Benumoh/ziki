"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ideasPath, issuesPath, statusFromSegment, type ProjectRef } from "@/lib/project-paths";
import { useProjectRef } from "@/lib/use-project-ref";
import { statuses } from "@/lib/validations/issue";
import { statusLabel } from "@/lib/labels";
import { FINISHED_STATUS_FILTER, statusFilterLabel } from "@/lib/issue-state";
import {
  BUG_SORT_OPTIONS,
  bugSortLabels,
  parseBugSort,
} from "@/lib/issues-sort";
import {
  TAGS_PARAM,
  parseTagFilter,
  serializeTags,
  suggestTags,
} from "@/lib/tag-filter";
import {
  MINE_FILTER_OPTIONS,
  mineFilterLabels,
  parseMineFilter,
  defaultSortFor,
} from "@/lib/mine-filter";
import { TRACK_PARAM, parseTrackFilter } from "@/lib/my-work-filter";
import { AREA_NONE, AREA_PARAM, parseProjectAreaFilter, type ProjectAreaOption } from "@/lib/project-area-filter";
import { MILESTONE_NONE, MILESTONE_PARAM } from "@/lib/milestones";
import {
  MIN_SUGGEST_LENGTH,
  type IssueSuggestion,
} from "@/lib/issue-suggest";
import { isTypingTarget } from "@/lib/keyboard-shortcuts";

type TagType = { id: string; name: string; isActive?: boolean };

type Suggestion =
  | { kind: "tag"; id: string; name: string }
  | { kind: "issue"; id: string; number: number; title: string; path: string };

/** Long enough not to query on every keystroke, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 300;

/** One of the filter dialog's single-choice filters, as a native select. */
function FilterSelect({ id, value, onValueChange, children, className, "aria-label": label }: {
  id: string; value: string; onValueChange: (value: string) => void;
  children: ReactNode; className?: string; "aria-label": string;
}) {
  return <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)} className={className} aria-label={label}>{children}</select>;
}

/**
 * #1054: the intake stage used to be a sidebar beside the list. It is a
 * filter now. An issue is confirmed, then ready. Ideas are not issues: they
 * have their own tab (#idea-table).
 */
const STAGE_PARAM = "stage";
const STAGE_OPTIONS = [
  { value: "confirming", label: "Requires confirmation" },
  { value: "ready", label: "Ready" },
] as const;
type StageFilter = (typeof STAGE_OPTIONS)[number]["value"];

/** The `?stage=` choice. Mirrors `parseIssueStageView` in lib/issue-stage, which this client file can't import. */
function stageFilterValue(raw: string | null): StageFilter | "" {
  return STAGE_OPTIONS.find((option) => option.value === raw)?.value ?? "";
}

/**
 * URL params owned by the filter bar. `page` is paging, not a filter, and
 * `sort` is ordering (the column headers, #column-sort): sorting never shows
 * the active-filters bar.
 */
const FILTER_PARAMS = [
  "q",
  STAGE_PARAM,
  TAGS_PARAM,
  "mine",
  "status",
  AREA_PARAM,
  MILESTONE_PARAM,
  TRACK_PARAM,
];

/** The Ideas lists' names in the list logic (the issue list's IDEAS_STATUS and REJECTED_IDEAS_STATUS). */
const IDEAS_STATUS = "ideas";
const REJECTED_IDEAS_STATUS = "rejected_ideas";

/**
 * The list URL for `params`: the status is the path (`/<slug>/issues/open`,
 * #project-urls) and everything else stays in the query.
 */
function listHref(slug: ProjectRef, params: URLSearchParams): string {
  const next = new URLSearchParams(params.toString());
  const status = next.get("status") || "all";
  next.delete("status");
  if (status === IDEAS_STATUS) return ideasPath(slug, "new", next);
  if (status === REJECTED_IDEAS_STATUS) return ideasPath(slug, "rejected", next);
  return issuesPath(slug, status, next);
}

/** The issues URL with `changes` applied and paging reset. */
function hrefWithChanges(
  slug: ProjectRef,
  params: URLSearchParams,
  changes: Record<string, string>,
): string {
  const next = new URLSearchParams(params.toString());
  for (const [key, value] of Object.entries(changes)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  next.delete("page");
  return listHref(slug, next);
}

export function IssueFilters({
  tagTypes = [],
  milestones = [],
  areas = [],
  shortcutsEnabled = true,
  stageCounts,
  compact = false,
}: {
  tagTypes?: TagType[];
  /** #289: open milestones first; closed ones stay selectable for history. */
  milestones?: { id: string; title: string; isClosed: boolean }[];
  areas?: ProjectAreaOption[];
  shortcutsEnabled?: boolean;
  /** Open issues in each intake stage, shown beside the Stage choices (#1054). */
  stageCounts?: Record<StageFilter, number>;
  /** Issues-page toolbar; other consumers retain the expanded search field. */
  compact?: boolean;
}) {
  const router = useRouter();
  const slug = useProjectRef()!;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The list is in the path; the filters read it as if it were `?status=`.
  const segments = pathname?.split("/").filter(Boolean) ?? [];
  const pathStatus = segments[1] === "ideas"
    ? (segments[2] === "rejected" ? REJECTED_IDEAS_STATUS : IDEAS_STATUS)
    : statusFromSegment(segments[2] ?? "") ?? "all";
  const params = useMemo(() => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.delete("status");
    if (pathStatus !== "all") next.set("status", pathStatus);
    return next;
  }, [searchParams, pathStatus]);
  // #690: while a navigation kicked off from this control is in flight, expose
  // a busy state so typing/searching gets visible + announced feedback.
  const [isSearching, startSearchTransition] = useTransition();
  const listId = useId();
  const filterPanelId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);

  useEffect(() => {
    if (!filterOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        filterPanelRef.current?.contains(target) ||
        filterButtonRef.current?.contains(target)
      ) {
        return;
      }
      setFilterOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFilterOpen(false);
        filterButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filterOpen]);

  useEffect(() => {
    if (!shortcutsEnabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      const isCmdOrCtrlK =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      const isSlash =
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey;

      if (!isCmdOrCtrlK && !isSlash) return;
      if (event.isComposing) return;

      const target = event.target as HTMLElement | null;
      const isEditable =
        isTypingTarget(target) ||
        Boolean(
          target &&
            (target.tagName === "INPUT" ||
              target.tagName === "TEXTAREA" ||
              target.tagName === "SELECT" ||
              target.isContentEditable ||
              Boolean(target.closest?.("[contenteditable='true']"))),
        );

      const inDialog =
        Boolean(target?.closest?.('dialog[open], [role="dialog"], [role="alertdialog"], [data-shortcuts-ignore]')) ||
        Boolean(document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]'));

      if (isSlash && isEditable) return;
      if (inDialog) return;
      if (isCmdOrCtrlK && isEditable) return;

      event.preventDefault();
      const focusSearch = () => {
        inputRef.current?.focus();
        inputRef.current?.select();
      };
      if (compact) {
        setSearchExpanded(true);
        requestAnimationFrame(focusSearch);
      } else focusSearch();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcutsEnabled, compact]);

  function updateMany(changes: Record<string, string>, replace = false) {
    // Nothing changed: don't navigate (and don't reset the page, #132).
    if (Object.entries(changes).every(([key, value]) => (params.get(key) ?? "") === value)) {
      return;
    }
    const href = hrefWithChanges(slug, params, changes);
    startSearchTransition(() => {
      if (replace) router.replace(href);
      else router.push(href);
    });
  }

  function update(key: string, value: string) {
    updateMany({ [key]: value });
  }

  // Tag (issue type) filter from the search box (#102).
  const selectedTags = parseTagFilter(params.get(TAGS_PARAM), tagTypes);
  const selectedNames = selectedTags.map((t) => t.name);
  const currentQuery = params.get("q") ?? "";
  const [text, setText] = useState(currentQuery);
  const [isFocused, setIsFocused] = useState(false);
  // Follow the URL when it changes from outside (Back, a link), adjusting
  // state during render rather than in an effect.
  const [lastQuery, setLastQuery] = useState(currentQuery);
  if (currentQuery !== lastQuery) {
    setLastQuery(currentQuery);
    // Don't overwrite newer text being typed during debounced transitions (#668).
    if (!isFocused || text === lastQuery) {
      setText(currentQuery);
    }
  }
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [issueSuggestions, setIssueSuggestions] = useState<IssueSuggestion[]>([]);
  const [suggestedFor, setSuggestedFor] = useState("");
  // Enter or the Search button applies the query at once; the debounced
  // navigation must not also fire and duplicate it (#690: leaving the box no
  // longer commits the search).
  const skipLiveRef = useRef<string | null>(null);
  // The real search before the current typing session. Picking a tag is a
  // filter choice, not text to search for, so it puts this back (#671).
  const queryBeforeEditingRef = useRef(currentQuery);
  // The first live update in a typing session pushes, so Back returns to the
  // search before it; later pauses replace that entry (#671).
  const livePushedRef = useRef(false);
  const paramsString = params.toString();

  // Filter the list a beat after typing stops.
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === currentQuery.trim()) {
      if (skipLiveRef.current === trimmed) skipLiveRef.current = null;
      return;
    }
    const timer = setTimeout(() => {
      if (skipLiveRef.current === trimmed) {
        skipLiveRef.current = null;
        return;
      }
      const href = hrefWithChanges(slug, new URLSearchParams(paramsString), { q: trimmed });
      startSearchTransition(() => {
        if (livePushedRef.current) router.replace(href);
        else {
          livePushedRef.current = true;
          router.push(href);
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, currentQuery, paramsString, router, startSearchTransition, slug]);

  // Matching issue titles for the dropdown (#671), also debounced.
  useEffect(() => {
    const query = text.trim();
    // Suggestions already on screen are hidden by `suggestedFor` when they no
    // longer match, so there is nothing to clear here.
    if (!open || query.length < MIN_SUGGEST_LENGTH) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/issues/suggest?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as { issues?: IssueSuggestion[] };
        setSuggestedFor(query);
        setIssueSuggestions(body.issues ?? []);
      } catch {
        // Aborted by the next keystroke, or offline: suggest nothing.
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, open]);

  // Only active types are suggested; inactive ones still work in a shared link.
  const tagSuggestions: Suggestion[] = open
    ? suggestTags(tagTypes.filter((t) => t.isActive !== false), text, selectedNames).map(
        (type) => ({ kind: "tag", id: type.id, name: type.name }),
      )
    : [];
  // Only results for the text in the box now; stale ones would mislead.
  const titleSuggestions: Suggestion[] =
    open && suggestedFor === text.trim()
      ? issueSuggestions.map((issue) => ({
          kind: "issue",
          id: issue.id,
          number: issue.number,
          title: issue.title,
          path: issue.path,
        }))
      : [];
  const suggestions = [...tagSuggestions, ...titleSuggestions];

  function addTag(name: string) {
    // The typed text was only for finding the tag, so put the real search back.
    const restore = queryBeforeEditingRef.current;
    setText(restore);
    skipLiveRef.current = restore;
    setOpen(false);
    setActive(-1);
    // Replace a live-search entry still in history so it does not linger.
    updateMany(
      {
        [TAGS_PARAM]: serializeTags([...selectedNames, name]),
        q: restore,
      },
      livePushedRef.current,
    );
    livePushedRef.current = false;
  }

  function applyQueryNow() {
    const trimmed = text.trim();
    queryBeforeEditingRef.current = trimmed;
    if (trimmed !== currentQuery.trim()) skipLiveRef.current = trimmed;
    update("q", trimmed);
    livePushedRef.current = false;
  }

  function pickSuggestion(suggestion: Suggestion) {
    if (suggestion.kind === "tag") {
      addTag(suggestion.name);
      return;
    }
    setOpen(false);
    setActive(-1);
    router.push(suggestion.path);
  }

  function removeTag(name: string) {
    update(TAGS_PARAM, serializeTags(selectedNames.filter((n) => n !== name)));
  }

  /** Real link for each chip, so removing a tag also works before hydration. */
  function tagHref(name: string) {
    const next = new URLSearchParams(params.toString());
    const rest = serializeTags(selectedNames.filter((n) => n !== name));
    if (rest) next.set(TAGS_PARAM, rest);
    else next.delete(TAGS_PARAM);
    next.delete("page");
    return listHref(slug, next);
  }

  const currentSort = parseBugSort(
    params.get("sort"),
    defaultSortFor(parseMineFilter(params.get("mine"))),
  );
  const currentArea = parseProjectAreaFilter(params.get(AREA_PARAM), areas) ?? "";
  const currentMine = parseMineFilter(params.get("mine")) ?? "";
  const currentMilestone = params.get(MILESTONE_PARAM) ?? "";
  const currentTrack = parseTrackFilter(params.get(TRACK_PARAM));

  const currentStage = stageFilterValue(params.get(STAGE_PARAM));

  const activeFilterCount = [
    Boolean(currentStage),
    Boolean(params.get("status")),
    Boolean(currentMine),
    selectedNames.length > 0,
    Boolean(currentArea),
    Boolean(currentMilestone),
    currentTrack !== "product",
  ].filter(Boolean).length;

  // Only worth offering when there is something to clear (#336).
  const hasActiveFilters = FILTER_PARAMS.some((key) =>
    key === "mine" ? Boolean(currentMine) : (params.get(key) ?? "") !== "",
  );

  function clearAllFilters() {
    // Empty the box straight away: until the navigation lands, the local draft
    // would otherwise keep showing the text that was just cleared.
    skipLiveRef.current = "";
    livePushedRef.current = false;
    setText("");
    setOpen(false);
    setActive(-1);
    setFilterOpen(false);
    // The compact toolbar sits under the status tabs, so clearing keeps the tab.
    router.push(issuesPath(slug, compact ? pathStatus : "all"));
  }

  const milestoneValue =
    milestones.some((m) => m.id === params.get(MILESTONE_PARAM)) ||
    params.get(MILESTONE_PARAM) === MILESTONE_NONE
      ? (params.get(MILESTONE_PARAM) ?? "")
      : "";

  const selectClass =
    "w-full appearance-none rounded-xl border border-zk-border bg-zk-surface px-3.5 py-0 h-11 text-sm font-medium text-zk-text focus:border-electric-blue focus:outline-none focus:ring-1 focus:ring-electric-blue";
  const fieldLabelClass = "mb-1.5 block text-[13px] font-semibold text-zk-text2";

  return (
    <div className={`space-y-3 print:hidden ${compact ? "issues-filters" : ""}`}>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className={`min-w-0 flex-1 basis-[240px] max-w-xs ${compact ? `issues-search ${searchExpanded ? "issues-search-expanded" : ""}` : ""}`}>
          <label htmlFor="q" className="sr-only">Search</label>
          <div className="relative" aria-busy={isSearching} data-testid="search-box">
            <div className="flex h-[42px] items-center gap-2 rounded-full border border-zk-border bg-zk-surface px-4">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zk-muted" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
              </svg>
              {compact ? (
                <button ref={searchTriggerRef} type="button" className="issues-search-trigger"
                  aria-label={searchExpanded ? "Close search" : "Search issues"} title={searchExpanded ? "Close search" : "Search issues"} aria-expanded={searchExpanded} aria-controls="q"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (searchExpanded) {
                      setSearchExpanded(false); setOpen(false); setActive(-1);
                      requestAnimationFrame(() => searchTriggerRef.current?.focus());
                    } else {
                      setSearchExpanded(true);
                      requestAnimationFrame(() => inputRef.current?.focus());
                    }
                  }}>
                  {searchExpanded ? <Image src="/icons/issues-close.svg" width={18} height={18} alt="" /> : null}
                </button>
              ) : null}
              <input
                ref={inputRef}
                id="q"
                name="q"
                role="combobox"
                aria-haspopup="listbox"
                aria-autocomplete="list"
                aria-expanded={suggestions.length > 0}
                aria-controls={suggestions.length > 0 ? listId : undefined}
                aria-activedescendant={active >= 0 && suggestions[active] ? `${listId}-${active}` : undefined}
                autoComplete="off"
                value={text}
                placeholder={compact ? "Search issues…" : "Search, or type a tag like Design"}
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-zk-text outline-none placeholder:text-zk-muted"
                onChange={(event) => { setText(event.target.value); setOpen(true); setActive(-1); }}
                onFocus={() => { setIsFocused(true); queryBeforeEditingRef.current = currentQuery; livePushedRef.current = false; setOpen(true); }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && suggestions.length > 0) { event.preventDefault(); setActive((i) => (i + 1) % suggestions.length); }
                  else if (event.key === "ArrowUp" && suggestions.length > 0) { event.preventDefault(); setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1)); }
                  else if (event.key === "Escape") {
                    setOpen(false); setActive(-1); setSearchExpanded(false);
                    if (compact) requestAnimationFrame(() => searchTriggerRef.current?.focus());
                  }
                  else if (event.key === "Enter") {
                    event.preventDefault();
                    const picked = active >= 0 ? suggestions[active] : undefined;
                    if (picked) pickSuggestion(picked); else applyQueryNow();
                  } else if (event.key === "Backspace" && text === "" && selectedNames.length > 0) {
                    removeTag(selectedNames[selectedNames.length - 1]);
                  }
                }}
                onBlur={() => { setIsFocused(false); setOpen(false); setActive(-1); }}
              />
              {!text && shortcutsEnabled ? (
                <kbd className="hidden shrink-0 select-none rounded-md border border-zk-border px-1.5 py-0.5 text-[11px] font-bold text-zk-muted sm:inline-flex">/</kbd>
              ) : null}
            </div>
            {suggestions.length > 0 ? (
              <ul id={listId} role="listbox" aria-label="Search suggestions" className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-[20px] border border-zk-border bg-zk-surface py-1 text-sm shadow-[0_20px_48px_rgba(11,23,51,0.16)]">
                {suggestions.map((suggestion, index) => (
                  // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                  <li
                    key={`${suggestion.kind}-${suggestion.id}`}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pickSuggestion(suggestion)}
                    className={`flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 ${index === active ? "bg-zk-tint text-zk-accent" : "text-zk-text"}`}
                  >
                    {suggestion.kind === "tag" ? (
                      <><span className="font-semibold">{suggestion.name}</span><span className="shrink-0 text-xs text-zk-muted">Filter by tag</span></>
                    ) : (
                      <><span className="min-w-0 truncate"><span className="tabular-nums text-zk-muted">#{suggestion.number}</span> {suggestion.title}</span><span className="shrink-0 text-xs text-zk-muted">Open issue</span></>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <button type="button" onClick={applyQueryNow} disabled={isSearching} className={`inline-flex h-[42px] shrink-0 items-center gap-1.5 rounded-full border-0 bg-electric-blue-strong px-4 text-sm font-bold text-white shadow-[0_8px_20px_rgba(46,111,239,0.30)] transition-colors hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-70 ${compact ? "issues-search-submit" : ""}`}>
          {isSearching ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
          )}
          <span>Search</span>
        </button>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {/* The Issues page (compact) has no Filter button: the stages replace it. */}
          {compact ? null : (
          <div className="relative shrink-0">
            <button
              ref={filterButtonRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={filterOpen}
              aria-controls={filterPanelId}
              aria-label={activeFilterCount > 0 ? `Filter (${activeFilterCount} active)` : "Filter"}
              onClick={() => setFilterOpen((prev) => !prev)}
              className={`issues-filter-trigger inline-flex h-[42px] items-center gap-2 rounded-full border px-4 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 ${
                activeFilterCount > 0 || filterOpen
                  ? "border-electric-blue-strong bg-zk-tint text-zk-accent"
                  : "border-zk-border bg-zk-surface text-zk-text hover:bg-zk-chip"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M22 3H2l8 9.5V19l4 2v-8.5z" /></svg>
              <span>Filter</span>
              {activeFilterCount > 0 ? (
                <span aria-hidden="true" className="inline-flex items-center justify-center rounded-full bg-electric-blue-strong px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">{activeFilterCount}</span>
              ) : null}
              <svg className={`h-3.5 w-3.5 text-current transition-transform ${filterOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" /></svg>
            </button>

            {filterOpen ? (
              <div ref={filterPanelRef} id={filterPanelId} role="dialog" aria-label="Filters" className="issues-filter-dialog absolute right-0 z-30 mt-2.5 flex w-[340px] max-w-[calc(100vw-3rem)] flex-col gap-3.5 rounded-[20px] border border-zk-border bg-zk-surface p-5 shadow-[0_20px_48px_rgba(11,23,51,0.16)]">
                <div className="flex items-center justify-between border-b border-zk-divider pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-extrabold text-zk-text">Filters</span>
                    {activeFilterCount > 0 ? <span className="rounded-full bg-zk-tint px-2 py-0.5 text-[11px] font-bold text-zk-accent">{activeFilterCount} active</span> : null}
                  </div>
                  {hasActiveFilters ? (
                    <button type="button" onClick={clearAllFilters} className="h-8 rounded-full px-2.5 text-[13px] font-bold text-zk-accent hover:bg-zk-tint">Reset</button>
                  ) : null}
                </div>

                <div className="max-h-[70vh] space-y-3.5 overflow-y-auto pr-1">
                  <div>
                    <label htmlFor="mine" className={fieldLabelClass}>Show</label>
                    <FilterSelect aria-label="Show" id="mine" className={selectClass} value={currentMine === "reported" ? "created" : currentMine} onValueChange={(value) => update("mine", value)}>
                      <option value="">All issues</option>
                      {MINE_FILTER_OPTIONS.map((option) => (<option key={option} value={option}>{mineFilterLabels[option]}</option>))}
                    </FilterSelect>
                  </div>
                  <div>
                    <label htmlFor="stage" className={fieldLabelClass}>Kind</label>
                    <FilterSelect aria-label="Kind" id="stage" className={selectClass} value={currentStage} onValueChange={(value) => update(STAGE_PARAM, value)}>
                      <option value="">All issues</option>
                      {STAGE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{stageCounts ? `${option.label} (${stageCounts[option.value]})` : option.label}</option>
                      ))}
                    </FilterSelect>
                  </div>
                  <div>
                    <label htmlFor="status" className={fieldLabelClass}>Status</label>
                    <FilterSelect aria-label="Status" id="status" className={selectClass} value={params.get("status") ?? ""} onValueChange={(value) => update("status", value)}>
                      <option value="">All</option>
                      {statuses.map((status) => (<option key={status} value={status}>{statusLabel[status]}</option>))}
                      <option value={FINISHED_STATUS_FILTER}>Closed (incl. resolved)</option>
                    </FilterSelect>
                  </div>
                  <div>
                    <label htmlFor="category" className={fieldLabelClass}>Category</label>
                    <FilterSelect aria-label="Category" id="category" className={selectClass} value={selectedNames[0] ?? ""} onValueChange={(value) => update(TAGS_PARAM, serializeTags([value]))}>
                      <option value="">All</option>
                      {Array.from(new Set(["Features", "Fixes", "Design", "Marketing", "Documentation", "Other", ...tagTypes.filter((t) => t.isActive !== false).map((t) => t.name)])).map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </FilterSelect>
                  </div>
                  {areas.length > 0 ? (
                    <div>
                      <label htmlFor="area" className={fieldLabelClass}>Area</label>
                      <FilterSelect aria-label="Area" id="area" className={selectClass} value={currentArea} onValueChange={(value) => update(AREA_PARAM, value)}>
                        <option value="">All</option>
                        {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                        <option value={AREA_NONE}>No area</option>
                      </FilterSelect>
                    </div>
                  ) : null}
                  {milestones.length > 0 ? (
                    <div>
                      <label htmlFor="milestone" className={fieldLabelClass}>Milestone</label>
                      <FilterSelect aria-label="Milestone" id="milestone" className={selectClass} value={milestoneValue} onValueChange={(value) => update(MILESTONE_PARAM, value)}>
                        <option value="">All</option>
                        {milestones.map((m) => (<option key={m.id} value={m.id}>{m.title}{m.isClosed ? " (closed)" : ""}</option>))}
                        <option value={MILESTONE_NONE}>No milestone</option>
                      </FilterSelect>
                    </div>
                  ) : null}
                  <div>
                    <label htmlFor="track" className={fieldLabelClass}>Track</label>
                    <FilterSelect aria-label="Track" id="track" className={selectClass} value={currentTrack} onValueChange={(value) => update(TRACK_PARAM, value)}>
                      <option value="product">Product</option>
                      <option value="marketing">Marketing</option>
                      <option value="all">All</option>
                    </FilterSelect>
                  </div>
                  <div>
                    <label htmlFor="sort" className={fieldLabelClass}>Sort By</label>
                    <FilterSelect aria-label="Sort By" id="sort" className={selectClass} value={currentSort} onValueChange={(value) => update("sort", value)}>
                      {BUG_SORT_OPTIONS.map((option) => (<option key={option} value={option}>{bugSortLabels[option]}</option>))}
                    </FilterSelect>
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setFilterOpen(false)} className="h-[42px] flex-1 rounded-full border border-zk-border bg-zk-surface font-bold text-zk-text hover:bg-zk-chip">Cancel</button>
                  <button type="button" onClick={() => setFilterOpen(false)} className="h-[42px] flex-1 rounded-full border-0 bg-electric-blue-strong font-bold text-white shadow-[0_8px_20px_rgba(46,111,239,0.30)] hover:brightness-105">Apply filters</button>
                </div>
              </div>
            ) : null}
          </div>
          )}
        </div>
      </div>

      {selectedTags.length > 0 ? (
        <ul className="issues-selected-tags flex flex-wrap items-center gap-1.5" aria-label="Tag filters">
          {selectedTags.map((type) => (
            <li key={type.id}>
              <a href={tagHref(type.name)} onClick={(event) => { event.preventDefault(); removeTag(type.name); }} aria-label={`Remove tag ${type.name}`} className="inline-flex items-center gap-1 rounded-full border border-zk-border bg-zk-tint py-0.5 pl-2.5 pr-1.5 text-xs font-bold text-zk-accent hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue">
                {type.name}<span aria-hidden="true">×</span>
              </a>
            </li>
          ))}
          {selectedTags.length > 1 ? (
            <li><button type="button" onClick={() => update(TAGS_PARAM, "")} className="px-1 text-xs text-zk-muted hover:text-zk-text hover:underline">Clear tags</button></li>
          ) : null}
        </ul>
      ) : null}

      {hasActiveFilters && (!compact || FILTER_PARAMS.some((param) => param !== "status" && Boolean(params.get(param)))) ? (
        <div className="issues-active-filters flex w-full flex-wrap items-center gap-2 border-t border-zk-divider pt-2">
          <span className="text-xs font-semibold text-zk-muted">Active filters:</span>
          {currentQuery ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-zk-border bg-zk-tint py-0.5 pl-2.5 pr-1.5 text-xs font-bold text-zk-accent">
              Search: &ldquo;{currentQuery}&rdquo;
              <button type="button" onClick={() => { setText(""); update("q", ""); }} aria-label="Remove search filter" className="ml-0.5 rounded-full p-0.5 hover:bg-zk-chip">✕</button>
            </span>
          ) : null}
          {currentStage ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-zk-border bg-zk-chip py-0.5 pl-2.5 pr-1.5 text-xs font-bold text-zk-text">
              Kind: {STAGE_OPTIONS.find((option) => option.value === currentStage)?.label}
              <button type="button" onClick={() => update(STAGE_PARAM, "")} aria-label="Remove stage filter" className="ml-0.5 rounded-full p-0.5 text-zk-muted hover:bg-zk-divider">✕</button>
            </span>
          ) : null}
          {params.get("status") ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-transparent bg-zk-ok-bg py-0.5 pl-2.5 pr-1.5 text-xs font-bold text-zk-ok-fg">
              Status: {statusFilterLabel(params.get("status") ?? "")}
              <button type="button" onClick={() => update("status", "")} aria-label="Remove status filter" className="ml-0.5 rounded-full p-0.5 hover:bg-zk-chip">✕</button>
            </span>
          ) : null}
          {selectedTags.map((type) => (
            <span key={type.id} className="inline-flex items-center gap-1 rounded-full border border-zk-border bg-zk-tint py-0.5 pl-2.5 pr-1.5 text-xs font-bold text-zk-accent">
              Category: {type.name}
              <button type="button" onClick={() => removeTag(type.name)} aria-label={`Remove tag ${type.name}`} className="ml-0.5 rounded-full p-0.5 hover:bg-zk-chip">✕</button>
            </span>
          ))}
          {currentArea ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-zk-border bg-zk-tint py-0.5 pl-2.5 pr-1.5 text-xs font-bold text-zk-accent">
              Area: {currentArea === AREA_NONE ? "No area" : areas.find((area) => area.id === currentArea)?.name ?? currentArea}
              <button type="button" onClick={() => update(AREA_PARAM, "")} aria-label="Remove area filter" className="ml-0.5 rounded-full p-0.5 hover:bg-zk-chip">✕</button>
            </span>
          ) : null}
          {currentMilestone ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-zk-border bg-zk-chip py-0.5 pl-2.5 pr-1.5 text-xs font-bold text-zk-text">
              Milestone: {currentMilestone === MILESTONE_NONE ? "No milestone" : milestones.find((milestone) => milestone.id === currentMilestone)?.title ?? currentMilestone}
              <button type="button" onClick={() => update(MILESTONE_PARAM, "")} aria-label="Remove milestone filter" className="ml-0.5 rounded-full p-0.5 text-zk-muted hover:bg-zk-divider">✕</button>
            </span>
          ) : null}
          {currentTrack !== "product" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-zk-border bg-zk-tint py-0.5 pl-2.5 pr-1.5 text-xs font-bold text-zk-accent">
              Track: {currentTrack === "marketing" ? "Marketing" : "All"}
              <button type="button" onClick={() => update(TRACK_PARAM, "")} aria-label="Remove track filter" className="ml-0.5 rounded-full p-0.5 hover:bg-zk-chip">✕</button>
            </span>
          ) : null}
          {currentMine ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-zk-border bg-zk-chip py-0.5 pl-2.5 pr-1.5 text-xs font-bold text-zk-text">
              View: {mineFilterLabels[currentMine as keyof typeof mineFilterLabels] ?? currentMine}
              <button type="button" onClick={() => update("mine", "")} aria-label="Remove view filter" className="ml-0.5 rounded-full p-0.5 text-zk-muted hover:bg-zk-divider">✕</button>
            </span>
          ) : null}
          <button type="button" onClick={clearAllFilters} className="ml-auto rounded-full border border-zk-border bg-zk-surface px-3 py-1.5 text-xs font-bold text-zk-text hover:bg-zk-chip focus:border-electric-blue focus:outline-none focus:ring-1 focus:ring-electric-blue">
            Clear all filters
          </button>
        </div>
      ) : null}
    </div>
  );
}


export { IssueFilters as BugFilters };
