"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { DEFAULT_TARGET, TARGET_MAX, type PlatformRewardConfig } from "@/lib/rewards/config";
import { IssueSharesList } from "@/components/issue-shares-list";
import { savePlatformRewardsAction, type PlatformRewardsActionResult } from "@/app/(app)/superadmin/rewards/actions";

/**
 * Super-admin editor for the site-wide reward settings (#one-payment): the ranking goal and the earning guidelines
 * projects show when they set none. What an issue pays is its funded price, shared the same way everywhere.
 */
export function PlatformRewardsForm({ initial, fee }: { initial: PlatformRewardConfig; fee: number }) {
  const [state, action, pending] = useActionState<PlatformRewardsActionResult, FormData>(savePlatformRewardsAction, {});

  return (
    <form action={action} className="space-y-6">
      {state.error ? (
        <p className="rounded-lg border border-zk-bad-bd bg-zk-bad-bg px-3 py-2 text-sm text-zk-bad-fg" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p className="rounded-lg border border-zk-ok-fg bg-zk-ok-bg px-3 py-2 text-sm text-zk-ok-fg" role="status">
          {state.message}
        </p>
      ) : null}

      <section className="rounded-xl border border-zk-border bg-zk-surface p-4 sm:p-6">
        <h2 className="text-sm font-semibold text-zk-text">What an issue pays</h2>
        <div className="mt-2">
          <IssueSharesList fee={fee} />
        </div>
      </section>

      <section className="rounded-xl border border-zk-border bg-zk-surface p-4 sm:p-6">
        <label htmlFor="target" className="block text-sm font-semibold text-zk-text">
          Ranking goal ($)
        </label>
        <p className="mt-1 text-xs text-zk-muted">What the Workers ranking measures everyone against, shown in Ziks (1,000 a dollar). Default: ${DEFAULT_TARGET}.</p>
        <Input id="target" name="target" type="number" step="0.01" min={1} max={TARGET_MAX} defaultValue={initial.target} className="mt-2 max-w-xs" />
      </section>

      <section className="rounded-xl border border-zk-border bg-zk-surface p-4 sm:p-6">
        <label htmlFor="rewardGuidelines" className="block text-sm font-semibold text-zk-text">
          Earning guidelines (optional)
        </label>
        <p className="mt-1 text-xs text-zk-muted">Shown where projects don&apos;t set their own.</p>
        <Textarea id="rewardGuidelines" name="rewardGuidelines" rows={3} defaultValue={initial.guidelines ?? ""} className="mt-2" />
      </section>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
