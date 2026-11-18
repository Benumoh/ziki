import type { IdeaStatus } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RichText } from "@/components/rich-text";
import { LocalTime } from "@/components/local-time";
import { ReportSummary } from "@/components/report-summary";
import { stateLabel, statusLabel } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { findFeedbackProject, publicTrackingTokenHash } from "@/lib/public-projects";
import { publicFeedbackPath, publicProjectPath } from "@/lib/public-project-paths";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Track a public report", robots: { index: false, follow: false } };

const ideaStatusLabel: Record<IdeaStatus, string> = {
  open: "Awaiting triage",
  converted: "Converted to an issue",
  rejected: "Rejected",
  archived: "Archived",
};

export default async function PublicTrackingPage({ params }: { params: Promise<{ org: string; project: string; token: string }> }) {
  const { org, project: projectSlug, token } = await params;
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) notFound();
  const ref = { orgSlug: org, projectSlug };
  const project = await findFeedbackProject(ref);
  if (!project) notFound();
  const backHref = project.visibility === "public" ? publicProjectPath(ref) : publicFeedbackPath(ref);
  const idea = await prisma.idea.findFirst({
    where: { projectId: project.id, publicTrackingTokenHash: publicTrackingTokenHash(token), source: "public", isDeleted: false },
    select: {
      number: true,
      title: true,
      summary: true,
      description: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      issue: { select: { number: true, status: true, substatus: true } },
    },
  });
  if (!idea) notFound();
  const state = idea.issue
    ? `Issue #${idea.issue.number} · ${idea.issue.substatus ? stateLabel(idea.issue.substatus) : statusLabel[idea.issue.status]}`
    : ideaStatusLabel[idea.status];
  const progress = idea.issue
    ? { title: "Your report is now an issue", detail: `Agents can work on issue #${idea.issue.number} through Ziki's normal workflow.`, tone: "border-zk-ok-fg/40 bg-zk-ok-bg", dot: "bg-zk-ok-fg" }
    : idea.status === "open"
      ? { title: "Report received", detail: "The project can now review this idea. Submitting it did not assign work or give the guest account project permissions.", tone: "border-zk-info-fg/40 bg-zk-info-bg", dot: "bg-zk-info-fg" }
      : idea.status === "rejected"
        ? { title: "Review complete", detail: "The project reviewed this report and did not convert it into an issue.", tone: "border-zk-bad-fg/40 bg-zk-bad-bg", dot: "bg-zk-bad-fg" }
        : { title: "Report archived", detail: "This report is no longer in the active idea queue.", tone: "border-zk-border bg-zk-chip", dot: "bg-zk-muted" };

  return (
    <div className="flex flex-col gap-5 pb-10">
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <Link href={backHref} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded text-sm font-semibold text-zk-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zk-accent">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to {project.name}
          </Link>
        </div>
        <h1 className="min-w-0 break-words text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-zk-text">
          <span className="font-bold tabular-nums text-zk-muted">Idea #{idea.number}</span> {idea.title}
        </h1>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <main className="flex min-w-0 flex-[999_1_600px] flex-col gap-5">
          <section aria-label="Report progress" className={`flex items-start gap-3 rounded-2xl border-2 px-4 py-3 ${progress.tone}`}>
            <span aria-hidden className={`mt-1 h-3 w-3 shrink-0 rounded-full ${progress.dot}`} />
            <div>
              <p className="m-0 text-[15px] font-extrabold text-zk-text">{progress.title}</p>
              <p className="m-0 mt-0.5 text-[13px] leading-5 text-zk-text2">{progress.detail}</p>
            </div>
          </section>

          <ReportSummary summary={idea.summary} />

          <section className="rounded-[20px] border border-zk-border bg-zk-surface p-5 sm:p-6">
            <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">Description</h2>
            <RichText content={idea.description} className="mt-3 text-sm text-zk-text" />
          </section>
        </main>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <section aria-label="Status" className="flex flex-col gap-2.5 rounded-[20px] border border-zk-border bg-zk-surface px-4 py-3.5">
            <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">Status</h2>
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-zk-tint px-2.5 py-1 text-xs font-bold text-zk-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                {state}
              </span>
            </div>
            <p className="text-xs leading-5 text-zk-muted">
              Submitted <LocalTime date={idea.createdAt} /> · updated <LocalTime date={idea.updatedAt} />
            </p>
          </section>

          <section aria-label="Privacy" className="rounded-[20px] border border-zk-border bg-zk-surface px-4 py-3.5">
            <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">Private tracking link</h2>
            <p className="mt-2 text-xs leading-5 text-zk-text2">Keep this URL private. It is the key to this page and lets you return for status updates without an account.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
