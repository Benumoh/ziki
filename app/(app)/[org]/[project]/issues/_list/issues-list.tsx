import { IssuePriorityBadge } from "@/components/issue-priority-badge";
import { PRODUCT_TRACK } from "@/lib/marketing/track";
import { IdeasWelcome } from "@/components/ideas-welcome";
import { IdeaChat } from "@/components/idea-chat";
import { ProjectFilter } from "@/components/project-filter";
import { LocalTime } from "@/components/local-time";
import { POSSIBLY_DELIVERED_STATUS, POSSIBLY_DELIVERED_WHERE, deliverySignals, type DeliverySignals } from "@/lib/possibly-delivered";
import Link from "next/link";
import { EarnPanel } from "@/components/earn-panel";
import { earnBannerLine, newestOpenProjectFor, type EarnBannerProject } from "@/lib/earn-banner";
import { newIssueHref } from "@/lib/reported-from";
import "./issues.css";
import { Avatar } from "@/components/avatar";
import { Suspense } from "react";
import { RememberIssueList } from "@/components/back-to-list";
import type { Prisma, Status } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getIssueTypes } from "@/lib/lookups";

import { PipelineSteps } from "@/components/pipeline-steps";
import { loadYourCall } from "@/lib/your-call";
import { YourCall } from "@/components/your-call";
import { LightOnly } from "@/components/light-only";
import { StatusFilterChips } from "@/components/status-filter-chips";
import { ToolbarFilterMenu, type ToolbarFilterGroup, type ToolbarFilterOption } from "@/components/toolbar-filter-menu";
import { IdeasMoreFilters } from "@/components/ideas-more-filters";
import { IDEA_AUTHOR_PARAM, parseIdeaAuthorFilter } from "@/lib/idea-filters";
import { MY_WORK_PARAM, TRACK_PARAM, myWorkWhere, parseMyWorkFilter, parseTrackFilter, trackWhere, yourOpenBidsWhere, yourWorkWhere } from "@/lib/my-work-filter";
import { WORK_CATEGORY_PARAM, categoryTypesFor, ideaCategoryWhere, parseWorkCategory, workCategoryWhere, type CategoryTypes } from "@/lib/work-category";
import { WorkFeed, type JustAddedIdea, type WorkFeedItem, type WorkFeedKind } from "@/components/work-feed";
import { TILE_TONES, toneForName } from "@/lib/pill-tones";
import { WORK_TAG_TONE, whatsNext } from "@/lib/whats-next";
import { IDEA_SORT_COOKIE, ISSUE_SORT_COOKIE, getIdeaOrderBy, parseIdeaSort } from "@/lib/list-sort";
import { SortHeader } from "@/components/sort-header";
import { PROJECT_LINKS_SLOT_ID, ProjectIconLinks, ProjectLinks } from "@/components/project-links";
import { AppInfoLinks } from "@/components/app-info-links";
import { ShareMenu } from "@/components/share-menu";
import { FirstQuestions } from "@/components/get-started/first-questions";
import { ProjectPendingJoinRequestsBanner, type PendingJoinRequestItem } from "@/components/project-pending-join-requests";
import { missingProfileFields, type ProfileField } from "@/lib/agents/work-gate";
import { isAdminOfOrganisation } from "@/lib/agents/membership";
import type { AppRole } from "@/lib/roles";
import { IssueFilters } from "@/components/issue-filters";
import { RowAge, RowAssignee } from "@/components/issue-row-meta";
import { IdeaFeed } from "@/components/idea-feed";
import { IdeasList, type IdeaListRow } from "@/components/ideas-list";
import { WhimsicalEmptyState } from "@/components/whimsical-empty-state";
import { isUnstructuredDraft } from "@/lib/ideas";
import { workflowFor } from "@/lib/workflow";
import { priorityNow, type PriorityNowIssue } from "@/lib/priority-now";
import { PriorityNowStrip } from "@/components/priority-now-strip";
import { OPEN_BID_WHERE } from "@/lib/open-bids";
import { ideaVotes, isBadIdea } from "@/lib/idea-rejection";
import { archiveReasonLabel } from "@/lib/idea-archive";
import { statuses } from "@/lib/validations/issue";
import { boundSearchTerm, escapeSearchQuery, toSingleQueryParam } from "@/lib/search";
import {
  hasMatch,
  highlightSegments,
  markdownToPlain,
  matchSnippet,
  type Snippet,
} from "@/lib/search-snippet";
import { Highlighted, SearchSnippet } from "@/components/search-highlight";
import { formatIssueNumber, parseIssueNumberQuery } from "@/lib/issue-number";
import {
  DELIVERED_STATUS_FILTER,
  PROGRESS_STATUS_FILTER,
  SHOW_RESOLVED_PARAM,
  isDone,
  parseShowResolved,
  resultCountText,
  statusFilterLabel,
  statusFilterWhere,
} from "@/lib/issue-state";
import { calculatePagination } from "@/lib/pagination";
import { issueListPaginationParams } from "@/lib/issue-list-pagination";
import { DUPLICATES_PARAM, SHOW_DUPLICATES, duplicatesWhere, parseShowDuplicates } from "@/lib/duplicates";
import { PaginationControls } from "@/components/pagination-controls";
import { dueDateValue, MILESTONE_PARAM, milestoneParamValue, milestoneWhere, parseMilestoneFilter } from "@/lib/milestones";
import { loadMilestoneSummaries } from "@/lib/milestone-stats";
import { MilestoneProgressBar } from "@/components/milestone-progress";
import { MilestoneDue } from "@/components/milestone-due";
import {
  bugSortDescriptions,
  getBugOrderBy,
  parseBugSort,
} from "@/lib/issues-sort";
import { canDeleteTicket } from "@/lib/ticket-deletion";
import { organisationAccessFor } from "@/lib/organisation-access";
import type { OrganisationRole } from "@/lib/organisation-role";
import { defaultSortFor, mineFilterWhere, parseMineFilter } from "@/lib/mine-filter";
import { finishedWatchedWhere } from "@/lib/watching";
import { UnwatchButton, UnwatchFinishedButton } from "@/components/unwatch-button";
import { parseTagFilter, serializeTags, tagTypeIds } from "@/lib/tag-filter";
import { bugInOrganisation, isMissingOrganisationColumnError } from "@/lib/organisation-context";
import { requireProject } from "@/lib/project-route";
import { redirect } from "next/navigation";
import { ideaPath, ideasPath, issuesPath, orgPath, orgRefOf, projectPath, refOf, type ProjectRef } from "@/lib/project-paths";
import { RichText } from "@/components/rich-text";
import { isOrganisationAdmin } from "@/lib/organisation-role";
import { cookies } from "next/headers";
import { liveCheck, liveConfirmLabel, liveFactLabel, type LiveCheck } from "@/lib/live-check";
import { latestPullRequestReports } from "@/lib/agent-api/pull-request-report";
import { PROJECT_REPOSITORIES_SELECT, repoForPullRequest } from "@/lib/github/project-repositories";
import { IssueRowStatus } from "@/components/issue-row-status";
import { BidsVoteBadge, ImportanceVoteBadge } from "@/components/vote-badge";
import { RewardBadge } from "@/components/reward-badge";
import { escrowByBug } from "@/lib/coins/ledger";
import { mergePathOf } from "@/lib/merge-history";
import { IssuesToolsToggle } from "@/components/issues-tools-toggle";
import { LoadError } from "@/components/load-error";
import { logLoadFailure } from "@/lib/load-error";
import { AREA_PARAM, parseProjectAreaFilter, projectAreaFilterWhere } from "@/lib/project-area-filter";
import { openIssueConfirmations, parseIssueStageView, type IssueStage } from "@/lib/issue-stage";
import { issueHref } from "@/lib/issue-ref";
import { loadProdConfirmations, loadProdConfirmers, type ProdConfirmation } from "@/lib/live-confirm-data";
import { PROD_CONFIRMATIONS_NEEDED } from "@/lib/live-confirm";
import { LiveRefresh } from "@/components/live-refresh";
import { ConfirmDots } from "@/components/confirm-dots";
import { ExpandableRow, RowToggle } from "@/components/expandable-row";
import { ideaVoteTotals, NO_VOTES } from "@/lib/idea-vote-totals";
import { bugSearchSort, ideaSearchSort, searchWorkItems, typesenseFilter } from "@/lib/search-index";
import { activeIn } from "@/lib/agents/active-in";
import { judgementBars } from "@/lib/agent-api/tested-status";

/* Distinct browser-tab title; the root layout appends the site name. */
export const metadata = { title: "Issues" };

/** `?status=all`: every issue. With no `?status=` the page opens on Ideas. */
const ALL_STATUS = "all";
/** The Ideas tab, the page with no `?status=`. Ideas are not issues: they read the Idea table (#idea-table). */
const IDEAS_STATUS = "ideas";
/** Ideas a manager agent rejected (#idea-rejected), the second list under Ideas. */
const REJECTED_IDEAS_STATUS = "rejected_ideas";

/** The filters under the Ideas tab: new ideas (no `?ideas=`), or `?ideas=drafts`. */
const IDEAS_PARAM = "ideas";
type IdeasView = "new" | "drafts" | "rejected";

/** One of your agents that can't work until its profile is set up (#agent-work-gate). */
type UnconfiguredAgent = { id: string; name: string; username: string; missing: ProfileField[] };
/** Most ideas a list shows, highest score first. */

/** `?status=rejected`: someone's confirmation entry rejected the issue (#1122, #issue-confirmations). */
const REJECTED_STATUS = "rejected";
/** Delivered work that can't go live: the Merge · Error substatus (the latest pull request report says it can't merge). */
const ERROR_STATUS = "error";
/** Your call (#your-call): the issues the agents split on, a step of In Progress shown only while there are any. */
const YOUR_CALL_STATUS = "your_call";
/** Your Work: the issues assigned to you (a claim held or offered for you), a stage of its own shown only while there are any. */
const YOUR_WORK_STATUS = "your_work";
/** Project Overview's list tab: Work Feed (the default), `features` (New Features), `design` (Design Changes) or `delivered`. Fixes (the new ideas, at /new) sits after New Features. */
const OVERVIEW_TAB_PARAM = "view";
const OVERVIEW_TABS = [
  ["all", "Work Feed"],
  ["features", "New Features"],
  ["design", "Design Changes"],
  ["delivered", "Delivered"],
] as const;
/** The Filter's Assigned to me (#work-feed): any tab narrowed to the issues assigned to you (a claim held or offered for you). */
const OVERVIEW_MINE_PARAM = "assigned";
/** The Overview's Status filter (#work-feed): one main status, or every one the tab holds. */
const OVERVIEW_STATE_PARAM = "state";
const OVERVIEW_STATES = ["open", "in_progress", "done", "merge", "resolved"] as const satisfies readonly Status[];
/** How many rows the Overview's list shows a page. */
const FEED_PAGE_SIZE = 30;
/**
 * The Work Feed's sections (#work-feed-sections), top to bottom: what needs your OK (new ideas, live work to confirm),
 * what is being worked on right now, what is waiting for an agent (open, nobody on it yet), and what looks stalled. `?section=` shows one of them in full.
 */
const OVERVIEW_SECTION_PARAM = "section";
const FEED_SECTIONS = [
  { key: "needs", title: "Needs your OK" },
  { key: "active", title: "Being worked on" },
  // Open issues nobody holds yet: waiting to be confirmed or for an agent's bid (#work-feed-waiting).
  { key: "waiting", title: "Waiting for an agent" },
  { key: "stalled", title: "Stalled" },
] as const;
type FeedSection = (typeof FEED_SECTIONS)[number]["key"];
/** How many cards each section shows before its Show all link. */
const FEED_SECTION_SIZE = 6;
/** In progress counts as being worked on while its agent checked in this recently (heartbeats come every 15 minutes). */
const ACTIVE_HEARTBEAT_MS = 30 * 60 * 1000;

/** The time now, read when the feed is loaded on the server, not while rendering. */
function currentTime(): number {
  return Date.now();
}

/** Which issues one Work Feed section holds (#work-feed-sections), as of now. */
function feedSectionWhere(section: FeedSection, now: number): Prisma.BugWhereInput {
  const fresh = new Date(now - ACTIVE_HEARTBEAT_MS);
  // An agent holds it and checked in lately (or took it lately and hasn't had to check in yet).
  const heartbeat: Prisma.BugWhereInput = {
    claims: { some: { status: { in: ["active", "planning"] }, releasedAt: null, OR: [{ lastHeartbeatAt: { gte: fresh } }, { lastHeartbeatAt: null, claimedAt: { gte: fresh } }] } },
  };
  if (section === "needs") {
    // Only live work waits for a person: delivered work that isn't merged yet waits on agents, so it is Stalled.
    return { status: "resolved", substatus: { not: "merged_broken" }, liveConfirmedAt: null };
  }
  if (section === "active") {
    return { AND: [{ substatus: { in: ["in_progress", "plan_review"] } }, heartbeat] };
  }
  if (section === "waiting") {
    return { substatus: { in: ["requires_confirmation", "open"] } };
  }
  return { OR: [
    { AND: [{ substatus: { in: ["in_progress", "plan_review"] } }, { NOT: heartbeat }] },
    // Delivered but not merged: waiting on agents to judge, review or merge it.
    { substatus: { in: ["requires_review", "accepted", "ready_to_merge", "error", "merged_broken"] } },
  ] };
}
type OverviewTab = (typeof OVERVIEW_TABS)[number][0];
/** A delivery's screenshot links that a page can show (web links only), at most four. */
function webLinks(urls: string[] | undefined): string[] {
  return (urls ?? []).filter((url) => /^(https?:\/\/|\/)/i.test(url)).slice(0, 4);
}
/**
 * Why a Stalled card is stalled (#work-feed-sections), in a sentence: what it is waiting for and who should act.
 * `claim` is the agent holding it, or null when nobody does.
 */
function stallReason(
  substatus: string,
  claim: { agent: string | null; due: Date | null; heartbeat: Date | null } | null,
  now: number,
): string {
  const agent = claim?.agent ?? "The agent";
  switch (substatus) {
    case "in_progress":
    case "plan_review": {
      if (!claim) return "No agent holds it any more: the work was let go and nobody has taken it up again.";
      const overdue = claim.due && claim.due.getTime() < now ? " It is also past the time it was due." : "";
      const step = substatus === "plan_review" ? "writes its plan" : "works";
      return claim.heartbeat
        ? `${agent} stopped checking in. An agent checks in every 15 minutes while it ${step}, and this one hasn't for over 30 minutes.${overdue}`
        : `${agent} took it but never checked in.${overdue}`;
    }
    case "requires_review":
      return "Delivered, but not merged: it is waiting for testers to judge whether it is good to merge.";
    case "accepted":
      return "Judged good to merge, but not merged: it is waiting for a manager agent's review.";
    case "ready_to_merge":
      return "Reviewed and accepted, but not merged: it is waiting for a merger agent to merge the pull request.";
    case "error":
      return "The pull request can't be merged as it is: it needs a fix before a merger agent can merge it.";
    case "merged_broken":
      return "It was merged without Ziki's checks and judged broken: it needs a fix.";
    default:
      return "It hasn't moved for a while.";
  }
}
/** An opened card's text (#work-feed): the description, trimmed for a quick glance; empty when there is none. */
function feedBody(description: string | null | undefined): string {
  const text = description ?? "";
  return text.length > FEED_BODY_LIMIT ? `${text.slice(0, FEED_BODY_LIMIT).trimEnd()}…` : text;
}
/** How much of an agent's time to delivery has gone (#work-feed), 5% to 95%; null without a due time. */
/**
 * Why delivered work isn't merged yet (#work-feed-sections): the latest pull request report's note, when the issue is
 * accepted, ready to merge or blocked and that report says something stands in the way (it can't merge, conflicts,
 * its checks fail, or it is no longer open). Null when nothing is said to be in the way.
 */
function mergeHold(
  substatus: string,
  report: { state: string; mergeable: boolean | null; checks: string | null; note: string } | null,
): string | null {
  if (!report || !["accepted", "ready_to_merge", "error"].includes(substatus)) return null;
  const blocked = substatus === "error" || report.mergeable === false || report.checks === "failing" || report.state !== "open";
  return blocked && report.note.trim() ? report.note.trim() : null;
}

/**
 * How far along work being worked on is (#work-feed-sections), when there is no due time to measure against: by its
 * step, from the plan to ready to merge.
 */
const STEP_PROGRESS: Partial<Record<string, number>> = { plan_review: 0.2, in_progress: 0.5, accepted: 0.8, ready_to_merge: 0.9 };

function timeUsed(claimedAt: Date | null, deliverBy: Date | null): number | null {
  if (!claimedAt || !deliverBy) return null;
  const span = deliverBy.getTime() - claimedAt.getTime();
  if (span <= 0) return null;
  return Math.min(0.95, Math.max(0.05, (Date.now() - claimedAt.getTime()) / span));
}
/** Each Overview tab's small icon (24-unit stroke paths), Fixes' (the new ideas) included. */
const OVERVIEW_TAB_ICONS: Record<OverviewTab | "new", string> = {
  // A stack of cards: the feed.
  all: "M4 6h16M4 12h16M4 18h10",
  // A wrench: Fixes, the new ideas waiting for approval.
  new: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z",
  // A wrench: fixes.
  // A sparkle: something new being built.
  features: "M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
  // A pen nib: design.
  design: "M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.6 7.6M11 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  // A box: delivered.
  delivered: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
};
function TabIcon({ tab }: { tab: OverviewTab | "new" }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d={OVERVIEW_TAB_ICONS[tab]} />
    </svg>
  );
}
/** What each Overview tab says while it is empty. */
const OVERVIEW_EMPTY: Record<OverviewTab, { title: string; description: string }> = {
  all: { title: "No work yet", description: "Tell the agents what you want done in the box above: it shows up here as they take it on." },
  features: { title: "Nothing being built right now", description: "Issues waiting for an agent or being worked on show up here until the work is delivered." },
  design: { title: "No designs waiting for you", description: "When an agent proposes a design for an issue, it shows up here for you to choose." },
  delivered: { title: "Nothing confirmed yet", description: "Live work moves here once someone confirms it looks fine on the Work Feed." },
};
/** Work Feed: everything not closed, live included. */
const ALL_WORK_STATUSES = ["open", "in_progress", "done", "merge", "resolved"] as const;
/** Open issues that may already be done (#possibly-delivered): a manager's list to check and close. */
const POSSIBLY_DELIVERED = POSSIBLY_DELIVERED_STATUS;
const REJECTED_WHERE = { some: { verdict: "reject", undoneAt: null } } satisfies Prisma.IssueConfirmationListRelationFilter;
/** `?status=duplicate`: marked as a duplicate of another issue. */
const DUPLICATE_STATUS = "duplicate";
/** The filters under the All tab. Every status has a tab of its own. */
const ALL_FILTERS = [ALL_STATUS, REJECTED_STATUS, DUPLICATE_STATUS].map((value) => ({
  value,
  label: statusFilterLabel(value),
}));
/**
 * The three stages across the top, each holding the statuses listed down the
 * left of the panel when it is picked. Ideas (the Idea table) comes first.
 */
const STAGE_GROUPS = [
  // Project Overview comes first (who delivered this week, then your work in the project) and Live last, which shows only once something went live.
  { label: "Overview", statuses: [YOUR_WORK_STATUS] },
  // Ideas holds only ideas. The rest are main statuses (#substatus): each tab
  // lists every substatus of its status together (Open: Requires confirmation
  // and Open), and each row says which one it is at.
  { label: "New", statuses: [IDEAS_STATUS, REJECTED_IDEAS_STATUS] },
  // In Progress and Delivered (live included) each list all of their statuses together, the first value; the
  // Status filter narrows them to one (#simple-lists). The Work queue keeps every status apart.
  { label: "In Progress", statuses: [PROGRESS_STATUS_FILTER, "open", "in_progress", "closed", POSSIBLY_DELIVERED] },
  { label: "Delivered", statuses: [DELIVERED_STATUS_FILTER, "done", "merge", ERROR_STATUS, "resolved"] },
] as const;
/** The tabs' own values, which stand for all of their statuses. */
const GROUP_FILTERS: readonly string[] = [PROGRESS_STATUS_FILTER, DELIVERED_STATUS_FILTER];
/** Where In Progress sits in STAGE_GROUPS: Your call belongs to it. */
const IN_PROGRESS_STAGE = 2;
/** The stage that shows only while it holds issues (or is open). */
const YOUR_WORK_STAGE = 0;

/** A bug with head, antennae, segmented body and three pairs of legs. */
const BUG_ICON_PATH =
  "m8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3 3 0 1 1 6 0v1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4";

/** A sparkle, for feature and improvement types. */
const FEATURE_ICON_PATH =
  "m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z";

type SearchParams = Promise<{
  q?: string | string[];
  status?: string | string[];
  area?: string | string[];
  sort?: string | string[];
  page?: string | string[];
  deleted?: string | string[];
  mine?: string | string[];
  tags?: string | string[];
  [key: string]: string | string[] | undefined;
}>;

async function loadOrEmpty<T>(label: string, load: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await load();
  } catch (error) {
    console.error(`[bugs] ${label} lookup failed`, error);
    return empty;
  }
}

/**
 * Where each Live issue's fix really is (#live-check): the latest independent
 * check of its pull request, against its project's repository.
 */
async function loadLiveChecks(bugs: ReadonlyArray<{ id: string; pullRequestUrl: string | null; projectId: string }>): Promise<Map<string, LiveCheck>> {
  const checks = new Map<string, LiveCheck>();
  if (bugs.length === 0) return checks;
  const [reports, confirmers, projects] = await Promise.all([
    latestPullRequestReports(bugs),
    loadProdConfirmers(bugs.map((bug) => bug.id)),
    prisma.project.findMany({ where: { id: { in: [...new Set(bugs.map((bug) => bug.projectId))] } }, select: { id: true, repoUrl: true, ...PROJECT_REPOSITORIES_SELECT } }),
  ]);
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  // The repository each pull request is in: the main one or one the project lists (#2).
  for (const bug of bugs) checks.set(bug.id, liveCheck(bug.pullRequestUrl, reports.get(bug.id), repoForPullRequest(projectsById.get(bug.projectId), bug.pullRequestUrl), confirmers.get(bug.id) ?? []));
  return checks;
}

/** The database error stays in the server log under `reference` (#506). */
function issuesQueryError(reference: string, message?: string) {
  return (
    <LoadError title="Issues could not be loaded" reference={reference}>
      {message}
    </LoadError>
  );
}

/**
 * A project's issue and idea lists (#project-urls): `/<org>/<project>/ideas`,
 * `.../ideas/rejected`, `.../ideas/drafts` and `.../issues/<status>`. The
 * route passes the organisation and project slugs and the list it names;
 * lib/project-route.ts resolves the project and checks access.
 */
/** How much of an issue's description an opened Overview card shows (#work-feed): all of it (descriptions are at most 5000 characters). */
const FEED_BODY_LIMIT = 5000;

/**
 * The decision an Overview card asks of you (#work-feed), and where you take it: the issue's simple view, at the
 * part where that decision is made (designs to choose, Your turn, the bids).
 */
function feedDecision(kind: WorkFeedKind, href: string): { label: string; href: string } {
  const work = href;
  switch (kind) {
    case "design": return { label: "Choose a design", href: `${work}#redesigns` };
    case "delivered": return { label: "Review the work", href: `${work}#your-turn` };
    case "live": return { label: "Check it works", href: `${work}#your-turn` };
    case "working": return { label: "See progress", href: work };
    case "waiting": return { label: "Choose an agent", href: `${work}#bids` };
  }
}

export async function IssuesList({
  org,
  slug,
  everyProject = false,
  status,
  ideas,
  returnTo,
  searchParams,
}: {
  org: string;
  slug: string;
  /**
   * The organisation-wide list, `/<org>/issues/…` or `/<org>/ideas` (#project-filter): every project's work.
   * `slug` is then the project it is drawn through. Without it the list shows only `slug`'s work.
   */
  everyProject?: boolean;
  /** The list the path names: a status, `ideas` or `rejected_ideas` (#project-urls). */
  status: string;
  /** `drafts` on `/<slug>/ideas/drafts`. */
  ideas?: string;
  /** This page's address, to come back to after switching organisation. */
  returnTo: string;
  searchParams: SearchParams;
}) {
  const { user, organisationId, project, isOrgMember, canContribute, isOrgAdmin } = await requireProject(org, slug);
  const ref = project.ref;
  // The lists' own links stay organisation-wide on `/<org>/…`; everything else is the project's.
  const listRef = everyProject ? orgRefOf(ref) : ref;
  const userId: string | undefined = user.id;
  const effectiveRole: AppRole | null | undefined = user.role;
  const membershipRole: OrganisationRole | null = (await organisationAccessFor(user.id, organisationId, user.role)).membershipRole;
  // #425: only this project's issues, in its organisation.
  const projectId: string | null = project.id;
  const activeProject = project;

  const canDelete = canDeleteTicket(effectiveRole, membershipRole);
  const params: Awaited<SearchParams> = { ...(await searchParams), status, ...(ideas ? { [IDEAS_PARAM]: ideas } : {}) };
  /** A list's address from its query: the status and ideas view become the path (lib/project-paths.ts). */
  const listHrefIn = (target: ProjectRef, query: URLSearchParams): string => {
    const next = new URLSearchParams(query);
    const listStatus = next.get("status");
    const ideasParam = next.get(IDEAS_PARAM);
    next.delete("status");
    next.delete(IDEAS_PARAM);
    if (!listStatus || listStatus === IDEAS_STATUS) return ideasPath(target, ideasParam === "drafts" ? "drafts" : "new", next);
    if (listStatus === REJECTED_IDEAS_STATUS) return ideasPath(target, "rejected", next);
    return issuesPath(target, listStatus, next);
  };
  const listHref = (query: URLSearchParams): string => listHrefIn(listRef, query);
  // This list's query (its filters, without the page), for the same list in another project or in all of them.
  const switchQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (typeof value === "string" && key !== "page") switchQuery.set(key, value);
  const qParam = toSingleQueryParam(params.q);
  // The path names the list; a search stays in it (All looks across every issue).
  const statusParam: string = status;
  const sortParam = toSingleQueryParam(params.sort);
  const pageParam = toSingleQueryParam(params.page);
  const deletedParam = toSingleQueryParam(params.deleted);
  const mineFilter = parseMineFilter(params.mine);
  const ideaAuthor = parseIdeaAuthorFilter(params[IDEA_AUTHOR_PARAM]);
  const trackFilter = parseTrackFilter(params[TRACK_PARAM]);
  // Search follows the same track as the list; "all" names none, so both come back.
  const trackSearch = trackFilter === "all" ? {} : { track: trackFilter };
  const isDeletedView = canDelete && deletedParam === "true";
  // The project filter (#project-filter): `/<org>/…` shows a member every project's work, `/<org>/<project>/…`
  // only that project's; a visitor from outside the organisation sees only the project, at its own address.
  if (everyProject && !isOrgMember) redirect(listHrefIn(ref, switchQuery));
  const orgProjects = isOrgMember && organisationId
    ? await loadOrEmpty("projects", () => prisma.project.findMany({
        where: { organisationId, archivedAt: null },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, slug: true, name: true, organisation: { select: { slug: true } } },
      }), [] as Array<{ id: string; slug: string; name: string; organisation: { slug: string } }>)
    : [];
  const filterProject = isOrgMember && !everyProject ? orgProjects.find((item) => item.id === project.id) ?? null : null;
  // The address decides the scope: `/<org>/…` is every project, `/<org>/<project>/…` that project, whether or not
  // the organisation's project list loaded.
  const allProjects = isOrgMember && everyProject;
  // The one project the list is limited to, or null for every project.
  const scopeProjectId: string | null = allProjects ? null : projectId;
  // Rows say which project they are in only when the list holds several.
  const projectNames = new Map(orgProjects.length > 1 ? orgProjects.map((item) => [item.id, item.name]) : []);
  const projectRefs = new Map(orgProjects.map((item) => [item.id, refOf(item)]));

  // Column sort (#column-sort): the address wins, then the sort remembered in this list's cookie.
  const sortCookies = await cookies();
  const currentSort = parseBugSort(sortParam ?? sortCookies.get(ISSUE_SORT_COOKIE)?.value, defaultSortFor(mineFilter));
  const currentIdeaSort = parseIdeaSort(sortParam ?? sortCookies.get(IDEA_SORT_COOKIE)?.value);
  const isWatchingView = mineFilter === "watching" && !!userId;
  // #285: duplicates are hidden unless asked for, and the count says so.
  const showDuplicates = parseShowDuplicates(params[DUPLICATES_PARAM]);
  const where: Prisma.BugWhereInput = {
    ...bugInOrganisation(organisationId),
    ...(scopeProjectId ? { projectId: scopeProjectId } : {}),
    ...trackWhere(trackFilter),
    isDeleted: isDeletedView,
    ...mineFilterWhere(mineFilter, userId),
    ...duplicatesWhere(showDuplicates),
  };

  // Tag filter (#102): issue types picked from the search box.
  // These lookups are filters only. Each one fails on its own: Promise.all
  // used to throw away the ones that succeeded when Milestone was missing,
  // and the admin path below then queried them again outside this catch.
  const [tagTypes, milestones, areas, userPrefs] = await Promise.all([
    // Cached, expired by the admin actions that change them (#297).
    loadOrEmpty("issue types", () => getIssueTypes(organisationId), []),
    // #289: few rows; closed ones too, so an old link still resolves.
    loadOrEmpty(
      "milestones",
      () =>
        organisationId
          ? prisma.milestone.findMany({
              where: { organisationId },
              select: { id: true, title: true, isClosed: true },
              orderBy: [{ isClosed: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { title: "asc" }],
            })
          : Promise.resolve([]),
      [],
    ),
    loadOrEmpty(
      "project areas",
      () => projectId
        ? prisma.projectArea.findMany({ where: { projectId }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] })
        : Promise.resolve([]),
      [],
    ),
    userId && prisma.user?.findUnique
      ? prisma.user
          .findUnique({
            where: { id: userId },
            select: { keyboardShortcuts: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  const shortcutsEnabled = userPrefs?.keyboardShortcuts ?? true;
  const selectedMilestone = parseMilestoneFilter(params[MILESTONE_PARAM], milestones);
  const milestoneParam = milestoneParamValue(selectedMilestone);
  const selectedTags = parseTagFilter(params.tags, tagTypes);
  if (selectedTags.length > 0) {
    where.typeId = { in: tagTypeIds(selectedTags, tagTypes) };
  }
  const tagsParam = serializeTags(selectedTags.map((t) => t.name));

  const statusWhere = statusFilterWhere(statusParam);
  // Each status tab filters on its status alone (one status per issue). With no
  // status filter the All tab shows every issue.
  const showResolved = parseShowResolved(params[SHOW_RESOLVED_PARAM]);
  if (statusWhere !== undefined) where.status = statusWhere;
  // The Ideas tab lists ideas from their own table: no issue row matches it.
  const ideasView: IdeasView | null =
    isDeletedView
      ? null
      : statusParam === REJECTED_IDEAS_STATUS
        ? "rejected"
        : statusParam !== IDEAS_STATUS
          ? null
          : toSingleQueryParam(params[IDEAS_PARAM]) === "drafts"
            ? "drafts"
            : "new";
  const isIdeasView = ideasView !== null;
  if (isIdeasView) where.id = { in: [] };
  // Your call lists its own items (lib/your-call.ts), not issue rows.
  const isYourCallView = statusParam === YOUR_CALL_STATUS && !isDeletedView;
  if (isYourCallView) where.id = { in: [] };
  if (statusParam === REJECTED_STATUS && !isDeletedView) {
    where.confirmations = REJECTED_WHERE;
  }
  if (statusParam === DUPLICATE_STATUS && !isDeletedView) {
    where.duplicateOfId = { not: null };
  }
  if (statusParam === ERROR_STATUS) where.substatus = "error";
  if (statusParam === POSSIBLY_DELIVERED) {
    // Added with AND, so a search's own OR stays as it is.
    const and = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    where.AND = [...and, POSSIBLY_DELIVERED_WHERE];
  }
  const selectedArea = parseProjectAreaFilter(params[AREA_PARAM], areas);
  Object.assign(where, projectAreaFilterWhere(selectedArea));
  Object.assign(where, milestoneWhere(selectedMilestone));
  // My Work (?mywork=1): only the issues you bid on or are working on.
  const myWorkOn = parseMyWorkFilter(params[MY_WORK_PARAM]) && Boolean(userId);
  if (myWorkOn && userId) {
    const and = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    where.AND = [...and, myWorkWhere(userId)];
  }
  // Project Overview (#project-overview): two lists under the contributors, as tabs. Delivered Work (the default):
  // the project's tickets delivered this week, by anyone. My Work: what you hold.
  const isYourWorkView = statusParam === YOUR_WORK_STATUS && !isDeletedView;
  const overviewParam = toSingleQueryParam(params[OVERVIEW_TAB_PARAM]);
  const overviewTab: OverviewTab = OVERVIEW_TABS.find(([tab]) => tab === overviewParam)?.[0] ?? "all";
  // Assigned to me (the Filter): what you or your agents hold or are offered, on whichever tab.
  const isMyWorkTab = isYourWorkView && toSingleQueryParam(params[OVERVIEW_MINE_PARAM]) === "1";
  const overviewStateParam = toSingleQueryParam(params[OVERVIEW_STATE_PARAM]);
  const overviewState = OVERVIEW_STATES.find((value) => value === overviewStateParam) ?? null;
  if (isYourWorkView) {
    const and = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    where.AND = [
      ...and,
      ...(isMyWorkTab ? [userId ? yourWorkWhere(userId) : { id: { in: [] } }] : []),
      overviewTab === "features"
          // New Features: issues not delivered yet, waiting for an agent or being worked on, that aren't a design to choose.
          ? { status: { in: ["open", "in_progress"] as Status[] }, redesigns: { none: { status: "proposed" } } }
          : overviewTab === "design"
            // Design Changes: issues with a proposed design waiting for someone to choose.
            ? { redesigns: { some: { status: "proposed" } } }
            : overviewTab === "delivered"
              // Delivered: live work someone confirmed looks fine (#live-confirmed).
              ? { status: "resolved", liveConfirmedAt: { not: null } }
              : { status: { in: [...ALL_WORK_STATUSES] } },
    ];
  }
  if (qParam?.trim()) {
    const q = escapeSearchQuery(boundSearchTerm(qParam));
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
    // "42" or "#42" should also find issue #42, which is how people quote an
    // issue to each other. Left as an OR so a title containing "42" still
    // matches too, rather than the number silently hijacking the search.
    const asNumber = parseIssueNumberQuery(qParam);
    if (asNumber !== null) where.OR.push({ number: asNumber });
  }

  const complexBugSearchFilter = Boolean(
    mineFilter || (parseMyWorkFilter(params[MY_WORK_PARAM]) && userId)
      || statusParam === REJECTED_STATUS || statusParam === POSSIBLY_DELIVERED
      || toSingleQueryParam(params.stage),
  );
  const bugSearchExtraFilters = ["status", "substatus", "typeId", "areaId", "milestoneId", "reporterId", "assigneeId", "duplicateOfId", "isBoosted", "isDeleted"]
    .map((field) => typesenseFilter(field, (where as Record<string, unknown>)[field]))
    .filter((filter): filter is string => filter !== null);
  let typesenseBugSearch: { found: number } | null = null;
  if (qParam && boundSearchTerm(qParam).length >= 3 && organisationId && !isIdeasView && !complexBugSearchFilter) {
    try {
      const indexed = await searchWorkItems({ query: boundSearchTerm(qParam), kind: "bug", organisationId, ...(scopeProjectId ? { projectId: scopeProjectId } : {}), ...trackSearch, includeDeleted: isDeletedView, page: 1, perPage: 1, sortBy: bugSearchSort(currentSort, !isWatchingView), extraFilters: bugSearchExtraFilters });
      if (indexed.found > 0) typesenseBugSearch = indexed;
    } catch (error) {
      console.error("[issues] Typesense search failed; using PostgreSQL", error);
    }
  }

  // The kinds of work (#work-segments): `?category=` lists one kind; the Work Feed and New ideas otherwise show a few of each.
  const workCategory = parseWorkCategory(params[WORK_CATEGORY_PARAM]);
  const categoryTypes: CategoryTypes = organisationId && (isYourWorkView || isIdeasView)
    ? await loadOrEmpty("work categories", () => categoryTypesFor(organisationId), { design: [], feature: [] })
    : { design: [], feature: [] };
  if (workCategory && isYourWorkView) {
    const and = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    where.AND = [...and, workCategoryWhere(workCategory, categoryTypes)];
  }
  // The Overview (#work-feed) is one list of work on every tab, newest first: the Work Feed (mixed), and the same list narrowed to
  // Active Work, Design Changes, Delivered or My Work (the tab's own `where` above), and to one status by the filter.
  const feedView = isYourWorkView && !qParam;
  const sectionParam = toSingleQueryParam(params[OVERVIEW_SECTION_PARAM]);
  const overviewSection: FeedSection | null = overviewTab === "all" ? FEED_SECTIONS.find(({ key }) => key === sectionParam)?.key ?? null : null;
  type FeedGroup = { key: FeedSection; title: string; count: number; items: WorkFeedItem[] };
  const emptyFeed = { items: [] as WorkFeedItem[], groups: null as FeedGroup[] | null, total: 0, page: 1, counts: new Map<string, number>() };
  // New ideas that need your OK (#just-added): this project's open ideas you haven't given a verdict on, newest first.
  // They top Needs your OK with Approve (your good verdict), and the one the chat just filed flashes there.
  const ideaSection = toSingleQueryParam(params[OVERVIEW_SECTION_PARAM]);
  // On the organisation-wide list (every project), every project's ideas, as the Fixes tab lists them.
  const ideasToOkWhere: Prisma.IdeaWhereInput = {
    ...(allProjects ? { organisationId: organisationId ?? "" } : { projectId: project.id }), isDeleted: false, status: "open", track: "product",
    ...(userId ? { verdicts: { none: { onBehalfOfUserId: userId } } } : {}),
  };
  const [justAdded, ideasToOkCount] = feedView && overviewTab === "all" && (!ideaSection || ideaSection === "needs")
    ? await loadOrEmpty("ideas to approve", () => Promise.all([
        prisma.idea.findMany({
          where: ideasToOkWhere,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: ideaSection === "needs" ? 30 : 3,
          select: { id: true, number: true, title: true, createdAt: true, reporter: { select: { name: true } }, project: { select: { slug: true, organisation: { select: { slug: true } } } } },
        }).then((rows) => rows.map((row) => ({ id: row.id, number: row.number, title: row.title, at: row.createdAt, by: row.reporter?.name ?? null, href: ideaPath(refOf(row.project), row.number) }))),
        prisma.idea.count({ where: ideasToOkWhere }),
      ]), [[], 0] as [JustAddedIdea[], number])
    : [[] as JustAddedIdea[], 0];
  const feed = feedView
    ? await loadOrEmpty("work feed", async () => {
        const select = {
          id: true, number: true, title: true, createdAt: true, updatedAt: true, projectId: true, summary: true, description: true, status: true,
          project: { select: { slug: true, organisation: { select: { slug: true } } } },
          assignee: { select: { name: true } },
          reporter: { select: { name: true } },
          // What the card shows when opened (#work-feed): the files on it.
          attachments: { orderBy: { createdAt: "asc" }, take: 4, select: { id: true, filename: true, contentType: true, size: true } },
          claims: { where: { status: { in: ["active", "planning"] }, releasedAt: null }, select: { claimedAt: true, deliverBy: true, lastHeartbeatAt: true, beneficiary: { select: { name: true } }, agent: { select: { name: true } } }, take: 1 },
          // A design waiting for someone to choose it makes the row a design to review.
          redesigns: { where: { status: "proposed" }, take: 1, select: { id: true } },
          // Delivered work's View (#work-feed): where it was delivered, the newest preview first, else the delivery's link,
          // else the pull request.
          substatus: true, pullRequestUrl: true, liveConfirmedAt: true,
          previewBuilds: { where: { status: "ready", url: { not: null } }, orderBy: { updatedAt: "desc" }, take: 1, select: { url: true } },
          deliveries: { orderBy: { updatedAt: "desc" }, take: 1, select: { deliverableUrls: true, pullRequestUrl: true, screenshots: true, beforeScreenshots: true, updatedAt: true, beneficiary: { select: { name: true } } } },
          // Why accepted work isn't merged yet (#work-feed-sections): the latest pull request report, when it says so.
          pullRequestReports: { orderBy: { createdAt: "desc" }, take: 1, select: { state: true, mergeable: true, checks: true, note: true } },
          // The live link (#live-link): the newest deployment report that gave one.
          deploymentReports: { where: { url: { not: null } }, orderBy: { updatedAt: "desc" }, take: 1, select: { url: true } },
        } satisfies Prisma.BugSelect;
        const page = Math.max(1, Number.parseInt(toSingleQueryParam(params.page) ?? "1", 10) || 1);
        const orderBy: Prisma.BugOrderByWithRelationInput[] = [{ updatedAt: "desc" }, { id: "desc" }];
        // `section` is the Work Feed section the card is in: every card Being worked on has a bar, none Stalled does.
        // When an agent first took each issue (#work-feed-sections): its earliest claim, held or since let go.
        const startsFor = async (rows: { id: string }[]) => {
          if (rows.length === 0) return new Map<string, Date>();
          const firsts = await prisma.issueClaim.groupBy({
            by: ["bugId"],
            where: { bugId: { in: rows.map((row) => row.id) }, claimedAt: { not: null } },
            _min: { claimedAt: true },
          });
          return new Map(firsts.flatMap((first) => (first._min.claimedAt ? [[first.bugId, first._min.claimedAt] as const] : [])));
        };
        // When each issue's pull request was merged and by whom: the first report that says merged. Ziki's own GitHub
        // reads carry GitHub's merge time and merger; an agent's report gives its time and the person it works for.
        const mergesFor = async (rows: { id: string }[]) => {
          const merges = new Map<string, { at: Date; by: string | null }>();
          if (rows.length === 0) return merges;
          const reports = await prisma.pullRequestReport.findMany({
            where: { bugId: { in: rows.map((row) => row.id) }, state: "merged" },
            orderBy: { createdAt: "asc" },
            select: { bugId: true, createdAt: true, details: true, agent: { select: { name: true } }, onBehalfOf: { select: { name: true } } },
          });
          for (const report of reports) {
            const details = (report.details ?? {}) as { mergedAt?: string | null; mergedBy?: string | null };
            const fromGitHub = details.mergedAt ? { at: new Date(details.mergedAt), by: details.mergedBy ?? null } : null;
            const known = merges.get(report.bugId);
            if (fromGitHub && (!known || !known.by)) merges.set(report.bugId, { at: fromGitHub.at, by: fromGitHub.by ?? known?.by ?? null });
            else if (!known) merges.set(report.bugId, { at: report.createdAt, by: report.onBehalfOf?.name ?? report.agent?.name ?? null });
          }
          return merges;
        };
        type Times = { starts: Map<string, Date>; merges: Map<string, { at: Date; by: string | null }> };
        const timesFor = async (rows: { id: string }[]): Promise<Times> => {
          const [starts, merges] = await Promise.all([startsFor(rows), mergesFor(rows)]);
          return { starts, merges };
        };
        const toItem = (row: Prisma.BugGetPayload<{ select: typeof select }>, section: FeedSection | null, times: Times): WorkFeedItem => {
          const href = issueHref(row);
          // Work under way (#work-feed): how far through its time it is, from when the agent took it to when it is due.
          const claim = row.claims[0];
          const due = row.substatus === "in_progress" ? timeUsed(claim?.claimedAt ?? null, claim?.deliverBy ?? null) : null;
          const progress = section === "stalled" ? null : section === "active" ? due ?? STEP_PROGRESS[row.substatus] ?? null : due;
          const kind: WorkFeedKind = row.redesigns.length > 0 ? "design"
            : row.status === "done" || row.status === "merge" ? "delivered"
            : row.status === "resolved" ? "live"
            : row.status === "in_progress" ? "working"
            : "waiting";
          return {
            id: row.id,
            kind,
            number: row.number,
            title: row.title,
            href,
            at: row.updatedAt,
            projectName: allProjects ? projectNames.get(row.projectId) ?? null : null,
            who: row.claims[0]?.agent?.name ?? row.claims[0]?.beneficiary?.name ?? row.assignee?.name ?? null,
            // Where it is, said on the card in one word with its colour and icon ("Broken", not "Live · Broken").
            substatus: row.substatus,
            progress,
            progressBy: due !== null ? "time" : "step",
            // Opened: when it was delivered, and why it isn't merged yet when the latest pull request report says why.
            deliveredAt: row.deliveries[0]?.updatedAt ?? null,
            // The opened card's timeline: when it was added and when an agent started on it.
            addedAt: row.createdAt,
            startedAt: times.starts.get(row.id) ?? null,
            merged: times.merges.get(row.id) ?? null,
            // Stalled (#work-feed-sections): since when it hasn't moved. Work in progress since its agent last checked
            // in; anything else since it last changed.
            stalledSince: section === "stalled"
              ? (row.substatus === "in_progress" || row.substatus === "plan_review"
                ? claim?.lastHeartbeatAt ?? claim?.claimedAt ?? row.updatedAt
                : row.updatedAt)
              : null,
            held: Boolean(claim),
            // Who delivered it (#just-delivered): the person the delivering agent works for, else who solved it.
            deliveredBy: row.deliveries[0]?.beneficiary?.name ?? row.assignee?.name ?? null,
            justDelivered: false,
            stallReason: section === "stalled" ? stallReason(row.substatus, claim ? { agent: claim.agent?.name ?? null, due: claim.deliverBy, heartbeat: claim.lastHeartbeatAt } : null, currentTime()) : null,
            mergeHold: mergeHold(row.substatus, row.pullRequestReports[0] ?? null),
            // Opened (#work-feed): what it is, its files, and the decision it asks of you.
            reporter: row.reporter?.name ?? null,
            summary: row.summary ?? null,
            body: row.description.length > FEED_BODY_LIMIT ? `${row.description.slice(0, FEED_BODY_LIMIT).trimEnd()}…` : row.description,
            files: row.attachments.map((file) => ({ id: file.id, name: file.filename, type: file.contentType, size: file.size })),
            decision: feedDecision(kind, href),
            // Where it can be seen running (its preview, else the delivery's link), apart from its pull request.
            // Live work: its live link from a deployment report (#live-link); before that, its preview or the delivery's link.
            liveUrl: row.status === "resolved"
              ? row.deploymentReports[0]?.url ?? null
              : row.previewBuilds[0]?.url ?? row.deliveries[0]?.deliverableUrls[0] ?? null,
            pullRequestUrl: row.deliveries[0]?.pullRequestUrl ?? row.pullRequestUrl ?? null,
            // The opened card's preview: the delivery's screenshots, web links only.
            screenshots: webLinks(row.deliveries[0]?.screenshots),
            beforeScreenshots: webLinks(row.deliveries[0]?.beforeScreenshots),
            // Approve is the good-to-merge judgement, given while the work waits for it.
            canApprove: row.substatus === "requires_review",
            approved: row.substatus === "accepted" || row.substatus === "ready_to_merge" || row.substatus === "error",
            // Live work waits for a person's "Looks fine" before it moves to Delivered (#live-confirmed).
            canConfirm: row.status === "resolved" && row.substatus !== "merged_broken" && !row.liveConfirmedAt,
            confirmed: Boolean(row.liveConfirmedAt),
          };
        };

        // A section's cards. Needs your OK puts the newest delivery first (#just-delivered): the work delivered last is
        // the top card, then live work with no delivery on record, newest first. The others are newest first.
        const sectionRows = async (key: FeedSection, sectionWhere: Prisma.BugWhereInput, skip: number, take: number) => {
          if (key !== "needs") return prisma.bug.findMany({ where: sectionWhere, orderBy, skip, take, select });
          const deliveredWhere: Prisma.BugWhereInput = { AND: [sectionWhere, { deliveries: { some: {} } }] };
          const [latest, deliveredCount] = await Promise.all([
            prisma.delivery.findMany({ where: { bug: deliveredWhere }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], distinct: ["bugId"], skip, take, select: { bugId: true } }),
            prisma.bug.count({ where: deliveredWhere }),
          ]);
          const ids = latest.map((row) => row.bugId);
          const delivered = ids.length ? await prisma.bug.findMany({ where: { id: { in: ids } }, select }) : [];
          const byId = new Map(delivered.map((row) => [row.id, row]));
          const rows = ids.flatMap((id) => byId.get(id) ?? []);
          if (rows.length >= take) return rows;
          const rest = await prisma.bug.findMany({
            where: { AND: [sectionWhere, { deliveries: { none: {} } }] },
            orderBy, skip: Math.max(0, skip - deliveredCount), take: take - rows.length, select,
          });
          return [...rows, ...rest];
        };

        // The Work Feed (#work-feed-sections): its three sections, a few cards each, or one of them in full.
        if (overviewTab === "all") {
          const now = currentTime();
          const counts = new Map<string, number>();
          if (!overviewSection) {
            const groups: FeedGroup[] = await Promise.all(FEED_SECTIONS.map(async ({ key, title }) => {
              const sectionWhere: Prisma.BugWhereInput = { AND: [where, feedSectionWhere(key, now)] };
              const [rows, count] = await Promise.all([
                sectionRows(key, sectionWhere, 0, FEED_SECTION_SIZE),
                prisma.bug.count({ where: sectionWhere }),
              ]);
              counts.set(key, count);
              const times = await timesFor(rows);
              const items = rows.map((row) => toItem(row, key, times));
              // The newest delivery tops Needs your OK, celebrated (#just-delivered).
              if (key === "needs" && items[0]) items[0] = { ...items[0], justDelivered: true };
              return { key, title, count, items };
            }));
            return { items: [], groups, total: 0, page: 1, counts };
          }
          const sectionWhere: Prisma.BugWhereInput = { AND: [where, feedSectionWhere(overviewSection, now)] };
          const [rows, total, ...sectionCounts] = await Promise.all([
            sectionRows(overviewSection, sectionWhere, (page - 1) * FEED_PAGE_SIZE, FEED_PAGE_SIZE),
            prisma.bug.count({ where: sectionWhere }),
            ...FEED_SECTIONS.map(({ key }) => prisma.bug.count({ where: { AND: [where, feedSectionWhere(key, now)] } })),
          ]);
          FEED_SECTIONS.forEach(({ key }, index) => counts.set(key, sectionCounts[index]));
          const times = await timesFor(rows);
          const items = rows.map((row) => toItem(row, overviewSection, times));
          if (overviewSection === "needs" && page === 1 && items[0]) items[0] = { ...items[0], justDelivered: true };
          return { items, groups: null, total, page, counts };
        }
        // The other tabs: newest first; the Status filter narrows to one status, and its counts are the tab's.
        const feedWhere: Prisma.BugWhereInput = overviewState ? { AND: [where, { status: overviewState }] } : where;
        const [rows, total, byStatus] = await Promise.all([
          prisma.bug.findMany({ where: feedWhere, orderBy, skip: (page - 1) * FEED_PAGE_SIZE, take: FEED_PAGE_SIZE, select }),
          prisma.bug.count({ where: feedWhere }),
          prisma.bug.groupBy({ by: ["status"], where, _count: { _all: true } }),
        ]);
        const counts = new Map(byStatus.map((group) => [group.status as string, group._count._all]));
        const times = await timesFor(rows);
        return { items: rows.map((row) => toItem(row, null, times)), groups: null, total, page, counts };
      }, emptyFeed)
    : emptyFeed;
  // An Overview tab's address, with the Status filter when one is picked.
  const overviewHref = (tab: OverviewTab, state: string | null, mine: boolean = isMyWorkTab, section: FeedSection | null = null) =>
    listHref(new URLSearchParams({ status: YOUR_WORK_STATUS, ...(tab === "all" ? {} : { [OVERVIEW_TAB_PARAM]: tab }), ...(state ? { [OVERVIEW_STATE_PARAM]: state } : {}), ...(mine ? { [OVERVIEW_MINE_PARAM]: "1" } : {}), ...(section ? { [OVERVIEW_SECTION_PARAM]: section } : {}) }));
  // The same Overview tab in another project, or every project.
  const overviewProjectHref = (target: ProjectRef) =>
    listHrefIn(target, new URLSearchParams({ status: YOUR_WORK_STATUS, ...(overviewTab === "all" ? {} : { [OVERVIEW_TAB_PARAM]: overviewTab }), ...(overviewState ? { [OVERVIEW_STATE_PARAM]: overviewState } : {}), ...(isMyWorkTab ? { [OVERVIEW_MINE_PARAM]: "1" } : {}) }));
  // The Work Feed with one of its sections in full, or all three.
  const sectionHref = (section: FeedSection | null) => overviewHref("all", null, isMyWorkTab, section);
  // New ideas (`/new`) is one of the Overview's tabs (#work-feed): it has the Overview's top, chat box and tabs.
  const isNewIdeasView = ideasView === "new";
  const withOverviewLook = isYourWorkView || isNewIdeasView;
  const tabClass = (current: boolean) =>
    `inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] transition ${
      current ? "bg-white font-semibold text-zk-accent shadow-[0_1px_2px_rgba(16,24,40,0.08)]" : "font-medium text-zk-muted hover:text-zk-text"
    }`;
  // How much has been delivered (#live-confirmed), shown on the Delivered tab: live work someone confirmed.
  const deliveredCount = withOverviewLook
    ? await loadOrEmpty("delivered count", () => prisma.bug.count({
        where: { ...(allProjects ? { organisationId } : { projectId: project.id }), isDeleted: false, status: "resolved", liveConfirmedAt: { not: null } },
      }), 0)
    : 0;
  // The Overview's tabs, as a segmented control: the Work Feed, New (the ideas), then the work's other lists.
  const overviewTabs = withOverviewLook ? (
    <nav aria-label="Overview lists" className="flex flex-wrap gap-0.5 rounded-2xl bg-zk-bg p-1 sm:rounded-full">
      {OVERVIEW_TABS.flatMap(([tab, label]) => [
        <Link key={tab} href={overviewHref(tab, null)} aria-current={isYourWorkView && overviewTab === tab ? "page" : undefined} className={tabClass(isYourWorkView && overviewTab === tab)}>
          <TabIcon tab={tab} />
          {label}
          {tab === "delivered" && deliveredCount > 0 ? (
            <span className="ml-0.5 rounded-full bg-zk-chip px-1.5 py-px text-[11px] font-semibold tabular-nums text-zk-text2">{deliveredCount}</span>
          ) : null}
        </Link>,
        // Fixes (the new ideas) sits after New Features, with a small + before it to plan a new feature (#add-feature).
        ...(tab === "features"
          ? [
              ...(everyProject
                ? []
                : [
                    <Link
                      key="add-feature"
                      href={projectPath(ref, "/features/new")}
                      aria-label="Add a new feature"
                      title="Add a new feature"
                      className="-ml-1 inline-flex h-8 w-8 items-center justify-center self-center rounded-full text-zk-muted transition hover:bg-white hover:text-zk-accent hover:shadow-[0_1px_2px_rgba(16,24,40,0.08)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                    </Link>,
                  ]),
              <Link key="new" href={ideasPath(listRef, "new")} aria-current={isNewIdeasView ? "page" : undefined} className={tabClass(isNewIdeasView)}>
                <TabIcon tab="new" />
                Fixes
              </Link>,
            ]
          : []),
      ])}
    </nav>
  ) : null;
  // The Work Feed's top: its tabs on the left, the Status filter on the right.
  const overviewToolbar = isYourWorkView ? (
    <>
      {overviewTabs}
      {/* The Filter picks the project only (#project-filter): every project, or one, keeping the tab. The tabs and
          sections already say what kind of work and where it is, so the Filter doesn't repeat them. */}
      {isOrgMember && orgProjects.length > 1 ? (
        <ToolbarFilterMenu
          summary={filterProject ? filterProject.name : ""}
          groups={[{
            label: "Project",
            options: [
              { label: "All projects", href: overviewProjectHref(orgRefOf(ref)), selected: !filterProject },
              ...orgProjects.map((item) => ({ label: item.name, href: overviewProjectHref(refOf(item)), selected: filterProject?.id === item.id })),
            ],
          }]}
        />
      ) : null}
    </>
  ) : null;
  // The Overview shows the cards above, not the list: the list's count, rows and confirmations are skipped, which with
  // thousands of issues are most of the page's work (the Work Feed's filter matches every issue in the organisation).
  if (feedView) where.id = { in: [] };

  let totalCount = 0;
  try {
    // PostgreSQL is authoritative for pagination totals while the index is asynchronous.
    totalCount = await prisma.bug.count({ where });
  } catch (error) {
    const reference = logLoadFailure("[bugs] list count failed", error);
    const missingColumn = isMissingOrganisationColumnError(error);
    if (!organisationId) {
      // No membership: nothing to show either way (#439).
      totalCount = 0;
      if (missingColumn) {
        delete where.organisationId;
        delete where.projectId;
        where.id = { in: [] };
      }
    } else if (missingColumn) {
      // #506: never retry without the organisation filter. That used to show every
      // organisation's issues to anyone whose query error mentioned the column.
      return issuesQueryError(
        reference,
        "The issue list is unavailable while the database finishes upgrading. Try again in a minute.",
      );
    } else {
      return issuesQueryError(reference);
    }
  }
  // A cardinality mismatch means the asynchronous index cannot safely define
  // this request's page set. Use PostgreSQL for both rows and exact total.
  if (typesenseBugSearch && typesenseBugSearch.found !== totalCount) typesenseBugSearch = null;

  const stageView: IssueStage | null = isDeletedView || isIdeasView
    ? null
    : parseIssueStageView(toSingleQueryParam(params.stage));
  let stages = new Map<string, IssueStage>();
  // How many independent people confirmed each open issue, under the one rule (#issue-confirmations).
  let confirmationCounts = new Map<string, number>();
  let confirmationStates = new Map<string, { accepts: number; rejects: number; needed: number; confirmed: boolean }>();
  if (!isDeletedView) {
    try {
      const confirmations = await openIssueConfirmations(prisma, where);
      stages = new Map([...confirmations].map(([id, c]) => [id, c.stage]));
      confirmationCounts = new Map([...confirmations].map(([id, c]) => [id, c.accepts]));
      confirmationStates = new Map([...confirmations].map(([id, c]) => [id, { accepts: c.accepts, rejects: c.rejects, needed: c.needed, confirmed: c.confirmed }]));
    } catch (error) {
      console.error("[bugs] issue stage lookup failed", error);
    }
    if (stageView) {
      const ids = [...stages.entries()].filter(([, stage]) => stage === stageView).map(([id]) => id);
      where.id = { in: ids };
      try {
        totalCount = await prisma.bug.count({ where });
      } catch (error) {
        console.error("[bugs] stage count failed", error);
        totalCount = 0;
      }
    }
  }
  // #1055: every tab counts what the other filters match, so switching tabs
  // never surprises. The snapshot is taken after
  // the stage clause is applied (#626): a ?stage= page must count the same
  // rows its result list shows — tabs, badges and the "Show N resolved" link
  // all follow the stage filter, not the pre-stage row set.
  // Count the same organisation/project and search scope without the selected tab:
  // its status, and the extra clauses Ideas, Rejected, Duplicates,
  // Ready to Merge and Live add. Left in, those leaked into every other tab's
  // count (on Ready to Merge, "All" only counted ready-to-merge issues).
  const {
    status: _selectedStatus,
    id: _stageIds,
    confirmations: _rejected,
    duplicateOfId: _duplicate,
    AND: _notMergeStage,
    ...tabScope
  } = where;
  // Put the default duplicate scope back: the Duplicates filter's override is
  // dropped, but tabs and counts still leave out the duplicates the list hides.
  const statusTabWhere: Prisma.BugWhereInput = { ...tabScope, ...duplicatesWhere(showDuplicates) };
  void _selectedStatus;
  void _stageIds;
  void _rejected;
  void _duplicate;
  void _notMergeStage;
  // How many the default view is hiding, so "Show duplicates" can say so.
  let hiddenDuplicates = 0;
  if (!showDuplicates) {
    try {
      hiddenDuplicates = await prisma.bug.count({
        where: { ...where, duplicateOfId: { not: null } },
      });
    } catch (error) {
      console.error("[bugs] duplicate count failed", error);
    }
  }
  const duplicatesHref = (() => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const v = Array.isArray(value) ? value[0] : value;
      if (v && key !== DUPLICATES_PARAM && key !== "page") next.set(key, v);
    }
    if (!showDuplicates) next.set(DUPLICATES_PARAM, SHOW_DUPLICATES);
    const qs = next.toString();
    return listHref(new URLSearchParams(qs));
  })();

  const pagination = calculatePagination({
    page: pageParam,
    totalCount,
  });

  // Select only what the list shows: no `description` (up to 5000 chars
  // each), which the list never displays (#217).
  let indexedBugIds: string[] | null = null;
  if (typesenseBugSearch && organisationId && qParam) {
    try {
      const result = await searchWorkItems({ query: boundSearchTerm(qParam), kind: "bug", organisationId, ...(scopeProjectId ? { projectId: scopeProjectId } : {}), ...trackSearch, includeDeleted: isDeletedView, page: pagination.page, perPage: pagination.take, sortBy: bugSearchSort(currentSort, !isWatchingView), extraFilters: bugSearchExtraFilters });
      indexedBugIds = result.hits.map((hit) => hit.id);
    } catch (error) {
      console.error("[issues] Typesense result lookup failed; using PostgreSQL", error);
    }
  }
  const issueRowWhere = { ...where };
  if (indexedBugIds) {
    delete issueRowWhere.OR;
    issueRowWhere.id = { in: indexedBugIds };
  }
  let listed = await prisma.bug
    .findMany({
      where: issueRowWhere,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        substatus: true,
        // A closed issue says why it was closed (#close-reasons).
        closeReason: true,
        voteCount: true,
        projectId: true,
        project: { select: { slug: true, organisation: { select: { slug: true } } } },
        isDeleted: true,
        isBoosted: true,
        priority: true,
        duplicateOf: showDuplicates ? { select: { number: true } } : false,
        createdAt: true,
        updatedAt: true,
        // A live fix shows its dev → staging → main chips in the status column.
        pullRequestUrl: true,
        type: { select: { name: true } },
        reporter: { select: { name: true, role: true, image: true } },
        assignee: { select: { name: true, role: true, image: true } },
        // Who is working on it and since when, for the status column.
        // The claim working on it, or an offer waiting to be accepted.
        claims: {
          where: { status: { in: ["active", "offered", "planning"] }, releasedAt: null },
          select: { status: true, claimedAt: true, createdAt: true, deliverBy: true, beneficiaryUserId: true, beneficiary: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: 2,
        },
        area: { select: { id: true, name: true } },
        // #rewards: what solving it pays, in $, and whether the estimating is done.
        reward: true,
        rewardEstimateCount: true,
        rewardFixedAt: true,
        _count: {
          select: {
            comments: true,
            attachments: true,
            // Open bids, shown on Open issues: the issue page's rule, so an
            // awarded bid whose offer lapsed or claim was released no longer counts.
            bids: { where: OPEN_BID_WHERE },
          },
        },
      },
      // A personal list reads newest-activity-first; boosts are for the shared one.
      orderBy: getBugOrderBy(currentSort, { boostFirst: !isWatchingView }),
      skip: indexedBugIds ? 0 : pagination.skip,
      take: indexedBugIds ? indexedBugIds.length : pagination.take,
    })
    .then((bugs) => ({ bugs }))
    .catch((error: unknown) => ({ reference: logLoadFailure("[bugs] list query failed", error) }));
  let forcePgFallback = false;
  if (indexedBugIds && "bugs" in listed && qParam) {
    try {
      const literalQuery = boundSearchTerm(qParam).toLocaleLowerCase();
      const exactNumber = parseIssueNumberQuery(qParam);
      const descriptionsNeeded = listed.bugs.filter((bug) => !bug.title.toLocaleLowerCase().includes(literalQuery) && bug.number !== exactNumber).map((bug) => bug.id);
      const descriptions = descriptionsNeeded.length
        ? await prisma.bug.findMany({ where: { ...issueRowWhere, id: { in: descriptionsNeeded } }, select: { id: true, description: true } })
        : [];
      const byId = new Map(descriptions.map((row) => [row.id, row.description]));
      const matched = listed.bugs.filter((bug) => bug.title.toLocaleLowerCase().includes(literalQuery)
        || bug.number === exactNumber || (byId.get(bug.id)?.toLocaleLowerCase().includes(literalQuery) ?? false));
      if (matched.length !== listed.bugs.length) listed = { bugs: matched };
    } catch (error) {
      console.error("[issues] could not validate indexed text results; using PostgreSQL", error);
      forcePgFallback = true;
    }
  }
  if (indexedBugIds && "bugs" in listed && (forcePgFallback || listed.bugs.length < Math.min(pagination.take, Math.max(0, totalCount - pagination.skip)))) {
    // The index is eventually consistent. If validation drops a stale hit, use the established query for this request rather than render a short page.
    listed = await prisma.bug.findMany({ where, select: {
      id: true, number: true, title: true, status: true, substatus: true, closeReason: true, voteCount: true,
      projectId: true, project: { select: { slug: true, organisation: { select: { slug: true } } } }, isDeleted: true, isBoosted: true, priority: true, createdAt: true, updatedAt: true,
      pullRequestUrl: true, type: { select: { name: true } }, reporter: { select: { name: true, role: true, image: true } },
      assignee: { select: { name: true, role: true, image: true } },
      claims: { where: { status: { in: ["active", "offered", "planning"] }, releasedAt: null }, select: { status: true, claimedAt: true, createdAt: true, deliverBy: true, beneficiaryUserId: true, beneficiary: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 2 },
      area: { select: { id: true, name: true } }, reward: true, rewardEstimateCount: true, rewardFixedAt: true,
      duplicateOf: showDuplicates ? { select: { number: true } } : false,
      _count: { select: { comments: true, attachments: true, bids: { where: OPEN_BID_WHERE } } },
    }, orderBy: getBugOrderBy(currentSort, { boostFirst: !isWatchingView }), skip: pagination.skip, take: pagination.take })
      .then((bugs) => ({ bugs }))
      .catch((error: unknown) => ({ reference: logLoadFailure("[bugs] list query failed", error) }));
  }
  if ("reference" in listed) {
    return issuesQueryError(listed.reference);
  }
  const bugs = listed.bugs;
  // #ziki-coins: which rows on this page have Ziks behind them, for the Funded badge.
  const funded = await loadOrEmpty("funded", () => escrowByBug(prisma, bugs.map((bug) => bug.id)), new Map<string, number>());
  // #live-check: where each Live row on this page has its fix.
  const liveChecks = await loadOrEmpty("live checks", () => loadLiveChecks(bugs.filter((bug) => bug.status === "resolved")), new Map<string, LiveCheck>());
  // #live-confirm: what each agent found, for the Live rows on this page, shown when a row is opened.
  const liveConfirmations = await loadOrEmpty("live confirmations", () => loadProdConfirmations(bugs.filter((bug) => liveChecks.has(bug.id)).map((bug) => bug.id)), new Map<string, ProdConfirmation[]>());
  // Your Work: which rows are there because of your bid, for each row's tag.
  const myBidIds = isMyWorkTab && userId && bugs.length
    ? new Set(
        (await loadOrEmpty("your bids", () => prisma.issueBid.findMany({
          where: { beneficiaryUserId: userId, withdrawnAt: null, bugId: { in: bugs.map((b) => b.id) } },
          select: { bugId: true },
        }), [])).map((bid) => bid.bugId),
      )
    : new Set<string>();

  // #idea-table: the Ideas tab's New ideas and Drafted read open ideas from
  // their own table, in the same organisation, project and search scope as the
  // issues. A draft is a person's idea not yet written up in the standard
  // headings.
  const ideaWhere: Prisma.IdeaWhereInput = {
    organisationId: organisationId ?? "",
    ...PRODUCT_TRACK,
    ...(scopeProjectId ? { projectId: scopeProjectId } : {}),
    isDeleted: false,
    status: "open",
    ...(qParam?.trim()
      ? {
          OR: [
            { title: { contains: escapeSearchQuery(boundSearchTerm(qParam)), mode: "insensitive" } },
            { description: { contains: escapeSearchQuery(boundSearchTerm(qParam)), mode: "insensitive" } },
          ],
        }
      : {}),
    // The Ideas list's more-filters widget: who wrote it, and only mine.
    ...(ideaAuthor === "agents" ? { createdByAgentId: { not: null } } : ideaAuthor === "people" ? { createdByAgentId: null } : {}),
    ...(mineFilter === "created" && userId ? { reporterId: userId } : {}),
    ...(workCategory ? { AND: [ideaCategoryWhere(workCategory, categoryTypes)] } : {}),
  };
  // Rejected ideas (#idea-rejected), with the same scope and search as new
  // ones. Archived ideas (#idea-archive) show here too, labelled Archived.
  const rejectedIdeaWhere: Prisma.IdeaWhereInput = { ...ideaWhere, status: { in: ["rejected", "archived"] } };
  // #project-links: the project's site and GitHub repository, and whether you can set them.
  const [projectLinks, canEditProjectLinks] = await Promise.all([
    loadOrEmpty("project links", () => prisma.project.findUnique({ where: { id: project.id }, select: { siteUrl: true, repoUrl: true, appStoreUrl: true, playStoreUrl: true, downloadUrl: true, productKinds: true, productOther: true } }), null),
    organisationId && userId ? loadOrEmpty("project admin", () => isAdminOfOrganisation(user, organisationId), false) : Promise.resolve(false),
  ]);
  // #agent-work-gate: your agents that aren't allowed to work until their profile is set up. The agents bar
  // marks each one "Set up"; here they only hold back the ideas page's opening question.
  const unconfiguredAgents: UnconfiguredAgent[] =
    organisationId && userId
      ? await loadOrEmpty(
          "unconfigured agents",
          async () => {
            const agents = await prisma.agent.findMany({
              where: {
                ...activeIn(organisationId),
                ownerUserId: userId,
                revokedAt: null,
                OR: [{ tagline: null }, { about: null }, { skills: { none: {} } }, { tagline: "" }, { about: "" }],
              },
              orderBy: { createdAt: "asc" },
              select: { id: true, name: true, username: true, tagline: true, about: true, _count: { select: { skills: true } } },
            });
            return agents
              .map((agent) => ({ id: agent.id, name: agent.name, username: agent.username, missing: missingProfileFields({ ...agent, skillCount: agent._count.skills }) }))
              .filter((agent) => agent.missing.length > 0);
          },
          [] as UnconfiguredAgent[],
        )
      : [];
  // First questions (#first-questions): setting up a project is the organisation owner's or an admin's, so only
  // they get it, on a project that has no ideas yet (any status, rejected included). It opens on Overview too,
  // where /home lands right after creating an organisation. Members who join get the welcome tour instead.
  const showFirstQuestions =
    (isIdeasView || isYourWorkView) && !isDeletedView && Boolean(organisationId && userId) && isOrgAdmin &&
    (await loadOrEmpty("first questions", () => prisma.idea.count({ where: { projectId: project.id } }), 1)) === 0;
  // My Work shows only when you have work in this project: issues you bid on or hold, whatever their status.
  const myWorkCount =
    userId && !isDeletedView
      ? await loadOrEmpty(
          "my work",
          () =>
            prisma.bug.count({
              where: { ...bugInOrganisation(organisationId), ...(scopeProjectId ? { projectId: scopeProjectId } : {}), ...trackWhere(trackFilter), isDeleted: false, ...myWorkWhere(userId) },
            }),
          0,
        )
      : 0;
  // The Your Work stage shows only while something is assigned to you in this project.
  const yourWorkCount =
    userId && !isDeletedView && organisationId
      ? await loadOrEmpty(
          "your work",
          () =>
            prisma.bug.count({
              where: { ...bugInOrganisation(organisationId), ...(scopeProjectId ? { projectId: scopeProjectId } : {}), isDeleted: false, ...duplicatesWhere(showDuplicates), AND: [yourWorkWhere(userId)] },
            }),
          0,
        )
      : 0;
  // Project Overview (#project-overview): your open bids, counted, not listed. Who delivered what this week is on the Work queue.
  const openBidCount = isYourWorkView && organisationId && userId
    ? await loadOrEmpty("open bids", () => prisma.bug.count({ where: { ...bugInOrganisation(organisationId), ...(scopeProjectId ? { projectId: scopeProjectId } : {}), isDeleted: false, ...yourOpenBidsWhere(userId) } }), 0)
    : 0;
  // The Ideas tab's counts show on every tab; drafts only while Ideas is open.
  const [ideasCount, rejectedIdeasCount, draftIds] = await Promise.all([
    organisationId && !isDeletedView ? loadOrEmpty("ideas tab", () => prisma.idea.count({ where: ideaWhere }), 0) : 0,
    organisationId && !isDeletedView ? loadOrEmpty("rejected ideas tab", () => prisma.idea.count({ where: rejectedIdeaWhere }), 0) : 0,
    organisationId && isIdeasView
      ? loadOrEmpty(
          "drafted ideas",
          async () =>
            (await prisma.idea.findMany({ where: { ...ideaWhere, createdByAgentId: null }, select: { id: true, description: true, createdByAgentId: true } }))
              .filter(isUnstructuredDraft)
              .map((idea) => idea.id),
          [] as string[],
        )
      : ([] as string[]),
  ]);

  // New ideas are the Overview's New Ideas tab (#work-feed): one list of cards, newest first, not grouped by kind.
  // The Ideas lists page like the issue lists (#ideas-pages), 25 at a time.
  const ideaPagination = calculatePagination({
    page: pageParam,
    totalCount: ideasView === "drafts" ? draftIds.length : ideasView === "rejected" ? rejectedIdeasCount : ideasCount,
  });
  const ideaPageParams: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(params)
      .filter(([key]) => key !== "page" && key !== "status" && key !== IDEAS_PARAM)
      .map(([key, value]) => [key, toSingleQueryParam(value)]),
  );
  const ideaRows: IdeaListRow[] = isIdeasView && organisationId
    ? await loadOrEmpty("ideas list", async () => {
        const originalIdeaWhere = ideasView === "drafts" ? { ...ideaWhere, id: { in: draftIds } } : ideasView === "rejected" ? rejectedIdeaWhere : ideaWhere;
        let indexedIdeaIds: string[] | null = null;
        if (qParam && boundSearchTerm(qParam).length >= 3 && ideasView !== "drafts") {
          try {
            const filters = [
              ...(ideasView === "rejected" ? ["status:[rejected,archived]"] : ["status:=open"]),
              ...(ideaAuthor === "agents" ? ["hasAgentCreator:=true"] : ideaAuthor === "people" ? ["hasAgentCreator:=false"] : []),
              ...(mineFilter === "created" && userId ? [`reporterId:=${userId}`] : []),
            ];
            const indexed = await searchWorkItems({ query: boundSearchTerm(qParam), kind: "idea", organisationId, ...(scopeProjectId ? { projectId: scopeProjectId } : {}), track: "product", page: ideaPagination.page, perPage: ideaPagination.take, sortBy: ideaSearchSort(currentIdeaSort), extraFilters: filters });
            if (indexed.found === ideaPagination.totalCount) indexedIdeaIds = indexed.hits.map((hit) => hit.id);
          } catch (error) {
            console.error("[ideas] Typesense result lookup failed; using PostgreSQL", error);
          }
        }
        const ideaRowWhere = { ...originalIdeaWhere };
        if (indexedIdeaIds) {
          delete ideaRowWhere.OR;
          ideaRowWhere.id = { in: indexedIdeaIds };
        }
        let rows = await prisma.idea.findMany({
          where: ideaRowWhere,
          orderBy: getIdeaOrderBy(currentIdeaSort),
          skip: indexedIdeaIds ? 0 : ideaPagination.skip,
          take: indexedIdeaIds ? indexedIdeaIds.length : ideaPagination.take,
          select: {
            id: true, number: true, title: true, score: true, projectId: true, createdAt: true, updatedAt: true, summary: true, description: true,
            status: true, archiveReason: true, archiveDuplicateOf: true, rejectedAt: true, archivedAt: true,
            // Its newest verdict, for the Last update column.
            verdicts: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
            reporter: { select: { name: true } },
            _count: { select: { verdicts: true } },
          },
        });
        let validatedRows = rows;
        let forcePgIdeaFallback = false;
        if (indexedIdeaIds && qParam) {
          try {
            const literalQuery = boundSearchTerm(qParam).toLocaleLowerCase();
            const descriptionsNeeded = rows.filter((row) => !row.title.toLocaleLowerCase().includes(literalQuery)).map((row) => row.id);
            const descriptions = descriptionsNeeded.length
              ? await prisma.idea.findMany({ where: { ...ideaRowWhere, id: { in: descriptionsNeeded } }, select: { id: true, description: true } })
              : [];
            const byId = new Map(descriptions.map((row) => [row.id, row.description]));
            validatedRows = rows.filter((row) => row.title.toLocaleLowerCase().includes(literalQuery) || (byId.get(row.id)?.toLocaleLowerCase().includes(literalQuery) ?? false));
          } catch (error) {
            console.error("[ideas] could not validate indexed text results; using PostgreSQL", error);
            forcePgIdeaFallback = true;
          }
        }
        if (indexedIdeaIds && (forcePgIdeaFallback || validatedRows.length < Math.min(ideaPagination.take, Math.max(0, ideaPagination.totalCount - ideaPagination.skip)))) {
          rows = await prisma.idea.findMany({ where: originalIdeaWhere, orderBy: getIdeaOrderBy(currentIdeaSort), skip: ideaPagination.skip, take: ideaPagination.take, select: {
            id: true, number: true, title: true, score: true, projectId: true, createdAt: true, updatedAt: true, summary: true, description: true,
            status: true, archiveReason: true, archiveDuplicateOf: true, rejectedAt: true, archivedAt: true,
            verdicts: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
            reporter: { select: { name: true } }, _count: { select: { verdicts: true } },
          } });
        } else rows = validatedRows;
        const thresholds = new Map<string, number | null>();
        for (const id of new Set(rows.map((row) => row.projectId))) {
          thresholds.set(id, await workflowFor(id).then((w) => w.ideaThreshold).catch(() => null));
        }
        // Each idea's weighted votes (#724): the good and bad columns, and to mark the bad ones red (lib/idea-rejection.ts).
        const totals = await ideaVoteTotals(prisma, rows.map((row) => row.id));
        // Ideas the viewer already gave a verdict on, any way (#idea-path): those show their way on, not Approve.
        const approvedByMe = new Set(
          userId
            ? (await prisma.ideaVerdict.findMany({
                where: { ideaId: { in: rows.map((row) => row.id) }, onBehalfOfUserId: userId },
                select: { ideaId: true },
              })).map((verdict) => verdict.ideaId)
            : [],
        );
        const listed = rows.map((row) => {
          const votes = totals.get(row.id) ?? NO_VOTES;
          return { row, votes };
        });
        return listed.map(({ row, votes }) => ({
          id: row.id,
          number: row.number,
          ref: projectRefs.get(row.projectId),
          projectName: allProjects ? projectNames.get(row.projectId) ?? null : null,
          title: row.title,
          score: row.score,
          threshold: thresholds.get(row.projectId) ?? null,
          createdAt: row.createdAt,
          reporterName: row.reporter.name,
          // Opened in place (#work-feed): what it says, trimmed for a quick glance.
          summary: row.summary ?? null,
          body: feedBody(row.description),
          verdicts: row._count.verdicts,
          rejected: ideasView === "rejected",
          archived: row.status === "archived" ? archiveReasonLabel(row.archiveReason, row.archiveDuplicateOf) : null,
          good: votes.good,
          badVotes: votes.bad,
          approvedByMe: approvedByMe.has(row.id),
          // The latest thing that happened to it: an edit, a verdict, a rejection or archiving.
          lastUpdateAt: new Date(Math.max(
            ...[row.updatedAt, row.verdicts[0]?.updatedAt, row.rejectedAt, row.archivedAt].filter((date): date is Date => Boolean(date)).map((date) => date.getTime()),
          )),
          bad: ideasView !== "rejected" && (thresholds.get(row.projectId) ?? null) !== null
            && isBadIdea(ideaVotes([{ opinion: "good", votes: votes.good }, { opinion: "bad", votes: votes.bad }, { opinion: "neutral", votes: votes.neutral }]), thresholds.get(row.projectId)!),
        }));
      }, [] as IdeaListRow[])
    : [];

  // #301: when searching, show why a row matched. Only rows whose title
  // doesn't already contain the query need their description, so the list
  // query still never selects it (#217) and a search whose hits are all in
  // titles costs nothing extra. No search → no query at all.
  const searchText = qParam?.trim() ?? "";
  const snippets = new Map<string, Snippet>();
  // Possibly delivered: why each issue is on the list, and why it is still Open.
  const signals = statusParam === POSSIBLY_DELIVERED ? await loadOrEmpty("delivery signals", () => deliverySignals(prisma, bugs.map((b) => b.id)), new Map()) : new Map<string, DeliverySignals>();
  // #deeper-testing: each row being judged shows its tests at a glance, counted as the gate counts them.
  const testBars = await loadOrEmpty("tests bars", () => judgementBars(prisma, bugs.filter((b) => b.status === "done").map((b) => b.id)), new Map<string, { good: number; needed: number }>());
  if (searchText) {
    const needDescription = bugs
      .filter((bug) => !hasMatch(bug.title, searchText))
      .map((bug) => bug.id);
    if (needDescription.length > 0) {
      try {
        const rows = await prisma.bug.findMany({
          where: { id: { in: needDescription } },
          select: { id: true, description: true },
        });
        for (const row of rows) {
          const snippet = matchSnippet(markdownToPlain(row.description), searchText);
          if (snippet) snippets.set(row.id, snippet);
        }
      } catch (error) {
        // A snippet is a nicety; the results themselves are already loaded.
        console.error("[bugs] search snippets failed", error);
      }
    }
  }


  // #289: filtering on one milestone shows its progress above the list.
  let milestoneSummary: Awaited<ReturnType<typeof loadMilestoneSummaries>>[number] | null = null;
  if (selectedMilestone && selectedMilestone !== "none") {
    try {
      [milestoneSummary] = await loadMilestoneSummaries({
        id: selectedMilestone.id,
        organisationId: organisationId ?? undefined,
      });
    } catch (error) {
      console.error("[bugs] milestone summary failed", error);
    }
  }

  // "No issues match" and "there are no issues yet" need different pages
  // (#292): filter advice on an empty tracker sends people looking for a
  // filter that is not there. The extra count only runs when the page is
  // already empty, so a populated list pays nothing for it. It counts the
  // same scope the list shows, including ?project=all, so an empty filter
  // across a busy organisation is "no issues match", not "no issues yet".
  // A project whose only work is ideas waiting for your OK isn't empty: the Work Feed lists them under Needs your OK.
  let isFirstRun = false;
  if (totalCount === 0 && !isDeletedView && ideasToOkCount === 0) {
    try {
      isFirstRun = (await prisma.bug.count({
        where: {
          ...bugInOrganisation(organisationId),
          ...PRODUCT_TRACK,
          ...(scopeProjectId ? { projectId: scopeProjectId } : {}),
          isDeleted: false,
        },
      })) === 0;
    } catch {
      isFirstRun = false;
    }
  }

  // Only the watching view offers "stop watching the finished ones", and
  // only when there are some; everyone else pays for nothing (#312).
  let finishedWatched = 0;
  if (isWatchingView && userId) {
    try {
      finishedWatched = await prisma.bug.count({
        where: { ...finishedWatchedWhere(userId), ...bugInOrganisation(organisationId), ...PRODUCT_TRACK },
      });
    } catch (error) {
      console.error("[bugs] finished watched count failed", error);
    }
  }

  // The current query string, which the status links build on.
  const currentQuery = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) => {
      const single = toSingleQueryParam(v);
      return single ? [[k, single] as [string, string]] : [];
    }),
  ).toString();

  const confirmingCount = [...stages.values()].filter((stage) => stage === "confirming").length;
  const readyCount = [...stages.values()].filter((stage) => stage === "ready").length;

  const [statusCounts, rejectedCount, duplicateCount, errorCount, possiblyDeliveredCount] = isDeletedView || !organisationId ? [[], 0, 0, 0, 0] : await Promise.all([
    loadOrEmpty("status tabs", () => prisma.bug.groupBy({
      by: ["status"], where: statusTabWhere, _count: { _all: true },
    }), []),
    loadOrEmpty("rejected filter", () => prisma.bug.count({
      where: { ...statusTabWhere, confirmations: REJECTED_WHERE },
    }), 0),
    loadOrEmpty("duplicate filter", () => prisma.bug.count({
      where: { ...statusTabWhere, duplicateOfId: { not: null } },
    }), 0),
    loadOrEmpty("merge error list", () => prisma.bug.count({
      where: { ...statusTabWhere, substatus: "error" },
    }), 0),
    loadOrEmpty("possibly delivered list", () => prisma.bug.count({
      where: { AND: [statusTabWhere, POSSIBLY_DELIVERED_WHERE] },
    }), 0),
  ]);
  // One status per issue, so the status tabs never overlap and add up to All.
  const countForStatus = (status: string) => statusCounts.find((row) => row.status === status)?._count._all ?? 0;
  const allCount = statusCounts.reduce((sum, row) => sum + row._count._all, 0);
  const allFilterCount = (value: string) =>
    value === ALL_STATUS ? allCount : value === REJECTED_STATUS ? rejectedCount : value === DUPLICATE_STATUS ? duplicateCount : countForStatus(value);
  // The All tab stays selected on its own filters (Closed, Rejected, Duplicates).
  const allSelected = ALL_FILTERS.some((filter) => filter.value === statusParam);
  const statusHref = (status: string | null) => {
    const next = new URLSearchParams(currentQuery);
    next.delete("page");
    next.delete("stage");
    next.delete(SHOW_RESOLVED_PARAM);
    next.delete(IDEAS_PARAM);
    if (status) next.set("status", status);
    else next.delete("status");
    return listHref(next);
  };
  // Turns My Work on or off on the current tab; the rest of the filters stay.
  const myWorkHref = (() => {
    const next = new URLSearchParams(currentQuery);
    next.delete("page");
    if (myWorkOn) next.delete(MY_WORK_PARAM);
    else next.set(MY_WORK_PARAM, "1");
    return listHref(next);
  })();
  // Track filter: Product (the default, which leaves the address alone) / Marketing / All
  const trackHref = (track: "product" | "marketing" | "all") => {
    const next = new URLSearchParams(currentQuery);
    next.delete("page");
    if (track === "product") next.delete(TRACK_PARAM);
    else next.set(TRACK_PARAM, track);
    return listHref(next);
  };
  const trackFilterOptions: ToolbarFilterOption[] = [
    { label: "Product", count: 0, href: trackHref("product"), selected: trackFilter === "product" },
    { label: "Marketing", count: 0, href: trackHref("marketing"), selected: trackFilter === "marketing" },
    { label: "All", count: 0, href: trackHref("all"), selected: trackFilter === "all" },
  ];
  // The toolbar's Filter menu: on the All tab, All / Rejected / Duplicates (pick one); then My Work (on or off); then Track filter.
  const allTabFilters: ToolbarFilterOption[] = !isDeletedView && allSelected
    ? ALL_FILTERS.map(({ value, label }) => ({ label, count: allFilterCount(value), href: statusHref(value), selected: statusParam === value }))
    : [];
  const myWorkFilter: ToolbarFilterOption[] = myWorkCount > 0 || myWorkOn ? [{ label: "My Work", count: myWorkCount, href: myWorkHref, selected: myWorkOn }] : [];
  // Only a status tab is picked (no search or other filter): an empty list then
  // just means that tab is empty, so the empty state names the tab.
  const onlyStatusTab =
    Boolean(statusParam && (statuses as readonly string[]).includes(statusParam)) &&
    !qParam && !tagsParam && !selectedMilestone && !mineFilter;

  // The stage the page is on, and the status inside it, for the stage bar and the list on the left.
  const currentStatus = ideasView === "rejected" ? REJECTED_IDEAS_STATUS : isIdeasView ? IDEAS_STATUS : statusParam;
  const stageIndex = isDeletedView
    ? -1
    : isYourCallView
      ? IN_PROGRESS_STAGE
      : STAGE_GROUPS.findIndex((group) => (group.statuses as readonly string[]).includes(currentStatus ?? ""));
  // Your call (#your-call): the issues the agents split on that this person has to settle. Its step sits above Open only while there
  // are any, and only In Progress shows it, so the other views don't ask for it.
  const yourCall = stageIndex !== IN_PROGRESS_STAGE || !organisationId || !scopeProjectId || !userId
    ? []
    : await loadOrEmpty("your call", () => loadYourCall(scopeProjectId, { userId, isAdmin: Boolean(membershipRole && isOrganisationAdmin(membershipRole, effectiveRole)) }), []);
  // Priority now (#priority-now): the top Open issues and who each is offered to, at the top of In Progress.
  const priorityIssues = stageIndex !== IN_PROGRESS_STAGE || isDeletedView || !organisationId || !scopeProjectId
    ? []
    : await loadOrEmpty("priority now", async () => {
      const { offerWindowSeconds } = await workflowFor(scopeProjectId);
      return priorityNow({ organisationId, projectId, offerWindowSeconds });
    }, [] as PriorityNowIssue[]);
  const statusCount = (value: string) =>
    value === YOUR_WORK_STATUS ? yourWorkCount : value === IDEAS_STATUS ? ideasCount : value === REJECTED_IDEAS_STATUS ? rejectedIdeasCount : value === ERROR_STATUS ? errorCount : value === POSSIBLY_DELIVERED ? possiblyDeliveredCount : countForStatus(value);
  const statusLink = (value: string) => (value === IDEAS_STATUS ? statusHref(null) : statusHref(value));
  // The Status filter (#simple-lists): on In Progress and Delivered, all of the tab's statuses or one of them; Your call joins
  // In Progress only while the agents have split on something.
  const tabGroup = stageIndex >= 0 && !isIdeasView && !isYourWorkView ? STAGE_GROUPS[stageIndex] : null;
  const statusFilters: ToolbarFilterOption[] = tabGroup && !isDeletedView
    ? [
        ...tabGroup.statuses.map((value) => ({
          label: GROUP_FILTERS.includes(value) ? "All" : statusFilterLabel(value),
          count: GROUP_FILTERS.includes(value)
            ? tabGroup.statuses.reduce((sum, item) => sum + (item === ERROR_STATUS || item === POSSIBLY_DELIVERED || GROUP_FILTERS.includes(item) ? 0 : statusCount(item)), 0)
            : statusCount(value),
          href: statusLink(value),
          selected: value === currentStatus,
        })),
        ...(stageIndex === IN_PROGRESS_STAGE && yourCall.length > 0
          ? [{ label: "Your call", count: yourCall.length, href: statusLink(YOUR_CALL_STATUS), selected: isYourCallView }]
          : []),
      ]
    : [];
  const filterGroups: ToolbarFilterGroup[] = [
    ...(statusFilters.length ? [{ label: "Status", options: statusFilters }] : []),
    ...(allTabFilters.length ? [{ label: "Show", options: allTabFilters }] : []),
    ...(myWorkFilter.length ? [{ options: myWorkFilter }] : []),
    { label: "Track", options: trackFilterOptions },
  ];
  // What the Filter button names while closed: anything beyond the default "All".
  const filterSummary = [
    ...statusFilters.filter((option) => option.selected && option.label !== "All").map((option) => option.label),
    ...allTabFilters.filter((option) => option.selected && option.label !== "All").map((option) => option.label),
    ...(myWorkOn ? ["My Work"] : []),
    ...(trackFilter !== "product" ? [trackFilter === "all" ? "Track: All" : `Track: ${trackFilter.charAt(0).toUpperCase() + trackFilter.slice(1)}`] : []),
  ].join(" · ");
  const headerContent = (
    <>
      {activeProject?.goal ? (
        <section aria-labelledby="project-goal-heading" className="rounded-panel border border-zk-border bg-zk-surface px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="project-goal-heading" className="text-sm font-bold text-zk-text">{activeProject.name} goal</h2>
            {membershipRole && isOrganisationAdmin(membershipRole, effectiveRole) ? (
              <span className="flex items-baseline gap-4">
                <Link href={projectPath(ref, "/budget")} className="text-xs font-bold text-zk-accent underline">Budget</Link>
                <Link href={`/projects/${encodeURIComponent(activeProject.slug)}/settings`} className="text-xs font-bold text-zk-accent underline">Edit project settings</Link>
              </span>
            ) : null}
          </div>
          <RichText content={activeProject.goal} className="mt-1 text-sm text-zk-text2" />
        </section>
      ) : null}
      {/* On the Overview it holds nothing on a desktop unless there are projects to pick between: no empty band and line then. */}
      <div className={`issues-heading flex flex-wrap items-start justify-between gap-4 ${isYourWorkView && !(isOrgMember && orgProjects.length > 1) ? "md:hidden" : ""}`}>
        {/* flex-1: the Add Idea chat box opens in this bar and takes its width. */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* No visible title: the stages above say where you are. */}
          <h1 className="sr-only">{isDeletedView ? "Deleted Issues" : "Issues"}</h1>
          {isDeletedView || allProjects || !isFirstRun ? (
            <div className="flex flex-wrap items-center gap-2">
              {/* Desktop: Add Idea at the far left of the toolbar. */}
              {!isDeletedView && !isFirstRun && !isYourWorkView ? <IdeaChat projectId={project.id} className="max-md:hidden" /> : null}
              {isDeletedView ? (
                <span className="rounded-md bg-zk-bad-bg px-2 py-0.5 text-[11px] font-bold text-zk-bad-fg">Admin view</span>
              ) : null}
            </div>
          ) : null}
        </div>
        {/* Project Overview has no filters. */}
        {isYourWorkView ? null : <Suspense fallback={<div className="h-8 w-36 rounded-lg bg-zk-chip" />}>
          <IssueFilters compact tagTypes={tagTypes} milestones={milestones} areas={areas} shortcutsEnabled={shortcutsEnabled}
            stageCounts={isDeletedView ? undefined : { confirming: confirmingCount, ready: readyCount }} />
        </Suspense>}
        <div className="issues-actions flex flex-wrap items-center gap-2 print:hidden">
          {/* The Ideas section's statuses (STAGE_GROUPS), beside the search: New ideas and Rejected ideas. */}
          {isIdeasView ? (
              <StatusFilterChips
                label={false}
                filters={[
                  { label: "New ideas", count: ideasCount, href: ideasPath(listRef), selected: ideasView === "new" },
                  { label: "Rejected", count: rejectedIdeasCount, href: ideasPath(listRef, "rejected"), selected: ideasView === "rejected" },
                ]}
                more={
                  <Suspense fallback={null}>
                    <IdeasMoreFilters draftsHref={ideasPath(listRef, "drafts")} />
                  </Suspense>
                }
              />
          ) : null}
          {/* The project filter (#project-filter): every project by default, or one. */}
          {/* Only where there is more than one project to choose from. */}
          {isOrgMember && orgProjects.length > 1 && !isDeletedView ? (
            <ProjectFilter
              allHref={listHrefIn(orgRefOf(ref), switchQuery)}
              projects={orgProjects.map((item) => ({ slug: item.slug, name: item.name, href: listHrefIn(refOf(item), switchQuery) }))}
              current={filterProject?.slug ?? null}
            />
          ) : null}
          {/* The issue tabs' filter, beside the search: a standard Filter button and menu. */}
          {!isIdeasView && !isYourWorkView && filterGroups.length > 0 ? <ToolbarFilterMenu groups={filterGroups} summary={filterSummary} /> : null}
          {finishedWatched > 0 ? <UnwatchFinishedButton count={finishedWatched} /> : null}
          <IssuesToolsToggle
            active={Boolean(searchText || selectedTags.length > 0 || selectedMilestone)}
          />
          {/* Phones: the + beside the title, since the tools row is collapsed there.
              Desktop has it at the far left of the toolbar, except on a first run. */}
          {!isDeletedView && !isYourWorkView ? <IdeaChat projectId={project.id} className={isFirstRun ? "" : "md:hidden"} /> : null}
        </div>
      </div>
    </>
  );

  // Earnings (#earnings): the notice names the newest project open in Discover that this person isn't in yet, and
  // comes back for each new one; with nothing new to join it isn't shown.
  let earnProject: EarnBannerProject | null = null;
  if (isIdeasView && userId) {
    try {
      earnProject = await newestOpenProjectFor(prisma, userId);
    } catch {
      // Unknown: no notice this time; Discover in the menu is always there.
    }
  }

  let pendingJoinRequests: PendingJoinRequestItem[] = [];
  if (
    (isIdeasView || isYourWorkView) &&
    !isDeletedView &&
    organisationId &&
    membershipRole &&
    isOrganisationAdmin(membershipRole, effectiveRole)
  ) {
    try {
      if (typeof prisma.projectJoinRequest?.findMany === "function") {
        pendingJoinRequests = await prisma.projectJoinRequest.findMany({
          where: { project: { organisationId, archivedAt: null }, status: "pending" },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            message: true,
            createdAt: true,
            project: {
              select: {
                id: true,
                name: true,
                slug: true,
                organisation: { select: { slug: true } },
              },
            },
            user: { select: { id: true, name: true, email: true, image: true } },
          },
        });
      }
    } catch {
      // Keep the list working even if join requests couldn't be loaded.
    }
  }

  const listContent = (
    <div className="space-y-4">
        {statusParam === "resolved" && !isDeletedView ? <LiveRefresh /> : null}

        {/* #project-links: the site/code panel renders here (from ProjectLinks in the top right) while it is open. */}
        <div id={PROJECT_LINKS_SLOT_ID} className="empty:hidden" />

        {pendingJoinRequests.length > 0 ? (
          <ProjectPendingJoinRequestsBanner
            requests={pendingJoinRequests}
            orgRef={ref}
            projectName={project.name}
          />
        ) : null}

        {/* Earnings (#earnings): the way to earn, on the page everyone lands on, closed with × like the panel above. */}
        {isIdeasView && !isDeletedView && earnProject ? <EarnPanel project={earnProject} line={earnBannerLine(earnProject)} /> : null}

        {/* First questions: full-screen, one at a time, over a project that has no ideas yet. */}
        {showFirstQuestions ? (
          <FirstQuestions
            projectId={project.id}
            projectSlug={project.slug}
            productKinds={projectLinks?.productKinds ?? []}
            productOther={projectLinks?.productOther ?? null}
            canEditProject={canEditProjectLinks}
            firstName={(user.name ?? "").trim().split(/\s+/)[0] || null}
          />
        ) : null}

        {priorityIssues.length > 0 ? <PriorityNowStrip issues={priorityIssues} projectRef={ref} /> : null}

        {/* First questions: full-screen, one at a time, over a project that has no ideas yet. */}
        {showFirstQuestions ? (
          <FirstQuestions
            projectId={project.id}
            projectSlug={project.slug}
            productKinds={projectLinks?.productKinds ?? []}
            productOther={projectLinks?.productOther ?? null}
            canEditProject={canEditProjectLinks}
            firstName={(user.name ?? "").trim().split(/\s+/)[0] || null}
          />
        ) : null}

        {/* Project Overview: who delivered what this week first, then the work you hold, then your open bids,
            only counted, under the list. Goals are in the project's settings. */}


        {milestoneSummary ? (
          <section aria-label={`Milestone ${milestoneSummary.title}`} className="rounded-panel border border-zk-border bg-zk-surface p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-zk-text">{milestoneSummary.title}</h2>
              <MilestoneDue due={dueDateValue(milestoneSummary.dueDate) || null} isClosed={milestoneSummary.isClosed} />
              <Link href="/milestones" className="ml-auto text-sm font-bold text-zk-accent hover:underline">All milestones</Link>
            </div>
            {milestoneSummary.description ? <p className="mt-1 text-sm text-zk-muted">{milestoneSummary.description}</p> : null}
            <div className="mt-3 max-w-md">
              <MilestoneProgressBar progress={milestoneSummary.progress} label={milestoneSummary.title} />
            </div>
          </section>
        ) : null}

        {isNewIdeasView ? <div className="flex flex-wrap items-center justify-between gap-2">{overviewTabs}</div> : null}
        {isNewIdeasView ? (
          // The Overview's New Ideas tab: the Work Feed's cards, with Approve on each idea you can still approve.
          <IdeaFeed slug={ref} ideas={ideaRows} empty={qParam ? <p className="m-0 text-sm text-zk-muted">No new ideas match that search.</p> : <IdeasWelcome projectId={project.id} />} />
        ) : isIdeasView ? (
          <IdeasList
            slug={ref}
            ideas={ideaRows}
            sort={currentIdeaSort}
            empty={
              ideasView === "drafts"
                ? "No unstructured draft ideas are waiting to be structured."
                : ideasView === "rejected"
                  ? "No rejected or archived ideas. A manager agent rejects a bad idea: one whose votes reach the threshold and whose bad and neutral votes outnumber its good ones. It archives an obsolete one: already implemented, a duplicate or in the wrong project."
                  : undefined
            }
          />
        ) : null}
        {isIdeasView && ideaRows.length > 0 ? (
          <PaginationControls
            basePath={ideasPath(listRef, ideasView ?? "new")}
            page={ideaPagination.page}
            totalPages={ideaPagination.totalPages}
            totalCount={ideaPagination.totalCount}
            from={ideaPagination.from}
            to={ideaPagination.to}
            queryParams={ideaPageParams}
            itemLabel="idea"
          />
        ) : null}
        {isIdeasView ? null : isFirstRun ? (
          <FirstRunWelcome hasOrganisation={Boolean(organisationId)} slug={ref} returnTo={returnTo} canContribute={canContribute} />
        ) : feedView ? (
          // The Work Feed: one card with its tabs and filter on top, the table of work, and its pages under it. An
          // empty tab says what it will hold: the tabs are lists of what happened, not filter results.
          <WorkFeed
            items={feed.items}
            groups={feed.groups?.map((group) => {
              // Needs your OK also holds the new ideas (#just-added).
              const ideas = group.key === "needs" ? { all: ideasToOkCount, shown: justAdded.length } : { all: 0, shown: 0 };
              return { ...group, moreHref: group.count + ideas.all > group.items.length + ideas.shown ? sectionHref(group.key) : null };
            })}
            justAdded={justAdded}
            justAddedCount={ideasToOkCount}
            title={OVERVIEW_TABS.find(([tab]) => tab === overviewTab)?.[1] ?? "Work Feed"}
            toolbar={overviewToolbar}
            empty={
              <WhimsicalEmptyState
                title={OVERVIEW_EMPTY[overviewTab].title}
                description={OVERVIEW_EMPTY[overviewTab].description}
                showClear={false}
                showCreate={false}
              />
            }
            footer={feed.total > FEED_PAGE_SIZE ? (
              <PaginationControls
                basePath={overviewHref(overviewTab, overviewState, isMyWorkTab, overviewSection).split("?")[0]}
                queryParams={Object.fromEntries(new URLSearchParams(overviewHref(overviewTab, overviewState, isMyWorkTab, overviewSection).split("?")[1] ?? ""))}
                page={feed.page}
                totalPages={Math.ceil(feed.total / FEED_PAGE_SIZE)}
                totalCount={feed.total}
                from={(feed.page - 1) * FEED_PAGE_SIZE + 1}
                to={Math.min(feed.page * FEED_PAGE_SIZE, feed.total)}
                itemLabel="issue"
              />
            ) : undefined}
          />
        ) : bugs.length === 0 ? (
          <WhimsicalEmptyState
            title={
              isWatchingView && !qParam && !statusParam && !tagsParam && !selectedMilestone
                ? "You're not watching any issues."
                : onlyStatusTab
                  ? `No issues in ${statusFilterLabel(statusParam!)}.`
                  : "No issues match these filters."
            }
            description={
              isWatchingView
                ? "You watch issues you report, are assigned to or comment on, and any you choose to watch from the issue page."
                : onlyStatusTab
                  ? undefined
                  : "Maybe the bugs went into hiding, or they've all been squashed! Try clearing your filters or create a new issue."
            }
            clearHref={issuesPath(listRef, statusParam ?? ALL_STATUS)}
            createHref={newIssueHref(ref, returnTo)}
            showClear={Boolean((myWorkOn || !onlyStatusTab) && (qParam || statusParam || tagsParam || selectedMilestone || myWorkOn))}
            showCreate={canContribute}
          />
        ) : (
          <section className="issues-results flex flex-col gap-3.5">
            <div className="issues-results-summary flex flex-wrap items-baseline justify-between gap-2.5">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <h2 className="text-lg font-bold text-zk-text">All issues</h2>
                <p role="status" aria-live="polite" className="text-[13px] text-zk-muted">
                  {/* Not shown on screen (the tabs carry the counts), but still announced when the results change. */}
                  <span className="sr-only">
                    {resultCountText(totalCount, statusWhere !== undefined ? statusParam ?? null : null)}, sorted by{" "}
                    {bugSortDescriptions[currentSort]}
                  </span>
                  {hiddenDuplicates > 0 || showDuplicates ? (
                    <>
                      <Link href={duplicatesHref} className="font-bold text-zk-accent hover:underline print:hidden">
                        {showDuplicates ? "Hide duplicates" : `Show ${hiddenDuplicates} duplicate${hiddenDuplicates === 1 ? "" : "s"}`}
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
            </div>

            <div className="issues-table relative">
              <div>
                <div className="issues-table-heading">
                  {/* Each column sorts the list on the server; the choice is kept in a cookie (#column-sort). */}
                  {/* #rewards: what solving each issue pays, in $; sorts highest first, then lowest. */}
                  <span className="issues-vote w-[76px] shrink-0">
                    <SortHeader label="Reward" current={currentSort} first="reward" second="reward_low" cookie={ISSUE_SORT_COOKIE} />
                  </span>
                  {/* Your Work: who it's for, between the reward and the issue. */}
                  {isMyWorkTab ? <span className="hidden w-10 shrink-0 lg:block" aria-hidden="true" /> : null}
                  <span className="min-w-0 flex-1">
                    <SortHeader label="Issue" current={currentSort} first="title" second="title_desc" firstDescending={false} cookie={ISSUE_SORT_COOKIE} />
                  </span>
                  {isMyWorkTab ? (
                    // Your Work: who it's for sits beside the issue, then what happens next. No bids or importance.
                    <>
                      <span className="hidden w-[260px] shrink-0 md:block">What&apos;s next?</span>
                    </>
                  ) : (
                    <>
                      <span className="hidden w-[200px] shrink-0 md:block">Status</span>
                      <span className="issues-status-cell justify-center">Bids</span>
                      <span className="issues-vote-end">
                        <SortHeader label="Importance" current={currentSort} first="importance" second="least_important" cookie={ISSUE_SORT_COOKIE} />
                      </span>
                      <span className="w-10" aria-hidden="true" />
                    </>
                  )}
                </div>
                <ul>
                  {bugs.map((bug, index) => {
                    const stage = stages.get(bug.id);
                    const typeName = bug.type?.name ?? "—";
                    const isSecurity = /security/i.test(typeName);
                    const isFeature = !isSecurity && /feature|improve|enhance|request|idea/i.test(typeName);
                    const claim = bug.claims?.find((c) => c.status === "active");
                    const offer = bug.claims?.find((c) => c.status === "offered");
                    const planning = bug.claims?.find((c) => c.status === "planning");
                    // Someone is on it: an active claim, or the issue was moved to in progress.
                    // On Your Work it is you, shown once in its own column, and What's next says the deadline:
                    // the row shows the plain status instead of who is on it.
                    const work = !isMyWorkTab && (claim || bug.status === "in_progress")
                      ? { person: claim?.beneficiary?.name ?? bug.assignee?.name ?? null, since: claim ? (claim.claimedAt ?? claim.createdAt) : null }
                      : null;
                    // Importance in a list is a number to read, not a button: it is marked on the issue's page.
                    // Green once an Open issue has a bid: someone wants to do it.
                    const hasBids = bug.substatus === "open" && bug._count.bids > 0;
                    const importance = <ImportanceVoteBadge bugId={bug.id} count={bug.voteCount} highlighted={hasBids} votable={false} />;
                    // Your Work: which kind of your work this is, and the next step (lib/whats-next.ts).
                    const next = isMyWorkTab
                      ? whatsNext(bug.substatus, (bug.claims ?? []).filter((c) => c.beneficiaryUserId === userId), myBidIds.has(bug.id))
                      : null;
                    // #live-check: a Live row says where its fix really is, as its issue page does.
                    const liveFix = liveChecks.get(bug.id);
                    const status = (
                      <IssueRowStatus substatus={bug.substatus} stage={stage} botConfirmations={confirmationCounts.get(bug.id) ?? 0} work={work}
                        closeReason={bug.closeReason}
                        confirmed={confirmationStates.get(bug.id)?.confirmed ?? false}
                        bids={bug.substatus === "open" || bug.substatus === "merged_broken" ? bug._count.bids : undefined}
                        offeredTo={(bug.substatus === "open" || bug.substatus === "merged_broken") && offer ? (offer.beneficiary?.name ?? "someone") : null}
                        planReviewFor={bug.substatus === "plan_review" ? (planning?.beneficiary?.name ?? null) : null}
                        mergePath={bug.status === "resolved" && bug.pullRequestUrl ? mergePathOf(bug) : null} />
                    );
                    // #live-confirm: on a Live row, the status as it is, then how many of the 3 people found it on prod.
                    const rowStatus = liveFix ? (
                      <span className="inline-flex items-center gap-1">
                        {status}
                        <LiveDots check={liveFix} />
                      </span>
                    ) : status;

                    return (
                      <ExpandableRow
                        key={bug.id}
                        className={`issues-row flex items-center gap-2 px-2 py-3.5 lg:gap-4 lg:px-4 ${
                          index < bugs.length - 1 ? "border-b border-zk-divider" : ""
                        }`}
                        details={liveFix ? <LiveRowDetails check={liveFix} confirmations={liveConfirmations.get(bug.id) ?? []} /> : null}
                      >
                        <div className="issues-vote w-[76px] shrink-0">
                          <RewardBadge reward={Number(bug.reward)} estimates={bug.rewardEstimateCount} fixed={Boolean(bug.rewardFixedAt)} funded={funded.has(bug.id)} />
                        </div>
                        {isMyWorkTab ? (
                          <span className="hidden w-10 shrink-0 items-center lg:flex">
                            {bug.assignee ? <RowAssignee name={bug.assignee.name} image={bug.assignee.image} /> : null}
                          </span>
                        ) : null}
                        <Link
                          href={issueHref(bug)}
                          data-issue-link=""
                          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md text-left [touch-action:manipulation] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-electric-blue"
                        >
                          <span
                            data-issue-type-icon=""
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                              isSecurity ? "bg-zk-bad-bg text-zk-bad-fg" : "bg-zk-tint text-zk-accent"
                            }`}
                            aria-hidden="true"
                          >
                            {isSecurity ? (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                            ) : (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={BUG_ICON_PATH} /></svg>
                            )}
                          </span>
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className={`issues-row-title text-sm font-semibold leading-snug ${isDone(bug.status) ? "text-zk-muted" : "text-zk-text"}`}>
                              {searchText ? (
                                <Highlighted segments={highlightSegments(bug.title, searchText)} />
                              ) : (
                                bug.title
                              )}
                            </span>
                            <span className="issues-row-meta flex items-center gap-2 text-xs text-zk-muted">
                              <span className="font-mono tabular-nums">{formatIssueNumber(bug.number)}</span>
                              {/* With every project listed (#project-filter), which project it is in. */}
                              {allProjects && projectNames.get(bug.projectId) ? (
                                <span className="rounded bg-zk-chip px-1.5 py-px text-[11px] font-medium text-zk-text2">{projectNames.get(bug.projectId)}</span>
                              ) : null}
                              {/* The type, as a small icon: bug, feature or security. */}
                              <span className="inline-flex items-center" title={typeName}>
                                <span className="sr-only">{typeName}</span>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d={isSecurity ? "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" : isFeature ? FEATURE_ICON_PATH : BUG_ICON_PATH} />
                                </svg>
                              </span>
                              <IssuePriorityBadge priority={bug.priority} />
                              {(bug._count?.comments ?? 0) > 0 ? (
                                <span className="inline-flex items-center gap-1" title={`Conversation: ${bug._count?.comments}`}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                                  {bug._count?.comments}
                                </span>
                              ) : null}
                              {(bug._count?.attachments ?? 0) > 0 ? (
                                <span title={`${bug._count?.attachments} attachments`}>📎 {bug._count?.attachments}</span>
                              ) : null}
                              {bug.isDeleted ? <span className="font-bold text-zk-bad-fg">Deleted</span> : null}
                              {bug.duplicateOf ? (
                                <span>Duplicate of {formatIssueNumber(bug.duplicateOf.number)}</span>
                              ) : null}
                              <RowAge date={currentSort === "newest" ? bug.createdAt : bug.updatedAt} sort={currentSort === "newest" ? "newest" : "updated"} />
                              {/* On a phone the Status column is hidden: the status rides at the end of this line. */}
                              {isMyWorkTab ? <span className="inline-flex min-w-0">{rowStatus}</span> : <span className="inline-flex min-w-0 md:hidden">{rowStatus}</span>}
                              {/* On a phone the What's next column is hidden: its tag rides here. */}
                              {next ? <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold md:hidden ${WORK_TAG_TONE[next.tag]}`}>{next.tag}</span> : null}
                            </span>
                            {snippets.has(bug.id) ? <SearchSnippet snippet={snippets.get(bug.id)!} /> : null}
                            {signals.has(bug.id) ? <DeliverySignalsLine signals={signals.get(bug.id)!} /> : null}
                            {testBars.has(bug.id) ? <TestsBar {...testBars.get(bug.id)!} /> : null}
                          </span>
                        </Link>
                        {/* #live-confirm: opens who found it on prod, under the row (a button can't sit in the link). */}
                        {liveFix ? <RowToggle label="Show who found it on prod" /> : null}
                        {isMyWorkTab ? (
                          (() => {
                            if (!next) return null;
                            return (
                              <>
                                <span className="hidden w-[260px] shrink-0 flex-col items-start gap-1 text-xs md:flex">
                                  {/* Which kind of your work this is, then the next step. */}
                                  <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${WORK_TAG_TONE[next.tag]}`}>{next.tag}</span>
                                  <span className={next.late ? "font-semibold text-zk-bad-fg" : next.yours ? "font-semibold text-zk-text" : "text-zk-muted"}>
                                    {next.text}
                                    <span className="sr-only">{next.yours ? " (yours to do)" : " (waiting on others)"}</span>
                                  </span>
                                </span>
                              </>
                            );
                          })()
                        ) : (
                          <>
                        <span className="hidden w-[200px] min-w-0 shrink-0 md:flex">{rowStatus}</span>
                        <span className="issues-status-cell justify-center">
                          <BidsVoteBadge count={bug._count.bids} />
                        </span>
                        <div className="issues-vote issues-vote-end shrink-0">{importance}</div>
                        <span
                          className={`w-10 shrink-0 items-center justify-end gap-2 ${
                            isWatchingView && !bug.isDeleted ? "flex" : "hidden lg:flex"
                          }`}
                        >
                          {bug.assignee ? (
                            <span className="hidden lg:inline-flex">
                              <RowAssignee name={bug.assignee.name} image={bug.assignee.image} />
                            </span>
                          ) : bug.reporter ? (
                            <span className="hidden lg:inline-flex" title={`Reported by ${bug.reporter.name}`}>
                              <Avatar name={bug.reporter.name} image={bug.reporter.image} size="sm" />
                              <span className="sr-only">Reported by {bug.reporter.name}</span>
                            </span>
                          ) : null}
                          {isWatchingView && !bug.isDeleted ? (
                            <UnwatchButton bugId={bug.id} label={`${formatIssueNumber(bug.number)} ${bug.title}`} />
                          ) : null}
                        </span>
                          </>
                        )}
                      </ExpandableRow>
                    );
                  })}
                </ul>
              </div>
            </div>

            <PaginationControls
              basePath={listHref(new URLSearchParams({ ...(statusParam ? { status: statusParam } : {}), ...(isYourWorkView && overviewTab !== "all" ? { [OVERVIEW_TAB_PARAM]: overviewTab } : {}), ...(workCategory ? { [WORK_CATEGORY_PARAM]: workCategory } : {}) }))}
              page={pagination.page}
              totalPages={pagination.totalPages}
              totalCount={totalCount}
              from={pagination.from}
              to={pagination.to}
              queryParams={issueListPaginationParams({
                status: undefined,
                mine: mineFilter,
                q: qParam,
                sort: sortParam,
                milestone: milestoneParam,
                tags: tagsParam,
                area: selectedArea,
                stage: stageView,
                deleted: isDeletedView,
                showDuplicates,
                showResolved,
              })}
            />
          </section>
        )}

        {/* Project Overview: your open bids are counted, not listed, under the work you hold. */}
        {isMyWorkTab && openBidCount > 0 ? (
          <Link
            href={issuesPath(listRef, "open", `${MY_WORK_PARAM}=1`)}
            className="group flex items-center gap-4 rounded-panel border border-zk-border bg-zk-surface px-5 py-4 transition hover:border-zk-accent/40 hover:bg-zk-tint/40 focus-visible:outline-2 focus-visible:outline-electric-blue"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zk-tint text-lg font-extrabold tabular-nums text-zk-accent">
              {openBidCount}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-zk-text">Open {openBidCount === 1 ? "bid" : "bids"} waiting for an award</span>
              <span className="block text-xs text-zk-muted">Issues you or your agents bid on that nobody has been awarded yet.</span>
            </span>
            <span className="shrink-0 text-xs font-semibold text-zk-accent group-hover:underline">
              See them <span aria-hidden="true">→</span>
            </span>
          </Link>
        ) : null}
      </div>
  );

  return (
    <>
    {/* An issue's back arrow returns here, to this tab, filters and page. */}
    <Suspense fallback={null}>
      <RememberIssueList />
    </Suspense>
    {/* The stages, centred, with Project notes at the right of the same row. The row is as wide
        as the panel below, so the project icons line up with the panel's right edge. */}
    {/* On a phone the icons take their own row above the stages, so they never cover them. */}
    {/* From lg the icons sit at the right of this row; the same room on both sides keeps the tabs centred and clear of them. */}
    {withOverviewLook ? (
      // The Overview has no stage bar: its tabs filter the list. At the top, a gray card about the app itself: its name,
      // where it runs and where its code is, with the project's icons (feedback, settings) at the right.
      <section aria-label="Your app" className="mx-auto mb-4 flex w-full max-w-[920px] flex-wrap items-center justify-between gap-3 rounded-xl border border-zk-border bg-zk-text/[0.045] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] text-[16px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]" style={TILE_TONES[toneForName(project.name)]}>
            {project.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="m-0 truncate text-[15px] font-semibold text-zk-text">{project.name}</p>
            {/* Where it runs and where its code is, each with a pencil to edit it in place. */}
            <AppInfoLinks
              slug={slug}
              siteUrl={projectLinks?.siteUrl ?? null}
              repoUrl={projectLinks?.repoUrl ?? null}
              appStoreUrl={projectLinks?.appStoreUrl ?? null}
              playStoreUrl={projectLinks?.playStoreUrl ?? null}
              downloadUrl={projectLinks?.downloadUrl ?? null}
              productKinds={projectLinks?.productKinds ?? []}
              canEdit={canEditProjectLinks}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canContribute ? <ShareMenu orgSlug={project.orgSlug} inviteHref={isOrgAdmin ? `${orgPath(ref, "team")}?invite=1` : undefined} /> : null}
          <ProjectIconLinks
            settingsHref={isOrgAdmin ? `/projects/${encodeURIComponent(slug)}/settings` : undefined}
          />
        </div>
      </section>
    ) : (
    <div className={`relative mx-auto mb-4 flex min-h-8 w-full items-start justify-center max-sm:mb-3 max-sm:flex-col-reverse max-sm:items-stretch max-sm:gap-1 lg:px-[12.75rem] max-w-[920px]`}>
      {!isDeletedView ? (
        <PipelineSteps
          stages={STAGE_GROUPS.flatMap((group, index) => {
            const stage = {
              label: group.label,
              // Error is part of Merge and the tab's own value is all of them, so the stage total counts each issue once.
              count: group.statuses.reduce((sum, value) => sum + (value === ERROR_STATUS || value === POSSIBLY_DELIVERED || GROUP_FILTERS.includes(value) ? 0 : statusCount(value)), 0),
              href: statusLink(group.statuses[0]),
              selected: index === stageIndex,
            };
            // Project Overview always for people who can contribute, else only while something is assigned to you.
            const conditional = index === YOUR_WORK_STAGE && !canContribute;
            return !conditional || stage.count > 0 || stage.selected ? [stage] : [];
          })}
        />
      ) : null}
      <div className="absolute right-0 top-0 flex items-center gap-2 max-sm:static max-sm:self-end">
        {/* At the far right: the site and code addresses, then Project notes and the settings page. */}
        {projectLinks && !isDeletedView ? (
          <ProjectLinks
            slug={slug}
            siteUrl={projectLinks.siteUrl}
            repoUrl={projectLinks.repoUrl}
            canEdit={canEditProjectLinks}
            // #agent-work-gate: a blocked agent comes first; the site URL ask waits (the icon still opens it).
            askOnLoad={isIdeasView && unconfiguredAgents.length === 0}
          />
        ) : null}
        {/* The feedback portal, Design and settings, as icons, beside the tabs. */}
        {!isDeletedView && canContribute ? (
          <ShareMenu orgSlug={project.orgSlug} inviteHref={isOrgAdmin ? `${orgPath(ref, "team")}?invite=1` : undefined} />
        ) : null}
        {!isDeletedView ? (
          <ProjectIconLinks
            settingsHref={isOrgAdmin ? `/projects/${encodeURIComponent(slug)}/settings` : undefined}
          />
        ) : null}
      </div>
    </div>
    )}
    {/* Overview opens with a chat box, in a white panel of its own above the list: what people type is filed as an
        idea in this project for agents to take up, with files, a screen recording or a captured area. */}
    {withOverviewLook ? (
      <section aria-label="Tell the agents" className="mx-auto mb-4 w-full max-w-[920px]">
        {/* The project chat (#project-chat): Ziki answers here, sets the product's basics as they're given, and
            files the work people describe as ideas. */}
        <IdeaChat
          projectId={project.id}
          alwaysOpen
          chatSlug={ref}
          me={{ name: user.name ?? null, image: user.image ?? null }}
          placeholder="Tell the agents what you want done: a bug to fix, a change to make, a feature to add…"
        />
      </section>
    ) : null}
    {/* Every list is the same narrow, centred panel (#simple-lists). */}
    {/* The Overview has no title row, so its tabs start a panel's padding (20px) from the top. */}
    <div className="issues-page mx-auto w-full space-y-5 max-w-[920px]" style={withOverviewLook ? { paddingTop: 20 } : undefined}>
      {/* The Overview has no title row: no filters to open, and the tabs say where you are. */}
      {withOverviewLook ? null : headerContent}
      <div className="flex items-start gap-5 max-lg:flex-col max-lg:gap-3">
        {/* No sidebar (#simple-lists): each row has a Status column, and the toolbar's Filter narrows the tab to one status. */}
        <div className="w-full min-w-0 flex-1">
          {statusParam === POSSIBLY_DELIVERED ? (
            <p className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-zk-warn-bg px-4 py-2.5 text-sm text-zk-warn-fg">
              <span>Open issues that may already be done: a linked or reported pull request, a delivery, or a comment that mentions a merge.</span>
              <Link href={projectPath(ref, "/issues/bulk-close")} className="font-bold underline">Review and close</Link>
            </p>
          ) : null}
          {/* Your call is light only (#your-call), whatever the theme setting. */}
          {isYourCallView ? <><LightOnly /><YourCall items={yourCall} /></> : listContent}
        </div>
      </div>
    </div>
    </>
  );
}


/** The first-run arrow's dashes (#first-run-arrow): how many, each one's length (of 100 along the line), and the delay between
 * them. The first starts at the line's foot and the last ends under the arrowhead, where the line runs straight up into it. */
const ARROW_DASHES = 7;
const ARROW_DASH = 8;
const ARROW_STEP_S = 0.12;

/** What a brand-new tracker shows instead of an empty list (#292, #444). */
function FirstRunWelcome({
  hasOrganisation = true,
  slug,
  returnTo,
  canContribute = true,
}: {
  hasOrganisation?: boolean;
  slug: ProjectRef;
  returnTo: string;
  canContribute?: boolean;
}) {
  if (!hasOrganisation) {
    return (
      <section aria-labelledby="issues-organisation-heading" className="issues-organisation-empty rounded-panel border border-zk-border bg-zk-bg px-6 py-10 text-center sm:px-8">
        <h2 id="issues-organisation-heading" className="text-xl font-bold leading-7 text-zk-text">No organisation yet</h2>
        <p className="mx-auto mt-3 max-w-lg text-base leading-7 text-zk-text2">
          You are not currently a member of any organisation. Join an organisation via an invite from your team,
          or create your own organisation to start filing issues.
        </p>
        <div className="mt-6">
          <Link
            href="/organisations"
            className="inline-flex min-h-12 max-w-full items-center justify-center rounded-full bg-electric-blue-strong px-6 py-3 text-sm font-bold leading-5 text-white transition-colors hover:bg-blue-slate focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zk-accent"
          >
            Create or join an organisation
          </Link>
        </div>
      </section>
    );
  }

  // The first thing to do is tell the agents about the app, in the box above the list: a winding arrow points up at it.
  return (
    <section className="rounded-panel border border-zk-border bg-zk-surface px-5 pb-8 pt-4 text-center">
      {/* A winding dashed line up to a solid arrowhead. Its dashes vanish one after another from the bottom up, the
          arrowhead last, then come back the same way: a wave that runs up towards the task box. */}
      <svg aria-hidden="true" viewBox="0 0 120 172" className="mx-auto h-32 w-[90px] text-zk-text">
        {Array.from({ length: ARROW_DASHES }, (_, index) => (
          <path
            key={index}
            d="M60 166 C 78 150, 78 132, 60 118 C 42 104, 42 90, 60 78 C 76 67, 60 50, 60 31"
            pathLength={100}
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${ARROW_DASH} 200`}
            strokeDashoffset={-(index * (100 - ARROW_DASH)) / (ARROW_DASHES - 1)}
            className="motion-safe:animate-[zk-dash-wave_2.8s_ease-in-out_infinite]"
            style={{ animationDelay: `${index * ARROW_STEP_S}s` }}
          />
        ))}
        <path
          d="M60 6 L45 32 Q60 26 75 32 Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="round"
          className="motion-safe:animate-[zk-dash-wave_2.8s_ease-in-out_infinite]"
          style={{ animationDelay: `${ARROW_DASHES * ARROW_STEP_S}s` }}
        />
      </svg>
      <h2 className="mt-2 text-lg font-bold text-zk-text">No tasks yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-zk-muted">
        This is where every task you add will be listed. Tell us what your app is and what you would like fixed.
      </p>
      {canContribute ? (
        <div className="mt-5">
          <Link
            href={newIssueHref(slug, returnTo)}
            className="inline-flex h-[42px] items-center justify-center rounded-full bg-electric-blue-strong px-5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(46,111,239,0.35)]"
          >
            Report the first issue
          </Link>
        </div>
      ) : null}
    </section>
  );
}

/** Possibly delivered (#possibly-delivered): why the issue is on the list, its last activity, and why it is still Open. */
function DeliverySignalsLine({ signals }: { signals: DeliverySignals }) {
  return (
    <span data-testid="delivery-signals" className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zk-text2">
      <span className="font-semibold text-zk-warn-fg">{signals.reasons.join(" · ")}</span>
      <span className="text-zk-muted">Still Open: {signals.stillOpenBecause}</span>
      {signals.lastActivityAt ? (
        <span className="text-zk-muted">Last activity <LocalTime date={signals.lastActivityAt} /></span>
      ) : null}
    </span>
  );
}

/**
 * The tests at a glance (#deeper-testing): a checked clipboard, then one slot per
 * judgement needed, green for each that counts and red for each still missing.
 * An approved exception to "no per-stage tally under a row" (AGENTS.md).
 */
function TestsBar({ good, needed }: { good: number; needed: number }) {
  const label = `Tests: ${Math.min(good, needed)} of ${needed} passed`;
  return (
    <span role="img" aria-label={label} title={label} className="mt-1 flex items-center gap-2">
      <svg viewBox="0 0 24 24" className={`h-4 w-4 ${good >= needed ? "text-zk-ok-fg" : "text-zk-text2"}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="8" y="2" width="8" height="4" rx="1" />
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <path d="m9 14 2 2 4-4" />
      </svg>
      <span className="flex gap-1">
        {Array.from({ length: needed }, (_, i) => (
          <span key={i} aria-hidden="true" className={`h-2.5 w-7 rounded-full ${i < good ? "bg-zk-ok-fg" : "bg-zk-bad-fg"}`} />
        ))}
      </span>
      <span className={`text-xs font-bold tabular-nums ${good >= needed ? "text-zk-ok-fg" : "text-zk-bad-fg"}`}>
        {Math.min(good, needed)}/{needed}
      </span>
    </span>
  );
}

/** Three dots for the three agents who must find it on prod (#live-confirm). */
function LiveDots({ check }: { check: LiveCheck }) {
  const names = check.confirmedBy.length ? `Found on prod by ${check.confirmedBy.join(", ")}` : "Nobody has found it on prod yet";
  return (
    <span className="inline-flex text-zk-ok-fg">
      <ConfirmDots count={check.confirmedBy.length} needed={PROD_CONFIRMATIONS_NEEDED} label={liveConfirmLabel(check)} title={`${liveConfirmLabel(check)}. ${names}.`} />
    </span>
  );
}

/**
 * A Live row, opened (#live-confirm): what the pull request check found, and
 * each agent who found it on prod, with what they checked.
 */
function LiveRowDetails({ check, confirmations }: { check: LiveCheck; confirmations: ProdConfirmation[] }) {
  const left = PROD_CONFIRMATIONS_NEEDED - confirmations.length;
  return (
    <div data-testid="live-row-details" className="mt-3 grid gap-3 rounded-lg border border-zk-border bg-zk-bg px-4 py-3 text-[13px] leading-5 text-zk-text2 sm:grid-cols-[1fr_1.4fr]">
      <div>
        <p className="m-0 font-semibold text-zk-text">Its pull request</p>
        <p className="m-0">
          {liveFactLabel(check)}{check.repo ? <> in {check.repo}</> : null}.{" "}
          {check.checkedBy ? <>Checked on GitHub by {check.checkedBy}.</> : <>Nobody has checked it on GitHub yet.</>}
        </p>
      </div>
      <div>
        <p className="m-0 font-semibold text-zk-text">Found on prod: {liveConfirmLabel(check)}</p>
        {confirmations.length ? (
          <ol className="m-0 mt-1 list-none space-y-1.5 p-0">
            {confirmations.map((confirmation) => (
              <li key={`${confirmation.agentName}-${confirmation.createdAt.toISOString()}`}>
                <span className="font-semibold text-zk-text">{confirmation.agentName}</span>{" "}
                <LocalTime date={confirmation.createdAt} className="text-zk-muted" />
                <span className="block break-words">{confirmation.note}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {left > 0 ? (
          <p className="m-0 mt-1 text-zk-muted">
            {left === PROD_CONFIRMATIONS_NEEDED ? "Nobody has found it on prod yet. " : ""}
            {left} more {left === 1 ? "person" : "people"} must each check it is running on prod. The solver&apos;s own report doesn&apos;t count.
          </p>
        ) : null}
      </div>
    </div>
  );
}


