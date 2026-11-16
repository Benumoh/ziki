import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { RichText } from "@/components/rich-text";
import { LocalTime } from "@/components/local-time";
import { findPublicIssue } from "@/lib/public-issues";
import {
  publicIssueDetailPath,
  publicIssuesPath,
  publicContributePath,
} from "@/lib/public-project-paths";
import { pageMetadata } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ org: string; project: string; number: string }>;
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "In review",
  merge: "Ready to merge",
  resolved: "Live",
  closed: "Closed",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, project: projectSlug, number } = await params;
  const issueNumber = Number.parseInt(number, 10);
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

export default async function PublicIssueDetailPage({ params }: Props) {
  const { org, project: projectSlug, number } = await params;
  const issueNumber = Number.parseInt(number, 10);
  const ref = { orgSlug: org, projectSlug };
  const data = await findPublicIssue(ref, issueNumber);
  if (!data) notFound();

  const { project, issue } = data;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={publicIssuesPath(ref)}
          className="inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-zk-accent hover:underline"
        >
          ← Back to public issues
        </Link>
        {project.acceptsGuestIdeas ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={publicContributePath(ref, "problem")}
              className="inline-flex min-h-9 items-center justify-center rounded-xl border border-zk-border bg-zk-surface px-3 py-1.5 text-xs font-semibold text-zk-text hover:bg-zk-chip"
            >
              Report a problem
            </Link>
            <Link
              href={publicContributePath(ref, "improvement")}
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
              {STATUS_LABELS[issue.status] ?? issue.status}
            </Badge>
            {issue.area ? (
              <Badge className="border border-zk-border bg-zk-chip text-xs text-zk-text2">
                {issue.area.name}
              </Badge>
            ) : null}
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">{issue.title}</h1>
          <p className="text-xs text-zk-muted">
            Opened <LocalTime date={issue.createdAt} /> · Updated <LocalTime date={issue.updatedAt} />
          </p>
        </header>

        {issue.summary ? (
          <section aria-labelledby="public-issue-summary">
            <h2 id="public-issue-summary" className="text-sm font-bold uppercase tracking-wider text-zk-muted">
              Summary
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
      </article>
    </div>
  );
}
