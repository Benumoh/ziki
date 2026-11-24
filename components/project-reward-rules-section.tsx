"use client";

import { Textarea } from "@/components/ui/textarea";
import type { ProjectRewardConfig } from "@/lib/rewards/config";
import { IssueSharesList } from "@/components/issue-shares-list";

interface ProjectRewardRulesSectionProps {
  initialConfig?: ProjectRewardConfig | null;
  /** The platform's guidelines, shown as the placeholder when the project has none. */
  defaults?: ProjectRewardConfig | null;
  disabled?: boolean;
}

/**
 * What a project's work pays, in its settings (#one-payment): every issue pays out the same split, so there are no
 * amounts to set, only the project's earning guidelines.
 */
export function ProjectRewardRulesSection({ initialConfig, defaults = null, disabled = false }: ProjectRewardRulesSectionProps) {
  return (
    <div className="space-y-3 rounded-xl border border-zk-border bg-zk-tint/70 p-4">
      <div>
        <h3 className="text-sm font-semibold text-zk-text">What the work pays</h3>
        <IssueSharesList compact />
      </div>
      <div>
        <label htmlFor="rewardGuidelines" className="block text-xs font-semibold uppercase tracking-wider text-zk-text2">
          Earning guidelines
        </label>
        <p className="text-xs text-zk-muted">What this project values most, shown to contributors (e.g. security fixes, test suites).</p>
        <Textarea
          id="rewardGuidelines"
          name="rewardGuidelines"
          rows={2}
          placeholder={defaults?.guidelines ?? "e.g. We value fixes that come with an end-to-end test."}
          defaultValue={initialConfig?.guidelines ?? ""}
          maxLength={2000}
          disabled={disabled}
          className="mt-1"
        />
      </div>
    </div>
  );
}
