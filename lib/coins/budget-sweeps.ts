import { prisma } from "@/lib/prisma";
import { notifyLater } from "@/lib/notify";
import { IDLE_RETURN_DAYS, LOW_BUDGET_ISSUES, budgetBalance, issuePriceZik, returnUnusedBudget } from "./budget";

/**
 * What runs around project budgets (#project-budget): warning the owners when the budget can't cover what is waiting,
 * and giving a budget back when its project is archived or has had nothing to do for a while. Both are part of the cron
 * sweep (lib/cron/runner.ts) and are safe to run again: a warning is only sent when the state changes, and a return
 * only moves what is left.
 */

export type BudgetAlertState = "low" | "empty" | null;

/**
 * Judges the budget against the issues waiting to be awarded (open, nobody holds them, priced), oldest first. "Empty"
 * when it can't cover the next one (awards stop), "low" when it can't cover the next LOW_BUDGET_ISSUES, otherwise fine.
 * Pure, so it can be tested without a database.
 */
export function budgetAlertState(available: number, needs: number[]): BudgetAlertState {
  if (needs.length === 0) return null;
  if (available < needs[0]) return "empty";
  if (available < needs.slice(0, LOW_BUDGET_ISSUES).reduce((sum, need) => sum + need, 0)) return "low";
  return null;
}

/** Judges one project's budget and, when the state has changed to a worse one, tells its owners and admins once. */
export async function refreshBudgetAlert(projectId: string): Promise<BudgetAlertState> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, slug: true, organisationId: true, budgetEnabled: true, budgetPausedAt: true, budgetAlert: true, archivedAt: true, organisation: { select: { slug: true } } },
  });
  if (!project) return null;
  let state: BudgetAlertState = null;
  let available = 0;
  // A paused budget is the owner's own choice, so it warns about nothing.
  if (project.budgetEnabled && !project.budgetPausedAt && !project.archivedAt) {
    const waiting = await prisma.bug.findMany({
      where: { projectId, isDeleted: false, substatus: "open", assigneeId: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 20,
      select: { id: true, reward: true, rewardEstimateCount: true, rewardOverrideZik: true },
    });
    const held = await prisma.coinEntry.groupBy({ by: ["bugId"], where: { account: "escrow", bugId: { in: waiting.map((bug) => bug.id) } }, _sum: { amount: true } });
    const heldBy = new Map(held.map((row) => [row.bugId, row._sum.amount ?? 0]));
    const needs = waiting.flatMap((bug) => {
      const price = issuePriceZik(bug);
      return price === null ? [] : [Math.max(0, price - (heldBy.get(bug.id) ?? 0))];
    });
    available = await budgetBalance(prisma, projectId);
    state = budgetAlertState(available, needs);
  }
  if (state === project.budgetAlert) return state;
  await prisma.project.update({ where: { id: projectId }, data: { budgetAlert: state } });
  if (state) {
    const owners = await prisma.membership.findMany({ where: { organisationId: project.organisationId, role: { in: ["owner", "admin"] } }, select: { userId: true } });
    const budgetPath = `/${project.organisation.slug}/${project.slug}/budget`;
    const subject = state === "empty" ? `${project.name} is out of funds` : `${project.name}'s budget is running low`;
    const message =
      state === "empty"
        ? `The budget for ${project.name} can't cover the next issue waiting to be awarded (${available.toLocaleString("en-US")} Ziks left), so work on new issues has stopped. Add Ziks to keep it going.`
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
 * For each project with a budget: warns its owners when it is low or out, and returns the budget to the people who
 * funded it when the project is archived, or has had no unfinished issue and no activity for IDLE_RETURN_DAYS.
 */
export async function sweepProjectBudgets(now: Date = new Date()): Promise<{ checked: number; returned: number }> {
  const projects = await prisma.project.findMany({ where: { budgetEnabled: true }, select: { id: true, archivedAt: true } });
  const idleBefore = new Date(now.getTime() - IDLE_RETURN_DAYS * 24 * 60 * 60 * 1000);
  let returned = 0;
  for (const project of projects) {
    const idle = project.archivedAt ? true : await isIdle(project.id, idleBefore);
    if (idle) returned += await prisma.$transaction((tx) => returnUnusedBudget(tx, project.id));
    await refreshBudgetAlert(project.id);
  }
  return { checked: projects.length, returned };
}

/** No unfinished issue, and nothing in the project touched since `before`. */
async function isIdle(projectId: string, before: Date): Promise<boolean> {
  const busy = await prisma.bug.findFirst({
    where: { projectId, isDeleted: false, OR: [{ status: { in: ["open", "in_progress", "done", "merge"] } }, { updatedAt: { gt: before } }] },
    select: { id: true },
  });
  return !busy;
}
