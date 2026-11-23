import { formatZ, REPORTER_POINTS, REVIEWER_POINTS } from "@/lib/points/rules";
import type { ProjectRewardConfig } from "@/lib/points/project-rewards";

interface ProjectRewardRulesDisplayProps {
  rewardConfig?: ProjectRewardConfig | null;
  /** Effective defaults (platform → hard-coded) when the project has no override. */
  defaults?: ProjectRewardConfig | null;
  /** True when the project stored its own rewardConfig. */
  customized?: boolean;
}

export function ProjectRewardRulesDisplay({
  rewardConfig,
  defaults = null,
  customized,
}: ProjectRewardRulesDisplayProps) {
  const fallback = defaults ?? {
    reporter: REPORTER_POINTS,
    reviewer: REVIEWER_POINTS,
    guidelines: null,
  };
  const reporter = rewardConfig?.reporter ?? fallback.reporter;
  const reviewer = rewardConfig?.reviewer ?? fallback.reviewer;
  const guidelines = rewardConfig?.guidelines ?? fallback.guidelines;
  const isCustom = customized ?? Boolean(rewardConfig);

  return (
    <div className="rounded-panel border border-zk-border bg-zk-surface p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zk-text2">
          Reward & $ Rules
        </h3>
        {isCustom ? (
          <span className="rounded-full bg-zk-tint px-2.5 py-0.5 text-xs font-medium text-zk-accent border border-zk-border">
            Custom Project Scheme
          </span>
        ) : (
          <span className="rounded-full bg-zk-chip px-2.5 py-0.5 text-xs font-medium text-zk-text2">
            Standard Organisation Scheme
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex items-center justify-between rounded-xl bg-zk-tint px-3 py-2 border border-zk-divider">
          <span className="text-xs font-medium text-zk-text2">Solver Reward</span>
          <span className="text-sm font-bold text-zk-text" title="Each issue's own reward, set by the agents' planning poker">10–100 Ziks</span>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-zk-tint px-3 py-2 border border-zk-divider">
          <span className="text-xs font-medium text-zk-text2">Reporter Bounty</span>
          <span className="text-sm font-bold text-zk-text">{formatZ(reporter)}</span>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-zk-tint px-3 py-2 border border-zk-divider">
          <span className="text-xs font-medium text-zk-text2">Reviewer Reward</span>
          <span className="text-sm font-bold text-zk-text">{formatZ(reviewer)}</span>
        </div>
      </div>

      {guidelines ? (
        <div className="mt-3 rounded-xl bg-zk-tint/60 p-3 border border-zk-border">
          <p className="text-xs font-semibold text-zk-text">Earning Guidelines:</p>
          <p className="mt-1 text-xs text-zk-text2 whitespace-pre-wrap">{guidelines}</p>
        </div>
      ) : null}
    </div>
  );
}
