/** What the Your call page (#your-call) shares with the browser. */

/** How much a stuck issue holds the project back (lib/your-call.ts `urgencyOf`). */
export type Urgency = "critical" | "high" | "medium" | "low";

export const URGENCIES: Urgency[] = ["critical", "high", "medium", "low"];

export const URGENCY_LABEL: Record<Urgency, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** "Bug", "Feature" and the like come in brackets at the start of a title: the plain list leaves them out. */
export const plainTitle = (title: string) => title.replace(/^\[[^\]]+\]\s*/, "");

/** The plain choice a person gives, in the words they see (`yes`: go ahead, `no`: leave it). */
export type YourCallAnswer = "yes" | "no";

/** What each choice means for the kind of issue, in plain words: the question, the two buttons and what the agents read. */
export const PLAIN: Record<"confirm" | "merge", { question: string; yes: string; no: string; yesSaid: string; noSaid: string; yesSentence: string; noSentence: string }> = {
  confirm: {
    question: "The agents could not agree on whether this should be fixed.",
    yes: "Yes, fix it",
    no: "No, leave it",
    yesSaid: "Some agents say it is a real problem",
    noSaid: "Some agents say it is not",
    yesSentence: "Yes, this is a real problem. Please go ahead and fix it.",
    noSentence: "No, leave it. Please do not work on this.",
  },
  merge: {
    question: "The agents could not agree on whether the fix is ready.",
    yes: "Yes, it is ready",
    no: "No, not yet",
    yesSaid: "Some agents say the fix is ready",
    noSaid: "Some agents say it is not",
    yesSentence: "Yes, the fix is ready. Please go ahead and merge it.",
    noSentence: "No, the fix is not ready yet. Please do not merge it.",
  },
};

/** Every answer a person gives starts with this, so the agents (and this list) can tell it from other comments. */
export const DECISION_MARKER = "**Decision from the owner:**";

export type YourCallVote = { agentId: string; agentName: string; says: string };

export type YourCallItem = {
  id: string;
  number: number;
  title: string;
  summary: string | null;
  /** merge: testers split on a delivered fix. confirm: confirmers split on a report. */
  kind: "merge" | "confirm";
  urgency: Urgency;
  /** Why it has that urgency, for the meter's tooltip ("Boosted", "Split for 9 days"). */
  reasons: string[];
  /** Good to merge (merge) or confirm (confirm). */
  yes: YourCallVote[];
  /** Not good to merge, or reject. */
  no: YourCallVote[];
  since: Date;
  href: string;
  /** What this person already answered here, when they did: the issue stays listed, now waiting for the agents. */
  answer: YourCallAnswer | null;
};
