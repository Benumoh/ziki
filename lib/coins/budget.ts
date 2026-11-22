import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { REWARD_ZIK_MIN } from "@/lib/points/rules";
import { CoinError, appendRows, assertAmount, assertCanSpend, escrowBalance, lockBug, lockUser, zikOf, type Tx } from "./ledger";
import { MAX_FUND_ZIK, dollarsToZiks, splitByWeight } from "./math";

/**
 * Project budgets (#project-budget). An owner puts Ziks behind a whole project instead of behind each issue. While the
 * project has a budget switched on, an issue is only awarded when the budget covers its price, and awarding it moves the
 * price from the budget into that issue's escrow (a reserve), where releasing and refunding work as they always have.
 * Whatever the budget still holds goes back to the people who funded it, when they take it or when the project goes idle.
 *
 * The price of an issue is its estimate once three estimates are in, or a price its owner set above that (the owner's
 * price counts even before then). A project with no budget works as before: free, or funded issue by issue.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** How many agent estimates an issue needs before it has a price (an owner's price replaces them). */
export const MIN_ESTIMATES_TO_AWARD = 3;
/** The owner is warned once the budget can't cover this many of the next issues waiting to be awarded. */
export const LOW_BUDGET_ISSUES = 3;
/** A budget with no unfinished issue for this long goes back to the people who funded it. */
export const IDLE_RETURN_DAYS = 30;

export async function lockProject(tx: Tx, projectId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
}

/** The Ziks the project's budget holds, not yet reserved for an issue. */
export async function budgetBalance(db: Db, projectId: string): Promise<number> {
  const sum = await db.coinEntry.aggregate({ where: { account: "budget", projectId }, _sum: { amount: true } });
  return zikOf(sum._sum.amount);
}

export type PricedIssue = { reward: Prisma.Decimal | number | string; rewardEstimateCount: number; rewardOverrideZik: number | null };

/** What an issue costs the budget, in Ziks, or null while it has no price (fewer than three estimates and no price from its owner). */
export function issuePriceZik(issue: PricedIssue): number | null {
  const estimate = issue.rewardEstimateCount >= MIN_ESTIMATES_TO_AWARD ? dollarsToZiks(Number(issue.reward)) : 0;
  const price = Math.max(estimate, issue.rewardOverrideZik ?? 0);
  return price > 0 ? price : null;
}

/** Whether this person may fund and take back a project's budget, and set prices: an owner or admin of its organisation. */
export async function canManageBudget(userId: string, organisationId: string): Promise<boolean> {
  const membership = await prisma.membership.findUnique({
    where: { organisationId_userId: { organisationId, userId } },
    select: { role: true },
  });
  return membership?.role === "owner" || membership?.role === "admin";
}

async function projectFor(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, organisationId: true, archivedAt: true } });
  if (!project) throw new CoinError("not_found", "That project doesn't exist.");
  return project;
}

/**
 * Moves Ziks from the owner's wallet into the project's budget, and switches the budget on. `requestId` makes a double
 * click or a retry fund once. Bought Ziks are spent before earned ones, because the wallet's withdrawable part is
 * only what is earned and still there (ledger.ts withdrawableOf).
 */
export async function fundBudget(userId: string, projectId: string, amount: number, requestId: string): Promise<{ funded: boolean; balance: number }> {
  assertAmount(amount);
  if (amount > MAX_FUND_ZIK) throw new CoinError("invalid_amount", `Fund at most ${MAX_FUND_ZIK.toLocaleString("en-US")} Ziks at a time.`);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new CoinError("invalid_amount", "Reload the page and try again.");
  const project = await projectFor(projectId);
  if (project.archivedAt) throw new CoinError("closed", "This project is archived, so it can't take a budget.");
  if (!(await canManageBudget(userId, project.organisationId))) throw new CoinError("not_allowed", "Only an owner or admin can fund the project's budget.");

  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    await lockProject(tx, projectId);
    const key = `budget-fund:${projectId}:${userId}:${requestId}`;
    if (await tx.coinEntry.findUnique({ where: { sourceKey: `${key}:wallet` }, select: { id: true } })) {
      return { funded: false, balance: await budgetBalance(tx, projectId) };
    }
    await assertCanSpend(tx, userId, amount);
    await appendRows(tx, [
      { account: "wallet", userId, projectId, kind: "fund_budget", amount: -amount, sourceKey: `${key}:wallet` },
      { account: "budget", projectId, kind: "fund_budget", amount, sourceKey: `${key}:budget` },
    ]);
    // New money clears any warning; the next one is judged from this balance.
    await tx.project.update({ where: { id: projectId }, data: { budgetEnabled: true, budgetAlert: null } });
    return { funded: true, balance: await budgetBalance(tx, projectId) };
  });
}

/**
 * Gives what the budget still holds back to the people who funded it, in proportion to what each put in. Used when the
 * owner takes it back and when an idle or archived project's budget is returned. Runs in the caller's transaction.
 */
export async function returnUnusedBudget(tx: Tx, projectId: string): Promise<number> {
  await lockProject(tx, projectId);
  const balance = await budgetBalance(tx, projectId);
  if (balance <= 0) return 0;
  const rows = await tx.coinEntry.groupBy({
    by: ["userId"],
    where: { account: "wallet", projectId, kind: { in: ["fund_budget", "budget_return"] } },
    _sum: { amount: true },
  });
  // Funding is negative on the wallet, a return positive: what is still theirs behind the project.
  const funders = new Map(rows.filter((row) => row.userId).map((row) => [row.userId as string, -zikOf(row._sum.amount)]));
  const shares = splitByWeight(balance, funders);
  if (shares.size === 0) return 0;
  const generation = await tx.coinEntry.count({ where: { account: "budget", projectId, kind: "budget_return" } });
  const out: Parameters<typeof appendRows>[1] = [];
  for (const [userId, share] of shares) {
    const key = `budget-return:${projectId}:${generation}:${userId}`;
    out.push(
      { account: "budget", projectId, kind: "budget_return", amount: -share, sourceKey: `${key}:budget` },
      { account: "wallet", userId, projectId, kind: "budget_return", amount: share, sourceKey: `${key}:wallet` },
    );
  }
  await appendRows(tx, out);
  return [...shares.values()].reduce((sum, share) => sum + share, 0);
}

const PAUSED_MESSAGE = "This project's budget is paused by its owner, so no new issue is awarded until it is resumed.";

/**
 * Pauses or resumes a project's budget: while paused no new issue is awarded or offered and no offer can be accepted,
 * the money stays where it is, and work already under way carries on. Only an owner or admin may.
 */
export async function setBudgetPaused(userId: string, projectId: string, paused: boolean): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { organisationId: true, budgetEnabled: true } });
  if (!project) throw new CoinError("not_found", "That project doesn't exist.");
  if (!(await canManageBudget(userId, project.organisationId))) throw new CoinError("not_allowed", "Only an owner or admin can pause the budget.");
  if (!project.budgetEnabled) throw new CoinError("invalid_amount", "This project has no budget to pause yet.");
  await prisma.project.update({ where: { id: projectId }, data: { budgetPausedAt: paused ? new Date() : null } });
}

/** The owner takes back what the budget hasn't reserved. Ziks already reserved for awarded issues stay with them. */
export async function takeBackBudget(userId: string, projectId: string): Promise<number> {
  const project = await projectFor(projectId);
  if (!(await canManageBudget(userId, project.organisationId))) throw new CoinError("not_allowed", "Only an owner or admin can take the budget back.");
  const returned = await prisma.$transaction((tx) => returnUnusedBudget(tx, projectId));
  if (returned === 0) throw new CoinError("invalid_amount", "There is nothing left in the budget to take back.");
  return returned;
}

/** Why an issue can't be awarded from its project's budget right now, or null when it can (or the project has no budget). */
export async function budgetBlock(db: Db, bugId: string): Promise<{ code: "not_priced" | "out_of_funds" | "paused"; message: string } | null> {
  const bug = await db.bug.findUnique({
    where: { id: bugId },
    select: { projectId: true, reward: true, rewardEstimateCount: true, rewardOverrideZik: true, project: { select: { budgetEnabled: true, budgetPausedAt: true } } },
  });
  if (!bug || !bug.project.budgetEnabled) return null;
  if (bug.project.budgetPausedAt) return { code: "paused", message: PAUSED_MESSAGE };
  const price = issuePriceZik(bug);
  if (price === null) {
    return { code: "not_priced", message: `This issue has no price yet: it needs ${MIN_ESTIMATES_TO_AWARD} estimates, or a price from its owner, before it can be awarded.` };
  }
  const need = price - (await escrowBalance(db, bugId));
  if (need <= 0) return null;
  const available = await budgetBalance(db, bug.projectId);
  if (available < need) {
    return { code: "out_of_funds", message: `This project has no funds left for this issue: it needs ${need.toLocaleString("en-US")} Ziks and the budget has ${available.toLocaleString("en-US")}. Its owner can add to the budget.` };
  }
  return null;
}

/**
 * Of these issues, the ones the project's budget can't pay for right now. Empty for a project without a budget. One
 * read for a whole list, for the work feed. Each issue is judged on its own against the whole budget.
 */
export async function unaffordableIssueIds(db: Db, projectId: string, bugIds: string[]): Promise<Set<string>> {
  if (bugIds.length === 0) return new Set();
  const project = await db.project.findUnique({ where: { id: projectId }, select: { budgetEnabled: true, budgetPausedAt: true } });
  if (!project?.budgetEnabled) return new Set();
  // Paused: nothing new is awarded, so every one of them is blocked.
  if (project.budgetPausedAt) return new Set(bugIds);
  const [bugs, held, available] = await Promise.all([
    db.bug.findMany({ where: { id: { in: bugIds } }, select: { id: true, reward: true, rewardEstimateCount: true, rewardOverrideZik: true } }),
    db.coinEntry.groupBy({ by: ["bugId"], where: { account: "escrow", bugId: { in: bugIds } }, _sum: { amount: true } }),
    budgetBalance(db, projectId),
  ]);
  const heldBy = new Map(held.map((row) => [row.bugId, zikOf(row._sum.amount)]));
  const blocked = new Set<string>();
  for (const bug of bugs) {
    const price = issuePriceZik(bug);
    if (price === null || price - (heldBy.get(bug.id) ?? 0) > available) blocked.add(bug.id);
  }
  return blocked;
}

/**
 * Reserves an issue's price from its project's budget into the issue's escrow, when it is awarded. Only what the issue
 * doesn't already hold is taken, so giving the work back and awarding it again takes nothing twice. A project without a
 * budget reserves nothing. Throws CoinError `out_of_funds` before writing anything when the budget can't cover it.
 * The caller holds the issue's lock; the project's is taken here (always the issue's first, then the project's).
 */
export async function reserveForIssue(tx: Tx, bugId: string): Promise<number> {
  const bug = await tx.bug.findUniqueOrThrow({
    where: { id: bugId },
    select: { projectId: true, reward: true, rewardEstimateCount: true, rewardOverrideZik: true, project: { select: { budgetEnabled: true, budgetPausedAt: true } } },
  });
  if (!bug.project.budgetEnabled) return 0;
  // Taking the work reserves its price, and that is new work: a paused budget starts none.
  if (bug.project.budgetPausedAt) throw new CoinError("paused", PAUSED_MESSAGE);
  const price = issuePriceZik(bug);
  if (price === null) throw new CoinError("not_priced", `This issue has no price yet: it needs ${MIN_ESTIMATES_TO_AWARD} estimates, or a price from its owner.`);
  await lockProject(tx, bug.projectId);
  const need = price - (await escrowBalance(tx, bugId));
  if (need <= 0) return 0;
  const available = await budgetBalance(tx, bug.projectId);
  if (available < need) {
    throw new CoinError("out_of_funds", `This project has no funds left for this issue: it needs ${need.toLocaleString("en-US")} Ziks and the budget has ${available.toLocaleString("en-US")}. Its owner can add to the budget.`);
  }
  const generation = await tx.coinEntry.count({ where: { account: "escrow", bugId, kind: "reserve" } });
  const key = `reserve:${bugId}:${generation}`;
  await appendRows(tx, [
    { account: "budget", projectId: bug.projectId, bugId, kind: "reserve", amount: -need, sourceKey: `${key}:budget` },
    { account: "escrow", bugId, projectId: bug.projectId, kind: "reserve", amount: need, sourceKey: `${key}:escrow` },
  ]);
  return need;
}

/**
 * The owner sets a price for an issue above what it costs now. It only goes up. If the issue is already awarded, the
 * difference is reserved from the budget at once, and a raise the budget can't cover is refused.
 */
export async function raiseIssuePrice(userId: string, bugId: string, zik: number): Promise<number> {
  if (!Number.isSafeInteger(zik) || zik < REWARD_ZIK_MIN) throw new CoinError("invalid_amount", `Enter a whole number of Ziks, at least ${REWARD_ZIK_MIN}.`);
  if (zik > MAX_FUND_ZIK) throw new CoinError("invalid_amount", `A price can be at most ${MAX_FUND_ZIK.toLocaleString("en-US")} Ziks.`);
  const issue = await prisma.bug.findUnique({ where: { id: bugId }, select: { organisationId: true, isDeleted: true, status: true, payoutReleasedAt: true } });
  if (!issue || issue.isDeleted) throw new CoinError("not_found", "That issue doesn't exist.");
  if (!(await canManageBudget(userId, issue.organisationId))) throw new CoinError("not_allowed", "Only an owner or admin can set an issue's price.");
  if (issue.status === "closed" || issue.payoutReleasedAt) throw new CoinError("closed", "This issue is finished, so its price can't change.");

  return prisma.$transaction(async (tx) => {
    await lockBug(tx, bugId);
    const fresh = await tx.bug.findUniqueOrThrow({
      where: { id: bugId },
      select: { reward: true, rewardEstimateCount: true, rewardOverrideZik: true, assigneeId: true, project: { select: { budgetEnabled: true } } },
    });
    const current = issuePriceZik(fresh) ?? 0;
    if (zik <= current) throw new CoinError("invalid_amount", `A price can only go up. It is ${current.toLocaleString("en-US")} Ziks now.`);
    await tx.bug.update({ where: { id: bugId }, data: { rewardOverrideZik: zik } });
    // Held by someone: the extra is reserved now, so the agent is promised what it was told.
    if (fresh.assigneeId && fresh.project.budgetEnabled) await reserveForIssue(tx, bugId);
    return zik;
  });
}
