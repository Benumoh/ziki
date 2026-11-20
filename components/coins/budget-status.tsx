import type { BudgetStatus } from "@/lib/coins/budget-states";

const STATUS: Record<BudgetStatus, { text: string; tone: string }> = {
  none: { text: "No budget yet", tone: "bg-zk-chip text-zk-text2" },
  paused: { text: "Paused", tone: "bg-zk-warn-bg text-zk-warn-fg" },
  empty: { text: "Out of funds", tone: "bg-zk-bad-bg text-zk-bad-fg" },
  low: { text: "Running low", tone: "bg-zk-warn-bg text-zk-warn-fg" },
  active: { text: "Active", tone: "bg-zk-ok-bg text-zk-ok-fg" },
};

/** A project's budget status as a small tag (#project-budget): on its Budget page and in the list on the Ziks page. */
export function BudgetStatusTag({ status }: { status: BudgetStatus }) {
  const { text, tone } = STATUS[status];
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${tone}`} data-testid="budget-status">{text}</span>;
}