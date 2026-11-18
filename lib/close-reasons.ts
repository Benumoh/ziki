/**
 * Why an issue was closed (#close-reasons). `Bug.closeReason` holds one of
 * these; `Bug.closeEvidence` the evidence recorded with the close.
 *
 * | reason              | when |
 * | ------------------- | ---- |
 * | superseded          | another change made it obsolete |
 * | not_reproducible    | repeated current checks can't reproduce it; it can be reopened with fresh evidence |
 * | already_implemented | the requested behaviour already exists when assessed |
 * | duplicate           | another issue owns the same work (sets `Bug.duplicateOfId`) |
 * | not_planned         | a valid request consciously declined, with the reason recorded |
 * | withdrawn           | the reporter or the person it is for cancels it (no votes) |
 * | rejected            | confirmations rejected it and it sat open for two days (#pipeline-cleanup, no votes) |
 *
 * Kept free of database imports so pages and components can use it.
 */
export const CLOSE_REASONS = [
  "superseded",
  "not_reproducible",
  "already_implemented",
  "duplicate",
  "not_planned",
  "withdrawn",
  "rejected",
] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

/** The reasons agents suggest and managers close with. Withdrawn is the owner's own, without votes. */
export const VOTED_CLOSE_REASONS = [
  "superseded",
  "not_reproducible",
  "already_implemented",
  "duplicate",
  "not_planned",
] as const satisfies readonly CloseReason[];
export type VotedCloseReason = (typeof VOTED_CLOSE_REASONS)[number];

/** Only an issue closed as not reproducible can be reopened, with fresh evidence. */
export const REOPENABLE_CLOSE_REASONS = ["not_reproducible"] as const satisfies readonly CloseReason[];

const LABELS: Record<CloseReason, string> = {
  superseded: "superseded",
  not_reproducible: "not reproducible",
  already_implemented: "already implemented",
  duplicate: "duplicate",
  not_planned: "not planned",
  withdrawn: "withdrawn",
  rejected: "rejected",
};

/** What each reason means, for tool descriptions and the work feed. */
export const CLOSE_REASON_MEANING: Record<CloseReason, string> = {
  superseded: "another change made it obsolete",
  not_reproducible: "repeated current checks can't reproduce it",
  already_implemented: "the requested behaviour already exists",
  duplicate: "another issue owns the same work",
  not_planned: "a valid request, consciously declined",
  withdrawn: "the reporter or the person it is for cancelled it",
  rejected: "the confirmations rejected it and it left the pipeline",
};

export function isCloseReason(value: unknown): value is CloseReason {
  return typeof value === "string" && (CLOSE_REASONS as readonly string[]).includes(value);
}

export function isReopenable(reason: string | null | undefined): boolean {
  return (REOPENABLE_CLOSE_REASONS as readonly string[]).includes(reason ?? "");
}

/** "not reproducible"; an unknown or missing reason gives null. */
export function closeReasonLabel(reason: string | null | undefined): string | null {
  return isCloseReason(reason) ? LABELS[reason] : null;
}

/** "Closed: not reproducible", or "Closed" without a known reason. */
export function closedLabel(reason: string | null | undefined): string {
  const label = closeReasonLabel(reason);
  return label ? `Closed: ${label}` : "Closed";
}

/** The issue's owner, who may withdraw it: whoever reported it or the person it is for. */
export function ownsIssue(bug: { reporterId: string; beneficiaryUserId: string | null }, userId: string): boolean {
  return bug.reporterId === userId || bug.beneficiaryUserId === userId;
}

export type CloseTally = { reason: string; votes: number };

/**
 * The weighted votes per reason, highest first. Suggestions come oldest first,
 * so on a tie the reason suggested first leads. Each reason is tallied apart:
 * the issue closes, or goes to the managers, only when one reason's votes
 * reach the threshold.
 */
export function closeTallies(suggestions: Iterable<{ reason: string; votes: number }>): CloseTally[] {
  const byReason = new Map<string, number>();
  for (const suggestion of suggestions) byReason.set(suggestion.reason, (byReason.get(suggestion.reason) ?? 0) + suggestion.votes);
  return [...byReason.entries()]
    .map(([reason, votes]) => ({ reason, votes }))
    .sort((a, b) => b.votes - a.votes);
}
