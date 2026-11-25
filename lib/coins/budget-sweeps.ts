import { prisma } from "@/lib/prisma";
import { notifyLater } from "@/lib/notify";
import { IDLE_RETURN_DAYS, LOW_BUDGET_ISSUES, PRICED_WHERE, PRICE_SETTLE_SECONDS, SETTLE_FIELDS, budgetBalance, hasBudget, lockPrice, priceStage, returnUnusedBudget } from "./budget";
import { lockBug, zikOf } from "./ledger";
import { payerIds } from "./payers";

/**
 * What runs around project budgets and prices (#project-budget, #price-lock): locking settled prices the budget covers,
 * warning the owners when issues are waiting for funding, and giving a budget back when its project is archived or has
 * had nothing to do for a while. All part of the cron sweep (lib/cron/runner.ts) and safe to run again: a lock happens
 * once, a warning is only sent when the state changes, and a return only moves what is left.
 */

export type BudgetAlertState = "low" | "empty" | null;

/** Statuses whose price can still be locked: the work isn't finished. */
const UNFINISHED = ["open", "in_progress", "done", "merge"] as const;

/**
 * Judges the budget against the issues waiting to be awarded (open, nobody holds them, priced, not yet funded), oldest
 * first. "Empty" when it can't cover the next one (it waits for funding), "low" when it can't cover the next
 * LOW_BUDGET_ISSUES, otherwise fine. Pure, so it can be tested without a database.
 */
export function budgetAlertState(available: number, needs: number[]): BudgetAlertState {
  const waiting = needs.filter((need) => need > 0);
  if (waiting.length === 0) return null;
  if (available < waiting[0]) return "empty";
  if (available < waiting.slice(0, LOW_BUDGET_ISSUES).reduce((sum, need) => sum + need, 0)) return "low";
  return null;
}

/**
 * Locks every settled price that can be locked now: the issue already holds its price, or the project's budget covers
 * it. Oldest issues first, so the budget pays for work in the order it came in. Only issues whose project has Ziks in
 * its budget, or that hold Ziks themselves, are tried. Returns how many it locked.
 */
export async function lockSettledPrices(scope: { projectId?: string } = {}, now: Date = new Date(), limit = 500): Promise<number> {
  const candidates = await prisma.bug.findMany({
    where: {
      ...(scope.projectId ? { projectId: scope.projectId } : {}),
      isDeleted: false,
      payoutReleasedAt: null,
      rewardFixedAt: null,
      ...PRICED_WHERE,
      rewardEstimatedAt: { lte: new Date(now.getTime() - PRICE_SETTLE_SECONDS * 1000) },
      status: { in: [...UNFINISHED] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, projectId: true },
  });
  if (candidates.length === 0) return 0;
  const [budgets, held] = await Promise.all([
    prisma.coinEntry.groupBy({ by: ["projectId"], where: { account: "budget", projectId: { in: [...new Set(candidates.map((bug) => bug.projectId))] } }, _sum: { amount: true } }),
    prisma.coinEntry.groupBy({ by: ["bugId"], where: { account: "escrow", bugId: { in: candidates.map((bug) => bug.id) } }, _sum: { amount: true } }),
  ]);
  const funded = new Set(budgets.filter((row) => zikOf(row._sum.amount) > 0).map((row) => row.projectId));
  const holding = new Set(held.filter((row) => zikOf(row._sum.amount) > 0).map((row) => row.bugId));
  let locked = 0;
  for (const bug of candidates) {
    if (!funded.has(bug.projectId) && !holding.has(bug.id)) continue;
    const result = await prisma.$transaction(async (tx) => {
      await lockBug(tx, bug.id);
      return lockPrice(tx, bug.id, now);
    });
    if (result.locked) locked += 1;
  }
  return locked;
}

/** Judges one project's budget and, when the state has changed to a worse one, tells its payers (#payers) once. */
export async function refreshBudgetAlert(projectId: string, now: Date = new Date()): Promise<BudgetAlertState> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, slug: true, organisationId: true, budgetPausedAt: true, budgetAlert: true, archivedAt: true, organisation: { select: { slug: true } } },
  });
  if (!project) return null;
  let state: BudgetAlertState = null;
  let available = 0;
  let funded = false;
  // A paused budget is the owner's own choice, so it warns about nothing.
  if (!project.budgetPausedAt && !project.archivedAt) {
    const waiting = await prisma.bug.findMany({
      where: { projectId, isDeleted: false, substatus: "open", assigneeId: null, ...PRICED_WHERE },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 20,
      select: { id: true, ...SETTLE_FIELDS },
    });
    const held = await prisma.coinEntry.groupBy({ by: ["bugId"], where: { account: "escrow", bugId: { in: waiting.map((bug) => bug.id) } }, _sum: { amount: true } });
    const heldBy = new Map(held.map((row) => [row.bugId, zikOf(row._sum.amount)]));
    const needs = waiting.flatMap((bug) => {
      const stage = priceStage(bug, now);
      // Only a settled price is waiting for money; one still settling may change.
      return stage.stage === "settled" || stage.stage === "locked" ? [Math.max(0, stage.price - (heldBy.get(bug.id) ?? 0))] : [];
    });
    [available, funded] = await Promise.all([budgetBalance(prisma, projectId), hasBudget(prisma, projectId)]);
    state = budgetAlertState(available, needs);
  }
  if (state === project.budgetAlert) return state;
  await prisma.project.update({ where: { id: projectId }, data: { budgetAlert: state } });
  if (state) {
    // Told to the people who pay (#payers), not every admin.
    const owners = (await payerIds(prisma, project.organisationId)).map((userId) => ({ userId }));
    const budgetPath = `/${project.organisation.slug}/${project.slug}/budget`;
    const subject = !funded ? `Work in ${project.name} is waiting for funding` : state === "empty" ? `${project.name} is out of funds` : `${project.name}'s budget is running low`;
    const message = !funded
      ? `Agents have priced work in ${project.name}. It starts once it is funded: fund the project once and every issue is paid from it, and you'll be told when it runs low.`
      : state === "empty"
        ? `The budget for ${project.name} can't cover the next issue waiting to be awarded (${available.toLocaleString("en-US")} Ziks left), so it waits for funding. Add Ziks to keep work going.`
        : `The budget for ${project.name} (${available.toLocaleString("en-US")} Ziks left) can't cover the next ${LOW_BUDGET_ISSUES} issues waiting to be awarded. Work continues for now; add Ziks to keep it going.`;
    notifyLater(
      ...owners.map((owner) => ({
        kind: "budget_alert" as const,
        actorId: null,
        actorName: "Ziki",
        recipientId: owner.userId,
        organisationId: project.organisationId,
        subject,
        message,
        budgetPath,
      })),
    );
  }
  return state;
}

/**
 * Locks the settled prices budgets can cover, then for each project with a budget or with priced work: warns its
 * owners when work is waiting for funding or the budget is low, and returns the budget to the people who funded it
 * when the project is archived, or has had no unfinished issue and no activity for IDLE_RETURN_DAYS.
 */
export async function sweepProjectBudgets(now: Date = new Date()): Promise<{ checked: number; returned: number; locked: number }> {
  const locked = await lockSettledPrices({}, now);
  const [withBudget, withPricedWork, alerted] = await Promise.all([
    prisma.coinEntry.groupBy({ by: ["projectId"], where: { account: "budget", projectId: { not: null } }, _sum: { amount: true } }),
    prisma.bug.groupBy({ by: ["projectId"], where: { isDeleted: false, substatus: "open", assigneeId: null, ...PRICED_WHERE } }),
    // A project warned before is judged again, so its warning clears once the work is funded or gone.
    prisma.project.findMany({ where: { budgetAlert: { not: null } }, select: { id: true } }),
  ]);
  const balances = new Map(withBudget.flatMap((row) => (row.projectId ? [[row.projectId, zikOf(row._sum.amount)] as const] : [])));
  const projectIds = [...new Set([...balances.keys(), ...withPricedWork.map((row) => row.projectId), ...alerted.map((project) => project.id)])];
  const projects = await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, archivedAt: true } });
  const idleBefore = new Date(now.getTime() - IDLE_RETURN_DAYS * 24 * 60 * 60 * 1000);
  let returned = 0;
  for (const project of projects) {
    if ((balances.get(project.id) ?? 0) > 0) {
      const idle = project.archivedAt ? true : await isIdle(project.id, idleBefore);
      if (idle) returned += await prisma.$transaction((tx) => returnUnusedBudget(tx, project.id));
    }
    await refreshBudgetAlert(project.id, now);
  }
  return { checked: projects.length, returned, locked };
}

/** No unfinished issue, and nothing in the project touched since `before`. */
async function isIdle(projectId: string, before: Date): Promise<boolean> {
  const busy = await prisma.bug.findFirst({
    where: { projectId, isDeleted: false, OR: [{ status: { in: [...UNFINISHED] } }, { updatedAt: { gt: before } }] },
    select: { id: true },
  });
  return !busy;
}
