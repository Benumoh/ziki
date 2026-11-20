/**
 * Issue priority (#issue-priority): a coarse urgency label on an issue.
 *
 * Stored as a plain string in the database so the value set can grow without a
 * migration. The four levels here are the ones the UI knows about; unknown
 * values fall back to "medium" everywhere they are read.
 */

export const ISSUE_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

export const DEFAULT_ISSUE_PRIORITY: IssuePriority = "medium";

export const ISSUE_PRIORITY_LABELS: Record<IssuePriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

/** Tailwind classes for the priority badge, light + dark. */
export const ISSUE_PRIORITY_BADGE_CLASSES: Record<IssuePriority, string> = {
  // Soft tinted pills (lib/pill-tones.ts): green, yellow, orange, red.
  low: "border-transparent bg-[#dcfce7] font-semibold text-[#15803d]",
  medium: "border-transparent bg-[#fef3c7] font-semibold text-[#8a5a00]",
  high: "border-transparent bg-[#ffedd5] font-semibold text-[#c2410c]",
  urgent: "border-transparent bg-[#fee2e2] font-semibold text-[#b91c1c]",
};

export function isIssuePriority(value: unknown): value is IssuePriority {
  return typeof value === "string" && (ISSUE_PRIORITIES as readonly string[]).includes(value);
}

/** Coerce any stored value to a known priority, defaulting to medium. */
export function normalizeIssuePriority(value: unknown): IssuePriority {
  return isIssuePriority(value) ? value : DEFAULT_ISSUE_PRIORITY;
}

/** Numeric rank, higher = more urgent. Useful for sorting. */
export function issuePriorityRank(priority: IssuePriority): number {
  return ISSUE_PRIORITIES.indexOf(priority);
}

/** Sort comparator: urgent first, then high, medium, low. */
export function compareIssuePriority(a: unknown, b: unknown): number {
  return issuePriorityRank(normalizeIssuePriority(b)) - issuePriorityRank(normalizeIssuePriority(a));
}

/** Zod-friendly parse: returns the priority or null when invalid. */
export function parseIssuePriority(value: unknown): IssuePriority | null {
  return isIssuePriority(value) ? value : null;
}
