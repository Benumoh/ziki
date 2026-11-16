"use client";

import { Fragment, useState, useTransition } from "react";
import { quickIdeaVerdictAction } from "@/app/actions/idea-verdicts";
import { Arrow } from "@/components/merge-path";

type Step = { label: string; state: "done" | "current" | "pending" | "rejected" | "advised" | "archived" };

// The same chips as the Live tab's dev → staging → main (components/merge-path.tsx).
const chip = "inline-flex h-5 items-center gap-0.5 whitespace-nowrap rounded-[7px] border px-[5px] font-mono text-[10.5px] font-semibold";
const tone: Record<Step["state"], string> = {
  done: "border-transparent bg-zk-chip text-zk-text2",
  current: "border-transparent bg-blue-50 text-blue-700",
  pending: "border-dashed border-zk-border bg-zk-surface text-zk-muted",
  rejected: "border-transparent bg-zk-bad-bg text-zk-bad-fg",
  // Rejection advised, not yet done: the Rejected step dashed in red.
  advised: "border-dashed border-zk-bad-fg/50 bg-zk-surface text-zk-bad-fg",
  archived: "border-transparent bg-zk-chip text-zk-muted",
};

function Icon({ state }: { state: Step["state"] }) {
  const common = { width: 11, height: 11, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (state === "done") return <svg {...common}><path d="M20 6 9 17l-5-5" /></svg>;
  if (state === "rejected" || state === "advised") return <svg {...common}><path d="M18 6 6 18M6 6l12 12" /></svg>;
  if (state === "current") return <svg {...common} fill="currentColor" stroke="none"><circle cx="12" cy="12" r="5" /></svg>;
  return <svg {...common} strokeWidth={2.2}><circle cx="12" cy="12" r="8" /></svg>;
}

/**
 * Where an idea is on its way (#idea-path), as the Live tab shows a fix's
 * deploys: Idea → In progress → Done, or Idea → Rejected (Archived) once a
 * manager agent turned it down. Until you approve it, the next step is an
 * Approve button: one tap gives it your good verdict, and the path then shows
 * In progress → Done. An idea in the list is at Idea; its score is in
 * the vote box beside it and in this chip's name.
 */
export function IdeaPathChips({ ideaId, approvedByMe = false, score, threshold, rejected = false, archived = null, bad = false }: {
  ideaId: string;
  /** The viewer already gave it a verdict, any way. */
  approvedByMe?: boolean;
  score: number;
  threshold: number | null;
  rejected?: boolean;
  archived?: string | null;
  bad?: boolean;
}) {
  const [approved, setApproved] = useState(approvedByMe);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scoreText = threshold === null ? `${score}` : `${score}/${threshold}`;
  const open = !archived && !rejected && !bad;
  // At the threshold it waits for an agent to convert it, and another good verdict
  // is refused (enough_verdicts), so there is nothing to approve.
  const reached = threshold !== null && score >= threshold;

  if (open && !approved && !reached) {
    const approve = () => {
      setError(null);
      setApproved(true);
      startTransition(async () => {
        let message: string | null;
        try {
          message = (await quickIdeaVerdictAction(ideaId, "good"))?.error ?? null;
        } catch {
          message = "Could not save that. Please try again.";
        }
        if (message) {
          setApproved(false);
          setError(message);
        }
      });
    };
    return (
      // Two steps sit at the right of the Status column.
      <div className="flex w-full items-center justify-end gap-[3px]" data-testid="idea-path" title={error ?? `At Idea, score ${scoreText}`}>
        {/* Why the approve didn't save, beside the button rather than only in the tooltip. */}
        {error ? (
          <span role="alert" className="min-w-0 truncate text-[11px] font-medium text-zk-bad-fg">
            {error}
          </span>
        ) : null}
        <span className={`${chip} ${tone.current}`}><Icon state="current" />Idea</span>
        <Arrow small />
        <button
          type="button"
          onClick={approve}
          disabled={pending}
          aria-label={`Approve this idea: give it your good verdict (score ${scoreText})`}
          // A real button: solid green, raised, with a hover and a press, unlike the flat step chips.
          className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border border-zk-ok-fg bg-zk-ok-fg px-2 text-[11.5px] font-bold text-white shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition hover:brightness-110 active:translate-y-px active:shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue disabled:opacity-60 ${error ? "ring-2 ring-zk-bad-fg" : ""}`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          Approve
        </button>
      </div>
    );
  }
  const steps: Step[] = archived
    ? [{ label: "Idea", state: "done" }, { label: "Archived", state: "archived" }]
    : rejected
      ? [{ label: "Idea", state: "done" }, { label: "Rejected", state: "rejected" }]
      : bad
        ? // Reject advised: its way is to Rejected, not In progress.
          [{ label: "Idea", state: "current" }, { label: "Rejected", state: "advised" }]
        : [{ label: "Idea", state: "current" }, { label: "In progress", state: "pending" }, { label: "Done", state: "pending" }];
  const name = archived
    ? `Idea, then archived: ${archived}`
    : rejected
      ? `Idea, then rejected; score ${scoreText}`
      : bad
        ? `At Idea, score ${scoreText}; rejection advised`
        : `At Idea, score ${scoreText}; next In progress, then Done`;
  return (
    // Every path sits at the right of the Status column, like Approve and the filters above it.
    <div className="flex w-full items-center justify-end gap-[3px]" role="img" aria-label={name} title={name} data-testid="idea-path">
      {steps.map((step, index) => (
        <Fragment key={step.label}>
          {index > 0 ? <Arrow small /> : null}
          <span className={`${chip} ${tone[step.state]}`}>
            <Icon state={step.state} />
            {step.label}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
