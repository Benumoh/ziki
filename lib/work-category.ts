import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toSingleQueryParam } from "@/lib/search";

/**
 * What kind of change a piece of work is (#work-segments): a fix, a new feature or a design change. The lists for
 * people group by it, a few of each with a link to all of that kind (`?category=`). It is read from the work's type
 * (a type named like "Design" or "Feat") or, untyped, its title's tag ("[UI/UX] …", "[Feature] …"); anything else is a fix.
 */
export type WorkCategory = "fix" | "feature" | "design";

export const WORK_CATEGORY_PARAM = "category";

export const WORK_CATEGORIES: readonly { key: WorkCategory; label: string; add: string }[] = [
  { key: "fix", label: "Fixes", add: "Add Fix" },
  { key: "feature", label: "New Features", add: "Add Feature" },
  { key: "design", label: "Design Changes", add: "Add Design Change" },
];

/** The report form's `?kind=`: which kind its type starts at, from a section's Add button. */
export const WORK_KIND_PARAM = "kind";

/** The type a new report of this kind starts with: the first type named for it, or null. */
export function typeForCategory<T extends { id: string; name: string }>(category: WorkCategory, types: T[]): T | null {
  if (category === "design") return types.find((type) => DESIGN_TYPE.test(type.name)) ?? null;
  if (category === "feature") return types.find((type) => !DESIGN_TYPE.test(type.name) && FEATURE_TYPE.test(type.name)) ?? null;
  return types.find((type) => /^fix$|bug/i.test(type.name)) ?? null;
}

/** How many of each kind a grouped list shows before its Show all link. */
export const WORK_SEGMENT_SIZE = 5;

export function parseWorkCategory(raw: string | string[] | undefined): WorkCategory | null {
  const value = toSingleQueryParam(raw);
  return WORK_CATEGORIES.some((category) => category.key === value) ? (value as WorkCategory) : null;
}

const DESIGN_TYPE = /design|ui|ux/i;
const FEATURE_TYPE = /feat|enhanc|improv/i;
const DESIGN_TAGS = ["[UI/UX]", "[Design]", "[UI]", "[UX]"];
const FEATURE_TAGS = ["[Feature]", "[Feat]"];

/** The organisation's types that mark design and feature work, by id. */
export type CategoryTypes = { design: string[]; feature: string[] };

export async function categoryTypesFor(organisationId: string): Promise<CategoryTypes> {
  const types = await prisma.issueType.findMany({ where: { organisationId }, select: { id: true, name: true } });
  const design = types.filter((type) => DESIGN_TYPE.test(type.name)).map((type) => type.id);
  const feature = types.filter((type) => !DESIGN_TYPE.test(type.name) && FEATURE_TYPE.test(type.name)).map((type) => type.id);
  return { design, feature };
}

const tagged = (tags: string[]) => tags.map((tag) => ({ title: { startsWith: tag, mode: "insensitive" as const } }));
// typeId may be null: `notIn` alone would leave untyped work out (NULL NOT IN … is not true), so null is named.
const typeNotIn = (ids: string[]) => ({ OR: [{ typeId: null }, { typeId: { notIn: ids } }] });

/**
 * The work of one kind, for issues and ideas alike (both have `title` and `typeId`). Design comes first: a design
 * type or tag makes it design whatever else it says; then feature; the rest are fixes.
 */
export function workCategoryWhere(category: WorkCategory, types: CategoryTypes): Prisma.BugWhereInput {
  const design = { OR: [{ typeId: { in: types.design } }, ...tagged(DESIGN_TAGS)] };
  const notDesign = { AND: [typeNotIn(types.design), { NOT: { OR: tagged(DESIGN_TAGS) } }] };
  if (category === "design") return design;
  const feature = { OR: [{ typeId: { in: types.feature } }, ...tagged(FEATURE_TAGS)] };
  if (category === "feature") return { AND: [feature, notDesign] };
  return { AND: [notDesign, typeNotIn(types.feature), { NOT: { OR: tagged(FEATURE_TAGS) } }] };
}

/** The same for ideas, which share the fields it reads. */
export function ideaCategoryWhere(category: WorkCategory, types: CategoryTypes): Prisma.IdeaWhereInput {
  return workCategoryWhere(category, types) as Prisma.IdeaWhereInput;
}
