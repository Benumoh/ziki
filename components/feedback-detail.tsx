import { ideaVotes, isBadIdea } from "@/lib/idea-rejection";
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { FeedbackPageHeader } from "@/components/feedback-page-header";
import { LocalTime } from "@/components/local-time";
import { RichText } from "@/components/rich-text";
import { IdeaVoteTotals, ideaScoreText, opinionChipClass, opinionLabels } from "@/components/idea-verdicts";
import { FeedbackDetailCopy } from "@/components/feedback-detail-copy";
import { feedbackTextLink } from "@/components/feedback-portal-styles";
import { feedbackSubmitterName } from "@/lib/public-feedback-ideas";
import { publicSubmissionStatus } from "@/lib/public-submission-status";
import { PILL_TONES } from "@/lib/pill-tones";
export const feedbackDetailSelect = {
  number: true, title: true, summary: true, description: true, status: true, score: true, createdAt: true, updatedAt: true,
  reporter: { select: { name: true } }, publicSubmission: { select: { user: { select: { name: true } } } },
  project: { select: { name: true, slug: true, visibility: true, organisation: { select: { name: true, slug: true } }, workflow: { select: { ideaThreshold: true } } } },
  issue: { select: { number: true, status: true, substatus: true, updatedAt: true } },
  verdicts: { select: { id: true, opinion: true, votes: true, summary: true, updatedAt: true, agent: { select: { name: true } } }, orderBy: { updatedAt: "desc" } },
} satisfies Prisma.IdeaSelect;
type Detail = Prisma.IdeaGetPayload<{ select: typeof feedbackDetailSelect }>;
export function FeedbackDetail({ idea, confirmationHref, trackingPath, issueHref }: { idea: Detail; confirmationHref?: string; trackingPath?: string; issueHref?: string }) {
  const votes = { good: 0, bad: 0, neutral: 0 };
  for (const verdict of idea.verdicts) votes[verdict.opinion] += verdict.votes;
  const threshold = idea.project.workflow?.ideaThreshold ?? 3;
  const awaitingRejection = idea.status === "open" && !idea.issue && isBadIdea(ideaVotes(idea.verdicts), threshold);
  const tone = idea.status === "rejected" || awaitingRejection ? "red" : idea.status === "converted" ? "green" : idea.status === "archived" ? "grey" : "teal";
  return <div className="space-y-4 pb-6">
    <FeedbackPageHeader title={idea.title} identity={idea.project.name} description={`${idea.project.name} · Idea #${idea.number}`} />
    <p className="text-sm text-zk-muted">Submitted by {feedbackSubmitterName(idea)} · <LocalTime date={idea.createdAt} /></p>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <section className="rounded-panel border border-zk-border bg-zk-surface p-5 sm:p-6"><h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">Description</h2><RichText content={idea.description || idea.summary || ""} className="mt-3 text-sm leading-6 text-zk-text" /></section>
        <section className="space-y-4 rounded-panel border border-zk-border bg-zk-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">Agent verdicts <span className="ml-1 font-normal">{idea.verdicts.length}</span></h2><div className="flex flex-wrap items-center gap-3"><span className="rounded-chip bg-zk-tint px-2 py-1 text-xs font-semibold text-zk-accent">{ideaScoreText(idea.score, threshold)}</span><IdeaVoteTotals votes={votes} /></div></div>
          <p className="text-sm text-zk-text2">Agents review feedback before it becomes an issue.</p>
          {idea.verdicts.length ? <ul className="divide-y divide-zk-divider">{idea.verdicts.map(verdict => <li key={verdict.id} className="space-y-2 py-3"><div className="flex flex-wrap items-center gap-2 text-sm"><span>{verdict.agent?.name ?? "Agent review"}</span><span className={`rounded-chip px-2 py-0.5 text-xs ${opinionChipClass[verdict.opinion]}`}>{opinionLabels[verdict.opinion]}</span><span className="text-xs text-zk-muted"><LocalTime date={verdict.updatedAt} /></span></div><p className="whitespace-pre-wrap break-words text-sm text-zk-text2">{verdict.summary}</p></li>)}</ul> : <p className="text-sm text-zk-muted">No verdicts yet.</p>}
        </section>
      </div>
      <aside className="min-w-0 space-y-4">
        <section className="space-y-3 rounded-panel border border-zk-border bg-zk-surface px-4 py-3.5"><h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">Status</h2><span className="inline-flex rounded-chip px-2 py-1 text-xs" style={PILL_TONES[tone]}>{awaitingRejection ? "Awaiting rejection decision" : publicSubmissionStatus(idea)}</span><p className="text-sm leading-6 text-zk-text2">{awaitingRejection ? "The votes meet this project’s rejection criteria. A final rejection decision is pending." : idea.status === "open" ? `Net votes: ${idea.score} of ${threshold} needed before conversion to an issue.` : idea.status === "rejected" ? "The feedback was reviewed and rejected." : idea.status === "converted" ? "This feedback became an issue." : "This feedback is archived."}</p><div className="border-t border-zk-divider pt-3"><h3 className="text-sm font-medium">Latest update</h3><p className="mt-2 text-sm text-zk-text2">{awaitingRejection ? "Agent votes meet the rejection criteria; no final rejection has been recorded yet." : idea.verdicts.length ? `${idea.verdicts.length} verdict${idea.verdicts.length === 1 ? "" : "s"} received.` : "Feedback received and awaiting review."}</p><p className="mt-1 text-xs text-zk-muted"><LocalTime date={idea.issue?.updatedAt ?? idea.updatedAt} /></p></div>{issueHref ? <Link href={issueHref} className={feedbackTextLink}>View issue #{idea.issue?.number} →</Link> : null}</section>
        {confirmationHref || trackingPath ? <section className="space-y-3 rounded-panel border border-zk-border bg-zk-surface px-4 py-3.5"><h2 className="text-base font-medium">Your report</h2>{confirmationHref ? <div><Link href={confirmationHref} className={feedbackTextLink}>View submission confirmation →</Link></div> : null}{trackingPath ? <FeedbackDetailCopy path={trackingPath} /> : null}</section> : null}
      </aside>
    </div>

  </div>;
}
