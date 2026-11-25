"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ForumIcon,
  POPULAR_TAGS,
  type FeedFilter,
  type ForumMessage,
  type SortOption,
  type StatusFilter,
  type TrackFilter,
} from "@/components/forum/forum-shared";

export interface ForumToolbarProps {
  messages: ForumMessage[];
  trackFilter: TrackFilter;
  onTrackFilterChange: (track: TrackFilter) => void;
  feedFilter: FeedFilter;
  onFeedFilterChange: (feed: FeedFilter) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (status: StatusFilter) => void;
  pinnedOnly: boolean;
  onPinnedOnlyChange: (value: boolean) => void;
  selectedTag: string | null;
  onSelectedTagChange: (tag: string | null) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  sortBy: SortOption;
  onSortByChange: (sort: SortOption) => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function ForumToolbar({
  messages,
  trackFilter,
  onTrackFilterChange,
  feedFilter,
  onFeedFilterChange,
  statusFilter,
  onStatusFilterChange,
  pinnedOnly,
  onPinnedOnlyChange,
  selectedTag,
  onSelectedTagChange,
  searchQuery,
  onSearchQueryChange,
  sortBy,
  onSortByChange,
  hasActiveFilters,
  onClearFilters,
}: ForumToolbarProps) {
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [popularTagsOpen, setPopularTagsOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const menusRef = useRef<HTMLDivElement>(null);
  const hasPopoverFilter = statusFilter !== "all" || pinnedOnly;

  useEffect(() => {
    if (!filterModalOpen && !popularTagsOpen && !sortMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (menusRef.current && !menusRef.current.contains(event.target as Node)) {
        setFilterModalOpen(false);
        setPopularTagsOpen(false);
        setSortMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFilterModalOpen(false);
        setPopularTagsOpen(false);
        setSortMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [filterModalOpen, popularTagsOpen, sortMenuOpen]);

  return (
    <>
      {/* Top Row with Tracks */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-[13px] px-1 pb-1">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-zk-chip/60 p-0.5 rounded-control border border-zk-border">
            <button
              type="button"
              onClick={() => onTrackFilterChange("all")}
              className={`px-2 py-0.5 rounded-chip text-xs transition-colors cursor-pointer ${
                trackFilter === "all"
                  ? "bg-zk-surface text-zk-text font-medium"
                  : "text-zk-muted hover:text-zk-text"
              }`}
            >
              All Tracks
            </button>
            <button
              type="button"
              onClick={() => onTrackFilterChange(trackFilter === "product" ? "all" : "product")}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-chip text-xs transition-colors cursor-pointer ${
                trackFilter === "product"
                  ? "bg-zk-surface text-zk-accent font-semibold"
                  : "text-zk-muted hover:text-zk-text"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-zk-muted" />
              <span>Your App</span>
            </button>
            <button
              type="button"
              onClick={() => onTrackFilterChange(trackFilter === "marketing" ? "all" : "marketing")}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-chip text-xs transition-colors cursor-pointer ${
                trackFilter === "marketing"
                  ? "bg-zk-surface text-zk-accent font-semibold"
                  : "text-zk-muted hover:text-zk-text"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-electric-blue" />
              <span>Marketing</span>
            </button>
            <button
              type="button"
              onClick={() => onTrackFilterChange(trackFilter === "security" ? "all" : "security")}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-chip text-xs transition-colors cursor-pointer ${
                trackFilter === "security"
                  ? "bg-zk-surface text-zk-accent font-semibold"
                  : "text-zk-muted hover:text-zk-text"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-zk-ok-fg" />
              <span>Security</span>
            </button>
          </div>
        </div>
      </div>

      {/* Sub-Filter Bar (Feeds, Search, Filter Modal, Popular Tags, Sort) */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-2 border-b border-zk-border">
        {/* Left: Feeds & Views */}
        <div className="flex items-center gap-1.5 relative flex-wrap">
          <button
            type="button"
            onClick={() => onFeedFilterChange("all")}
            className={`px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors cursor-pointer ${
              feedFilter === "all"
                ? "bg-zk-tint text-zk-accent border-zk-accent/30 font-semibold"
                : "bg-zk-chip hover:bg-zk-seg text-zk-text2 hover:text-zk-text border-zk-border"
            }`}
          >
            <span>All Discussions</span>
            <span className="ml-1.5 font-mono text-[11px] opacity-75">
              {messages.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onFeedFilterChange("ask")}
            className={`px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors cursor-pointer ${
              feedFilter === "ask"
                ? "bg-zk-tint text-zk-accent border-zk-accent/30 font-semibold"
                : "bg-zk-chip hover:bg-zk-seg text-zk-text2 hover:text-zk-text border-zk-border"
            }`}
          >
            <span>Asks</span>
            <span className="ml-1.5 font-mono text-[11px] opacity-75">
              {messages.filter((m) => m.kind === "ask").length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onFeedFilterChange("report")}
            className={`px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors cursor-pointer ${
              feedFilter === "report"
                ? "bg-zk-tint text-zk-accent border-zk-accent/30 font-semibold"
                : "bg-zk-chip hover:bg-zk-seg text-zk-text2 hover:text-zk-text border-zk-border"
            }`}
          >
            <span>Discoveries</span>
            <span className="ml-1.5 font-mono text-[11px] opacity-75">
              {messages.filter((m) => m.kind === "report").length}
            </span>
          </button>
        </div>

        {/* Right Action Controls: Clear, Search, Filter Modal, Popular Tags Dropdown, Sort */}
        <div ref={menusRef} className="flex items-center gap-2 shrink-0 flex-wrap relative">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              aria-label="Clear filters"
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-chip border border-zk-border bg-zk-surface hover:bg-zk-chip text-zk-muted hover:text-zk-text text-xs font-medium transition-colors cursor-pointer"
            >
              <span>Clear</span>
              <span aria-hidden="true">×</span>
            </button>
          )}
          <div className="relative flex items-center">
            <ForumIcon
              size={14}
              className="absolute left-2.5 text-zk-muted pointer-events-none"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </ForumIcon>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Search forum..."
              aria-label="Search forum"
              className="w-40 sm:w-48 h-8 pl-8 pr-3 bg-zk-bg rounded-chip border border-zk-border text-zk-text placeholder-zk-muted text-[13px] focus:outline-none focus:border-zk-accent transition-colors"
            />
          </div>

          {/* Filter Modal */}
          <div className="relative">
            <button
              type="button"
              aria-label="Open filter modal"
              onClick={() => {
                setFilterModalOpen((prev) => !prev);
                setPopularTagsOpen(false);
                setSortMenuOpen(false);
              }}
              className={`flex items-center gap-1.5 h-8 px-2.5 rounded-chip border text-[13px] transition-colors cursor-pointer ${
                hasPopoverFilter || filterModalOpen
                  ? "bg-zk-tint border-zk-accent/40 text-zk-accent font-semibold"
                  : "bg-zk-chip hover:bg-zk-seg border-zk-border text-zk-text"
              }`}
            >
              <ForumIcon size={13} className="text-zk-muted">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </ForumIcon>
              <span>Filter</span>
              {hasPopoverFilter && (
                <span className="w-1.5 h-1.5 rounded-full bg-zk-accent" />
              )}
              <ForumIcon size={11} className="text-zk-muted">
                <path d="m6 9 6 6 6-6" />
              </ForumIcon>
            </button>

            {filterModalOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-52 rounded-panel bg-zk-surface border border-zk-border shadow-xl p-2 z-40 flex flex-col gap-1">
                <div className="px-2 py-1 text-[11px] uppercase tracking-wider text-zk-muted font-semibold border-b border-zk-border mb-1">
                  Filter by Status
                </div>
                {(
                  [
                    { id: "all", label: "All Statuses" },
                    { id: "open", label: "Open Only" },
                    { id: "resolved", label: "Resolved" },
                    { id: "verified", label: "Verified Only" },
                    { id: "closed", label: "Closed" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onStatusFilterChange(item.id);
                      setFilterModalOpen(false);
                    }}
                    className={`w-full px-2.5 py-1.5 text-left text-xs rounded-chip transition-colors cursor-pointer flex items-center justify-between ${
                      statusFilter === item.id
                        ? "bg-zk-tint text-zk-accent font-semibold"
                        : "text-zk-text2 hover:text-zk-text hover:bg-zk-chip"
                    }`}
                  >
                    <span>{item.label}</span>
                    {statusFilter === item.id && (
                      <ForumIcon size={12} className="text-zk-accent">
                        <polyline points="20 6 9 17 4 12" />
                      </ForumIcon>
                    )}
                  </button>
                ))}

                <div className="px-2 pt-2 pb-1 text-[11px] uppercase tracking-wider text-zk-muted font-semibold border-t border-zk-border mt-1">
                  Topics
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onPinnedOnlyChange(!pinnedOnly);
                    setFilterModalOpen(false);
                  }}
                  className={`w-full px-2.5 py-1.5 text-left text-xs rounded-chip transition-colors cursor-pointer flex items-center justify-between ${
                    pinnedOnly
                      ? "bg-zk-tint text-zk-accent font-semibold"
                      : "text-zk-text2 hover:text-zk-text hover:bg-zk-chip"
                  }`}
                >
                  <span>Pinned Only</span>
                  {pinnedOnly && (
                    <ForumIcon size={12} className="text-zk-accent">
                      <polyline points="20 6 9 17 4 12" />
                    </ForumIcon>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Popular Tags Dropdown */}
          <div className="relative">
            <button
              type="button"
              aria-label="Open popular tags dropdown"
              onClick={() => {
                setPopularTagsOpen((prev) => !prev);
                setFilterModalOpen(false);
                setSortMenuOpen(false);
              }}
              className={`flex items-center gap-1.5 h-8 px-2.5 rounded-chip border text-[13px] transition-colors cursor-pointer ${
                selectedTag || popularTagsOpen
                  ? "bg-zk-tint border-zk-accent/40 text-zk-accent font-semibold"
                  : "bg-zk-chip hover:bg-zk-seg border-zk-border text-zk-text"
              }`}
            >
              <ForumIcon size={13} className="text-zk-muted">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
              </ForumIcon>
              <span>Popular</span>
              {selectedTag && (
                <span className="w-1.5 h-1.5 rounded-full bg-zk-accent" />
              )}
              <ForumIcon size={11} className="text-zk-muted">
                <path d="m6 9 6 6 6-6" />
              </ForumIcon>
            </button>

            {popularTagsOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-52 rounded-panel bg-zk-surface border border-zk-border shadow-xl p-2.5 z-40 flex flex-col gap-2">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-zk-muted font-semibold border-b border-zk-border pb-1">
                  <span>Popular Tags</span>
                  {selectedTag && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectedTagChange(null);
                        setPopularTagsOpen(false);
                      }}
                      className="text-zk-accent hover:underline lowercase normal-case text-[11px] cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 pt-0.5 max-h-48 overflow-y-auto">
                  {POPULAR_TAGS.map((tag) => {
                    const active = selectedTag === tag || selectedTag === `#${tag}`;
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => {
                          onSelectedTagChange(active ? null : tag);
                          setPopularTagsOpen(false);
                        }}
                        className={`px-2 py-1 rounded text-[11px] border transition-colors cursor-pointer ${
                          active
                            ? "bg-zk-tint border-zk-accent/40 text-zk-accent font-semibold"
                            : "bg-zk-chip hover:bg-zk-seg border-zk-border text-zk-text2 hover:text-zk-text"
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sort Menu Dialog */}
          <div className="relative">
            <button
              type="button"
              aria-label="Open sort menu"
              aria-expanded={sortMenuOpen}
              onClick={() => {
                setSortMenuOpen((prev) => !prev);
                setFilterModalOpen(false);
                setPopularTagsOpen(false);
              }}
              className={`flex items-center gap-1 h-8 px-2.5 rounded-chip border text-[13px] transition-colors cursor-pointer ${
                sortMenuOpen
                  ? "bg-zk-tint border-zk-accent/40 text-zk-accent font-semibold"
                  : "bg-zk-chip hover:bg-zk-seg border-zk-border text-zk-text"
              }`}
            >
              <span className="text-zk-muted">Sort:</span>
              <span className="font-medium capitalize">{sortBy}</span>
              <ForumIcon size={12} className="text-zk-muted">
                <path d="m6 9 6 6 6-6" />
              </ForumIcon>
            </button>

            {sortMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-44 rounded-panel bg-zk-surface border border-zk-border shadow-xl p-1.5 z-40 flex flex-col gap-0.5">
                {(
                  [
                    { id: "trending", label: "Trending" },
                    { id: "newest", label: "Newest" },
                    { id: "helpful", label: "Most Helpful" },
                    { id: "replies", label: "Most Replies" },
                    { id: "saved", label: "Most Saved" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      onSortByChange(option.id);
                      setSortMenuOpen(false);
                    }}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-control text-xs text-left transition-colors cursor-pointer ${
                      sortBy === option.id
                        ? "bg-zk-tint text-zk-accent font-semibold"
                        : "text-zk-text2 hover:text-zk-text hover:bg-zk-chip/60"
                    }`}
                  >
                    <span>{option.label}</span>
                    {sortBy === option.id && (
                      <ForumIcon size={12} className="text-zk-accent">
                        <polyline points="20 6 9 17 4 12" />
                      </ForumIcon>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
