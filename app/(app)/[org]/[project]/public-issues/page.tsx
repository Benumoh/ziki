import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { listPublicIssues, parsePublicIssueStatus, type PublicIssueStatusFilter } from "@/lib/public-issues";
import {
  publicIssueDetailPath,
  publicIssuesPath,
  publicProjectPath,
  publicContributePath,
} from "@/lib/public-project-paths";
import { findPublicProject } from "@/lib/public-projects";
import { pageMetadata } from "@/lib/seo/site";
import { LocalTime } from "@/components/local-time";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ q?: string; status?: string }>;
};

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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, project: projectSlug } = await params;
  const project = await findPublicProject({ orgSlug: org, projectSlug });
  if (!project) return { title: "Not found" };
  return pageMetadata({
    title: `Public issues — ${project.name}`,
    description: `Browse public issues for ${project.name}.`,
    path: publicIssuesPath({ orgSlug: project.organisation.slug, projectSlug: project.slug }),
  });
}

function filterHref(base: string, status: PublicIssueStatusFilter, query: string): string {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (query) params.set("q", query);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export default async function PublicIssuesPage({ params, searchParams }: Props) {
  const [{ org, project: projectSlug }, search] = await Promise.all([params, searchParams]);
  const ref = { orgSlug: org, projectSlug };
  const status = parsePublicIssueStatus(search.status);
  const query = (search.q ?? "").trim();

  const data = await listPublicIssues(ref, { status, query });
  if (!data) notFound();

  const { project, issues } = data;
  const basePath = publicIssuesPath(ref);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 pb-10">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <Link
            href={publicProjectPath(ref)}
            className="inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-zk-accent hover:underline"
          >
            ← Back to {project.name}
          </Link>
          <h1 className="text-2xl font-extrabold tracking-tight text-zk-text sm:text-3xl">
            Public issues
          </h1>
          <p className="text-sm text-zk-text2">
            Browse existing public issues for {project.name} before submitting a new report.
          </p>
        </div>

        {project.acceptsGuestIdeas ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={publicContributePath(ref, "problem")}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-zk-border bg-zk-surface px-4 py-2 text-sm font-semibold text-zk-text hover:bg-zk-chip"
            >
              Report a problem
            </Link>
            <Link
              href={publicContributePath(ref, "improvement")}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-zk-accent px-4 py-2 text-sm font-bold text-white hover:opacity-90"
            >
              Suggest an improvement
            </Link>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-zk-border bg-zk-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Issue status filter" className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => {
            const active = status === tab.value;
            return (
              <Link
                key={tab.value}
                href={filterHref(basePath, tab.value, query)}
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

        <form action={basePath} method="get" className="flex w-full gap-2 sm:w-auto">
          {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search issues..."
            aria-label="Search public issues"
            className="w-full rounded-xl border border-zk-border bg-zk-card px-3 py-1.5 text-sm text-zk-text placeholder:text-zk-muted focus:border-zk-accent focus:outline-none focus:ring-1 focus:ring-zk-accent sm:w-64"
          />
          <button
            type="submit"
            className="inline-flex min-h-[36px] shrink-0 cursor-pointer items-center justify-center rounded-xl bg-electric-blue-strong px-4 py-1.5 text-sm font-bold text-white transition hover:brightness-110"
          >
            Search
          </button>
        </form>
      </div>

      {issues.length === 0 ? (
        <div className="rounded-2xl border border-zk-border bg-zk-surface p-10 text-center">
          <h2 className="text-base font-semibold text-zk-text">No public issues found</h2>
          <p className="mt-1 text-sm text-zk-text2">
            {query || status !== "all"
              ? "Try clearing your search or choosing another status filter."
              : "No public issues are listed for this project yet."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zk-divider overflow-hidden rounded-2xl border border-zk-border bg-zk-surface">
          {issues.map((issue) => (
            <li key={issue.id}>
              <Link
                href={publicIssueDetailPath(ref, issue.number)}
                className="block p-4 transition hover:bg-zk-chip/50 focus:bg-zk-chip/50 focus:outline-none sm:p-5"
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
    </div>
  );
}
