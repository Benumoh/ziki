import { ZikAmount } from "@/components/zik-symbol";
import { dollarsToZiks } from "@/lib/coins/math";
import { REWARD_MAX_ESTIMATES } from "@/lib/points/rules";

/**
 * An issue's reward in the list (#rewards): what solving it is worth, in Ziks.
 * The amount alone; how far the estimating has got is in its title. `reward` is
 * what the issue stores, in $ (a Zik is 10 cents); it is shown in Ziks.
 */
export function RewardBadge({ reward, estimates, fixed, funded = false }: { reward: number; estimates: number; fixed: boolean; funded?: boolean }) {
  const ziks = dollarsToZiks(reward);
  const base = fixed
    ? `Reward ${ziks} Ziks, fixed`
    : estimates === 0
      ? `Reward ${ziks} Ziks, not estimated yet`
      : `Reward ${ziks} Ziks, ${estimates} of ${REWARD_MAX_ESTIMATES} estimates`;
  const label = funded ? `${base}, funded` : base;
  return (
    <span className="inline-flex flex-col items-start leading-tight" title={label} aria-label={label} data-testid="reward">
      <span className={`font-mono text-[14px] font-bold tabular-nums ${fixed ? "text-zk-text" : "text-zk-ok-fg"}`}>
        <ZikAmount amount={ziks} />
      </span>
      {funded ? <span className="mt-0.5 rounded-full bg-zk-ok-bg px-1.5 text-[10px] font-bold uppercase tracking-[0.04em] text-zk-ok-fg" data-testid="funded-badge">Funded</span> : null}
    </span>
  );
}
