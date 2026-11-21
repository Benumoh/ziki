"use client";
import type { ProjectRef } from "@/lib/project-paths";

import { useState, useTransition } from "react";

import { updateMarketingRevisionLimitAction } from "@/app/(app)/[org]/marketing/settings/actions";
import { WORKFLOW_LIMITS } from "@/lib/workflow-config";
import { Button } from "@/components/ui/button";

/**
 * The revision limit dial (M-UI-7 for M-API-6): how many send-backs a marketing
 * delivery takes before the task reopens for bids and the next worker starts
 * with a fresh count. Owner/admin only; the page decides.
 */
export function RevisionLimitForm({ slug, current }: { slug: ProjectRef; current: number }) {
  const [saved, setSaved] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const bounds = WORKFLOW_LIMITS.revisionLimit;
  const options = Array.from({ length: bounds.max - bounds.min + 1 }, (_, index) => bounds.min + index);

  function save(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setError(null);
    setSaved(null);
    const formData = new FormData(formEvent.currentTarget);

    startTransition(async () => {
      try {
        const result = await updateMarketingRevisionLimitAction(slug, formData);
        if (result.error) {
          setError(result.error);
        } else {
          setSaved(Number(formData.get("revisionLimit")));
        }
      } catch {
        setError("The setting couldn't be saved. Please try again.");
      }
    });
  }

  const selectClass = "rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-sm text-zk-text";

  return (
    <section aria-labelledby="marketing-revision-limit" className="rounded-panel border border-zk-border bg-zk-surface p-5 sm:p-6">
      <h2 id="marketing-revision-limit" className="m-0 text-base font-bold text-zk-text">
        Revision limit
      </h2>
      <p className="m-0 mt-1 max-w-2xl text-sm text-zk-text2">
        How many times a marketing delivery can be sent back — by a “request changes” judgement or a manager&apos;s
        reject — before the task reopens for bids. The next worker starts with a fresh count.
      </p>

      <form onSubmit={save} className="mt-4 flex flex-wrap items-center gap-3">
        <label htmlFor="marketing-revision-limit-value" className="text-sm text-zk-text">
          Send a delivery back up to
        </label>
        <select
          id="marketing-revision-limit-value"
          name="revisionLimit"
          defaultValue={current}
          disabled={pending}
          className={selectClass}
        >
          {options.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <label htmlFor="marketing-revision-limit-value" className="text-sm text-zk-text">
          time{current === 1 ? "" : "s"} before the task reopens for bids
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>

      {error ? (
        <div role="alert" className="mt-3 rounded-xl border border-zk-bad-bd bg-zk-bad-bg px-3 py-2 text-sm text-zk-bad-fg">
          {error}
        </div>
      ) : saved !== null ? (
        <p role="status" className="m-0 mt-3 text-sm text-zk-ok-fg">
          Saved. Send-backs now number {saved} before a task reopens for bids.
        </p>
      ) : null}
    </section>
  );
}
