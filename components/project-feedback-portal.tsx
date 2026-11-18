import { PortalSearch } from "@/components/portal-search";
import { PublicFeedbackIdeas } from "@/components/public-feedback-ideas";
import { listPublicFeedbackIdeas } from "@/lib/public-feedback-ideas";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { listPublicIssues, parsePublicIssueStatus, type PublicIssueStatusFilter } from "@/lib/public-issues";
import { publicIssueDetailPath, publicFeedbackPath, publicOrgFeedbackPath, type PublicProjectRef } from "@/lib/public-project-paths";
import { findFeedbackProject, listOrgFeedbackProjects } from "@/lib/public-projects";
import { LocalTime } from "@/components/local-time";
import { PublicFeedbackVote } from "@/components/public-feedback-vote";
export type FeedbackSearch = { q?: string; status?: string; sort?: string; kind?: string };
const STATUS_TABS: Array<{ value: PublicIssueStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Live" },
];

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "In review",
  merge: "Ready to merge",
  resolved: "Live",
  closed: "Closed",
};

function filterHref(base: string, status: PublicIssueStatusFilter, query: string, sort: string, kind?: string): string {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (kind) params.set("kind", kind);
  if (query) params.set("q", query);
  if (sort === "recent") params.set("sort", sort);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export async function ProjectFeedbackPortal({ projectRef: ref, search }: { projectRef: PublicProjectRef; search: FeedbackSearch }) {
  const status = parsePublicIssueStatus(search.status);
  const query = (search.q ?? "").trim().slice(0, 200);
  const sort = search.sort === "recent" ? "recent" : "votes";

  const kind = search.kind === "problem" || search.kind === "improvement" ? search.kind : undefined;
  const [project, data] = await Promise.all([findFeedbackProject(ref), listPublicIssues(ref, { status, query, sort, kind })]);
  if (!project) notFound();
  const [portal, ideas] = await Promise.all([listOrgFeedbackProjects(ref.orgSlug), listPublicFeedbackIdeas(ref.orgSlug, { projectSlug: ref.projectSlug, query })]);
  const issues = data?.issues ?? [];
  const basePath = publicFeedbackPath(ref);

  return (
    <div className="mx-auto w-full max-w-[920px] space-y-6 pb-10">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <Link
            href={publicOrgFeedbackPath(ref.orgSlug)}
            className="inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-zk-accent hover:underline"
          >
            ← All projects
          </Link>
          <h1 className="text-2xl font-extrabold tracking-tight text-zk-text sm:text-3xl">
            {project.name} feedback
          </h1>
          <p className="text-sm text-zk-text2">
            Browse feedback or share a problem or suggestion. New reports are added as ideas for agents to review.
          </p>
        </div>

        {(
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={publicFeedbackPath(ref, "problem")}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-zk-border bg-zk-surface px-4 py-2 text-sm font-semibold text-zk-text hover:bg-zk-chip"
            >
              Report a problem
            </Link>
            <Link
              href={publicFeedbackPath(ref, "improvement")}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-zk-accent px-4 py-2 text-sm font-bold text-white hover:opacity-90"
            >
              Suggest an improvement
            </Link>
          </div>
        )}
      </div>

      <nav aria-label="Project feedback" className="flex flex-wrap gap-2">
        <Link href={publicOrgFeedbackPath(ref.orgSlug)} className="rounded-xl border border-zk-border bg-zk-surface px-4 py-2 text-sm font-semibold text-zk-text2 hover:bg-zk-chip">All feedback</Link>
        {portal?.projects.map(item => <Link key={item.id} href={publicFeedbackPath({ orgSlug: ref.orgSlug, projectSlug: item.slug })} aria-current={item.slug === ref.projectSlug ? "page" : undefined} className={`rounded-xl border px-4 py-2 text-sm font-semibold ${item.slug === ref.projectSlug ? "border-zk-accent bg-zk-tint text-zk-accent" : "border-zk-border bg-zk-surface text-zk-text2 hover:bg-zk-chip"}`}>{item.name}</Link>)}
      </nav>
      <PublicFeedbackIdeas orgSlug={ref.orgSlug} ideas={ideas} />
      <h2 className="text-lg font-bold text-zk-text">Issues being worked on</h2>
      <nav aria-label="Feedback type" className="flex flex-wrap gap-2">
        {([{ value: undefined, label: "All feedback" }, { value: "problem", label: "Problems" }, { value: "improvement", label: "Suggestions" }] as const).map(tab => (
          <Link key={tab.label} href={filterHref(basePath, status, query, sort, tab.value)} aria-current={kind === tab.value ? "page" : undefined} className={`rounded-xl border px-3 py-1.5 text-sm font-semibold ${kind === tab.value ? "border-zk-accent bg-zk-tint text-zk-accent" : "border-zk-border bg-zk-surface text-zk-text2 hover:bg-zk-chip"}`}>{tab.label}</Link>
        ))}
      </nav>
      <div className="flex flex-col gap-3 rounded-2xl border border-zk-border bg-zk-surface p-4 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Issue status filter" className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => {
            const active = status === tab.value;
            return (
              <Link
                key={tab.value}
                href={filterHref(basePath, tab.value, query, sort, kind)}
                aria-current={active ? "page" : undefined}
                className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-zk-accent ${
                  active
                    ? "bg-zk-accent text-white"
                    : "border border-zk-border bg-zk-card text-zk-text2 hover:text-zk-text"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <form action={basePath} method="get" className="flex w-full flex-wrap gap-2 lg:w-auto">
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
          <PortalSearch label="Search public issues" defaultValue={query} />
          <select name="sort" defaultValue={sort} aria-label="Sort feedback" className="rounded-xl border border-zk-border bg-zk-surface px-2 py-1.5 text-sm text-zk-text">
            <option value="votes">Most voted</option><option value="recent">Recently updated</option>
          </select>
          <button type="submit" className="inline-flex h-8 items-center rounded-lg border border-zk-border bg-zk-surface px-3 text-xs font-semibold text-zk-text hover:bg-zk-chip">Apply filters</button>
        </form>
      </div>

      {issues.length === 0 ? (
        <div className="rounded-2xl border border-zk-border bg-zk-surface p-10 text-center">
          <h2 className="text-base font-semibold text-zk-text">No feedback found</h2>
          <p className="mt-1 text-sm text-zk-text2">
            {project.visibility !== "public"
              ? "This project keeps its feedback private. Share a report and use your private tracking link for updates."
              : query || status !== "all" || kind
              ? "Try clearing your search or choosing another status filter."
              : "No public feedback is listed for this project yet. You can share a report using the buttons above."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zk-divider overflow-hidden rounded-2xl border border-zk-border bg-zk-surface">
          {issues.map((issue) => (
            <li key={issue.id} className="flex items-start gap-4 p-4 sm:p-5">
              <PublicFeedbackVote project={ref} number={issue.number} count={issue._count.publicFeedbackVotes} />
              <Link
                href={publicIssueDetailPath(ref, issue.number)}
                className="block min-w-0 flex-1 transition hover:bg-zk-chip/50 focus:bg-zk-chip/50 focus:outline-none"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zk-muted">
                      <span className="font-mono font-semibold text-zk-text2">#{issue.number}</span>
                      {issue.area ? (
                        <Badge className="border border-zk-border bg-zk-chip text-[11px] text-zk-text2">
                          {issue.area.name}
                        </Badge>
                      ) : null}
                      <span>
                        Updated <LocalTime date={issue.updatedAt} />
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-zk-text">{issue.title}</h2>
                    {issue.type ? <p className="text-xs text-zk-muted">{issue.type.name}</p> : null}
                    {issue.summary ? (
                      <p className="line-clamp-2 text-sm text-zk-text2">{issue.summary}</p>
                    ) : null}
                  </div>
                  <Badge className="shrink-0 border border-zk-border bg-zk-chip text-xs font-semibold text-zk-text2">
                    {STATUS_LABELS[issue.status] ?? issue.status}
                  </Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-zk-muted">Found your issue? Vote for it instead of creating another report.</p>
    </div>
  );
}
