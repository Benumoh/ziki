import { publish } from "@/lib/agent-api/events";
import { confirmationStateOf, paidConfirmerOrder } from "@/lib/agent-api/confirmations";
import { penalisedConfirmationIds } from "@/lib/agent-api/confirmation-penalties";
import { reportedClosedUnmerged } from "@/lib/agent-api/pull-request-report";
import { confirmationPayFactor } from "@/lib/coins/price-rules";
import { appendRows, escrowBalance, lockBug, type CoinRow, type Tx } from "./ledger";
import { feeOf, feePercent, splitByWeight } from "./math";
import { ISSUE_ROLES, ISSUE_SHARES, type IssueRole } from "./issue-shares";
import { PAYER_WHERE } from "./payers";

/**
 * One payment system (#one-payment). Ziks are Ziki's only money: an issue's funded Ziks (its escrow, ./escrow.ts) pay
 * everyone who worked on it, once the work is live, and nothing else pays. Ziki keeps its fee (`ZIKI_FEE_PERCENT`,
 * 10%) and the rest is shared by role (./issue-shares.ts: the fixer 70%, testers 8%, merge reviewer 5%, reporter 5%,
 * confirmers 5%, estimators 4%, awarder 3%).
 *
 * A role nobody filled goes to the fixer (a Solo issue has no confirmers, say); with no fixer it is shared by the roles
 * that were filled. An issue nobody funded, or that never goes live, pays nobody.
 *
 * "Live" is when `LIVE_REPORTS_NEEDED` people other than the fixer have reported the work deployed
 * (`POST /api/v1/issues/{id}/deployment`, one report per person counts).
 */
export { ISSUE_ROLES, ISSUE_SHARES, type IssueRole };

/** People reporting the work deployed, other than its fixer, before the issue pays out. */
export const LIVE_REPORTS_NEEDED = 3;

/**
 * Someone who worked on the issue, in one role. `weight` shares the role between the people in it (1 each by default;
 * confirmers are weighted by their place in line, so piling onto a confirmed issue earns little). `agentId` is the agent
 * whose work it was, when an agent did it.
 */
export type Contributor = { userId: string; role: IssueRole; weight?: number; agentId?: string | null };

/** One person's pay for one role. */
export type PayoutLine = { userId: string; role: IssueRole; amount: number; agentId: string | null };

export type IssuePayoutPlan = { fee: number; lines: PayoutLine[] };

/**
 * What releasing `escrow` Ziks pays (pure): Ziki's fee, then each role's share split between its people. The lines
 * add up to exactly `escrow - fee`, in whole Ziks. Null when there is nothing to pay or nobody to pay it to.
 */
export function planIssuePayout(escrow: number, contributors: readonly Contributor[], percent: number = feePercent()): IssuePayoutPlan | null {
  if (escrow <= 0) return null;
  // Each role's people, first come first, one entry per person.
  const byRole = new Map<IssueRole, Map<string, number>>();
  const agentOf = new Map<string, string | null>();
  for (const contributor of contributors) {
    const weight = contributor.weight ?? 1;
    if (!(weight > 0) || !(contributor.role in ISSUE_SHARES)) continue;
    const people = byRole.get(contributor.role) ?? new Map<string, number>();
    if (!people.has(contributor.userId)) {
      people.set(contributor.userId, weight);
      agentOf.set(`${contributor.role}\u0000${contributor.userId}`, contributor.agentId ?? null);
    }
    byRole.set(contributor.role, people);
  }
  const filled = ISSUE_ROLES.filter((role) => (byRole.get(role)?.size ?? 0) > 0);
  if (filled.length === 0) return null;

  // Each filled role's share; the empty roles' shares go to the fixer, or across the filled roles without one.
  const share = new Map<IssueRole, number>(filled.map((role) => [role, ISSUE_SHARES[role]]));
  const unfilled = ISSUE_ROLES.filter((role) => !share.has(role)).reduce((sum, role) => sum + ISSUE_SHARES[role], 0);
  if (share.has("fixer")) share.set("fixer", (share.get("fixer") ?? 0) + unfilled);

  // A weight per (role, person), so one exact split covers everyone and the lines add up to the pool.
  const weights = new Map<string, number>();
  for (const role of filled) {
    const people = byRole.get(role)!;
    const total = [...people.values()].reduce((sum, weight) => sum + weight, 0);
    for (const [userId, weight] of people) weights.set(`${role}\u0000${userId}`, ((share.get(role) ?? 0) * weight) / total);
  }
  const fee = feeOf(escrow, percent);
  const lines: PayoutLine[] = [];
  for (const [key, amount] of splitByWeight(escrow - fee, weights)) {
    const [role, userId] = key.split("\u0000") as [IssueRole, string];
    lines.push({ userId, role, amount, agentId: agentOf.get(key) ?? null });
  }
  return { fee, lines };
}

type PayoutBug = {
  id: string;
  organisationId: string;
  reporterId: string;
  beneficiaryUserId: string | null;
  assigneeId: string | null;
  pullRequestUrl: string | null;
  createdByAgentId: string | null;
  createdByAgent: { ownerUserId: string } | null;
  idea: { source: string } | null;
};

/** The organisation's payers (#payers) among `userIds`: they pay for its issues, so reporting and confirming them earns nothing. */
async function payersAmong(tx: Tx, organisationId: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await tx.membership.findMany({
    where: { organisationId, userId: { in: userIds }, ...PAYER_WHERE },
    select: { userId: true },
  });
  return new Set(rows.map((row) => row.userId));
}

/** Everyone who worked on the issue, read from the work itself: the claim, the judgements, the reviews, the confirmations and the estimates. */
export async function issueContributors(tx: Tx, bug: PayoutBug): Promise<Contributor[]> {
  const contributors: Contributor[] = [];
  // The fixer, unless the pull request was reported closed without merging.
  const fixer = bug.assigneeId && !(bug.pullRequestUrl && (await reportedClosedUnmerged(bug.id, bug.pullRequestUrl, tx))) ? bug.assigneeId : null;

  const [verdicts, review, estimates, claim, state, penalised] = await Promise.all([
    tx.testVerdict.findMany({
      where: { bugId: bug.id, goodToMerge: true, ...(bug.pullRequestUrl ? { pullRequestUrl: bug.pullRequestUrl } : {}) },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: { onBehalfOfUserId: true, agentId: true },
    }),
    tx.mergeReview.findFirst({ where: { bugId: bug.id, verdict: "accept" }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { onBehalfOfUserId: true, agentId: true } }),
    tx.rewardEstimate.findMany({ where: { bugId: bug.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { onBehalfOfUserId: true, agentId: true } }),
    // The claim that delivered the work: the one released when the issue was resolved, else the latest.
    tx.issueClaim.findFirst({
      where: { bugId: bug.id, ...(fixer ? { beneficiaryUserId: fixer } : {}) },
      orderBy: [{ releasedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      select: { agentId: true, awardedByUserId: true, dispatcherUserId: true },
    }),
    confirmationStateOf(bug.id, tx),
    penalisedConfirmationIds(tx, bug.id),
  ]);
  if (fixer) contributors.push({ userId: fixer, role: "fixer", agentId: claim?.agentId ?? null });
  // The holder can't judge or review their own work; skip them if an entry slipped through.
  for (const verdict of verdicts) if (verdict.onBehalfOfUserId !== fixer) contributors.push({ userId: verdict.onBehalfOfUserId, role: "tester", agentId: verdict.agentId });
  if (review && review.onBehalfOfUserId !== fixer) contributors.push({ userId: review.onBehalfOfUserId, role: "merge_reviewer", agentId: review.agentId });
  for (const estimate of estimates) contributors.push({ userId: estimate.onBehalfOfUserId, role: "estimator", agentId: estimate.agentId });
  const awarder = claim?.awardedByUserId ?? claim?.dispatcherUserId ?? null;
  if (awarder) contributors.push({ userId: awarder, role: "awarder" });

  // Reporting and confirming are paid only to people who don't pay for the organisation's issues (#price-lock).
  const counted = (state?.counted ?? []).filter((entry) => !penalised.has(entry.id));
  const confirmers = paidConfirmerOrder(counted, bug);
  const reporter = bug.idea?.source === "public" ? null : bug.beneficiaryUserId ?? bug.reporterId;
  const payers = await payersAmong(tx, bug.organisationId, [...confirmers, ...(reporter ? [reporter] : [])]);
  if (reporter && !payers.has(reporter)) contributors.push({ userId: reporter, role: "reporter", agentId: bug.createdByAgentId });
  confirmers.forEach((userId, index) => {
    // The first three in full, the next three 1/2, 1/4 and 1/8 (#confirmation-pay): piling on earns nothing.
    const weight = confirmationPayFactor(index);
    const agentId = counted.find((entry) => entry.onBehalfOfUserId === userId && entry.verdict === "confirm")?.agentId ?? null;
    if (weight > 0 && !payers.has(userId)) contributors.push({ userId, role: "confirmer", weight, agentId });
  });
  return contributors;
}

/** People who reported the issue deployed, not counting its fixer. */
export async function liveReporters(tx: Tx, bugId: string, fixerUserId: string | null): Promise<string[]> {
  const reports = await tx.deploymentReport.findMany({ where: { bugId }, select: { onBehalfOfUserId: true } });
  return [...new Set(reports.map((report) => report.onBehalfOfUserId))].filter((userId) => userId !== fixerUserId);
}

/** Live and judged good: Live, but not force-merged and waiting for judgements, and not judged broken. */
const PAYING_SUBSTATUSES = new Set(["on_dev", "on_staging", "on_prod"]);

const PAYOUT_BUG_SELECT = {
  id: true, number: true, organisationId: true, projectId: true, reporterId: true, beneficiaryUserId: true, assigneeId: true,
  pullRequestUrl: true, substatus: true, payoutReleasedAt: true, createdByAgentId: true,
  createdByAgent: { select: { ownerUserId: true } }, idea: { select: { source: true } }, project: { select: { solo: true } },
} as const;

/**
 * Pays the issue's funded Ziks out once it is live (#live-payout): Ziki's fee, then everyone who worked on it, each
 * row once by its source key. True if it paid now. Runs in the caller's transaction; safe to call on every resolve
 * and every deployment report.
 */
export async function releasePayoutIfLive(tx: Tx, bugId: string): Promise<boolean> {
  const bug = await tx.bug.findUniqueOrThrow({ where: { id: bugId }, select: PAYOUT_BUG_SELECT });
  if (bug.payoutReleasedAt || !PAYING_SUBSTATUSES.has(bug.substatus)) return false;
  const reporters = await liveReporters(tx, bug.id, bug.assigneeId);
  if (reporters.length < LIVE_REPORTS_NEEDED) return false;
  return payOut(tx, bug, { liveReports: reporters.length });
}

/**
 * Pays the issue's funded Ziks out now, without waiting for deployment reports: for marketing work, which is
 * published when a manager accepts it and has nothing to deploy. True if it paid now.
 */
export async function releasePayoutNow(tx: Tx, bugId: string): Promise<boolean> {
  const bug = await tx.bug.findUniqueOrThrow({ where: { id: bugId }, select: PAYOUT_BUG_SELECT });
  if (bug.payoutReleasedAt) return false;
  return payOut(tx, bug, {});
}

async function payOut(tx: Tx, bug: { id: string; number: number; organisationId: string; projectId: string; project: { solo: boolean } } & PayoutBug, facts: Record<string, number>): Promise<boolean> {
  // A Solo project's work is its owner's own (#solo): no money moves.
  if (bug.project.solo) return false;
  await lockBug(tx, bug.id);
  const escrow = await escrowBalance(tx, bug.id);
  const plan = planIssuePayout(escrow, await issueContributors(tx, bug));
  // Marked paid even with nothing funded: an unfunded issue pays nobody, now or later.
  await tx.bug.update({ where: { id: bug.id }, data: { payoutReleasedAt: new Date() } });
  if (plan) {
    const rows: CoinRow[] = [];
    if (plan.fee > 0) {
      rows.push(
        { account: "escrow", bugId: bug.id, kind: "fee", amount: -plan.fee, sourceKey: `fee:${bug.id}:escrow` },
        { account: "revenue", bugId: bug.id, kind: "fee", amount: plan.fee, sourceKey: `fee:${bug.id}:revenue` },
      );
    }
    for (const line of plan.lines) {
      const key = `release:${bug.id}:${line.userId}:${line.role}`;
      rows.push(
        { account: "escrow", bugId: bug.id, kind: "release", payoutRole: line.role, agentId: line.agentId, amount: -line.amount, sourceKey: `${key}:escrow` },
        { account: "wallet", userId: line.userId, bugId: bug.id, kind: "release", payoutRole: line.role, agentId: line.agentId, amount: line.amount, sourceKey: `${key}:wallet` },
      );
    }
    await appendRows(tx, rows);
  }
  await publish(tx, {
    organisationId: bug.organisationId,
    type: "issue.updated",
    actorAgentId: null,
    bugId: bug.id,
    projectId: bug.projectId,
    payload: { issueId: bug.id, issueNumber: bug.number, payoutReleased: true, paid: plan?.lines.length ?? 0, ...facts },
  });
  return true;
}