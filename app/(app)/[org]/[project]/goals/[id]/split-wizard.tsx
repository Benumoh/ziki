"use client";

import { useActionState, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { splitGoalAction, type GoalActionResult } from "@/app/actions/goals";
import {
  PoolBudgetError,
  assertWithinPool,
  splitEvenly,
  splitMilestones,
  splitProportional,
  type GoalBudgetSummary,
} from "@/lib/goals/pool-split";

export type IssueTarget = { id: string; number: number; title: string; status: string };
export type GoalTarget = { id: string; title: string };
export type AgentTarget = { id: string; name: string };

type SplitMethod = "even" | "proportional" | "milestone" | "manual";

const METHODS: { value: SplitMethod; label: string; hint: string }[] = [
  { value: "even", label: "Even", hint: "Split the amount equally across every target." },
  { value: "proportional", label: "By weight", hint: "Each target's weight sets its share of the amount." },
  { value: "milestone", label: "Milestone shares", hint: "Each target names its percentage; shares must total 100." },
  { value: "manual", label: "Manual amounts", hint: "Type the exact credit amount for every target." },
];

type SelectedTarget = {
  /** Stable state key: `issue:<id>` / `goal:<id>` / `agent:<id>`. */
  key: string;
  targetType: "issue" | "goal" | "agent";
  ref: string;
  label: string;
};

type Preview =
  | { ok: true; rows: { key: string; label: string; amount: number }[]; total: number }
  | { ok: false; error: string };

function intOr(value: string | undefined, fallback: number): number {
  const text = (value ?? "").trim();
  if (!/^\d+$/.test(text)) return fallback;
  return Number(text);
}

/**
 * The preview runs the same pure pool arithmetic the server will run
 * (`lib/goals/pool-split.ts`), against the same pool numbers, so a split that
 * would be refused — over-allocation, empty pool, shares that miss 100 — is
 * refused here first, with the identical message.
 */
function computePreview({
  method,
  amountText,
  pool,
  allocated,
  remaining,
  selected,
  weights,
  manualAmounts,
}: {
  method: SplitMethod;
  amountText: string;
  pool: number;
  allocated: number;
  remaining: number;
  selected: SelectedTarget[];
  weights: Record<string, string>;
  manualAmounts: Record<string, string>;
}): Preview {
  if (selected.length === 0) {
    return { ok: false, error: "Pick at least one target to fund." };
  }
  try {
    let amounts: number[];
    if (method === "manual") {
      amounts = selected.map((target) => {
        const raw = Number(manualAmounts[target.key] ?? "");
        if (!Number.isInteger(raw) || raw < 1) {
          throw new PoolBudgetError(
            "bad_amount",
            `“${target.label}” needs a whole amount of at least 1 credit.`,
          );
        }
        return raw;
      });
    } else {
      let splitAmount: number;
      if (amountText.trim() === "") {
        // The server defaults an omitted amount to everything left, with the
        // same refusals for an empty or exhausted pool.
        if (pool === 0) throw new PoolBudgetError("empty_pool", "This goal's budget pool is empty (0 credits).");
        if (remaining <= 0) throw new PoolBudgetError("over_allocated", "This goal's pool is already fully allocated.");
        splitAmount = remaining;
      } else {
        splitAmount = Number(amountText);
        if (!Number.isInteger(splitAmount) || splitAmount < 1) {
          throw new PoolBudgetError("bad_amount", "The split amount must be a whole number of at least 1 credit.");
        }
      }
      if (method === "even") {
        amounts = splitEvenly(splitAmount, selected.length);
      } else if (method === "proportional") {
        amounts = splitProportional(splitAmount, selected.map((target) => intOr(weights[target.key], 0)));
      } else {
        amounts = splitMilestones(splitAmount, selected.map((target) => intOr(weights[target.key], 0)));
      }
    }

    const total = amounts.reduce((sum, amount) => sum + amount, 0);
    assertWithinPool(pool, allocated, total);
    return {
      ok: true,
      rows: selected.map((target, index) => ({ key: target.key, label: target.label, amount: amounts[index] ?? 0 })),
      total,
    };
  } catch (error) {
    if (error instanceof PoolBudgetError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * The split wizard: choose a method, pick issues, nested goals and agent
 * deliverables, watch the preview, and apply — the preview and the server
 * share one arithmetic module, and the payload carries a fresh `sourceKey`
 * so a retried submit can never double-spend the pool.
 */
export function SplitWizard({
  org,
  slug,
  goalId,
  budget,
  issues,
  goals,
  agents,
}: {
  org: string;
  slug: string;
  goalId: string;
  budget: GoalBudgetSummary;
  issues: IssueTarget[];
  goals: GoalTarget[];
  agents: AgentTarget[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [state, action, pending] = useActionState<GoalActionResult | undefined, FormData>(
    splitGoalAction,
    undefined,
  );

  const [method, setMethod] = useState<SplitMethod>("even");
  const [amountText, setAmountText] = useState("");
  const [issueFilter, setIssueFilter] = useState("");
  const [issueIds, setIssueIds] = useState<Set<string>>(new Set());
  const [goalIds, setGoalIds] = useState<Set<string>>(new Set());
  const [agentIds, setAgentIds] = useState<Set<string>>(new Set());
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [manualAmounts, setManualAmounts] = useState<Record<string, string>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});

  const selected = useMemo<SelectedTarget[]>(() => {
    const rows: SelectedTarget[] = [];
    for (const issue of issues) {
      if (issueIds.has(issue.id)) {
        rows.push({ key: `issue:${issue.id}`, targetType: "issue", ref: issue.id, label: `#${issue.number} ${issue.title}` });
      }
    }
    for (const goal of goals) {
      if (goalIds.has(goal.id)) {
        rows.push({ key: `goal:${goal.id}`, targetType: "goal", ref: goal.id, label: goal.title });
      }
    }
    for (const agent of agents) {
      if (agentIds.has(agent.id)) {
        const key = `agent:${agent.id}`;
        rows.push({ key, targetType: "agent", ref: agent.id, label: labels[key]?.trim() || `${agent.name} deliverable` });
      }
    }
    return rows;
  }, [issues, goals, agents, issueIds, goalIds, agentIds, labels]);

  const preview = useMemo(
    () =>
      computePreview({
        method,
        amountText,
        pool: budget.budgetPool,
        allocated: budget.allocated,
        remaining: budget.remaining,
        selected,
        weights,
        manualAmounts,
      }),
    [method, amountText, budget, selected, weights, manualAmounts],
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      // Selections deliberately stay checked: splitting the same targets
      // again from a fresh sourceKey is a normal follow-up (the preview
      // recomputes against the pool's new remaining balance).
      toast(state.message ?? "Split applied.", "success");
      router.refresh();
    }
    // Success and failure both surface in the panel below the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const toggle = (
    set: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
    checked: boolean,
  ) => {
    set((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const visibleIssues = issueFilter.trim()
    ? issues.filter((issue) => {
        const needle = issueFilter.trim().toLowerCase();
        return `#${issue.number} ${issue.title}`.toLowerCase().includes(needle);
      })
    : issues;

  /** Stamp the JSON payload — method, amounts, targets, fresh sourceKey — just before submit. */
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (!preview.ok) {
      event.preventDefault();
      return;
    }
    const form = event.currentTarget;
    const payloadInput = form.elements.namedItem("payload") as HTMLInputElement | null;
    if (!payloadInput) return;
    const payload: Record<string, unknown> = { method, sourceKey: `ui-${crypto.randomUUID()}` };
    if (method !== "manual" && amountText.trim() !== "") {
      payload.amount = Number(amountText);
    }
    payload.targets = selected.map((target) => {
      const base: Record<string, unknown> =
        target.targetType === "issue"
          ? { targetType: "issue", targetBugId: target.ref }
          : target.targetType === "goal"
            ? { targetType: "goal", targetGoalId: target.ref }
            : { targetType: "agent", targetAgentId: target.ref, label: target.label };
      if (method === "proportional" || method === "milestone") {
        base.weight = intOr(weights[target.key], 0);
      } else if (method === "manual") {
        base.amount = Number(manualAmounts[target.key] ?? "");
      }
      return base;
    });
    payloadInput.value = JSON.stringify(payload);
  };

  const needsWeight = method === "proportional" || method === "milestone";
  const shareTotal = selected.reduce((sum, target) => sum + intOr(weights[target.key], 0), 0);

  return (
    <section aria-labelledby="split-heading" className="rounded-panel border border-zk-border bg-zk-surface px-5 py-4" data-testid="split-wizard">
      <h2 id="split-heading" className="text-base font-bold text-zk-text">Split the pool</h2>
      <p className="mt-0.5 text-[13px] text-zk-text2">
        {budget.remaining.toLocaleString()} credits of {budget.budgetPool.toLocaleString()} are still unallocated.
      </p>

      <form action={action} onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
        <input type="hidden" name="org" value={org} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="goalId" value={goalId} />
        <input type="hidden" name="payload" value="" />

        <fieldset className="space-y-1.5">
          <legend className="text-sm font-semibold text-zk-text">Method</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {METHODS.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                  method === option.value ? "border-electric-blue-strong bg-zk-tint" : "border-zk-border bg-zk-surface"
                }`}
              >
                <input
                  type="radio"
                  name="method"
                  value={option.value}
                  checked={method === option.value}
                  onChange={() => setMethod(option.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-semibold text-zk-text">{option.label}</span>
                  <span className="block text-[12.5px] text-zk-text2">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {method !== "manual" ? (
          <div className="max-w-[260px]">
            <label htmlFor="split-amount" className="block text-sm font-semibold text-zk-text">
              Amount to split <span className="font-normal text-zk-muted">(credits)</span>
            </label>
            <Input
              id="split-amount"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              placeholder={String(budget.remaining)}
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              className="mt-1"
            />
            <p className="mt-1 text-[12.5px] text-zk-muted">
              Leave empty to split everything left ({budget.remaining.toLocaleString()} credits).
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <fieldset className="rounded-xl border border-zk-border p-3" data-testid="issue-picker">
            <legend className="px-1 text-sm font-semibold text-zk-text">Issues</legend>
            <Input
              type="search"
              placeholder="Filter issues…"
              value={issueFilter}
              onChange={(event) => setIssueFilter(event.target.value)}
              className="mb-2"
              aria-label="Filter issues"
            />
            <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {visibleIssues.map((issue) => (
                <li key={issue.id} className="flex items-start gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    id={`pick-issue-${issue.id}`}
                    checked={issueIds.has(issue.id)}
                    onChange={(event) => toggle(setIssueIds, issue.id, event.target.checked)}
                    className="mt-0.5"
                  />
                  <label htmlFor={`pick-issue-${issue.id}`} className="min-w-0 cursor-pointer">
                    <span className="block truncate font-medium text-zk-text">
                      <span className="text-zk-muted">#{issue.number}</span> {issue.title}
                    </span>
                    <span className="text-[11px] uppercase tracking-wide text-zk-muted">{issue.status.replace("_", " ")}</span>
                  </label>
                </li>
              ))}
              {visibleIssues.length === 0 ? <li className="text-[13px] text-zk-muted">No issues match.</li> : null}
            </ul>
          </fieldset>

          <fieldset className="rounded-xl border border-zk-border p-3" data-testid="goal-picker">
            <legend className="px-1 text-sm font-semibold text-zk-text">Nested goals</legend>
            <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {goals.map((goal) => (
                <li key={goal.id} className="flex items-start gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    id={`pick-goal-${goal.id}`}
                    checked={goalIds.has(goal.id)}
                    onChange={(event) => toggle(setGoalIds, goal.id, event.target.checked)}
                    className="mt-0.5"
                  />
                  <label htmlFor={`pick-goal-${goal.id}`} className="min-w-0 cursor-pointer font-medium text-zk-text">
                    <span className="block truncate">{goal.title}</span>
                  </label>
                </li>
              ))}
              {goals.length === 0 ? <li className="text-[13px] text-zk-muted">No other active goals.</li> : null}
            </ul>
          </fieldset>

          <fieldset className="rounded-xl border border-zk-border p-3" data-testid="agent-picker">
            <legend className="px-1 text-sm font-semibold text-zk-text">Agent deliverables</legend>
            <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {agents.map((agent) => {
                const key = `agent:${agent.id}`;
                const checked = agentIds.has(agent.id);
                return (
                  <li key={agent.id} className="text-[13px]">
                    <span className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        id={`pick-agent-${agent.id}`}
                        checked={checked}
                        onChange={(event) => toggle(setAgentIds, agent.id, event.target.checked)}
                        className="mt-0.5"
                      />
                      <label htmlFor={`pick-agent-${agent.id}`} className="min-w-0 cursor-pointer font-medium text-zk-text">
                        {agent.name}
                      </label>
                    </span>
                    {checked ? (
                      <Input
                        value={labels[key] ?? ""}
                        onChange={(event) => setLabels((current) => ({ ...current, [key]: event.target.value }))}
                        placeholder={`${agent.name} deliverable (label)`}
                        maxLength={200}
                        aria-label={`Deliverable label for ${agent.name}`}
                        className="mt-1.5"
                      />
                    ) : null}
                  </li>
                );
              })}
              {agents.length === 0 ? <li className="text-[13px] text-zk-muted">No active agents in this organisation.</li> : null}
            </ul>
          </fieldset>
        </div>

        {selected.length > 0 && method !== "manual" && needsWeight ? (
          <div className="rounded-xl border border-zk-border p-3" data-testid="weight-inputs">
            <p className="text-sm font-semibold text-zk-text">
              {method === "milestone" ? "Shares" : "Weights"}
              {method === "milestone" ? (
                <span className={`ml-2 text-[12.5px] font-normal ${shareTotal === 100 ? "text-zk-ok-fg" : "text-zk-bad-fg"}`}>
                  total {shareTotal} / 100
                </span>
              ) : null}
            </p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {selected.map((target) => (
                <li key={target.key} className="flex items-center gap-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-zk-text2" title={target.label}>{target.label}</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={method === "milestone" ? 100 : 1_000_000}
                    value={weights[target.key] ?? ""}
                    onChange={(event) => setWeights((current) => ({ ...current, [target.key]: event.target.value }))}
                    aria-label={`${method === "milestone" ? "Share" : "Weight"} for ${target.label}`}
                    className="w-24"
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {selected.length > 0 && method === "manual" ? (
          <div className="rounded-xl border border-zk-border p-3" data-testid="manual-inputs">
            <p className="text-sm font-semibold text-zk-text">Amounts per target</p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {selected.map((target) => (
                <li key={target.key} className="flex items-center gap-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-zk-text2" title={target.label}>{target.label}</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={manualAmounts[target.key] ?? ""}
                    onChange={(event) => setManualAmounts((current) => ({ ...current, [target.key]: event.target.value }))}
                    aria-label={`Credits for ${target.label}`}
                    className="w-24"
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Live preview: the exact slices the server will write. */}
        <div className="rounded-xl border border-zk-border bg-zk-chip px-4 py-3" data-testid="split-preview">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-zk-muted">Preview</p>
          {preview.ok ? (
            <>
              <ul className="mt-2 space-y-1">
                {preview.rows.map((row) => (
                  <li key={row.key} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="min-w-0 truncate text-zk-text" title={row.label}>{row.label}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-zk-text">{row.amount.toLocaleString()} cr</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 border-t border-zk-border pt-2 text-[13px] font-bold text-zk-text">
                Total {preview.total.toLocaleString()} of {budget.remaining.toLocaleString()} remaining
              </p>
            </>
          ) : (
            <p className="mt-2 text-[13px] font-medium text-zk-bad-fg" role="alert">{preview.error}</p>
          )}
        </div>

        {state && !state.ok ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-800" role="alert" data-testid="split-error">
            {state.status ? <span className="mr-2 rounded bg-red-100 px-1.5 py-0.5 font-mono text-[11px]">{state.status}</span> : null}
            {state.error}
          </p>
        ) : null}
        {state && state.ok ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-medium text-emerald-900" role="status" data-testid="split-success">
            {state.message}
          </p>
        ) : null}

        <Button type="submit" disabled={pending || !preview.ok}>
          {pending ? "Applying…" : "Apply split"}
        </Button>
      </form>
    </section>
  );
}
