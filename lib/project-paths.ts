/**
 * Every page belongs to a project, and its address starts with the project's
 * slug (#project-urls): `/<slug>/issues/open`, `/<slug>/ideas`,
 * `/<slug>/ideas/42`, `/<slug>/notes`, `/<slug>/740`. The slug, not a cookie,
 * says which project a page shows (lib/project-route.ts resolves it and checks
 * access). Build every in-app link with these helpers.
 */

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
};
const SEGMENT_STATUS: Record<string, string> = Object.fromEntries(Object.entries(STATUS_SEGMENT).map(([status, segment]) => [segment, status]));

/** The list status a path segment names (`in-progress` → `in_progress`), or null for an unknown one. */
export function statusFromSegment(segment: string): string | null {
  return SEGMENT_STATUS[segment] ?? null;
}

/** `/<slug>` followed by `rest` (which starts with `/`, or is empty). */
export function projectPath(slug: string, rest = ""): string {
  return `/${encodeURIComponent(slug)}${rest}`;
}

function withQuery(path: string, query?: URLSearchParams | string): string {
  const text = typeof query === "string" ? query.replace(/^\?/, "") : query?.toString() ?? "";
  return text ? `${path}?${text}` : path;
}

/** An issue list: `/<slug>/issues/<status>`; `all` when no status is given. */
export function issuesPath(slug: string, status: string | null = "all", query?: URLSearchParams | string): string {
  const segment = STATUS_SEGMENT[status ?? "all"] ?? "all";
  return withQuery(projectPath(slug, `/issues/${segment}`), query);
}

/** The ideas lists: new ideas, `drafts` or `rejected`. */
export function ideasPath(slug: string, view: "new" | "drafts" | "rejected" = "new", query?: URLSearchParams | string): string {
  return withQuery(projectPath(slug, view === "new" ? "/ideas" : `/ideas/${view}`), query);
}

/** An idea's page: `/<slug>/ideas/<number>`. Ideas are numbered apart from issues. */
export function ideaPath(slug: string, number: number): string {
  return projectPath(slug, `/ideas/${number}`);
}

/** The organization admin area under a project: `/<slug>/org`, `/<slug>/org/members`. */
export function orgPath(slug: string, section = ""): string {
  return projectPath(slug, section ? `/org/${section}` : "/org");
}

/** Filing a new report (it starts as an idea). */
export function newIssuePath(slug: string, query?: URLSearchParams | string): string {
  return withQuery(projectPath(slug, "/issues/new"), query);
}
