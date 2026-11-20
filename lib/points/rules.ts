import { ZIKS_PER_DOLLAR } from "@/lib/coins/math";

/**
 * The contributor ledger's rules (#428). The ledger keeps every amount, award,
 * goal and setting in dollars, but people are shown Ziks (#earnings-in-ziks):
 * 10 Ziks a dollar, the currency their earnings move into
 * (lib/coins/earnings-sync.ts). Super admins can override the amounts.
 */

/**
 * An issue's reward (#rewards): what solving it pays, from $1 (easy) to $10
 * (expensive). Agents estimate it (planning poker); the reward is the average
 * of their estimates, fixed once `REWARD_MAX_ESTIMATES` are in. Until the
 * first estimate it is `REWARD_DEFAULT`.
 */
export const REWARD_MIN = 1;
export const REWARD_MAX = 10;
export const REWARD_DEFAULT = 1;
export const REWARD_MAX_ESTIMATES = 15;

/**
 * The same range as people and agents see and give it (#ziki-coins): in Ziks, 10 (easy) to 100 (expensive), 10 at a
 * time. The reward is stored in $ above; a Zik is 10 cents, so these are the stored range times ten.
 */
export const REWARD_ZIK_MIN = REWARD_MIN * ZIKS_PER_DOLLAR;
export const REWARD_ZIK_MAX = REWARD_MAX * ZIKS_PER_DOLLAR;
export const REWARD_ZIK_STEP = ZIKS_PER_DOLLAR;

/** Reporter award, once the bug is accepted as real and not a duplicate. */
export const REPORTER_POINTS = 1.5;

/** Reviewer award, when a "good to merge" verdict is accepted. */
export const REVIEWER_POINTS = 3;

/**
 * Reviewer points for an independent "real" accept that confirms the issue.
 * Separate from the merge verdict so the same person can earn both.
 */
export const CONFIRMATION_REVIEWER_POINTS = 0.9;

/** Triager points for clearing a report as not a duplicate. */
export const TRIAGER_CLEAR_POINTS = 0.3;

/** Confirmers paid in full: the first three to confirm an issue. */
export const CONFIRMATION_FULL_PAY_COUNT = 3;
/** After them, this many more are paid, each half the one before; later confirmations earn nothing. */
export const CONFIRMATION_HALVING_COUNT = 3;

/**
 * What share of the confirmation awards the confirmer at `index` (0 = first)
 * earns (#confirmation-pay): the first three in full, the next three 1/2, 1/4
 * and 1/8, and nobody after them, so piling onto a confirmed issue pays nothing.
 */
export function confirmationPayFactor(index: number): number {
  if (index < 0) return 0;
  if (index < CONFIRMATION_FULL_PAY_COUNT) return 1;
  const halving = index - CONFIRMATION_FULL_PAY_COUNT + 1;
  return halving <= CONFIRMATION_HALVING_COUNT ? 0.5 ** halving : 0;
}

/** The confirmation award for the confirmer at `index`: the base amount scaled by `confirmationPayFactor`. */
export function confirmationPointsAt(index: number, base: number): number {
  const factor = confirmationPayFactor(index);
  return factor > 0 && base > 0 ? roundPoints(base * factor) : 0;
}

/** Triager points for marking a report as a duplicate of another issue. */
export const DUPLICATE_MARKER_POINTS = 1.5;

/** Ledger amounts keep this many decimal places ($0.1125 is the smallest confirmation share). */
export const POINT_DECIMALS = 4;

/**
 * A ledger amount (dollars) as people see it, in Ziks: $12 is "120 Ziks", $0.67 is "6.7 Ziks", -$1.50 is
 * "-15 Ziks". One decimal at most; a share smaller than 0.1 Zik still shows as 0.1.
 */
export function formatZ(value: number): string {
  const ziks = roundPoints(value) * ZIKS_PER_DOLLAR;
  const abs = Math.abs(ziks);
  const tenths = Math.round(abs * 10) / 10;
  const shown = abs > 0 && tenths === 0 ? 0.1 : tenths;
  const text = shown.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return `${ziks < 0 && shown > 0 ? "-" : ""}${text} ${shown === 1 ? "Zik" : "Ziks"}`;
}

/**
 * Each later reviewer receives this share of the previous award.
 * A small step keeps the amounts close instead of falling off a cliff.
 */
export const REVIEWER_POINT_RATIO = 0.9;

/**
 * Smallest positive award. Backoff stops shrinking here so a later action
 * still earns something instead of rounding down to zero.
 */
export const MIN_POINT_AWARD = 10 ** -POINT_DECIMALS;

/** A point amount from the ledger: a number, or Prisma's Decimal. */
export type PointAmount = number | { toNumber(): number };

/** Round to the ledger's decimal places. Non-finite values become 0. */
export function roundPoints(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** POINT_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** Read a ledger amount as a number, including sums that come back as Decimal. */
export function pointsNumber(value: PointAmount | string | bigint | null | undefined): number {
  if (value == null) return 0;
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "bigint"
        ? Number(value)
        : typeof value === "string"
          ? Number(value)
          : value.toNumber();
  return roundPoints(raw);
}


/**
 * The next reviewer's award, given the previous reviewer's award.
 * Take 90% of the previous award, rounded to the ledger's decimal places.
 * When rounding would leave the amount unchanged, step down by the smallest award.
 * The result never falls below it, so every later action still earns something.
 * The first reviewer still receives the full base amount.
 */
export function diminishedReviewerPoints(previous: number): number {
  if (!(previous > 0)) return 0;
  const scaled = roundPoints(previous * REVIEWER_POINT_RATIO);
  if (scaled > 0 && scaled < previous) return scaled;
  const stepped = roundPoints(previous - MIN_POINT_AWARD);
  if (stepped > 0 && stepped < previous) return stepped;
  return MIN_POINT_AWARD;
}

/** Points for the reviewer at `index` (0 is the first), starting from `firstAward`. */
export function reviewerPointsAt(index: number, firstAward: number): number {
  if (index < 0 || !(firstAward > 0)) return 0;
  let points = roundPoints(firstAward);
  if (!(points > 0)) return 0;
  for (let step = 0; step < index; step += 1) {
    points = diminishedReviewerPoints(points);
  }
  return points;
}

/** The goal, in $. Solved tasks are counted, not required. */
export const TARGET_POINTS = 5;

export const DISPATCHER_POINTS = 0.6;

/** Largest award, in $, a super admin can store for one action. */
export const POINT_AWARD_MAX = 10_000;

/** Largest goal, in $, a super admin can store. */
export const POINT_TARGET_MAX = 1_000_000;

export type PointRole = "solver" | "reporter" | "reviewer" | "triager" | "submission" | "dispatcher" | "idea" | "signup" | "comment" | "vote" | "plan" | "security_check";

/**
 * The plan's award on a complex issue (#plan-review): $1 to the owner whose
 * agent's approved plan the delivering claim ran under. Nothing at approval
 * (approving your own agent's plan earns nothing on its own): it is held with
 * the solver's reward when the work is resolved and released once enough
 * people report it deployed, or paid on a marketing accept.
 */
export const PLAN_POINTS = 1;

/** Idempotency key for a plan's points: once per issue and person, however many awards, plans or claims they go through. */
export function planSourceKey(bugId: string, userId: string): string {
  return `plan:${bugId}:${userId}`;
}

/** Paid for a person's first importance mark on an issue, and their first bid vote on an issue (#vote-points). */
export const VOTE_POINTS = 0.01;

/** Idempotency key for an importance mark: once per person per issue, even if they unmark and mark again. */
export function importanceSourceKey(bugId: string, userId: string): string {
  return `importance:${bugId}:${userId}`;
}

/** Idempotency key for a bid vote: once per person per issue, however many of its bids they vote for. */
export function bidVoteSourceKey(bugId: string, userId: string): string {
  return `bid-vote:${bugId}:${userId}`;
}

/** Paid to a comment's author for each upvote from another person (#comment-votes). */
export const COMMENT_UPVOTE_POINTS = 0.01;

/**
 * Idempotency key for one change of a person's vote on a note comment: up +1,
 * down -1, and the change between them (a switch moves 2, taking a vote back
 * reverses it). `at` makes each change its own ledger row.
 */
export function noteVoteSourceKey(commentId: string, voterUserId: string, from: number, to: number, at: number): string {
  return `note-vote:${commentId}:${voterUserId}:${from}>${to}:${at}`;
}

/** Idempotency key for a comment upvote: one award per comment and voting person. */
export function commentUpvoteSourceKey(commentId: string, voterUserId: string): string {
  return `comment-upvote:${commentId}:${voterUserId}`;
}

/** Paid once per person per idea for their first opinion on it: a validation or a comment (#work-feed). */
export const IDEA_CONTRIBUTION_POINTS = 0.01;

/** Idempotency key for an idea contribution, so each person earns once per idea. */
export function ideaContributionSourceKey(ideaId: string, userId: string): string {
  return `idea:${ideaId}:${userId}`;
}

/** Idempotency key for paying the triager who cleared an issue as not a duplicate. */
export function triagerClearSourceKey(bugId: string, userId: string): string {
  return `triager-clear:${bugId}:${userId}`;
}

/** Idempotency key for paying the agent that marked an issue as a duplicate. */
export function duplicateMarkerSourceKey(bugId: string, userId: string): string {
  return `duplicate-marker:${bugId}:${userId}`;
}

/** The idempotency key for a job-submission award (#617). */
export function jobSubmissionSourceKey(jobId: string, submissionId: string): string {
  return `job:${jobId}:submission:${submissionId}`;
}

/**
 * The idempotency key for an award. `PointEntry.sourceKey` is unique, so a
 * second award with the same key adds nothing.
 */
export function pointSourceKey(role: PointRole, bugId: string, userId: string): string {
  return `${role}:${bugId}:${userId}`;
}

/** Idempotency key for paying a reviewer who confirmed the issue as real. */
export function confirmationReviewerSourceKey(bugId: string, userId: string): string {
  return `reviewer-confirm:${bugId}:${userId}`;
}

export type PointsProgress = {
  points: number;
  solvedTasks: number;
  /** 0–100, capped. */
  pointsPercent: number;
  /** True once the points goal is met. */
  targetMet: boolean;
};

function percent(value: number, target: number): number {
  return Math.min(100, Math.max(0, Math.floor((value / target) * 100)));
}

/** Progress toward the points goal (hard-coded TARGET_POINTS unless overridden). */
export function pointsProgress(
  points: number,
  solvedTasks: number,
  target: number = TARGET_POINTS,
): PointsProgress {
  const goal = target > 0 ? target : TARGET_POINTS;
  return {
    points,
    solvedTasks,
    pointsPercent: percent(points, goal),
    targetMet: points >= goal,
  };
}
