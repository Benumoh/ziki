"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { REPORTER_POINTS, REVIEWER_POINTS } from "@/lib/points/rules";
import type { ProjectRewardConfig } from "@/lib/points/project-rewards";

interface ProjectRewardRulesSectionProps {
  initialConfig?: ProjectRewardConfig | null;
  /** Platform (or hard-coded) defaults shown when the project has no override. */
  defaults?: ProjectRewardConfig | null;
  disabled?: boolean;
}

export function ProjectRewardRulesSection({
  initialConfig,
  defaults = null,
  disabled = false,
}: ProjectRewardRulesSectionProps) {
  const [open, setOpen] = useState(false);
  const fallback = defaults ?? {
    reporter: REPORTER_POINTS,
    reviewer: REVIEWER_POINTS,
    guidelines: null,
  };

  return (
    <div className="rounded-xl border border-zk-border bg-zk-tint/70 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zk-text">Reward & $ Rules</h3>
          <p className="text-xs text-zk-muted">
            Define custom reward bounties for solvers, reporters, and reviewers in this project.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-xs font-medium text-zk-accent hover:text-zk-accent"
        >
          {open ? "Hide custom rules" : "Customize rewards"}
        </button>
      </div>

      {open ? (
        <div className="mt-4 space-y-4 border-t border-zk-border pt-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <p className="text-xs text-zk-muted">Solving an issue is worth that issue&apos;s own reward, 10 to 100 Ziks, set by the agents&apos; planning poker.</p>
            <div>
              <label htmlFor="reporterPoints" className="block text-xs font-semibold uppercase tracking-wider text-zk-text2">
                Reporter bounty
              </label>
              <p className="text-xs text-zk-muted">$ awarded when an issue is confirmed.</p>
              <Input
                id="reporterPoints"
                type="number"
                step="0.01"
                name="reporterPoints"
                defaultValue={initialConfig?.reporter ?? fallback.reporter}
                min={0}
                max={1_000_000}
                disabled={disabled}
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="reviewerPoints" className="block text-xs font-semibold uppercase tracking-wider text-zk-text2">
                Reviewer bounty
              </label>
              <p className="text-xs text-zk-muted">$ awarded for accepted merge verdicts.</p>
              <Input
                id="reviewerPoints"
                type="number"
                step="0.01"
                name="reviewerPoints"
                defaultValue={initialConfig?.reviewer ?? fallback.reviewer}
                min={0}
                max={1_000_000}
                disabled={disabled}
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <label htmlFor="rewardGuidelines" className="block text-xs font-semibold uppercase tracking-wider text-zk-text2">
              Earning guidelines / notes
            </label>
            <p className="text-xs text-zk-muted">
              Ways $ can be earned in this project (e.g. security audits, test suites).
            </p>
            <Textarea
              id="rewardGuidelines"
              name="rewardGuidelines"
              rows={2}
              placeholder="e.g. Extra 5 Ziks for full end-to-end regression tests."
              defaultValue={initialConfig?.guidelines ?? ""}
              maxLength={2000}
              disabled={disabled}
              className="mt-1"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
