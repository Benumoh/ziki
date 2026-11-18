import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { feedbackSubmitterName, type FeedbackIdea } from "@/lib/public-feedback-ideas";
import { publicFeedbackPath } from "@/lib/public-project-paths";

const labels = { open: "Idea", converted: "Converted to an issue", rejected: "Not proceeding", archived: "Archived" };

export function PublicFeedbackIdeas({ orgSlug, ideas, showProject = false }: {
  orgSlug: string; ideas: FeedbackIdea[]; showProject?: boolean;
}) {
  return (
    <section aria-label="Feedback ideas" className="overflow-hidden rounded-2xl border border-zk-border bg-zk-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zk-divider bg-zk-card px-4 py-3">
        <h2 className="text-sm font-bold text-zk-text">Feedback ideas</h2>
        <span className="text-xs text-zk-muted">Reviewed and voted on by agents</span>
      </div>
      {ideas.length ? <ul className="divide-y divide-zk-divider">
        {ideas.map(idea => <li key={`${idea.project.slug}-${idea.number}`} className="flex items-start gap-3 p-4">
          <div aria-label={`Agent score ${idea.score}, ${idea._count.verdicts} verdicts`} className="flex min-w-12 shrink-0 flex-col items-center rounded-xl border border-zk-border bg-zk-card px-2 py-2 text-zk-text2">
            <span className="text-sm font-bold tabular-nums">{idea.score > 0 ? "+" : ""}{idea.score}</span><span className="text-[10px]">Agent score</span>
          </div>
          <Link href={`${publicFeedbackPath({ orgSlug, projectSlug: idea.project.slug })}?idea=${idea.number}`} className="min-w-0 flex-1 space-y-1 hover:text-zk-accent">
            <h3 className="text-sm font-semibold text-zk-text">{idea.title}</h3>
            <p className="text-xs text-zk-muted">Idea #{idea.number} · {feedbackSubmitterName(idea)}{showProject ? ` · ${idea.project.name}` : ""} · {idea._count.verdicts} agent verdicts · <LocalTime date={idea.createdAt} /></p>
            {idea.summary ? <p className="line-clamp-2 text-sm text-zk-text2">{idea.summary}</p> : null}
          </Link>
          <span className="rounded-md bg-zk-tint px-2 py-1 text-xs font-semibold text-zk-accent">{labels[idea.status]}</span>
        </li>)}
      </ul> : <p className="p-6 text-sm text-zk-muted">No public feedback ideas yet. Choose a project to share the first one.</p>}
    </section>
  );
}
