"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { giveRewardEstimateAction } from "@/app/actions/reward";
import { ZikAmount } from "@/components/zik-symbol";
import { REWARD_ZIK_MAX, REWARD_ZIK_STEP } from "@/lib/points/rules";

export type RewardEstimateView = {
  id: string;
  userId: string;
  by: string;
  agentName: string | null;
  /** In Ziks. */
  value: number;
  reason: string | null;
  updatedAt: Date | string;
};

/** The choices, in Ziks, two steps apart so they fit on one line: 20, 40, … 100. */
const VALUES = Array.from({ length: REWARD_ZIK_MAX / (2 * REWARD_ZIK_STEP) }, (_, index) => (index + 1) * 2 * REWARD_ZIK_STEP);

/**
 * The issue page's Reward panel (#rewards), compact: what solving the issue is worth, in Ziks (the average of the
 * estimates, fixed at 15), and the values in one row with yours highlighted. Picking one gives or changes your estimate
 * at once.
 */
export function IssueRewardPanel({
  bugId,
  reward,
  estimates,
  fixed,
  viewerId,
  canEstimate,
  children,
}: {
  /** Drawn under the values: where the issue is funded (#ziki-coins). */
  children?: React.ReactNode;
  bugId: string;
  /** In Ziks. */
  reward: number;
  estimates: RewardEstimateView[];
  fixed: boolean;
  viewerId: string | null;
  /** False on a closed or deleted issue. */
  canEstimate: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const mine = viewerId ? estimates.find((estimate) => estimate.userId === viewerId) ?? null : null;
  const [value, setValue] = useState<number | null>(mine?.value ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const open = canEstimate && !fixed && Boolean(viewerId);

  const pick = (option: number) => {
    if (!open || pending || option === value) return;
    const previous = value;
    setValue(option);
    setError(null);
    const data = new FormData();
    data.set("value", String(option));
    startTransition(async () => {
      const result = await giveRewardEstimateAction(bugId, data);
      if (result.error) {
        setValue(previous);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-2 rounded-[20px] border border-zk-border bg-zk-surface px-4 py-3" data-testid="reward-panel">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={`${id}-heading`} className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">Reward</h2>
        <span className="text-xs text-zk-muted">
          <b className="font-mono font-bold tabular-nums text-zk-text" data-testid="reward-amount"><ZikAmount amount={reward} /></b>
          {" · "}
          {fixed ? "fixed" : `${estimates.length} ${estimates.length === 1 ? "estimate" : "estimates"}`}
        </span>
      </div>
      <div role="radiogroup" aria-label={mine ? "Your estimate" : "Give your estimate"} className="grid grid-cols-5 gap-1">
        {VALUES.map((option) => {
          const chosen = value === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={chosen}
              disabled={!open || pending}
              onClick={() => pick(option)}
              className={`inline-flex h-8 items-center justify-center rounded-lg border text-[13px] font-bold tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong disabled:cursor-default ${
                chosen ? "border-electric-blue-strong bg-electric-blue-strong text-white" : "border-zk-border bg-zk-surface text-zk-text enabled:cursor-pointer enabled:hover:bg-zk-chip disabled:text-zk-muted"
              }`}
            >
              <ZikAmount amount={option} />
            </button>
          );
        })}
      </div>
      {error ? <p role="alert" className="m-0 text-xs font-medium text-zk-bad-fg">{error}</p> : null}
      {children}
    </section>
  );
}
