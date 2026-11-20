import { DUPLICATES_PARAM, SHOW_DUPLICATES } from "@/lib/duplicates";
import { SHOW_RESOLVED, SHOW_RESOLVED_PARAM } from "@/lib/issue-state";
import { MILESTONE_PARAM } from "@/lib/milestones";
import { AREA_PARAM } from "@/lib/project-area-filter";
import { TAGS_PARAM } from "@/lib/tag-filter";

/**
 * Every filter the issue list reads, as the page resolved it. Previous/Next
 * links are built from this one object, and the type has no optional keys, so
 * adding a filter to the list without carrying it here is a compile error
 * rather than a quiet reset on page 2 (#967).
 */
export type IssueListFilterValues = {
  status: string | undefined;
  mine: string | null | undefined;
  q: string | undefined;
  sort: string | undefined;
  milestone: string | undefined;
  tags: string | undefined;
  area: string | null | undefined;
  stage: string | null | undefined;
  deleted: boolean;
  showDuplicates: boolean;
  /** #1058: resolved and closed issues are hidden unless this is set. */
  showResolved: boolean;
};

/** The query string the pagination links carry, without empty values. */
export function issueListPaginationParams(values: IssueListFilterValues): Record<string, string> {
  const entries: [string, string | null | undefined][] = [
    ["status", values.status],
    [MILESTONE_PARAM, values.milestone],
    ["mine", values.mine],
    ["q", values.q],
    [TAGS_PARAM, values.tags],
    [AREA_PARAM, values.area],
    ["stage", values.stage],
    ["deleted", values.deleted ? "true" : undefined],
    [DUPLICATES_PARAM, values.showDuplicates ? SHOW_DUPLICATES : undefined],
    [SHOW_RESOLVED_PARAM, values.showResolved ? SHOW_RESOLVED : undefined],
    ["sort", values.sort],
  ];
  return Object.fromEntries(entries.filter((entry): entry is [string, string] => Boolean(entry[1])));
}
