import { formatZik } from "./math";

export type PaceState = "on-track" | "fixable" | "short";

export type WeeklyPace = {
  earned: number;
  inMotion: number;
  target: number;
  state: PaceState;
  /** Share of the bar (0-100) that is earned / in motion, capped so they never exceed the bar together. */
  earnedPct: number;
  inMotionPct: number;
  /** Where the goal sits on the bar (0-100). */
  goalPct: number;
  headline: string;
  detail: string;
};

const clean = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Weekly pace: what you have earned this week, what is still in motion
 * (the funded prices of your active claims) and whether that adds up to the goal, in Ziks.
 * The bar's scale is 1.6x the goal, so the goal mark sits clear of the
 * edge and overshoot is visible.
 */
export function weeklyPace(earnedRaw: number, inMotionRaw: number, targetRaw: number): WeeklyPace {
  const earned = clean(earnedRaw);
  const inMotion = clean(inMotionRaw);
  const target = clean(targetRaw) || 1;
  const scale = Math.max(target * 1.6, earned + inMotion);
  const pct = (v: number) => Math.min(100, (v / scale) * 100);
  const earnedPct = pct(earned);
  const inMotionPct = Math.min(pct(earned + inMotion), 100) - earnedPct;

  let state: PaceState;
  let headline: string;
  let detail: string;
  if (earned >= target) {
    state = "on-track";
    headline = "On track";
    detail = `Goal reached this week, ${formatZik(earned - target)} over.`;
  } else if (earned + inMotion >= target) {
    state = "fixable";
    headline = "Behind, but fixable";
    detail = `${formatZik(inMotion)} is in motion. Landing it brings you to ${formatZik(earned + inMotion)}.`;
  } else {
    state = "short";
    headline = `Short by ${formatZik(target - earned - inMotion)}`;
    detail =
      inMotion > 0
        ? `Even if ${formatZik(inMotion)} in motion lands, you need more work.`
        : "Nothing in motion yet. Claim an issue to get started.";
  }
  return { earned, inMotion, target, state, earnedPct, inMotionPct, goalPct: pct(target), headline, detail };
}
