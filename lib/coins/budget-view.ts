import { prisma } from "@/lib/prisma";
import { priorityNow } from "@/lib/priority-now";
import { workflowFor } from "@/lib/workflow";
import { LOW_BUDGET_ISSUES, PRICED_WHERE, budgetBalance, currentPriceZik, hasBudget } from "./budget";
import { zikOf } from "./ledger";
import { ZIKS_PER_DOLLAR } from "./math";
import { PAYER_WHERE } from "./payers";
import { BUDGET_FILTERS, budgetStatusOf, classifyIssues, type BudgetFilterId, type BudgetIssueState, type BudgetSort, type BudgetStatus } from "./budget-states";

/**
 * What the Budget page shows (#project-budget): the project's figures, the issues with where each stands against the
 * budget, and the recent movements. Reads only; every figure comes off the ledger.
 */

export const BUDGET_PAGE_SIZE = 25;
/** The most issues one page of the list considers; beyond it the list says so. */
const MAX_ISSUES = 2000;

export type BudgetOverview = {
  /** In the budget, not yet reserved for an issue. */
  available: number;
  /** Reserved for issues that haven't paid out. */
  reserved: number;
  /** Paid out to the people who solved issues in this project. */
  paidOut: number;
  /** Whether the owner has paused it, and the project has a budget at all. */
  enabled: boolean;
  paused: boolean;
  alert: "low" | "empty" | null;
};

export async function budgetOverview(projectId: string): Promise<BudgetOverview> {
  const [project, enabled, available, reserved, paid] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { budgetPausedAt: true, budgetAlert: true } }),
    hasBudget(prisma, projectId),
    budgetBalance(prisma, projectId),
    // What the issues hold now: reserved from the budget, or funded on the issue itself.
    prisma.coinEntry.aggregate({ where: { account: "escrow", bug: { projectId } }, _sum: { amount: true } }),
    prisma.coinEntry.aggregate({ where: { account: "escrow", kind: "release", bug: { projectId } }, _sum: { amount: true } }),
  ]);
  return {
    available,
    reserved: Math.max(0, zikOf(reserved._sum.amount)),
    // Releases leave escrow, so they are negative there.
    paidOut: Math.max(0, -zikOf(paid._sum.amount)),
    enabled,
    paused: Boolean(project.budgetPausedAt),
    alert: project.budgetAlert === "low" || project.budgetAlert === "empty" ? project.budgetAlert : null,
  };
}

export type BudgetIssueRow = {
  id: string;
  number: number;
  title: string;
  state: BudgetIssueState;
  price: number | null;
  held: number;
};

export type BudgetIssueList = {
  rows: BudgetIssueRow[];
  /** How many issues each filter shows, for the chips. */
  counts: Record<BudgetFilterId, number>;
  /** Issues matching the chosen filter, across all pages. */
  total: number;
  page: number;
  pages: number;
  /** True when the project has more issues than the list considers. */
  truncated: boolean;
};

export async function budgetIssueList(
  projectId: string,
  organisationId: string,
  available: number,
  options: { filter: BudgetFilterId; sort: BudgetSort; page: number },
): Promise<BudgetIssueList> {
  const bugs = await prisma.bug.findMany({
    where: { projectId, isDeleted: false, status: { not: "closed" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_ISSUES + 1,
    select: {
      id: true, number: true, title: true, substatus: true, assigneeId: true, payoutReleasedAt: true,
      reward: true, rewardEstimateCount: true, rewardOverrideZik: true, zikiEstimateZik: true, rewardFixedAt: true, lockedPriceZik: true,
    },
  });
  const truncated = bugs.length > MAX_ISSUES;
  const considered = truncated ? bugs.slice(0, MAX_ISSUES) : bugs;

  // By priority: the confirmed, waiting issues in the order "Priority now" ranks them, then the rest oldest first.
  let ordered = considered;
  if (options.sort === "priority" && considered.length > 0) {
    const workflow = await workflowFor(projectId);
    const ranked = await priorityNow({ organisationId, projectId, offerWindowSeconds: workflow.offerWindowSeconds }, MAX_ISSUES, prisma);
    const rank = new Map(ranked.map((issue, index) => [issue.id, index]));
    ordered = [...considered].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  }

  const held = await prisma.coinEntry.groupBy({ by: ["bugId"], where: { account: "escrow", bugId: { in: ordered.map((bug) => bug.id) } }, _sum: { amount: true } });
  const heldBy = new Map(held.map((row) => [row.bugId, Math.max(0, zikOf(row._sum.amount))]));

  const inputs = ordered.map((bug) => ({
    id: bug.id,
    price: currentPriceZik(bug),
    held: heldBy.get(bug.id) ?? 0,
    paid: bug.payoutReleasedAt !== null,
    waiting: !bug.assigneeId && (bug.substatus === "open" || bug.substatus === "requires_confirmation"),
  }));
  const states = classifyIssues(inputs, available);

  const counts = Object.fromEntries(BUDGET_FILTERS.map((filter) => [filter.id, 0])) as Record<BudgetFilterId, number>;
  for (const state of states.values()) {
    for (const filter of BUDGET_FILTERS) {
      if (filter.states === null || (filter.states as readonly BudgetIssueState[]).includes(state)) counts[filter.id] += 1;
    }
  }

  const chosen = BUDGET_FILTERS.find((filter) => filter.id === options.filter) ?? BUDGET_FILTERS[0];
  const matching = ordered.filter((bug) => chosen.states === null || (chosen.states as readonly BudgetIssueState[]).includes(states.get(bug.id)!));
  const pages = Math.max(1, Math.ceil(matching.length / BUDGET_PAGE_SIZE));
  const page = Math.min(Math.max(1, options.page), pages);
  const rows = matching.slice((page - 1) * BUDGET_PAGE_SIZE, page * BUDGET_PAGE_SIZE).map((bug) => {
    const input = inputs.find((entry) => entry.id === bug.id)!;
    return { id: bug.id, number: bug.number, title: bug.title, state: states.get(bug.id)!, price: input.price, held: input.held };
  });
  return { rows, counts, total: matching.length, page, pages, truncated };
}

export type OwnedProjectBudget = {
  id: string;
  name: string;
  organisationName: string;
  /** The project's Budget page. */
  href: string;
  available: number;
  status: BudgetStatus;
};

/**
 * The projects this person can fund, with each one's budget and status, for the Ziks page: every live project in an
 * organisation they pay for (#payers), those with a budget first. `limit` keeps the list short.
 */
export async function ownedProjectBudgets(userId: string, limit = 8): Promise<{ projects: OwnedProjectBudget[]; more: number }> {
  const projects = await prisma.project.findMany({
    where: {
      archivedAt: null,
      organisation: { archivedAt: null, memberships: { some: { userId, ...PAYER_WHERE } } },
    },
    select: {
      id: true, name: true, slug: true, budgetPausedAt: true, budgetAlert: true,
      organisation: { select: { name: true, slug: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const [balances, fundedRows] = await Promise.all([
    prisma.coinEntry.groupBy({ by: ["projectId"], where: { account: "budget", projectId: { in: projects.map((project) => project.id) } }, _sum: { amount: true } }),
    prisma.coinEntry.groupBy({ by: ["projectId"], where: { account: "budget", kind: "fund_budget", projectId: { in: projects.map((project) => project.id) } } }),
  ]);
  const balanceOf = new Map(balances.map((row) => [row.projectId, zikOf(row._sum.amount)]));
  const everFunded = new Set(fundedRows.map((row) => row.projectId));
  // Those with a budget first.
  const shown = [...projects].sort((a, b) => Number(everFunded.has(b.id)) - Number(everFunded.has(a.id))).slice(0, limit);
  return {
    projects: shown.map((project) => ({
      id: project.id,
      name: project.name,
      organisationName: project.organisation.name,
      href: `/${project.organisation.slug}/${project.slug}/budget`,
      available: Math.max(0, balanceOf.get(project.id) ?? 0),
      status: budgetStatusOf({
        enabled: everFunded.has(project.id),
        paused: project.budgetPausedAt !== null,
        alert: project.budgetAlert === "low" || project.budgetAlert === "empty" ? project.budgetAlert : null,
      }),
    })),
    more: Math.max(0, projects.length - shown.length),
  };
}

/**
 * What to suggest an owner puts into the project's budget (#price-lock): what the priced issues waiting for funding
 * still need, plus room for the next LOW_BUDGET_ISSUES issues at the project's average price, less what the budget
 * already holds. Never below `minimum` (the issue in front of the owner), rounded up to a whole dollar. Pure.
 */
export function suggestBudget(input: { needs: number[]; averagePrice: number; available: number; minimum: number }): number {
  const waiting = input.needs.reduce((sum, need) => sum + Math.max(0, need), 0);
  const wanted = waiting + LOW_BUDGET_ISSUES * Math.max(0, input.averagePrice) - Math.max(0, input.available);
  return Math.ceil(Math.max(input.minimum, wanted) / ZIKS_PER_DOLLAR) * ZIKS_PER_DOLLAR;
}

/** The suggested budget for a project, read from its priced issues: see suggestBudget. */
export async function suggestedBudget(projectId: string, minimum: number): Promise<number> {
  const priced = await prisma.bug.findMany({
    where: { projectId, isDeleted: false, ...PRICED_WHERE, status: { not: "closed" } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
    select: { id: true, reward: true, rewardEstimateCount: true, rewardOverrideZik: true, zikiEstimateZik: true, rewardFixedAt: true, lockedPriceZik: true, substatus: true, assigneeId: true, payoutReleasedAt: true },
  });
  const prices = priced.flatMap((bug) => {
    const price = currentPriceZik(bug);
    return price === null ? [] : [{ bug, price }];
  });
  const waiting = prices.filter(({ bug }) => !bug.assigneeId && !bug.payoutReleasedAt && (bug.substatus === "open" || bug.substatus === "requires_confirmation"));
  const [held, available] = await Promise.all([
    prisma.coinEntry.groupBy({ by: ["bugId"], where: { account: "escrow", bugId: { in: waiting.map(({ bug }) => bug.id) } }, _sum: { amount: true } }),
    budgetBalance(prisma, projectId),
  ]);
  const heldBy = new Map(held.map((row) => [row.bugId, zikOf(row._sum.amount)]));
  const averagePrice = prices.length > 0 ? prices.reduce((sum, { price }) => sum + price, 0) / prices.length : minimum;
  return suggestBudget({ needs: waiting.map(({ bug, price }) => price - (heldBy.get(bug.id) ?? 0)), averagePrice, available, minimum });
}

export type BudgetMovement = {
  id: string;
  kind: "fund_budget" | "reserve" | "unreserve" | "budget_return";
  amount: number;
  createdAt: Date;
  issue: { number: number; title: string } | null;
};

/** The latest funding, reserving and returns on the budget, newest first. */
export async function budgetMovements(projectId: string, take = 12): Promise<BudgetMovement[]> {
  const rows = await prisma.coinEntry.findMany({
    where: { account: "budget", projectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: { id: true, kind: true, amount: true, createdAt: true, bug: { select: { number: true, title: true } } },
  });
  return rows.flatMap((row) =>
    row.kind === "fund_budget" || row.kind === "reserve" || row.kind === "unreserve" || row.kind === "budget_return"
      ? [{ id: row.id, kind: row.kind, amount: zikOf(row.amount), createdAt: row.createdAt, issue: row.bug }]
      : [],
  );
}
