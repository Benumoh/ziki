import { PublicReportProgress } from "@/components/public-report-progress";
import { stateLabel } from "@/lib/labels";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { RichText } from "@/components/rich-text";
import { LocalTime } from "@/components/local-time";
import { findPublicIssue } from "@/lib/public-issues";
import {
  publicIssueDetailPath,
  publicFeedbackPath,

} from "@/lib/public-project-paths";
import { pageMetadata } from "@/lib/seo/site";
import { PublicFeedbackVote } from "@/components/public-feedback-vote";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ org: string; project: string; number: string }>;
  searchParams: Promise<{ view?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, project: projectSlug, number } = await params;
  const issueNumber = Number(number);
  const data = await findPublicIssue({ orgSlug: org, projectSlug }, issueNumber);
  if (!data) return { title: "Not found" };
  return pageMetadata({
    title: `#${data.issue.number} ${data.issue.title} — ${data.project.name}`,
    description: data.issue.summary ?? `Public issue #${data.issue.number} in ${data.project.name}.`,
    path: publicIssueDetailPath(
      { orgSlug: data.project.organisation.slug, projectSlug: data.project.slug },
      data.issue.number,
    ),
  });
}

export default async function PublicIssueDetailPage({ params, searchParams }: Props) {
  const { org, project: projectSlug, number } = await params;
  const issueNumber = Number(number);
  const ref = { orgSlug: org, projectSlug };
  const data = await findPublicIssue(ref, issueNumber);
  if (!data) notFound();

  const { project, issue } = data;
  const state = stateLabel(issue.substatus);
  if ((await searchParams).view === "tracking") return (
    <div className="mx-auto w-full max-w-[920px] space-y-5 pb-10">
      <Link href={publicIssueDetailPath(ref, issue.number)} className="text-sm font-semibold text-zk-accent hover:underline">← Issue details</Link>
      <h1 className="text-[28px] font-extrabold tracking-tight text-zk-text">Track this issue</h1>
      <PublicReportProgress title={issue.title} number={`#${issue.number}`} state={state} summary={issue.summary} description={issue.description} createdAt={issue.createdAt} updatedAt={issue.updatedAt} issue={issue} inactive={issue.status === "closed"} />
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[920px] space-y-6 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={publicFeedbackPath(ref)}
          className="inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-zk-accent hover:underline"
        >
          ← All feedback
        </Link>
        {project.acceptsGuestIdeas ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={publicFeedbackPath(ref, "problem")}
              className="inline-flex min-h-9 items-center justify-center rounded-xl border border-zk-border bg-zk-surface px-3 py-1.5 text-xs font-semibold text-zk-text hover:bg-zk-chip"
            >
              Report a problem
            </Link>
            <Link
              href={publicFeedbackPath(ref, "improvement")}
              className="inline-flex min-h-9 items-center justify-center rounded-xl bg-zk-accent px-3 py-1.5 text-xs font-bold text-white hover:opacity-90"
            >
              Suggest an improvement
            </Link>
          </div>
        ) : null}
      </div>

      <article className="space-y-5 rounded-2xl border border-zk-border bg-zk-surface p-5 sm:p-7">
        <header className="space-y-3 border-b border-zk-divider pb-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-zk-text2">#{issue.number}</span>
            <Badge className="border border-zk-border bg-zk-chip text-xs font-semibold text-zk-text2">
              {state}
            </Badge>
            {issue.area ? (
              <Badge className="border border-zk-border bg-zk-chip text-xs text-zk-text2">
                {issue.area.name}
              </Badge>
            ) : null}
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">{issue.title}</h1>
          <PublicFeedbackVote project={ref} number={issue.number} count={issue._count.publicFeedbackVotes} detailed />
          <p className="text-xs text-zk-muted">
            Opened <LocalTime date={issue.createdAt} /> · Updated <LocalTime date={issue.updatedAt} />
          </p>
        </header>

        <aside aria-label="Status" className="rounded-xl border border-zk-border bg-zk-card p-4 text-sm">
          <h2 className="font-bold text-zk-text">Status</h2><p className="mt-1 text-zk-text2">{state}</p>
          <h2 className="mt-3 font-bold text-zk-text">Last updated</h2><p className="mt-1 text-zk-text2"><LocalTime date={issue.updatedAt} /></p>
        </aside>
        {issue.summary ? (
          <section aria-labelledby="public-issue-summary">
            <h2 id="public-issue-summary" className="text-sm font-bold uppercase tracking-wider text-zk-muted">
              What happened
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zk-text">{issue.summary}</p>
          </section>
        ) : null}

        <section aria-labelledby="public-issue-description">
          <h2 id="public-issue-description" className="text-sm font-bold uppercase tracking-wider text-zk-muted">
            Details
          </h2>
          {issue.description ? (
            <RichText
              content={issue.description}
              className="!mt-2 !text-zk-text [&_a]:!text-zk-accent [&_pre]:!bg-zk-chip [&_pre]:!text-zk-text"
            />
          ) : (
            <p className="mt-2 text-sm text-zk-muted">No additional details were provided.</p>
          )}
        </section>
        <Link href={`${publicIssueDetailPath(ref, issue.number)}?view=tracking`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-zk-accent hover:underline">Track this issue →</Link>
      </article>
    </div>
  );
}
