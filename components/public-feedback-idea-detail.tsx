import Link from "next/link";
import { notFound } from "next/navigation";
import { RichText } from "@/components/rich-text";
import { LocalTime } from "@/components/local-time";
import { feedbackSubmitterName, listPublicFeedbackIdeas } from "@/lib/public-feedback-ideas";
import { ideaPath, projectRef } from "@/lib/project-paths";
import { publicOrgFeedbackPath, type PublicProjectRef } from "@/lib/public-project-paths";

export async function PublicFeedbackIdeaDetail({ project, number }: { project: PublicProjectRef; number: number }) {
  if (!Number.isSafeInteger(number) || number < 1) notFound();
  const [idea] = await listPublicFeedbackIdeas(project.orgSlug, { projectSlug: project.projectSlug, number });
  if (!idea) notFound();
  const state = { open: "Idea · Awaiting agent review", converted: "Converted to an issue", rejected: "Not proceeding", archived: "Archived" }[idea.status];
  return <div className="mx-auto w-full max-w-[920px] space-y-5 pb-10">
    <Link href={`${publicOrgFeedbackPath(project.orgSlug)}?view=ideas&project=${encodeURIComponent(project.projectSlug)}`} className="text-sm font-semibold text-zk-accent hover:underline">← {idea.project.name} feedback</Link>
    <article className="space-y-5 rounded-2xl border border-zk-border bg-zk-surface p-5 sm:p-7">
      <header className="space-y-3 border-b border-zk-divider pb-5">
        <p className="text-xs text-zk-muted">Idea #{idea.number} · {idea.project.name}</p>
        <h1 className="text-2xl font-extrabold text-zk-text">{idea.title}</h1>
        <span className="inline-block rounded-md bg-zk-tint px-2 py-1 text-xs font-semibold text-zk-accent">{state}</span>
        <p className="text-xs text-zk-muted">Submitted by {feedbackSubmitterName(idea)} · <LocalTime date={idea.createdAt} /> · Updated <LocalTime date={idea.updatedAt} /></p>
      </header>
      {idea.summary ? <section><h2 className="text-sm font-bold text-zk-text">Feedback summary</h2><p className="mt-2 whitespace-pre-wrap text-sm text-zk-text2">{idea.summary}</p></section> : null}
      <section><h2 className="text-sm font-bold text-zk-text">Steps and details</h2><RichText content={idea.description} className="mt-3 text-sm text-zk-text" /></section>
      <section className="border-t border-zk-divider pt-4">
        <h2 className="text-sm font-bold text-zk-text">Agent review</h2>
        <p className="mt-2 text-sm text-zk-text2">Agent score: {idea.score} · {idea._count.verdicts} verdicts. Agents review this idea through the project’s existing Ideas workflow.</p>
        <Link href={ideaPath(projectRef(project.orgSlug, project.projectSlug), idea.number)} className="mt-3 inline-block text-sm font-semibold text-zk-accent hover:underline">Open in Ideas for agent review →</Link>
      </section>
    </article>
  </div>;
}
