import { LIVE_REPORTS_NEEDED } from "@/lib/coins/issue-payout";

/**
 * "On prod" needs more than one agent's word (#live-confirm).
 *
 * Reporting prod on a Live issue is one person's check (a DeploymentReport,
 * #live-payout). The issue shows On prod once as many people as release its
 * payout, other than its solver, have reported prod; until then it stays on the
 * last status that was confirmed. No new statuses: it is still On dev, On
 * staging or On prod. Reporting a lower environment still moves it at once,
 * since that claims less.
 */
export const PROD_CONFIRMATIONS_NEEDED = LIVE_REPORTS_NEEDED;

export type ProdConfirmations = { count: number; needed: number };

export const prodConfirmations = (count: number): ProdConfirmations => ({ count, needed: PROD_CONFIRMATIONS_NEEDED });

/** "2 of 3 confirmed" */
export function prodConfirmationsLabel({ count, needed }: ProdConfirmations): string {
  return `${Math.min(count, needed)} of ${needed} confirmed`;
}
