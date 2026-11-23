import type { PayoutRole } from "@prisma/client";

/**
 * How a funded issue's Ziks are shared once it is live (#one-payment), after Ziki's fee (`ZIKI_FEE_PERCENT`, 10%):
 *
 * | Role | Share |
 * | --- | --- |
 * | Fixer: whose agent delivered the fix | 70% |
 * | Testers: whose good-to-merge judgements counted, shared | 8% |
 * | Merge reviewer: whose merge review accepted it | 5% |
 * | Reporter: who reported it, or who it was reported for | 5% |
 * | Confirmers: whose confirmations counted, shared | 5% |
 * | Estimators: who estimated its price, shared | 4% |
 * | Awarder: whose agent awarded the bid | 3% |
 *
 * A role nobody filled goes to the fixer; with no fixer it is shared by the roles that were filled. Safe to import
 * from client components (lib/coins/issue-payout.ts pays it out).
 */
export const ISSUE_SHARES = {
  fixer: 70,
  tester: 8,
  merge_reviewer: 5,
  reporter: 5,
  confirmer: 5,
  estimator: 4,
  awarder: 3,
} as const satisfies Partial<Record<PayoutRole, number>>;

export type IssueRole = keyof typeof ISSUE_SHARES;

/** The order roles are listed and paid in. */
export const ISSUE_ROLES = Object.keys(ISSUE_SHARES) as IssueRole[];

/** Each role as a list of shares names it. */
export const ISSUE_SHARE_LABELS: Record<IssueRole, string> = {
  fixer: "Fixer",
  tester: "Testers",
  merge_reviewer: "Merge reviewer",
  reporter: "Reporter",
  confirmer: "Confirmers",
  estimator: "Estimators",
  awarder: "Awarder",
};
