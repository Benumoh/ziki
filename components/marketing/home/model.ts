import type { Status } from "@prisma/client";

/** A marketing task type as the Marketing home's pills and card show it (#marketing-agent-home). */
export type HomeTaskType = { id: string; name: string; description: string | null; goal: string | null; count: number };

/** One task or idea in the card's list. */
export type HomeTaskItem = { id: string; title: string; href: string; label: string; agentName: string | null; updatedAt: Date; /** "#230", ideas as issues. */ ref: string; /** The asset it is on (#marketing-assets), or null. */ assetId: string | null; /** Its type, for the Overview. */ typeName: string | null };

/** The card's list: the selected type's work, grouped by where it is. */
export type HomeTaskGroup = { key: string; heading: string; items: HomeTaskItem[]; more: number };

/** One of the picked type's assets (#marketing-assets): a landing page, a video. Its work is in the groups. */
export type HomeAsset = { id: string; name: string; updatedAt: Date; typeId: string; typeName: string; /** How good it is now, 0-100 (#asset-score); null until rated. */ score: number | null; scoreNote: string | null };

/**
 * `overview`: the Overview tab (#marketing-overview), the first and the default: every type's work and assets
 * together, with no type picked. Otherwise `selected` is the picked type.
 */
export type MarketingHomeData = { types: HomeTaskType[]; selected: HomeTaskType | null; overview: boolean; groups: HomeTaskGroup[]; assets: HomeAsset[] };

/** `?type=overview`, or no type: the Overview tab. */
export const OVERVIEW_TYPE = "overview";

/** The groups top to bottom: what needs a person first. Ideas sit between work that's open and work that's finished. */
export const HOME_GROUPS: readonly { key: Status | "ideas"; heading: string }[] = [
  { key: "done", heading: "Review needed" },
  { key: "in_progress", heading: "In progress" },
  { key: "open", heading: "Open" },
  { key: "ideas", heading: "Ideas" },
  { key: "resolved", heading: "Live" },
  { key: "closed", heading: "Closed" },
];

/** How many of a group the card lists before saying how many more there are. */
export const HOME_GROUP_LIMIT = 10;
