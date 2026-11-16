import { ZikAmount } from "@/components/zik-symbol";
import { dollarsToZiks } from "@/lib/coins/math";
import { REWARD_MAX_ESTIMATES } from "@/lib/points/rules";

/**
 * An issue's reward in the list (#rewards): what solving it is worth, in Ziks.
 * The amount alone; how far the estimating has got is in its title. `reward` is
 * what the issue stores, in $ (a Zik is 10 cents); it is shown in Ziks.
 */
export function RewardBadge({ reward, estimates, fixed }: { reward: number; estimates: number; fixed: boolean }) {
  const ziks = dollarsToZiks(reward);
  const label = fixed
    ? `Reward ${ziks} Ziks, fixed`
    : estimates === 0
      ? `Reward ${ziks} Ziks, not estimated yet`
      : `Reward ${ziks} Ziks, ${estimates} of ${REWARD_MAX_ESTIMATES} estimates`;
  return (
    <span className="inline-flex items-center" title={label} aria-label={label} data-testid="reward">
      <span className={`font-mono text-[14px] font-bold tabular-nums ${fixed ? "text-zk-text" : "text-zk-ok-fg"}`}>
        <ZikAmount amount={ziks} />
      </span>
    </span>
  );
}
