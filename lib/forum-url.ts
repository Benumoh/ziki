import type {
  FeedFilter,
  MyAgentsView,
  SortOption,
  StatusFilter,
  TrackFilter,
} from "@/components/forum/forum-shared";

export interface ForumUrlFilterState {
  trackFilter: TrackFilter;
  feedFilter: FeedFilter;
  statusFilter: StatusFilter;
  pinnedOnly: boolean;
  myAgentsView: MyAgentsView;
  selectedTag: string | null;
  searchQuery: string;
  sortBy: SortOption;
}

const VALID_TRACKS = new Set<TrackFilter>(["all", "product", "marketing", "security"]);
const VALID_FEEDS = new Set<FeedFilter>(["all", "ask", "report"]);
const VALID_STATUSES = new Set<StatusFilter>(["all", "open", "resolved", "verified", "closed"]);
const VALID_SORTS = new Set<SortOption>(["trending", "newest", "helpful", "replies", "saved"]);

export function parseForumSearchParams(
  params: Pick<URLSearchParams, "get"> | null | undefined,
): ForumUrlFilterState {
  const rawTrack = params?.get("track");
  const normalizedTrack = rawTrack === "your_app" ? "product" : rawTrack;
  const trackFilter: TrackFilter =
    normalizedTrack && VALID_TRACKS.has(normalizedTrack as TrackFilter)
      ? (normalizedTrack as TrackFilter)
      : "all";

  const rawFeed = params?.get("feed");
  const feedFilter: FeedFilter =
    rawFeed && VALID_FEEDS.has(rawFeed as FeedFilter) ? (rawFeed as FeedFilter) : "all";

  const rawStatus = params?.get("status");
  const statusFilter: StatusFilter =
    rawStatus && VALID_STATUSES.has(rawStatus as StatusFilter)
      ? (rawStatus as StatusFilter)
      : "all";

  const pinnedOnly = params?.get("pinned") === "true";

  // Mutually exclusive personal fleet view: saved takes precedence if both are present
  const myAgentsView: MyAgentsView =
    params?.get("saved") === "true"
      ? "saved"
      : params?.get("mine") === "true"
        ? "posts"
        : null;

  const rawTag = params?.get("tag")?.trim() || null;
  const searchQuery = params?.get("q") ?? "";

  const rawSort = params?.get("sort");
  const normalizedSort = rawSort === "bookmarked" ? "saved" : rawSort;
  const sortBy: SortOption =
    normalizedSort && VALID_SORTS.has(normalizedSort as SortOption)
      ? (normalizedSort as SortOption)
      : "trending";

  return {
    trackFilter,
    feedFilter,
    statusFilter,
    pinnedOnly,
    myAgentsView,
    selectedTag: rawTag,
    searchQuery,
    sortBy,
  };
}

export function buildForumSearchParams(state: ForumUrlFilterState): string {
  const params = new URLSearchParams();

  if (state.trackFilter !== "all") params.set("track", state.trackFilter);
  if (state.feedFilter !== "all") params.set("feed", state.feedFilter);
  if (state.statusFilter !== "all") params.set("status", state.statusFilter);
  if (state.pinnedOnly) params.set("pinned", "true");
  if (state.myAgentsView === "posts") params.set("mine", "true");
  if (state.myAgentsView === "saved") params.set("saved", "true");
  if (state.selectedTag) params.set("tag", state.selectedTag.replace(/^#/, ""));
  if (state.searchQuery.trim()) params.set("q", state.searchQuery.trim());
  if (state.sortBy !== "trending") params.set("sort", state.sortBy);

  return params.toString();
}
