"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { quickIdeaVerdictAction } from "@/app/actions/idea-verdicts";
import type { IdeaListRow } from "@/components/ideas-list";
import { LocalTime } from "@/components/local-time";
import { RichText } from "@/components/rich-text";
import { IssueThumb, PILL } from "@/components/work-feed";
import { cleanTitle } from "@/lib/issue-title";
import { PILL_TONES } from "@/lib/pill-tones";
import { ideaPath, type ProjectRef } from "@/lib/project-paths";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue";

/**
 * The Overview's New Ideas tab (#work-feed): the ideas as the Work Feed's cards, on the same gray inset. Each card has
 * a picture for its kind, the title, "Idea #n · project · who filed it · score · when", and on the right Approve (your
 * good verdict, one tap) while you can still give it, else where it stands. Clicking a card unfolds it in place for a
 * quick glance (its summary and description, and a link to the whole idea); clicking its head folds it.
 */
export function IdeaFeed({ slug, ideas, empty }: { slug: ProjectRef; ideas: IdeaListRow[]; empty?: React.ReactNode }) {
  // The opened card, or null for none.
  const [openId, setOpenId] = useState<string | null>(null);
  if (ideas.length === 0) return <div className="rounded-2xl border border-zk-border bg-white p-5">{empty}</div>;
  return (
    <ul className="m-0 flex list-none flex-col gap-3 rounded-xl bg-zk-bg p-4" aria-label="Ideas">
      {ideas.map((idea) => {
        const opened = openId === idea.id;
        const id = `idea-feed-detail-${idea.id}`;
        const head = (
          <button
            type="button"
            aria-expanded={opened}
            aria-controls={opened ? id : undefined}
            onClick={() => setOpenId(opened ? null : idea.id)}
            className={`flex min-w-0 flex-1 cursor-pointer items-center gap-4 rounded-lg text-left ${focus}`}
          >
            <IssueThumb item={{ title: idea.title, files: [] }} />
            <span className="min-w-0 flex-1">
              <span className={`block text-[15px] font-semibold text-zk-text ${opened ? "" : "truncate"}`}>{cleanTitle(idea.title)}</span>
              <span className="mt-0.5 block truncate text-[13px] text-zk-muted">
                <span className="tabular-nums">Idea #{idea.number}</span>
                {idea.projectName ? ` · ${idea.projectName}` : ""}
                {idea.reporterName ? ` · ${idea.reporterName}` : ""}
                {` · score ${idea.threshold === null ? idea.score : `${idea.score}/${idea.threshold}`}`} · <LocalTime date={idea.createdAt} />
              </span>
            </span>
          </button>
        );
        return (
          <li key={idea.id} data-testid="idea-row">
            {opened ? (
              // Opened, the card unfolds downwards, as the Work Feed's do.
              <article id={id} className="my-1 rounded-2xl border border-zk-border bg-white px-5 pb-5 pt-4 shadow-[0_2px_10px_rgba(0,0,0,0.06)]">
                <div className="flex flex-wrap items-center gap-4 border-b border-zk-divider pb-4">
                  {head}
                  <IdeaAction idea={idea} />
                </div>
                <div className="pt-4 text-[14.5px] leading-relaxed text-zk-text2">
                  {/* The summary, unless the description already opens with it. */}
                  {idea.summary && !idea.body?.trimStart().startsWith(idea.summary.trim().split("\n")[0]) ? <p className="m-0 mb-3 whitespace-pre-line">{idea.summary}</p> : null}
                  {idea.body ? (
                    <RichText content={idea.body} className="text-[14.5px] [&_h1]:text-[14.5px] [&_h2]:text-[14.5px] [&_h3]:text-[14.5px] [&_h4]:text-[14.5px] [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold" />
                  ) : idea.summary ? null : (
                    <p className="m-0 text-zk-muted">No description.</p>
                  )}
                  {idea.reporterName ? <p className="m-0 mt-4 text-[13.5px] text-zk-muted">Filed by {idea.reporterName}</p> : null}
                </div>
                {/* At the bottom: the whole idea, with its verdicts. */}
                <Link href={ideaPath(idea.ref ?? slug, idea.number)} className={`mt-5 inline-flex items-center gap-1 text-[13.5px] font-medium text-zk-accent hover:underline ${focus}`}>
                  Open the full idea
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </Link>
              </article>
            ) : (
              <div className="flex items-center gap-4 rounded-2xl border border-zk-border bg-white px-5 py-4 transition hover:bg-zk-bg">
                {head}
                {/* On a phone the title needs the width: Approve shows once the card is opened. */}
                <IdeaAction idea={idea} className="max-sm:hidden" />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A card's right: Approve while the viewer can give it a good verdict; else where the idea stands, as a pill. */
function IdeaAction({ idea, className = "" }: { idea: IdeaListRow; className?: string }) {
  const [approved, setApproved] = useState(Boolean(idea.approvedByMe));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const reached = idea.threshold !== null && idea.score >= idea.threshold;

  const pill = (label: string, tone: keyof typeof PILL_TONES) => (
    <span className={`${PILL} ${className}`} style={PILL_TONES[tone]}>{label}</span>
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
    <div className={`flex shrink-0 flex-col items-end gap-1 ${className}`}>
      <button
        type="button"
        onClick={approve}
        disabled={pending}
        aria-label={`Approve idea #${idea.number}: give it your good verdict`}
        // A real button, as on the ideas list before: solid green, raised, with a hover and a press, unlike the pills.
        className={`inline-flex h-6 cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border border-[#1f9d55] bg-[#22a85b] px-2 text-[11.5px] font-bold text-white shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition hover:brightness-110 active:translate-y-px active:shadow-none disabled:cursor-default disabled:opacity-60 ${focus} ${error ? "ring-2 ring-zk-bad-fg" : ""}`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 10v11M15 5.9 14 10h5.8a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 18.4 21H7V10l4-8a3.1 3.1 0 0 1 4 3.9zM3 10h4v11H3z" /></svg>
        Approve
      </button>
      {error ? <p role="alert" className="m-0 max-w-[220px] text-[12px] text-zk-bad-fg">{error}</p> : null}
    </div>
  );
}
