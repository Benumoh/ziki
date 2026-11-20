import { PRODUCT_TRACK } from "@/lib/marketing/track";
import type { Prisma } from "@prisma/client";
import { statusFilterWhere } from "@/lib/issue-state";
import { boundSearchTerm, escapeSearchQuery, toSingleQueryParam } from "@/lib/search";
import { MILESTONE_PARAM, milestoneWhere, parseMilestoneFilter } from "@/lib/milestones";
import {
  defaultSortFor,
  mineFilterWhere,
  parseMineFilter,
  type MineFilter,
} from "@/lib/mine-filter";
import { parseTagFilter, tagTypeIds } from "@/lib/tag-filter";
import { parseBugSort, type BugSortOption } from "@/lib/issues-sort";
import { DUPLICATES_PARAM, duplicatesWhere, parseShowDuplicates } from "@/lib/duplicates";
import { parseProjectAreaFilter, projectAreaFilterWhere, type ProjectAreaOption } from "@/lib/project-area-filter";

export type RawParams = Record<string, string | string[] | undefined>;

export type TagType = { id: string; name: string };

/**
 * The filters behind the issues list, as a Prisma `where` plus the sort.
 *
 * The CSV export has to return exactly what the list is showing, so both
 * read the query string through this rather than each assembling their own
 * conditions and drifting apart.
 */
export type ParsedBugFilters = {
  where: Prisma.BugWhereInput;
  sort: BugSortOption;
  /** The "Show" filter, which also decides the default order (#312). */
  mine: MineFilter | null;
  /** True when the caller asked for deleted issues and is allowed to see them. */
  isDeletedView: boolean;
};

export function parseBugListFilters({
  params,
  userId,
  canSeeDeleted,
  tagTypes = [],
  areas = [],
  milestones = [],
}: {
  params: RawParams;
  userId: string | undefined;
  /** Only admins may list deleted issues; everyone else gets the live ones. */
  canSeeDeleted: boolean;
  tagTypes?: readonly TagType[];
  /** Areas belonging to the active project, so stale/foreign ids mean no filter. */
  areas?: readonly ProjectAreaOption[];
  /** Known milestones (#289); an unknown id means no filter, like areas. */
  milestones?: readonly { id: string }[];
}): ParsedBugFilters {
  const q = toSingleQueryParam(params.q);
  const status = toSingleQueryParam(params.status);
  const deleted = toSingleQueryParam(params.deleted);
  const mine = parseMineFilter(params.mine);

  const isDeletedView = canSeeDeleted && deleted === "true";

  const where: Prisma.BugWhereInput = {
    ...PRODUCT_TRACK,
    isDeleted: isDeletedView,
    ...mineFilterWhere(mine, userId),
    // #285: same rule as the list, so the export matches what's on screen.
    ...duplicatesWhere(parseShowDuplicates(params[DUPLICATES_PARAM])),
  };

  const selectedTags = parseTagFilter(params.tags, tagTypes);
  if (selectedTags.length > 0) {
    where.typeId = { in: tagTypeIds(selectedTags, tagTypes) };
  }

  // The same status parsing the list uses, so the export understands the
  // `finished` aggregate the stat grid links to (#685) and cannot drift from
  // what is on screen.
  const statusWhere = statusFilterWhere(status);
  if (statusWhere !== undefined) {
    where.status = statusWhere;
  }

  Object.assign(where, projectAreaFilterWhere(parseProjectAreaFilter(params.area, areas)));

  Object.assign(where, milestoneWhere(parseMilestoneFilter(params[MILESTONE_PARAM], milestones)));

  if (q?.trim()) {
    const escaped = escapeSearchQuery(boundSearchTerm(q));
    where.OR = [
      { title: { contains: escaped, mode: "insensitive" } },
      { description: { contains: escaped, mode: "insensitive" } },
    ];
  }

  return { where, sort: parseBugSort(toSingleQueryParam(params.sort), defaultSortFor(mine)), mine, isDeletedView };
}
