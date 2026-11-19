import type { Prisma, Status } from "@prisma/client";
import { statusLabel } from "@/lib/labels";
import { statuses } from "@/lib/validations/issue";

/**
 * Resolved and closed issues are finished: nothing on them is waiting for
 * anyone. The list de-emphasises them so the eye lands on what still needs
 * work (#313).
 */
export function isDone(status: Status | string): boolean {
  return status === "resolved" || status === "closed";
}

/**
 * A single filter token that stands for every finished status. The stat grid
 * shows one "Closed" number for resolved + closed work (#685); this is the
 * token its tile links to, so the count on the tile and the list it opens
 * always agree. It is a filter keyword, not a real `Status`.
 */
export const FINISHED_STATUS_FILTER = "finished";

/** Statuses the `finished` filter token expands to. */
export const FINISHED_STATUS_VALUES = ["resolved", "closed"] as const;

/**
 * The issue lists' two tabs for people (#simple-lists): In progress holds everything not yet delivered and
 * Delivered everything delivered, live included. Each is a filter token over its statuses; the Status filter
 * narrows it to one. The Work queue keeps every status apart.
 */
export const PROGRESS_STATUS_FILTER = "progress";
export const DELIVERED_STATUS_FILTER = "delivered";
const GROUP_STATUS_VALUES: Record<string, Status[]> = {
  [PROGRESS_STATUS_FILTER]: ["open", "in_progress", "closed"],
  [DELIVERED_STATUS_FILTER]: ["done", "merge", "resolved"],
};

/**
 * What the issues page calls each `?status=` value, on its tabs and in the
 * Active filters chip, so the two always read the same ("Live", not "Resolved").
 */
const STATUS_FILTER_LABELS: Record<string, string> = {
  escalated: "Inbox",
  ideas: "Ideas",
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  merge: "Merge",
  resolved: "Live",
  error: "Error",
  progress: "All in progress",
  delivered: "All delivered",
  possibly_delivered: "Possibly delivered",
  your_work: "Your work",
  all: "All",
  closed: "Closed",
  rejected: "Rejected",
  duplicate: "Duplicates",
  [FINISHED_STATUS_FILTER]: "Closed (incl. resolved)",
};

export function statusFilterLabel(value: string): string {
  return STATUS_FILTER_LABELS[value] ?? (statusLabel as Record<string, string>)[value] ?? value;
}

/**
 * The status filter a `?status=` value stands for: our own `finished` token,
 * or a real status. `null` when the value filters nothing.
 */
export function statusFilterValues(value: string | undefined): Status[] | null {
  if (!value) return null;
  if (value === FINISHED_STATUS_FILTER) return [...FINISHED_STATUS_VALUES];
  if (GROUP_STATUS_VALUES[value]) return [...GROUP_STATUS_VALUES[value]];
  return (statuses as readonly string[]).includes(value) ? [value as Status] : null;
}

/**
 * A Prisma status clause for a `?status=` value, or `undefined` when the value
 * is not a filter we understand. One status is an equality; `finished` is an
 * `in` over resolved + closed.
 */
export function statusFilterWhere(value: string | undefined): Prisma.BugWhereInput["status"] | undefined {
  const values = statusFilterValues(value);
  if (!values) return undefined;
  return values.length === 1 ? values[0] : { in: values };
}

/** The result-count line under the list heading, naming the status filter
 * when one is applied so it is clear what is being left out — "12 open
 * issues", not "12 results" — and plain when none is.
 */
export function resultCountText(count: number, status: string | null): string {
  if (!status) return `${count} ${count === 1 ? "result" : "results"}`;
  const label =
    status === FINISHED_STATUS_FILTER
      ? "closed"
      : ((statusLabel as Record<string, string>)[status] ?? status).toLowerCase();
  return `${count} ${label} ${count === 1 ? "issue" : "issues"}`;
}

/**
 * #1058: the list shows live work by default. Resolved and closed issues are
 * hidden until `?resolved=1`, or until a status filter asks for them.
 */
export const SHOW_RESOLVED_PARAM = "resolved";
export const SHOW_RESOLVED = "1";
export const LIVE_STATUS_VALUES = ["open", "in_progress", "done", "merge"] as const;

export function parseShowResolved(raw: string | string[] | null | undefined): boolean {
  return (Array.isArray(raw) ? raw[0] : raw) === SHOW_RESOLVED;
}

/**
 * The status clause the list uses when no status filter is set: live work
 * only, unless resolved issues were asked for. `undefined` means no clause.
 */
export function defaultStatusWhere(showResolved: boolean): Prisma.BugWhereInput["status"] | undefined {
  return showResolved ? undefined : { in: [...LIVE_STATUS_VALUES] };
}
