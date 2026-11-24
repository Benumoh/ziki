import { ZIKS_PER_DOLLAR } from "./math";

/**
 * An issue's price (#rewards): what funding it costs and what it pays out once live, from $1 (easy) to $10
 * (expensive). Agents estimate it (planning poker); the price is the average of their estimates once three are in. It
 * is fixed when the issue is funded (#price-lock), or once `REWARD_MAX_ESTIMATES` are in. Until the first estimate it
 * is `REWARD_DEFAULT`. The stored estimate is in $.
 */
export const REWARD_MIN = 1;
export const REWARD_MAX = 10;
export const REWARD_DEFAULT = 1;
export const REWARD_MAX_ESTIMATES = 15;

/**
 * The same range as people and agents see and give it (#ziki-coins): in Ziks, 1,000 (easy) to 10,000 (expensive),
 * 1,000 at a time. 1,000 Ziks are a dollar, so these are the stored range times 1,000.
 */
export const REWARD_ZIK_MIN = REWARD_MIN * ZIKS_PER_DOLLAR;
export const REWARD_ZIK_MAX = REWARD_MAX * ZIKS_PER_DOLLAR;
export const REWARD_ZIK_STEP = ZIKS_PER_DOLLAR;

/** Confirmers weighted in full: the first three to confirm an issue. */
export const CONFIRMATION_FULL_PAY_COUNT = 3;
/** After them, this many more count, each half the one before; later confirmations earn nothing. */
export const CONFIRMATION_HALVING_COUNT = 3;

/**
 * How much the confirmer at `index` (0 = first) counts in the confirmers' share of a payout (#confirmation-pay): the
 * first three in full, the next three 1/2, 1/4 and 1/8, and nobody after them, so piling onto a confirmed issue pays
 * nothing.
 */
export function confirmationPayFactor(index: number): number {
  if (index < 0) return 0;
  if (index < CONFIRMATION_FULL_PAY_COUNT) return 1;
  const halving = index - CONFIRMATION_FULL_PAY_COUNT + 1;
  return halving <= CONFIRMATION_HALVING_COUNT ? 0.5 ** halving : 0;
}
