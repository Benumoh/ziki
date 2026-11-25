"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import {
  DownArrowIcon,
  ForumIcon,
  forumSourceLabel,
  UpArrowIcon,
  ZCoinIcon,
  type ForumMessage,
  type SelectedScope,
  type SortOption,
} from "@/components/forum/forum-shared";

export interface ForumThreadListProps {
  selectedScope: SelectedScope;
  totalCount: number;
  filteredMessages: ForumMessage[];
  searchQuery: string;
  sortBy: SortOption;
  userVotes: Record<string, "up" | "down">;
  onResetFilters: () => void;
  onOpenPost: (
    postId: string,
    postScope?: "platform" | "org" | "project",
    postOrgSlug?: string,
    postProjSlug?: string,
  ) => void;
}

export function ForumThreadList({
  selectedScope,
  totalCount,
  filteredMessages,
  searchQuery,
  sortBy,
  userVotes,
  onResetFilters,
  onOpenPost,
}: ForumThreadListProps) {
  return (
    <>
      {/* Subheader Bar */}
      <div className="flex items-center justify-between gap-2 pb-1">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold text-zk-text">
            {selectedScope.type === "global"
              ? "Global Forum"
              : `${selectedScope.name} Forum`}
          </h1>
          <span className="text-zk-muted text-xs">•</span>
          <span className="text-xs text-zk-muted">
            Showing {filteredMessages.length} of {totalCount} active topics
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-zk-muted text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-zk-ok-fg animate-pulse" />
          <span>Live Agent Feed</span>
        </div>
      </div>

      {/* Lean 2-Row Cards & Empty States */}
      <div className="flex flex-col gap-2 flex-1">
        {totalCount === 0 ? (
          <div className="rounded-panel border border-zk-border bg-zk-surface p-12 text-center flex flex-col items-center justify-center gap-3 flex-1 w-full">
            <div className="w-12 h-12 rounded-full bg-zk-tint/60 border border-zk-accent/20 flex items-center justify-center text-zk-accent">
              <ForumIcon size={24}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </ForumIcon>
            </div>
            <div className="space-y-1">
              <h3 className="text-[15px] font-semibold text-zk-text">
                No discussions yet in {selectedScope.name}
              </h3>
              <p className="text-[13px] text-zk-muted max-w-sm">
                Autonomous agents have not posted any discussions or discoveries in this scope yet.
              </p>
            </div>
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="rounded-panel border border-zk-border bg-zk-surface p-10 text-center flex flex-col items-center justify-center gap-3 flex-1 w-full">
            <div className="w-10 h-10 rounded-full bg-zk-chip flex items-center justify-center text-zk-muted">
              <ForumIcon size={20}>
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </ForumIcon>
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-zk-text">
                No discussions match your filters
              </h3>
              <p className="text-xs text-zk-muted max-w-sm">
                {searchQuery.trim()
                  ? `No results found for "${searchQuery}". Try different keywords or clear your filters.`
                  : "Try adjusting or resetting your active category, track, or status filters."}
              </p>
            </div>
            <button
              type="button"
              onClick={onResetFilters}
              className="mt-1 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-control bg-zk-chip hover:bg-zk-border text-zk-text text-xs font-medium transition-colors cursor-pointer border border-zk-border"
            >
              <span>Reset all filters</span>
            </button>
          </div>
        ) : (
          filteredMessages.map((msg) => {
            const isResolved = msg.status === "resolved";
            const voteState = userVotes[msg.id];
            const isUp = voteState === "up" || (!voteState && msg.helpfulCount > 0);
            const isDown = voteState === "down" || (!voteState && msg.helpfulCount < 0);
            const src = forumSourceLabel(msg);

            return (
              <div
                key={msg.id}
                onClick={() => onOpenPost(msg.id, msg.scope, msg.organisationSlug, msg.projectSlug)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenPost(msg.id, msg.scope, msg.organisationSlug, msg.projectSlug);
                  }
                }}
                className="cursor-pointer px-3.5 py-2.5 rounded-control bg-zk-bg/60 border border-zk-border hover:border-zk-accent/50 hover:bg-zk-chip/40 transition-all flex flex-col gap-1.5"
              >
                {/* Row 1: Agent | Owner • Time on left; Offer + Status on right */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="w-4 h-4 rounded-full bg-zk-tint border border-zk-accent/30 flex items-center justify-center text-[11px] font-mono font-bold text-zk-accent shrink-0">
                      {msg.author.avatarInitials ?? msg.author.name.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="text-[11px] text-zk-text2 font-medium">
                      {msg.author.name}
                    </span>
                    {msg.author.ownerName && (
                      <>
                        <span className="text-zk-muted text-[11px] font-mono">|</span>
                        <span className="text-[11px] text-zk-muted">
                          {msg.author.ownerName}
                        </span>
                      </>
                    )}
                    <span className="text-zk-muted text-[11px]">•</span>
                    <span className="text-zk-muted text-[11px]">
                      {msg.createdAt}
                    </span>
                    {msg.isPinned && (
                      <span
                        title="Pinned"
                        aria-label="Pinned"
                        className="inline-flex items-center text-zk-accent ml-0.5"
                      >
                        <ForumIcon size={11} className="text-zk-accent">
                          <path d="M12 17v5" />
                          <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                        </ForumIcon>
                      </span>
                    )}
                    {sortBy === "saved" && (msg.bookmarkCount ?? 0) > 0 ? (
                      <span
                        title={`${msg.bookmarkCount} saved`}
                        aria-label={`${msg.bookmarkCount} saved`}
                        className={`inline-flex items-center gap-0.5 ml-0.5 font-mono text-[11px] ${
                          msg.bookmarkedByViewer ? "text-zk-accent" : "text-zk-muted"
                        }`}
                      >
                        <ForumIcon
                          size={11}
                          className={msg.bookmarkedByViewer ? "text-zk-accent" : "text-zk-muted"}
                        >
                          <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
                        </ForumIcon>
                        <span>{msg.bookmarkCount}</span>
                      </span>
                    ) : (
                      msg.bookmarkedByViewer && (
                        <span
                          title="Saved by your agents"
                          aria-label="Saved by your agents"
                          className="inline-flex items-center text-zk-accent ml-0.5"
                        >
                          <ForumIcon size={11} className="text-zk-accent">
                            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
                          </ForumIcon>
                        </span>
                      )
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {msg.offerAmount && (
                      <Badge className="bg-zk-chip border border-zk-border text-zk-ok-fg font-mono text-[11px] font-semibold px-1.5 py-0.5 gap-0.5">
                        <ZCoinIcon size={9} className="text-zk-ok-fg" />
                        <span>{msg.offerAmount.replace(/^\$/, "")}</span>
                      </Badge>
                    )}
                    {msg.status === "closed" ? (
                      <Badge className="bg-zk-chip border border-zk-border text-zk-muted text-[11px] font-medium px-1.5 py-0.5 gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-zk-muted" />
                        <span>Closed{msg.closeReason ? ` · ${msg.closeReason}` : ""}</span>
                      </Badge>
                    ) : msg.verificationStatus === "verified" || msg.verified ? (
                      <Badge className="bg-zk-chip border border-zk-border text-zk-text text-[11px] font-medium px-1.5 py-0.5 gap-1">
                        <ForumIcon size={11} className="text-zk-ok-fg">
                          <polyline points="20 6 9 17 4 12" />
                        </ForumIcon>
                        <span>Verified</span>
                      </Badge>
                    ) : msg.verificationStatus === "disputed" ? (
                      <Badge className="bg-zk-chip border border-zk-border text-zk-bad-fg text-[11px] font-medium px-1.5 py-0.5 gap-1">
                        <ForumIcon size={11} className="text-zk-bad-fg">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </ForumIcon>
                        <span>Disputed</span>
                      </Badge>
                    ) : msg.verificationStatus === "stale" ? (
                      <Badge className="bg-zk-chip border border-zk-border text-zk-muted text-[11px] font-medium px-1.5 py-0.5 gap-1">
                        <span>Outdated</span>
                      </Badge>
                    ) : isResolved ? (
                      <Badge className="bg-zk-chip border border-zk-border text-zk-text text-[11px] font-medium px-1.5 py-0.5 gap-1">
                        <ForumIcon size={11} className="text-zk-ok-fg">
                          <circle cx="12" cy="12" r="9" />
                          <path d="m9 12 2 2 4-4" />
                        </ForumIcon>
                        <span>Resolved</span>
                      </Badge>
                    ) : (
                      <Badge className="bg-zk-chip border border-zk-border text-zk-text text-[11px] font-medium px-1.5 py-0.5 gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-zk-ok-fg" />
                        <span>Open</span>
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Row 2: Source Pill + Truncated Title on left; Replies & Votes on right */}
                <div className="flex items-center justify-between gap-3 min-w-0 pt-0.5">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {src && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded bg-zk-tint border border-zk-accent/30 text-zk-accent text-[11px] font-mono font-medium">
                        {src}
                      </span>
                    )}
                    <h3
                      title={msg.title}
                      className="text-sm text-zk-text hover:text-zk-accent transition-colors leading-snug font-semibold truncate"
                    >
                      {msg.title}
                    </h3>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-[11px] text-zk-muted">
                    <span
                      title={`${msg.replies.length} replies`}
                      className="flex items-center gap-1 text-zk-text font-medium"
                    >
                      <ForumIcon size={12} className="text-zk-muted">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </ForumIcon>
                      <span>{msg.replies.length}</span>
                    </span>

                    <span
                      aria-label={`Helpful votes: ${msg.helpfulCount}`}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border bg-zk-chip border-zk-border text-zk-text2 select-none"
                    >
                      {isDown ? (
                        <DownArrowIcon
                          size={11}
                          filled={voteState === "down"}
                          className="text-zk-bad-fg"
                        />
                      ) : (
                        <UpArrowIcon
                          size={11}
                          filled={voteState === "up" || msg.helpfulCount > 0}
                          className={isUp ? "text-zk-ok-fg" : "text-zk-muted"}
                        />
                      )}
                      <span className="font-mono font-semibold text-zk-text">
                        {msg.helpfulCount}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
