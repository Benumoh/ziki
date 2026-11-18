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
const PROJECT_PAGES = new Set(["goals", "ideas", "issues", "marketing", "notes", "org", "projects", "tasks", "workstream", "work"]);

export function isProjectFirstPath(path: string): boolean {
  const [first, second] = path.split("?")[0].split("/").filter(Boolean);
  return Boolean(first && second && (PROJECT_PAGES.has(second) || /^[0-9]+$/.test(second)));
}

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
  your_work: "your-work",
  closed: "closed",
  all: "all",
  rejected: "rejected",
  duplicate: "duplicates",
  finished: "finished",
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

/** An issue list: `/<org>/<project>/issues/<status>`; `all` when no status is given. */
export function issuesPath(slug: ProjectRef, status: string | null = "all", query?: URLSearchParams | string): string {
  const segment = STATUS_SEGMENT[status ?? "all"] ?? "all";
  return withQuery(projectPath(slug, `/issues/${segment}`), query);
}

/** The ideas lists: new ideas, `drafts` or `rejected`. */
export function ideasPath(slug: ProjectRef, view: "new" | "drafts" | "rejected" = "new", query?: URLSearchParams | string): string {
  return withQuery(projectPath(slug, view === "new" ? "/ideas" : `/ideas/${view}`), query);
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
export function marketingPath(slug: ProjectRef, section = ""): string {
  return projectPath(slug, section ? `/marketing/${section}` : "/marketing");
}

/**
 * The video studio, `/<org>/<project>/marketing/video`. It brings its own
 * chrome: the page opens on "← Back to Marketing", so the project breadcrumb
 * and the Marketing action bar leave it alone and every other page keeps them.
 */
export function isVideoStudio(pathname: string): boolean {
  return /\/marketing\/video\/?$/.test(pathname);
}

/** Filing a new report (it starts as an idea). */
export function newIssuePath(slug: ProjectRef, query?: URLSearchParams | string): string {
  return withQuery(projectPath(slug, "/issues/new"), query);
}

/** The project's Design area (#9): `/<org>/<project>/design`, or one proposal's page, `/<org>/<project>/design/<id>`. */
export function designPath(slug: ProjectRef, proposalId?: string, query?: URLSearchParams | string): string {
  return withQuery(projectPath(slug, proposalId ? `/design/${encodeURIComponent(proposalId)}` : "/design"), query);
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
