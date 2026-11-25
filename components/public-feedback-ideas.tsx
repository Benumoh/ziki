import { ideaVotes, isBadIdea } from "@/lib/idea-rejection";
import { TILE_TONES, PILL_TONES } from "@/lib/pill-tones";
import { publicSubmissionStatus } from "@/lib/public-submission-status";
import type { ReactNode } from "react";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { feedbackSubmitterName, type FeedbackIdea } from "@/lib/public-feedback-ideas";
import { publicFeedbackPath } from "@/lib/public-project-paths";
const labels = { open: "Awaiting review", converted: "Became an issue", rejected: "Rejected", archived: "Archived" };
export function PublicFeedbackIdeas({ orgSlug, ideas, showProject = false, title = "Feedback ideas", toolbar, viewAllHref, pagination }: { orgSlug: string; ideas: FeedbackIdea[]; showProject?: boolean; title?: string; toolbar?: ReactNode; viewAllHref?: string; pagination?: ReactNode }) {
  return <section aria-label={title} className="overflow-hidden rounded-panel border border-zk-border bg-zk-surface p-4 sm:p-5">
    {toolbar}<div className="mb-2.5 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">{title}</h2>{viewAllHref ? <Link href={viewAllHref} className="text-xs text-zk-accent hover:underline">Show all feedback →</Link> : null}</div>
    {ideas.length ? <div className="rounded-panel bg-zk-bg p-3 sm:p-4"><ul className="space-y-3">{(viewAllHref ? ideas.slice(0, 7) : ideas).map(idea => {
      const awaitingRejection = idea.status === "open" && !idea.issue && isBadIdea(ideaVotes(idea.verdicts), idea.project.workflow?.ideaThreshold ?? 3);
      return <li key={`${idea.project.slug}-${idea.number}`} className="flex items-center gap-4 rounded-panel border border-zk-border bg-zk-surface px-4 py-4 transition-colors hover:bg-zk-bg sm:px-5">
      <span aria-hidden="true" className="flex h-11 w-14 shrink-0 items-center justify-center rounded-control shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]" style={TILE_TONES[(idea.status === "rejected" || awaitingRejection) ? "red" : idea.status === "converted" ? "green" : idea.status === "archived" ? "grey" : "teal"]}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6M10 21h4M8 13a6 6 0 1 1 8 0c-1 .9-1 2-1 2H9s0-1.1-1-2Z" /></svg></span>
      <Link href={`${publicFeedbackPath({ orgSlug, projectSlug: idea.project.slug })}?idea=${idea.number}`} className="group min-w-0 flex-1 space-y-1 rounded-sm text-zk-text hover:text-zk-text hover:no-underline focus-visible:outline-2 focus-visible:outline-zk-accent"><h3 className="line-clamp-2 break-words text-sm font-semibold text-zk-text">{idea.title}</h3><p className="text-xs leading-5 text-zk-muted">Idea #{idea.number} · {feedbackSubmitterName(idea)}{showProject ? ` · ${idea.project.name}` : ""} · <LocalTime date={idea.createdAt} /></p></Link>
      <div className="flex max-w-40 shrink-0 flex-col items-end gap-1 text-right"><span className="rounded-chip px-2 py-1 text-xs" style={PILL_TONES[(idea.status === "rejected" || awaitingRejection) ? "red" : idea.status === "converted" ? "green" : idea.status === "archived" ? "grey" : "teal"]}>{awaitingRejection ? "Awaiting rejection decision" : idea.issue ? publicSubmissionStatus(idea) : labels[idea.status]}</span><span className="text-xs tabular-nums text-zk-muted">{idea._count.verdicts} agent {idea._count.verdicts === 1 ? "vote" : "votes"}</span></div>
    </li>; })}</ul></div> : <p className="px-5 py-8 text-sm text-zk-muted">No matching feedback yet. Share a problem or improvement for this product.</p>}
    {pagination}
  </section>;
}