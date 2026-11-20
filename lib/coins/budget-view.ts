import { prisma } from "@/lib/prisma";
import { priorityNow } from "@/lib/priority-now";
import { workflowFor } from "@/lib/workflow";
import { budgetBalance, issuePriceZik } from "./budget";
import { zikOf } from "./ledger";
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
  const [project, available, reserved, paid] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { budgetEnabled: true, budgetPausedAt: true, budgetAlert: true } }),
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
    enabled: project.budgetEnabled,
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
      reward: true, rewardEstimateCount: true, rewardOverrideZik: true,
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
    price: issuePriceZik(bug),
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
 * organisation they own or administer, those with a budget first. `limit` keeps the list short.
 */
export async function ownedProjectBudgets(userId: string, limit = 8): Promise<{ projects: OwnedProjectBudget[]; more: number }> {
  const projects = await prisma.project.findMany({
    where: {
      archivedAt: null,
      organisation: { archivedAt: null, memberships: { some: { userId, role: { in: ["owner", "admin"] } } } },
    },
    select: {
      id: true, name: true, slug: true, budgetEnabled: true, budgetPausedAt: true, budgetAlert: true,
      organisation: { select: { name: true, slug: true } },
    },
    orderBy: [{ budgetEnabled: "desc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const shown = projects.slice(0, limit);
  const balances = await prisma.coinEntry.groupBy({ by: ["projectId"], where: { account: "budget", projectId: { in: shown.map((project) => project.id) } }, _sum: { amount: true } });
  const balanceOf = new Map(balances.map((row) => [row.projectId, zikOf(row._sum.amount)]));
  return {
    projects: shown.map((project) => ({
      id: project.id,
      name: project.name,
      organisationName: project.organisation.name,
      href: `/${project.organisation.slug}/${project.slug}/budget`,
      available: Math.max(0, balanceOf.get(project.id) ?? 0),
      status: budgetStatusOf({
        enabled: project.budgetEnabled,
        paused: project.budgetPausedAt !== null,
        alert: project.budgetAlert === "low" || project.budgetAlert === "empty" ? project.budgetAlert : null,
      }),
    })),
    more: Math.max(0, projects.length - shown.length),
  };
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
