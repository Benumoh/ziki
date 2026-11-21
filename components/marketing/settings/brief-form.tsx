"use client";
import type { ProjectRef } from "@/lib/project-paths";

import { useState, useTransition } from "react";
import { updateMarketingBriefAction } from "@/app/(app)/[org]/marketing/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MarketingBrief, MarketingBriefKey } from "./model";

const FIELDS: {
  key: MarketingBriefKey;
  label: string;
  hint: string;
  max: number;
  rows: number;
  placeholder: string;
}[] = [
  {
    key: "product",
    label: "Product",
    hint: "What the project is, in a sentence.",
    max: 600,
    rows: 2,
    placeholder: "e.g. Ziki, an issue tracker where agents do the work.",
  },
  {
    key: "audience",
    label: "Audience",
    hint: "Who the work is for.",
    max: 300,
    rows: 2,
    placeholder: "e.g. Teams that run coding agents.",
  },
  {
    key: "currentFocus",
    label: "Current focus",
    hint: "What the marketing work should serve right now. Ideas answer this with their rationale.",
    max: 600,
    rows: 2,
    placeholder: "e.g. Getting the first ten teams onto the agent workflow.",
  },
  {
    key: "outOfScope",
    label: "Out of scope",
    hint: "What agents should not spend marketing effort on.",
    max: 600,
    rows: 2,
    placeholder: "e.g. Paid advertising.",
  },
];

/**
 * The project brief panel (M-UI-7 for M-API-8): the short facts agents read
 * before proposing or delivering marketing work. `lib/marketing/brief.ts` owns
 * the rules, so a refusal comes back from the action.
 */
export function BriefForm({ slug, initial }: { slug: ProjectRef; initial: MarketingBrief }) {
  const [brief, setBrief] = useState<MarketingBrief>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function save(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateMarketingBriefAction(slug, brief);
      if (result.error) setError(result.error);
      else setSaved(true);
    });
  }

  return (
    <section aria-labelledby="marketing-brief" className="rounded-panel border border-zk-border bg-zk-surface p-5 sm:p-6">
      <h2 id="marketing-brief" className="m-0 text-base font-bold text-zk-text">
        Brief
      </h2>
      <p className="mt-1.5 text-sm text-zk-text2">
        What agents should know before proposing or delivering marketing work.
      </p>

      <form onSubmit={save} className="mt-4 flex flex-col gap-4">
        {FIELDS.map((field) => (
          <div key={field.key} className="flex flex-col gap-1.5">
            <label htmlFor={`marketing-brief-${field.key}`} className="text-sm font-medium text-zk-text">
              {field.label}
            </label>
            {field.rows > 1 ? (
              <Textarea
                id={`marketing-brief-${field.key}`}
                rows={field.rows}
                maxLength={field.max}
                placeholder={field.placeholder}
                value={brief[field.key]}
                onChange={(event) => setBrief((previous) => ({ ...previous, [field.key]: event.target.value }))}
              />
            ) : (
              <Input
                id={`marketing-brief-${field.key}`}
                type="text"
                maxLength={field.max}
                placeholder={field.placeholder}
                value={brief[field.key]}
                onChange={(event) => setBrief((previous) => ({ ...previous, [field.key]: event.target.value }))}
              />
            )}
            <p className="m-0 text-xs text-zk-muted">{field.hint}</p>
          </div>
        ))}

        {error ? (
          <div role="alert" className="rounded-xl border border-zk-bad-bd bg-zk-bad-bg px-3 py-2 text-sm text-zk-bad-fg">
            {error}
          </div>
        ) : saved ? (
          <p role="status" className="m-0 text-sm text-zk-ok-fg">
            Saved. Agents read this brief from now on.
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save brief"}</Button>
        </div>
      </form>
    </section>
  );
}
