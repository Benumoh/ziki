"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { giveRewardEstimateAction } from "@/app/actions/reward";
import { ZikAmount } from "@/components/zik-symbol";
import { REWARD_ZIK_MAX, REWARD_ZIK_STEP } from "@/lib/coins/price-rules";

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

/** How many estimates give an issue its price (lib/coins/budget.ts MIN_ESTIMATES_TO_AWARD). */
const ESTIMATES_FOR_A_PRICE = 3;

/**
 * The issue page's Reward panel (#rewards), compact: what solving the issue is worth, in Ziks (the average of the
 * estimates once three are in, locked once it is funded), and the values in one row with yours highlighted. Picking one
 * gives or changes your estimate at once. The organisation's payers (#payers) fund its issues, so they see the
 * values but don't estimate (#price-lock).
 */
export function IssueRewardPanel({
  bugId,
  reward,
  estimates,
  fixed,
  viewerId,
  canEstimate,
  payer = false,
  ziki = null,
  children,
}: {
  /** Ziki's own estimate (#ziki-estimate), given when fewer than three agents had estimated it after a day. */
  ziki?: { value: number; reason: string | null } | null;
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
  /** The viewer pays for the organisation's issues (an owner or admin), so doesn't estimate them. */
  payer?: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const mine = viewerId ? estimates.find((estimate) => estimate.userId === viewerId) ?? null : null;
  const [value, setValue] = useState<number | null>(mine?.value ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const open = canEstimate && !fixed && !payer && Boolean(viewerId);
  const priced = fixed || estimates.length >= ESTIMATES_FOR_A_PRICE || ziki !== null;

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
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-2 rounded-panel border border-zk-border bg-zk-surface px-4 py-3" data-testid="reward-panel">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={`${id}-heading`} className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">Reward</h2>
        {priced ? (
          <span className="text-xs text-zk-muted">
            <b className="font-mono font-bold tabular-nums text-zk-text" data-testid="reward-amount"><ZikAmount amount={reward} /></b>
            {" · "}
            {fixed ? "locked" : ziki ? `${estimates.length} ${estimates.length === 1 ? "estimate" : "estimates"} + Ziki` : `${estimates.length} estimates`}
          </span>
        ) : (
          <span className="text-xs text-zk-muted" data-testid="reward-amount">
            Waiting for estimates · {estimates.length} of {ESTIMATES_FOR_A_PRICE}
          </span>
        )}
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
      {payer && canEstimate && !fixed ? (
        <p className="m-0 text-xs text-zk-muted">You pay for this organisation&apos;s issues, so you don&apos;t estimate them.</p>
      ) : null}
      {error ? <p role="alert" className="m-0 text-xs font-medium text-zk-bad-fg">{error}</p> : null}
      {children}
      {estimates.length > 0 || ziki ? <EstimateList estimates={estimates} viewerId={viewerId} ziki={ziki} /> : null}
    </section>
  );
}

/**
 * Who estimated the issue and why (#price-lock), under its price, folded until opened, while it is estimated and once
 * its price is locked, so the person paying can see what the price is made of. Agents reading the API still see only
 * the average until the price is locked (lib/agent-api/reward-estimates.ts readReward), so they don't anchor on each other.
 */
function EstimateList({ estimates, viewerId, ziki }: { estimates: RewardEstimateView[]; viewerId: string | null; ziki: { value: number; reason: string | null } | null }) {
  return (
    <details className="group" data-testid="reward-estimates">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-zk-accent hover:underline focus-visible:outline-2 focus-visible:outline-electric-blue [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">See estimates ({estimates.length + (ziki ? 1 : 0)})</span>
        <span className="hidden group-open:inline">Hide estimates</span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
        {estimates.map((estimate) => (
          <li key={estimate.id} className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-zk-text">
                <b className="font-semibold">{estimate.userId === viewerId ? "You" : estimate.by}</b>
                {estimate.agentName ? <span className="text-zk-muted"> · via {estimate.agentName}</span> : null}
              </span>
              <b className="shrink-0 font-mono font-bold tabular-nums text-zk-text"><ZikAmount amount={estimate.value} /></b>
            </div>
            {estimate.reason ? <p className="m-0 line-clamp-2 text-xs text-zk-muted">{estimate.reason}</p> : null}
          </li>
        ))}
        {/* #ziki-estimate: given because fewer than three agents had estimated it after a day; it counts as one. */}
        {ziki ? (
          <li className="flex flex-col gap-0.5" data-testid="ziki-estimate">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-zk-text">
                <b className="font-semibold">Ziki</b>
                <span className="text-zk-muted"> · AI estimate, as too few agents estimated it in a day</span>
              </span>
              <b className="shrink-0 font-mono font-bold tabular-nums text-zk-text"><ZikAmount amount={ziki.value} /></b>
            </div>
            {ziki.reason ? <p className="m-0 line-clamp-2 text-xs text-zk-muted">{ziki.reason}</p> : null}
          </li>
        ) : null}
      </ul>
    </details>
  );
}
