import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { REWARD_ZIK_MIN } from "@/lib/coins/price-rules";
import { CoinError, appendRows, assertAmount, assertCanSpend, escrowBalance, lockBug, lockUser, zikOf, type Tx } from "./ledger";
import { MAX_FUND_ZIK, dollarsToZiks, splitByWeight } from "./math";
import { isPayer } from "./payers";

/**
 * Project budgets and issue prices (#project-budget, #price-lock). Every issue is paid in Ziks, so an issue is only
 * awarded once its price is locked and the Ziks for it are held. The owner puts Ziks behind the whole project (its
 * budget) or behind one issue at a time; either way the price moves into that issue's escrow, where releasing and
 * refunding work as they always have. Whatever the budget still holds goes back to the people who funded it, when they
 * take it or when the project goes idle.
 *
 * Agents price issues. An issue's price is the average of its estimates once three are in; it settles when a minute
 * passes with no new estimate, and locks when it is funded: at once, from the project's budget, when the budget covers
 * it, or when the owner funds it. A locked price takes no more estimates. Once it has settled, the owner may raise it
 * (never lower it) to have the issue picked up sooner; the difference is funded like the rest.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** How many agent estimates an issue needs before it has a price. */
export const MIN_ESTIMATES_TO_AWARD = 3;
/** After the third estimate, the price settles once this long passes with no new estimate. */
export const PRICE_SETTLE_SECONDS = 60;
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

/** Whether anyone has ever put Ziks into this project's budget. */
export async function hasBudget(db: Db, projectId: string): Promise<boolean> {
  const funded = await db.coinEntry.findFirst({ where: { account: "budget", projectId, kind: "fund_budget" }, select: { id: true } });
  return funded !== null;
}

export type PricedIssue = {
  reward: Prisma.Decimal | number | string;
  rewardEstimateCount: number;
  rewardOverrideZik: number | null;
  /** Ziki's own estimate (#ziki-estimate), once it gave one. */
  zikiEstimateZik: number | null;
};

/**
 * The issue's price in Ziks: the average of its estimates, Ziki's own included when it gave one (it counts as one
 * estimate), or the higher price its owner raised it to. Null while fewer than three agents have estimated it and Ziki
 * hasn't yet (an owner's price never counts before the issue is priced).
 */
export function issuePriceZik(issue: PricedIssue): number | null {
  const agents = issue.rewardEstimateCount;
  const agentsAverage = dollarsToZiks(Number(issue.reward));
  let estimate: number;
  if (issue.zikiEstimateZik !== null && issue.zikiEstimateZik > 0) {
    estimate = Math.round((agentsAverage * agents + issue.zikiEstimateZik) / (agents + 1));
  } else if (agents >= MIN_ESTIMATES_TO_AWARD) {
    estimate = agentsAverage;
  } else {
    return null;
  }
  const price = Math.max(estimate, issue.rewardOverrideZik ?? 0);
  return price > 0 ? price : null;
}

/** The Prisma `where` for issues that have a price from estimates: three agents, or Ziki's own. */
export const PRICED_WHERE = { OR: [{ rewardEstimateCount: { gte: MIN_ESTIMATES_TO_AWARD } }, { zikiEstimateZik: { not: null } }] } satisfies Prisma.BugWhereInput;

export type PriceInput = PricedIssue & { rewardEstimatedAt: Date | null; rewardFixedAt: Date | null; lockedPriceZik: number | null };

/** The price to show: the one it was locked at, once locked by funding, else what the estimates make it. */
export function currentPriceZik(issue: PricedIssue & { rewardFixedAt: Date | null; lockedPriceZik: number | null }): number | null {
  if (issue.rewardFixedAt && issue.lockedPriceZik !== null && issue.lockedPriceZik > 0) return issue.lockedPriceZik;
  return issuePriceZik(issue);
}

/**
 * Where an issue's price stands:
 * - `estimating`: fewer than three estimates;
 * - `settling`: three or more, but the last came in less than a minute ago, so more may follow;
 * - `settled`: no estimate for a minute, so it can be funded and locked;
 * - `locked`: funded (or at 15 estimates); it takes no more estimates.
 */
export type PriceStage =
  | { stage: "estimating"; have: number; need: number }
  | { stage: "settling"; price: number; settlesAt: Date }
  | { stage: "settled"; price: number }
  | { stage: "locked"; price: number };

export const SETTLE_FIELDS = { reward: true, rewardEstimateCount: true, rewardOverrideZik: true, zikiEstimateZik: true, rewardEstimatedAt: true, rewardFixedAt: true, lockedPriceZik: true } as const;

export function priceStage(issue: PriceInput, now: Date = new Date()): PriceStage {
  // Locked by funding: the price it was locked at, as stored, whatever the estimates now work out to.
  if (issue.rewardFixedAt && issue.lockedPriceZik !== null && issue.lockedPriceZik > 0) return { stage: "locked", price: issue.lockedPriceZik };
  const price = currentPriceZik(issue);
  if (price === null) return { stage: "estimating", have: Math.min(issue.rewardEstimateCount, MIN_ESTIMATES_TO_AWARD), need: MIN_ESTIMATES_TO_AWARD };
  if (issue.rewardFixedAt) return { stage: "locked", price };
  const settlesAt = new Date((issue.rewardEstimatedAt?.getTime() ?? 0) + PRICE_SETTLE_SECONDS * 1000);
  if (settlesAt > now) return { stage: "settling", price, settlesAt };
  return { stage: "settled", price };
}

const PAUSED_MESSAGE = "This project's budget is paused by its owner, so no new issue is awarded until it is resumed.";

/** Why an issue without a settled price can't be funded or awarded yet. */
export function unpricedMessage(stage: Extract<PriceStage, { stage: "estimating" | "settling" }>): string {
  return stage.stage === "estimating"
    ? `This issue has no price yet: ${stage.have} of ${stage.need} agents have estimated it.`
    : "Agents are still estimating this issue. Its price settles a minute after the last estimate.";
}

function waitingForFundsMessage(need: number, available: number): string {
  return `This issue is waiting for funding: it needs ${need.toLocaleString("en-US")} Ziks and the project's budget has ${available.toLocaleString("en-US")}. Its owner can fund it.`;
}

/** Refused because only payers (#payers) may: owners, and admins an owner lets fund issues. */
function payersOnly(action: string): CoinError {
  return new CoinError("not_allowed", `Only an owner, or an admin an owner lets fund issues, can ${action}.`);
}

async function projectFor(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, organisationId: true, archivedAt: true } });
  if (!project) throw new CoinError("not_found", "That project doesn't exist.");
  return project;
}

/**
 * Moves Ziks from the owner's wallet into the project's budget. `requestId` makes a double click or a retry fund once.
 * Bought Ziks are spent before earned ones, because the wallet's withdrawable part is only what is earned and still
 * there (ledger.ts withdrawableOf). Settled prices the new money covers are locked by the caller (lockSettledPrices).
 */
export async function fundBudget(userId: string, projectId: string, amount: number, requestId: string): Promise<{ funded: boolean; balance: number }> {
  assertAmount(amount);
  if (amount > MAX_FUND_ZIK) throw new CoinError("invalid_amount", `Fund at most ${MAX_FUND_ZIK.toLocaleString("en-US")} Ziks at a time.`);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new CoinError("invalid_amount", "Reload the page and try again.");
  const project = await projectFor(projectId);
  if (project.archivedAt) throw new CoinError("closed", "This project is archived, so it can't take a budget.");
  if (!(await isPayer(prisma, userId, project.organisationId))) throw payersOnly("fund the project's budget");

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
    await tx.project.update({ where: { id: projectId }, data: { budgetAlert: null } });
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

/**
 * Pauses or resumes a project's budget: while paused no new issue is awarded or offered and no offer can be accepted,
 * the money stays where it is, and work already under way carries on. Only a payer (#payers) may.
 */
export async function setBudgetPaused(userId: string, projectId: string, paused: boolean): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { organisationId: true } });
  if (!project) throw new CoinError("not_found", "That project doesn't exist.");
  if (!(await isPayer(prisma, userId, project.organisationId))) throw payersOnly("pause the budget");
  if (!(await hasBudget(prisma, projectId))) throw new CoinError("invalid_amount", "This project has no budget to pause yet.");
  await prisma.project.update({ where: { id: projectId }, data: { budgetPausedAt: paused ? new Date() : null } });
}

/** The owner takes back what the budget hasn't reserved. Ziks already reserved for issues stay with them. */
export async function takeBackBudget(userId: string, projectId: string): Promise<number> {
  const project = await projectFor(projectId);
  if (!(await isPayer(prisma, userId, project.organisationId))) throw payersOnly("take the budget back");
  const returned = await prisma.$transaction((tx) => returnUnusedBudget(tx, projectId));
  if (returned === 0) throw new CoinError("invalid_amount", "There is nothing left in the budget to take back.");
  return returned;
}

type BlockCode = "not_priced" | "out_of_funds" | "paused";

/** Why an issue can't be awarded right now (no settled price, no Ziks for it, a paused budget), or null when it can. */
export async function budgetBlock(db: Db, bugId: string, now: Date = new Date()): Promise<{ code: BlockCode; message: string } | null> {
  const bug = await db.bug.findUnique({
    where: { id: bugId },
    select: { projectId: true, ...SETTLE_FIELDS, project: { select: { budgetPausedAt: true, solo: true } } },
  });
  // A Solo project (#solo) has no prices or funding: nothing blocks its awards.
  if (!bug || bug.project.solo) return null;
  if (bug.project.budgetPausedAt) return { code: "paused", message: PAUSED_MESSAGE };
  const stage = priceStage(bug, now);
  if (stage.stage === "estimating" || stage.stage === "settling") return { code: "not_priced", message: unpricedMessage(stage) };
  const need = stage.price - (await escrowBalance(db, bugId));
  if (need <= 0) return null;
  const available = await budgetBalance(db, bug.projectId);
  return available < need ? { code: "out_of_funds", message: waitingForFundsMessage(need, available) } : null;
}

/**
 * Of these issues, the ones that can't be awarded right now: no settled price, or no Ziks for it on the issue or in the
 * project's budget. One read for a whole list, for the work feed. Each issue is judged on its own against the whole budget.
 */
export async function unaffordableIssueIds(db: Db, projectId: string, bugIds: string[], now: Date = new Date()): Promise<Set<string>> {
  if (bugIds.length === 0) return new Set();
  const project = await db.project.findUnique({ where: { id: projectId }, select: { budgetPausedAt: true, solo: true } });
  // A Solo project (#solo) has no prices or funding: none of them is blocked.
  if (project?.solo) return new Set();
  // Paused: nothing new is awarded, so every one of them is blocked.
  if (!project || project.budgetPausedAt) return new Set(bugIds);
  const [bugs, held, available] = await Promise.all([
    db.bug.findMany({ where: { id: { in: bugIds } }, select: { id: true, ...SETTLE_FIELDS } }),
    db.coinEntry.groupBy({ by: ["bugId"], where: { account: "escrow", bugId: { in: bugIds } }, _sum: { amount: true } }),
    budgetBalance(db, projectId),
  ]);
  const heldBy = new Map(held.map((row) => [row.bugId, zikOf(row._sum.amount)]));
  const blocked = new Set<string>();
  for (const bug of bugs) {
    const stage = priceStage(bug, now);
    if (stage.stage === "estimating" || stage.stage === "settling" || stage.price - (heldBy.get(bug.id) ?? 0) > available) blocked.add(bug.id);
  }
  return blocked;
}

export type LockResult =
  | { locked: true; reserved: number }
  | { locked: false; code: BlockCode; message: string };

/**
 * Locks an issue's settled price: from what the issue already holds, else by reserving the rest from the project's
 * budget. Nothing is written unless it locks. Only what the issue doesn't already hold is taken, so giving the work back
 * and awarding it again takes nothing twice. The caller holds the issue's lock; the project's is taken here (always the
 * issue's first, then the project's).
 */
export async function lockPrice(tx: Tx, bugId: string, now: Date = new Date()): Promise<LockResult> {
  const bug = await tx.bug.findUniqueOrThrow({
    where: { id: bugId },
    select: { projectId: true, ...SETTLE_FIELDS, project: { select: { budgetPausedAt: true } } },
  });
  const stage = priceStage(bug, now);
  if (stage.stage === "estimating" || stage.stage === "settling") return { locked: false, code: "not_priced", message: unpricedMessage(stage) };
  let need = stage.price - (await escrowBalance(tx, bugId));
  if (need > 0) {
    // A paused budget is the owner's own choice: it reserves nothing until resumed.
    if (bug.project.budgetPausedAt) return { locked: false, code: "paused", message: PAUSED_MESSAGE };
    await lockProject(tx, bug.projectId);
    const available = await budgetBalance(tx, bug.projectId);
    if (available < need) return { locked: false, code: "out_of_funds", message: waitingForFundsMessage(need, available) };
    const generation = await tx.coinEntry.count({ where: { account: "escrow", bugId, kind: "reserve" } });
    const key = `reserve:${bugId}:${generation}`;
    await appendRows(tx, [
      { account: "budget", projectId: bug.projectId, bugId, kind: "reserve", amount: -need, sourceKey: `${key}:budget` },
      { account: "escrow", bugId, projectId: bug.projectId, kind: "reserve", amount: need, sourceKey: `${key}:escrow` },
    ]);
  } else {
    need = 0;
  }
  // The price is kept as it is now, so later rounding or estimates never move it away from what is held.
  if (!bug.rewardFixedAt || bug.lockedPriceZik !== stage.price) {
    await tx.bug.update({ where: { id: bugId }, data: { rewardFixedAt: bug.rewardFixedAt ?? now, lockedPriceZik: stage.price } });
  }
  return { locked: true, reserved: need };
}

/**
 * The owner raises an issue's settled price (#price-lock), to have it picked up sooner. It only goes up, and only once
 * agents have priced the issue. The difference is reserved from the budget at once when the budget covers it; if
 * someone already holds the issue it must be (they were promised the price), so a raise the budget can't cover is
 * refused. Otherwise the issue waits for the difference to be funded.
 */
export async function raiseIssuePrice(userId: string, bugId: string, zik: number): Promise<number> {
  if (!Number.isSafeInteger(zik) || zik < REWARD_ZIK_MIN) throw new CoinError("invalid_amount", `Enter a whole number of Ziks, at least ${REWARD_ZIK_MIN}.`);
  if (zik > MAX_FUND_ZIK) throw new CoinError("invalid_amount", `A price can be at most ${MAX_FUND_ZIK.toLocaleString("en-US")} Ziks.`);
  const issue = await prisma.bug.findUnique({ where: { id: bugId }, select: { organisationId: true, isDeleted: true, status: true, payoutReleasedAt: true } });
  if (!issue || issue.isDeleted) throw new CoinError("not_found", "That issue doesn't exist.");
  if (!(await isPayer(prisma, userId, issue.organisationId))) throw payersOnly("raise an issue's price");
  if (issue.status === "closed" || issue.status === "resolved" || issue.payoutReleasedAt) throw new CoinError("closed", "This issue is finished, so its price can't change.");

  return prisma.$transaction(async (tx) => {
    await lockBug(tx, bugId);
    const fresh = await tx.bug.findUniqueOrThrow({ where: { id: bugId }, select: { ...SETTLE_FIELDS, assigneeId: true } });
    const stage = priceStage(fresh);
    if (stage.stage === "estimating" || stage.stage === "settling") {
      throw new CoinError("not_priced", "Agents price an issue first. You can raise its price once their price has settled.");
    }
    if (zik <= stage.price) throw new CoinError("invalid_amount", `A price can only go up. It is ${stage.price.toLocaleString("en-US")} Ziks now.`);
    // A locked price moves to the raised one; the difference is funded like the rest.
    await tx.bug.update({ where: { id: bugId }, data: { rewardOverrideZik: zik, ...(stage.stage === "locked" ? { lockedPriceZik: zik } : {}) } });
    const locked = await lockPrice(tx, bugId);
    // Held by someone: the extra is reserved now, or the raise is refused (and rolled back with this transaction).
    if (fresh.assigneeId && !locked.locked) throw new CoinError(locked.code, locked.message);
    return zik;
  });
}

/**
 * When an issue is awarded (or an offer on it accepted): its price must be settled and held, so it is locked now if it
 * isn't yet. A paused budget starts no new work. Throws CoinError before writing anything when it can't.
 */
export async function reserveForIssue(tx: Tx, bugId: string): Promise<number> {
  const paused = await tx.bug.findUniqueOrThrow({ where: { id: bugId }, select: { project: { select: { budgetPausedAt: true, solo: true } } } });
  // A Solo project (#solo) has no prices or funding: nothing to reserve.
  if (paused.project.solo) return 0;
  if (paused.project.budgetPausedAt) throw new CoinError("paused", PAUSED_MESSAGE);
  const result = await lockPrice(tx, bugId);
  if (!result.locked) throw new CoinError(result.code, result.message);
  return result.reserved;
}
