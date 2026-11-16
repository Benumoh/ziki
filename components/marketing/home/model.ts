import type { Status } from "@prisma/client";

/** A marketing task type as the Marketing home's pills and card show it (#marketing-agent-home). */
export type HomeTaskType = { id: string; name: string; description: string | null; goal: string | null; count: number };

/** One task or idea in the card's list. */
export type HomeTaskItem = { id: string; title: string; href: string; label: string; agentName: string | null; updatedAt: Date };

/** The card's list: the selected type's work, grouped by where it is. */
export type HomeTaskGroup = { key: string; heading: string; items: HomeTaskItem[]; more: number };

export type MarketingHomeData = { types: HomeTaskType[]; selected: HomeTaskType | null; groups: HomeTaskGroup[] };

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
