"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AccessibleOrganisation, ExternalProject } from "@/lib/forum-types";
import { buildForumSearchParams, parseForumSearchParams } from "@/lib/forum-url";
import { scopedForumPath, scopedForumPostPath } from "@/lib/project-paths";
import {
  DEFAULT_EXTERNAL_PROJECTS,
  DEFAULT_ORGANISATIONS,
  FORUM_SCROLLBAR_CLASS,
  trendingScore,
  type FeedFilter,
  type ForumCategory,
  type ForumMessage,
  type ForumReplyItem,
  type ForumViewMode,
  type MyAgentsView,
  type SelectedScope,
  type SortOption,
  type StatusFilter,
  type TrackFilter,
} from "@/components/forum/forum-shared";
import { ForumSidebar } from "@/components/forum/forum-sidebar";
import { ForumToolbar } from "@/components/forum/forum-toolbar";
import { ForumThreadList } from "@/components/forum/forum-thread-list";
import { ForumPostDetail } from "@/components/forum/forum-post-detail";

export { forumSourceLabel } from "@/components/forum/forum-shared";
export type { ForumCategory, ForumMessage, ForumReplyItem };

function useSafeRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

function useSafePathname() {
  try {
    return usePathname();
  } catch {
    return null;
  }
}

function useSafeSearchParams() {
  try {
    return useSearchParams();
  } catch {
    return null;
  }
}

export interface PublicMessageBoardProps {
  initialView?: ForumViewMode;
  initialPostId?: string;
  scope?: "platform" | "org" | "project";
  orgSlug?: string;
  orgName?: string;
  projectSlug?: string;
  projectName?: string;
  currentUserId?: string;
  organisations?: AccessibleOrganisation[];
  externalProjects?: ExternalProject[];
  initialMessages?: ForumMessage[];
}

export function PublicMessageBoard({
  initialView = "list",
  initialPostId,
  scope = "platform",
  orgSlug,
  orgName,
  projectSlug,
  projectName,
  currentUserId,
  organisations,
  externalProjects,
  initialMessages,
}: PublicMessageBoardProps = {}) {
  const router = useSafeRouter();
  const pathname = useSafePathname();
  const searchParams = useSafeSearchParams();
  const initialUrlFilters = parseForumSearchParams(searchParams);

  const [messages, setMessages] = useState<ForumMessage[]>(initialMessages ?? []);
  const [view, setView] = useState<ForumViewMode>(initialView);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(initialPostId ?? null);

  // Synchronize with external prop changes
  const [prevInitialPostId, setPrevInitialPostId] = useState(initialPostId);
  if (initialPostId !== prevInitialPostId) {
    setPrevInitialPostId(initialPostId);
    if (initialPostId) setSelectedPostId(initialPostId);
  }

  const [prevInitialView, setPrevInitialView] = useState(initialView);
  if (initialView !== prevInitialView) {
    setPrevInitialView(initialView);
    if (initialView) setView(initialView);
  }

  const [prevInitialMessages, setPrevInitialMessages] = useState(initialMessages);
  if (initialMessages !== prevInitialMessages) {
    setPrevInitialMessages(initialMessages);
    if (initialMessages) setMessages(initialMessages);
  }

  // Filters & sorting (initialized from URL query params)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialUrlFilters.statusFilter);
  const [feedFilter, setFeedFilter] = useState<FeedFilter>(initialUrlFilters.feedFilter);
  const [trackFilter, setTrackFilter] = useState<TrackFilter>(initialUrlFilters.trackFilter);
  const [selectedTag, setSelectedTag] = useState<string | null>(initialUrlFilters.selectedTag);
  const [pinnedOnly, setPinnedOnly] = useState(initialUrlFilters.pinnedOnly);
  const [myAgentsView, setMyAgentsView] = useState<MyAgentsView>(initialUrlFilters.myAgentsView);
  const [searchQuery, setSearchQuery] = useState(initialUrlFilters.searchQuery);
  const [sortBy, setSortBy] = useState<SortOption>(initialUrlFilters.sortBy);
  const [userVotes] = useState<Record<string, "up" | "down">>({});

  // Sync active filters & sort to URL query params in list view
  const currentUrlQuery = searchParams?.toString() ?? "";
  useEffect(() => {
    if (view !== "list" || !router || !pathname) return;
    const nextQuery = buildForumSearchParams({
      trackFilter,
      feedFilter,
      statusFilter,
      pinnedOnly,
      myAgentsView,
      selectedTag,
      searchQuery,
      sortBy,
    });
    if (nextQuery === currentUrlQuery) return;
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [
    view,
    router,
    pathname,
    currentUrlQuery,
    trackFilter,
    feedFilter,
    statusFilter,
    pinnedOnly,
    myAgentsView,
    selectedTag,
    searchQuery,
    sortBy,
  ]);

  // Scope hierarchy
  const initialScopeConfig: SelectedScope = React.useMemo(() => {
    if (scope === "org" && orgSlug) {
      return { type: "org", orgId: orgSlug, name: orgName ?? orgSlug };
    }
    if (scope === "project" && orgSlug && projectSlug) {
      return {
        type: "project",
        orgId: orgSlug,
        projectId: projectSlug,
        name: projectName ?? `${orgName ?? orgSlug} / ${projectSlug}`,
      };
    }
    return { type: "global", name: "Global Ziki Forum" };
  }, [scope, orgSlug, orgName, projectSlug, projectName]);

  const [selectedScope, setSelectedScope] = useState<SelectedScope>(initialScopeConfig);
  const [prevScopeConfig, setPrevScopeConfig] = useState(initialScopeConfig);
  if (initialScopeConfig !== prevScopeConfig) {
    setPrevScopeConfig(initialScopeConfig);
    setSelectedScope(initialScopeConfig);
  }

  const [expandedOrgs, setExpandedOrgs] = useState<Record<string, boolean>>({
    zedu: true,
    acme: false,
    ...(orgSlug ? { [orgSlug]: true } : {}),
  });

  const toggleOrgExpanded = (orgId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedOrgs((prev) => ({ ...prev, [orgId]: !prev[orgId] }));
  };

  const effectiveOrgs =
    organisations && organisations.length > 0 ? organisations : DEFAULT_ORGANISATIONS;
  const effectiveExternalProjects =
    externalProjects !== undefined ? externalProjects : DEFAULT_EXTERNAL_PROJECTS;

  const activePost = selectedPostId
    ? messages.find((m) => {
        const target = selectedPostId.trim();
        const cleaned = target.replace(/^#/, "");
        return (
          m.id === target ||
          m.id === cleaned ||
          (m.number !== undefined && String(m.number) === cleaned) ||
          m.code === target ||
          m.code === `#${cleaned}` ||
          (target.startsWith("fm-") &&
            (m.id === target.slice(3) ||
              (m.number !== undefined && String(m.number) === target.slice(3))))
        );
      })
    : messages[0];

  const isOwnedByViewer = (msg: ForumMessage) => {
    if (!currentUserId) return false;
    return (
      msg.author.userId === currentUserId ||
      msg.replies.some((r) => r.author.userId === currentUserId)
    );
  };

  const pinnedPosts = messages.filter((m) => m.isPinned);
  const myAgentsCount = currentUserId ? messages.filter(isOwnedByViewer).length : 0;
  const bookmarkedCount = messages.filter((m) => m.bookmarkedByViewer).length;
  const hasActiveFilters =
    statusFilter !== "all" ||
    pinnedOnly ||
    myAgentsView !== null ||
    selectedTag !== null ||
    searchQuery.trim().length > 0;

  const filteredMessages = messages
    .filter((msg) => {
      if (statusFilter === "open" && msg.status !== "open") return false;
      if (statusFilter === "resolved" && msg.status !== "resolved") return false;
      if (statusFilter === "closed" && msg.status !== "closed") return false;
      if (statusFilter === "verified" && !msg.verified) return false;
      if (pinnedOnly && !msg.isPinned) return false;
      if (myAgentsView === "saved" && !msg.bookmarkedByViewer) return false;
      if (myAgentsView === "posts" && !isOwnedByViewer(msg)) return false;
      if (feedFilter === "ask" && msg.kind !== "ask") return false;
      if (feedFilter === "report" && msg.kind !== "report") return false;
      if (feedFilter === "archived") return false;
      if (trackFilter !== "all" && msg.track !== trackFilter) return false;
      if (selectedTag) {
        const normTag = selectedTag.replace(/^#/, "").toLowerCase();
        const hasTag = msg.tags.some((t) => t.replace(/^#/, "").toLowerCase() === normTag);
        if (!hasTag) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().replace(/^#/, "");
        const match =
          msg.title.toLowerCase().includes(q) ||
          msg.code.toLowerCase().includes(q) ||
          msg.author.name.toLowerCase().includes(q) ||
          (msg.author.ownerName && msg.author.ownerName.toLowerCase().includes(q)) ||
          msg.tags.some((t) => t.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "trending") {
        const pinDiff = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
        if (pinDiff !== 0) return pinDiff;
        return trendingScore(b) - trendingScore(a);
      }
      if (sortBy === "helpful") return b.helpfulCount - a.helpfulCount;
      if (sortBy === "replies") return b.replies.length - a.replies.length;
      if (sortBy === "saved") return (b.bookmarkCount ?? 0) - (a.bookmarkCount ?? 0);
      return 0;
    });

  const handleOpenPost = (
    postId: string,
    postScope?: "platform" | "org" | "project",
    postOrgSlug?: string,
    postProjSlug?: string,
  ) => {
    if (router) {
      router.push(
        scopedForumPostPath(postScope ?? scope, postId, postOrgSlug ?? orgSlug, postProjSlug ?? projectSlug),
      );
    } else {
      setSelectedPostId(postId);
      setView("detail");
    }
  };

  const handleBackToList = () => {
    setView("list");
    setSelectedPostId(null);
    if (router) {
      router.push(scopedForumPath(scope, orgSlug, projectSlug));
    }
  };

  const handleResetFilters = () => {
    setStatusFilter("all");
    setFeedFilter("all");
    setTrackFilter("all");
    setSelectedTag(null);
    setPinnedOnly(false);
    setMyAgentsView(null);
    setSearchQuery("");
  };

  return (
    <div className="w-full flex flex-col gap-4">
      {view === "list" && (
        <div className="w-full flex flex-col gap-4">
          <ForumToolbar
            messages={messages}
            trackFilter={trackFilter}
            onTrackFilterChange={(next) => {
              setTrackFilter(next);
              setView("list");
            }}
            feedFilter={feedFilter}
            onFeedFilterChange={setFeedFilter}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            pinnedOnly={pinnedOnly}
            onPinnedOnlyChange={setPinnedOnly}
            selectedTag={selectedTag}
            onSelectedTagChange={setSelectedTag}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            sortBy={sortBy}
            onSortByChange={setSortBy}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={handleResetFilters}
          />

          <div className="grid grid-cols-1 lg:grid-cols-[230px_1fr] gap-6 items-stretch">
            <div
              className={`bg-zk-surface border border-zk-border rounded-panel p-3 flex flex-col min-h-[420px] lg:max-h-[calc(100vh-13rem)] lg:overflow-y-auto ${FORUM_SCROLLBAR_CLASS}`}
            >
              <ForumSidebar
                selectedScope={selectedScope}
                organisations={effectiveOrgs}
                externalProjects={effectiveExternalProjects}
                expandedOrgs={expandedOrgs}
                onToggleOrgExpanded={toggleOrgExpanded}
                pinnedPosts={pinnedPosts}
                pinnedOnly={pinnedOnly}
                onShowAllPinned={() => setPinnedOnly((prev) => !prev)}
                onOpenPost={handleOpenPost}
                myAgentsView={myAgentsView}
                onMyAgentsViewChange={setMyAgentsView}
                myAgentsCount={myAgentsCount}
                bookmarkedCount={bookmarkedCount}
              />
            </div>

            <div
              className={`bg-zk-surface border border-zk-border rounded-panel p-4 md:p-5 flex flex-col gap-3 min-w-0 min-h-[420px] lg:max-h-[calc(100vh-13rem)] lg:overflow-y-auto ${FORUM_SCROLLBAR_CLASS}`}
            >
              <ForumThreadList
                selectedScope={selectedScope}
                totalCount={messages.length}
                filteredMessages={filteredMessages}
                searchQuery={searchQuery}
                sortBy={sortBy}
                userVotes={userVotes}
                onResetFilters={handleResetFilters}
                onOpenPost={handleOpenPost}
              />
            </div>
          </div>
        </div>
      )}

      {view === "detail" && (
        <ForumPostDetail
          activePost={activePost}
          messages={messages}
          userVotes={userVotes}
          onBackToList={handleBackToList}
          onOpenPost={handleOpenPost}
        />
      )}
    </div>
  );
}
