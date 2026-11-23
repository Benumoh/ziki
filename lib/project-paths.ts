/**
 * Every page belongs to a project, and its address starts with its
 * organisation's slug and then the project's (#project-urls):
 * `/<org>/<project>/issues/open`, `/<org>/<project>/ideas/42`,
 * `/<org>/<project>/740`. `/<org>` alone lists the organisation's projects.
 * The URL, not a cookie, says which project a page shows (lib/project-route.ts
 * resolves it and checks access). Build every in-app link with these helpers,
 * from a `ProjectRef` (`projectRef(org, project)` or `refOf(project)`).
 */

/** `<org>/<project>`, URL-encoded: the two segments every project address starts with. */
export type ProjectRef = string & { readonly __projectRef: true };

export function projectRef(orgSlug: string, projectSlug: string): ProjectRef {
  return `${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}` as ProjectRef;
}

/**
 * Every project of an organisation, for the lists that show them all (#project-filter): with no project
 * picked, the lists live at `/<org>/issues/<status>`, `/<org>/ideas` and `/<org>/queue`, and picking one
 * moves them to `/<org>/<project>/…`. The list helpers (`issuesPath`, `ideasPath`, `queuePath`) take it like
 * a project's ref; nothing else does.
 */
export function orgRef(orgSlug: string): ProjectRef {
  return encodeURIComponent(orgSlug) as ProjectRef;
}

/** The organisation-wide ref of a project's ref (`zedu/desktop` → `zedu`). */
export function orgRefOf(ref: ProjectRef): ProjectRef {
  return ref.split("/")[0] as ProjectRef;
}

/** The ref of a project read with `organisation: { select: { slug: true } }`. */
export function refOf(project: { slug: string; organisation: { slug: string } }): ProjectRef {
  return projectRef(project.organisation.slug, project.slug);
}

/** An organisation's own page, the list of its projects: `/<org>`. */
export function orgHomePath(orgSlug: string, query?: URLSearchParams | string): string {
  return withQuery(`/${encodeURIComponent(orgSlug)}`, query);
}

/**
 * The second segment of an address from before organisations were in URLs
 * (`/<project>/ideas`, `/<project>/740`): a project's own page name, or an
 * issue number. A project may not take one of these names, so
 * `/<a>/<b>/...` with such a `b` is always an old project-first address.
 */
const PROJECT_PAGES = new Set(["goals", "marketing", "notes", "org", "projects", "tasks", "workstream", "work"]);

/**
 * `/<org>/issues/…`, `/<org>/new` (and its `rejected` and `drafts`), `/<org>/queue` and `/<org>/marketing/…` are the
 * organisation-wide lists (#project-filter), not old addresses; an old `/<project>/issues/…` reaches
 * those pages, which send it on when no organisation has that slug. An idea, `/<project>/ideas/<number>`,
 * is still an old address.
 */
export function isProjectFirstPath(path: string): boolean {
  const [first, second, third] = path.split("?")[0].split("/").filter(Boolean);
  if (!first || !second) return false;
  // `/<org>/marketing/…` is the organisation's Marketing (#org-marketing); an old `/<project>/marketing/…`
  // reaches those pages, which send it on when no organisation has that slug.
  if (second === "marketing") return false;
  if (second === "ideas") return Boolean(third && /^[0-9]+$/.test(third));
  return PROJECT_PAGES.has(second) || /^[0-9]+$/.test(second);
}

/** The Overview's path segment (#overview-url): `/<org>/overview` and `/<org>/<project>/overview`. */
export const OVERVIEW_SEGMENT = "overview";
/** Where the Overview used to be, `/issues/your-work`: it redirects to /overview, query and all. */
export const OLD_OVERVIEW_SEGMENT = "your-work";

/** The path segment of each issue list, by the status it shows. */
const STATUS_SEGMENT: Record<string, string> = {
  open: "open",
  in_progress: "in-progress",
  done: "done",
  merge: "merge",
  resolved: "live",
  error: "error",
  possibly_delivered: "possibly-delivered",
  your_call: "your-call",
  closed: "closed",
  all: "all",
  rejected: "rejected",
  duplicate: "duplicates",
  finished: "finished",
  progress: "progress",
  delivered: "delivered",
};
const SEGMENT_STATUS: Record<string, string> = Object.fromEntries(Object.entries(STATUS_SEGMENT).map(([status, segment]) => [segment, status]));

/** The list status a path segment names (`in-progress` → `in_progress`), or null for an unknown one. */
export function statusFromSegment(segment: string): string | null {
  return SEGMENT_STATUS[segment] ?? null;
}

/** `/<org>/<project>` followed by `rest` (which starts with `/`, or is empty). */
export function projectPath(ref: ProjectRef, rest = ""): string {
  return `/${ref}${rest}`;
}

function withQuery(path: string, query?: URLSearchParams | string): string {
  const text = typeof query === "string" ? query.replace(/^\?/, "") : query?.toString() ?? "";
  return text ? `${path}?${text}` : path;
}

/**
 * The work's stages are the Overview's tabs and Status filter (#work-feed), not lists of their own: each stage's
 * place on the Overview (`/overview`, #overview-url, with `view` for the tab and `state` for the status).
 */
const OVERVIEW_PLACE: Record<string, Record<string, string>> = {
  all: {},
  your_work: {},
  open: { view: "features", state: "open" },
  in_progress: { view: "features", state: "in_progress" },
  progress: { view: "features", state: "in_progress" },
  delivered: { view: "delivered" },
  // The Work Feed's sections (#work-feed-sections): delivered work that isn't merged waits on agents, so it is
  // Stalled; live work waits for your OK, and is Delivered once confirmed.
  done: { section: "stalled" },
  merge: { section: "stalled" },
  error: { section: "stalled" },
  resolved: { view: "delivered" },
};

/** Where a stage list's address now goes on the Overview, or null for a list that is still its own page. */
export function overviewPlaceFor(status: string): Record<string, string> | null {
  return OVERVIEW_PLACE[status] ?? null;
}

/**
 * An issue list: a stage opens its place on the Overview (`/<org>/<project>/overview?view=…&state=…`); the
 * lists that are still pages of their own (closed, rejected, duplicates, possibly delivered, your call) are
 * `/<org>/<project>/issues/<status>`. `all` when no status is given.
 */
export function issuesPath(slug: ProjectRef, status: string | null = "all", query?: URLSearchParams | string): string {
  const place = overviewPlaceFor(status ?? "all");
  if (place) {
    const params = new URLSearchParams(typeof query === "string" ? query.replace(/^\?/, "") : query ?? "");
    for (const [key, value] of Object.entries(place)) params.set(key, value);
    return withQuery(projectPath(slug, `/${OVERVIEW_SEGMENT}`), params);
  }
  const segment = STATUS_SEGMENT[status ?? "all"] ?? "all";
  return withQuery(projectPath(slug, `/issues/${segment}`), query);
}

/** The Work queue: `/<org>/queue` for every project, `/<org>/<project>/queue` for one. */
export function queuePath(slug: ProjectRef, query?: URLSearchParams | string): string {
  return withQuery(projectPath(slug, "/queue"), query);
}

/** The ideas lists, the New tab: `/new` for new ideas, `/new/drafts` or `/new/rejected`. An idea's own page stays `/ideas/<number>`. */
export function ideasPath(slug: ProjectRef, view: "new" | "drafts" | "rejected" = "new", query?: URLSearchParams | string): string {
  return withQuery(projectPath(slug, view === "new" ? "/new" : `/new/${view}`), query);
}

/** An idea's page: `/<org>/<project>/ideas/<number>`. Ideas are numbered apart from issues. */
export function ideaPath(slug: ProjectRef, number: number): string {
  return projectPath(slug, `/ideas/${number}`);
}

/** The organisation admin area under a project: `/<org>/<project>/org`, `.../org/members`. */
export function orgPath(slug: ProjectRef, section = ""): string {
  return projectPath(slug, section ? `/org/${section}` : "/org");
}

/** `/<slug>/marketing`, or one of its sub-tabs. */
/**
 * Marketing's pages belong to the organisation, not a project (#org-marketing): `/<org>/marketing` and
 * `/<org>/marketing/<section>`, whichever project's ref is given.
 */
export function marketingPath(slug: ProjectRef, section = ""): string {
  return projectPath(orgRefOf(slug), section ? `/marketing/${section}` : "/marketing");
}

/** Filing a new report (it starts as an idea). */
export function newIssuePath(slug: ProjectRef, query?: URLSearchParams | string): string {
  return withQuery(projectPath(slug, "/issues/new"), query);
}

/** One goal's page with its split wizard and allocation ledger: `/<org>/<project>/goals/<id>`. */
export function goalPath(slug: ProjectRef, goalId: string): string {
  return projectPath(slug, `/goals/${encodeURIComponent(goalId)}`);
}

/** An organisation's forum discussion board: `/<org>/forum`. */
export function orgForumPath(orgSlug: string, query?: URLSearchParams | string): string {
  return withQuery(`/${encodeURIComponent(orgSlug)}/forum`, query);
}

/** An organisation's forum post detail: `/<org>/forum/<postId>`. */
export function orgForumPostPath(orgSlug: string, postId: string): string {
  return `/${encodeURIComponent(orgSlug)}/forum/${encodeURIComponent(postId)}`;
}

/** A project's forum discussion board: `/<org>/<project>/forum`. */
export function projectForumPath(ref: ProjectRef, query?: URLSearchParams | string): string {
  return withQuery(projectPath(ref, "/forum"), query);
}

/** A project's forum post detail: `/<org>/<project>/forum/<postId>`. */
export function projectForumPostPath(ref: ProjectRef, postId: string): string {
  return projectPath(ref, `/forum/${encodeURIComponent(postId)}`);
}

/** Path to a forum board across any scope. */
export function scopedForumPath(
  scope: "platform" | "org" | "project",
  orgSlug?: string | null,
  projectSlug?: string | null,
  query?: URLSearchParams | string
): string {
  if (scope === "project" && orgSlug && projectSlug) {
    return projectForumPath(projectRef(orgSlug, projectSlug), query);
  }
  if (scope === "org" && orgSlug) {
    return orgForumPath(orgSlug, query);
  }
  return withQuery("/forum", query);
}

/** Path to a forum post detail thread across any scope. */
export function scopedForumPostPath(
  scope: "platform" | "org" | "project",
  postId: string,
  orgSlug?: string | null,
  projectSlug?: string | null
): string {
  if (scope === "project" && orgSlug && projectSlug) {
    return projectForumPostPath(projectRef(orgSlug, projectSlug), postId);
  }
  if (scope === "org" && orgSlug) {
    return orgForumPostPath(orgSlug, postId);
  }
  return `/forum/${encodeURIComponent(postId)}`;
}

/** The address without Next's `_rsc` cache marker, which an in-app navigation adds and a full page load must not carry. */
export function withoutFlightMarker(path: string): string {
  const queryAt = path.indexOf("?");
  if (queryAt < 0) return path;
  const query = new URLSearchParams(path.slice(queryAt + 1));
  query.delete("_rsc");
  const rest = query.toString();
  return rest ? `${path.slice(0, queryAt)}?${rest}` : path.slice(0, queryAt);
}
