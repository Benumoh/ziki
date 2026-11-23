/**
 * Where an issue stands against its project's budget (#project-budget), for the Budget page. Pure, so it is easy to
 * test: the page loads the issues and what each holds, and this says which are funded, which the budget would cover,
 * and which it would not.
 */

export type BudgetIssueState =
  /** Its price is reserved and it has not paid out yet. */
  | "funded"
  /** Something is reserved or funded for it, but less than its price. */
  | "partly_funded"
  /** Waiting to be awarded, and the budget would cover it. */
  | "covered"
  /** Waiting to be awarded, and the budget is too low for it. */
  | "not_covered"
  /** Waiting, with no price yet: fewer than three agents have estimated it. */
  | "needs_price"
  /** Someone is working on it and nothing is reserved for it (it was awarded before the budget, or by hand). */
  | "not_reserved"
  /** Its payout was released. */
  | "paid";

export type BudgetIssueInput = {
  id: string;
  /** Its price in Ziks, or null while it has none. */
  price: number | null;
  /** What its escrow holds now. */
  held: number;
  /** Its payout was released. */
  paid: boolean;
  /** Nobody holds it and it can still be awarded. */
  waiting: boolean;
};

/**
 * One state per issue. The waiting issues are taken in the order given, each subtracting its price from what the budget
 * has left, and the first one that doesn't fit stops the run: it and everything after it are "not covered". That is how
 * awards stop in practice, at the first issue the budget can't carry.
 */
export function classifyIssues(issues: readonly BudgetIssueInput[], available: number): Map<string, BudgetIssueState> {
  const states = new Map<string, BudgetIssueState>();
  let remaining = Math.max(0, available);
  let stopped = false;
  for (const issue of issues) {
    if (issue.paid) {
      states.set(issue.id, "paid");
    } else if (issue.held > 0) {
      states.set(issue.id, issue.price !== null && issue.held < issue.price ? "partly_funded" : "funded");
    } else if (!issue.waiting) {
      states.set(issue.id, "not_reserved");
    } else if (issue.price === null) {
      states.set(issue.id, "needs_price");
    } else if (!stopped && issue.price <= remaining) {
      remaining -= issue.price;
      states.set(issue.id, "covered");
    } else {
      stopped = true;
      states.set(issue.id, "not_covered");
    }
  }
  return states;
}

export type BudgetStatus = "none" | "paused" | "empty" | "low" | "active";

/** The one status a project's budget shows, on its Budget page and in the list on the Ziks page. */
export function budgetStatusOf(budget: { enabled: boolean; paused: boolean; alert: "low" | "empty" | null }): BudgetStatus {
  if (!budget.enabled) return "none";
  if (budget.paused) return "paused";
  if (budget.alert === "empty") return "empty";
  if (budget.alert === "low") return "low";
  return "active";
}

/** The filters on the Budget page, and which states each shows. */
export const BUDGET_FILTERS = [
  { id: "all", label: "All", states: null },
  { id: "funded", label: "Funded", states: ["funded", "partly_funded"] },
  { id: "covered", label: "Covered", states: ["covered"] },
  { id: "not_covered", label: "Low funds", states: ["not_covered"] },
  { id: "needs_price", label: "Being priced", states: ["needs_price"] },
  { id: "paid", label: "Paid", states: ["paid"] },
] as const satisfies readonly { id: string; label: string; states: readonly BudgetIssueState[] | null }[];

export type BudgetFilterId = (typeof BUDGET_FILTERS)[number]["id"];

export function budgetFilterOf(value: unknown): BudgetFilterId {
  return BUDGET_FILTERS.find((filter) => filter.id === value)?.id ?? "all";
}

export type BudgetSort = "oldest" | "priority";

export function budgetSortOf(value: unknown): BudgetSort {
  return value === "priority" ? "priority" : "oldest";
}
