"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { quickIdeaVerdictAction } from "@/app/actions/idea-verdicts";
import type { IdeaListRow } from "@/components/ideas-list";
import { LocalTime } from "@/components/local-time";
import { IssueThumb, PILL } from "@/components/work-feed";
import { cleanTitle } from "@/lib/issue-title";
import { PILL_TONES } from "@/lib/pill-tones";
import { ideaPath, type ProjectRef } from "@/lib/project-paths";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue";

/**
 * The Overview's New Ideas tab (#work-feed): the ideas as the Work Feed's cards, on the same gray inset. Each card has
 * a picture for its kind, the title, "Idea #n · project · who filed it · score · when", and on the right Approve (your
 * good verdict, one tap) while you can still give it, else where it stands. A card opens the idea's page.
 */
export function IdeaFeed({ slug, ideas, empty }: { slug: ProjectRef; ideas: IdeaListRow[]; empty?: React.ReactNode }) {
  if (ideas.length === 0) return <div className="rounded-2xl border border-zk-border bg-white p-5">{empty}</div>;
  return (
    <ul className="m-0 flex list-none flex-col gap-3 rounded-xl bg-zk-bg p-4" aria-label="Ideas">
      {ideas.map((idea) => (
        <li key={idea.id} data-testid="idea-row" className="flex items-center gap-4 rounded-2xl border border-zk-border bg-white px-5 py-4 transition hover:bg-zk-bg">
          <Link href={ideaPath(idea.ref ?? slug, idea.number)} className={`flex min-w-0 flex-1 items-center gap-4 text-left ${focus}`}>
            <IssueThumb item={{ title: idea.title, files: [] }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold text-zk-text">{cleanTitle(idea.title)}</span>
              <span className="mt-0.5 block truncate text-[13px] text-zk-muted">
                <span className="tabular-nums">Idea #{idea.number}</span>
                {idea.projectName ? ` · ${idea.projectName}` : ""}
                {idea.reporterName ? ` · ${idea.reporterName}` : ""}
                {` · score ${idea.threshold === null ? idea.score : `${idea.score}/${idea.threshold}`}`} · <LocalTime date={idea.createdAt} />
              </span>
            </span>
          </Link>
          <IdeaAction idea={idea} />
        </li>
      ))}
    </ul>
  );
}

/** A card's right: Approve while the viewer can give it a good verdict; else where the idea stands, as a pill. */
function IdeaAction({ idea }: { idea: IdeaListRow }) {
  const [approved, setApproved] = useState(Boolean(idea.approvedByMe));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const reached = idea.threshold !== null && idea.score >= idea.threshold;

  const pill = (label: string, tone: keyof typeof PILL_TONES) => (
    <span className={`${PILL} max-sm:hidden`} style={PILL_TONES[tone]}>{label}</span>
  );
  if (idea.archived) return pill("Archived", "grey");
  if (idea.rejected) return pill("Rejected", "red");
  if (idea.bad) return pill("Reject advised", "red");
  if (approved) return pill("✓ Approved", "green");
  // At the threshold it waits for an agent to convert it; another good verdict is refused.
  if (reached) return pill("Ready to convert", "blue");

  const approve = () => {
    setError(null);
    setApproved(true);
    startTransition(async () => {
      let message: string | null;
      try {
        message = (await quickIdeaVerdictAction(idea.id, "good"))?.error ?? null;
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
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={approve}
        disabled={pending}
        aria-label={`Approve idea #${idea.number}: give it your good verdict`}
        // A real button, as on the ideas list before: solid green, raised, with a hover and a press, unlike the pills.
        className={`inline-flex h-7 cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border border-zk-ok-fg bg-zk-ok-fg px-2.5 text-[12px] font-bold text-white shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition hover:brightness-110 active:translate-y-px active:shadow-none disabled:cursor-default disabled:opacity-60 ${focus} ${error ? "ring-2 ring-zk-bad-fg" : ""}`}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        Approve
      </button>
      {error ? <p role="alert" className="m-0 max-w-[220px] text-[12px] text-zk-bad-fg">{error}</p> : null}
    </div>
  );
}
