import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { feedProject, feedWhere, FEED_PAGE_SIZE } from "@/lib/feed";
import { prisma } from "@/lib/prisma";
import { LocalTime } from "@/components/local-time";
import { issueHref } from "@/lib/issue-ref";

export const metadata = { title: "New-ticket feed" };

export default async function FeedPage({ searchParams }: {
  searchParams: Promise<{ projectId?: string | string[] }>;
}) {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  const { projectId } = await searchParams;
  if (Array.isArray(projectId)) notFound();
  const project = organisationId ? await feedProject(organisationId, projectId) : null;
  if (organisationId && !project) notFound();
  const issues = organisationId && project ? await prisma.bug.findMany({
    where: feedWhere(organisationId, project.id, null),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: FEED_PAGE_SIZE,
    select: { id: true, number: true, title: true, status: true, createdAt: true, project: { select: { slug: true, organisation: { select: { slug: true } } } } },
  }) : [];
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">New-ticket feed</h1>
        <p className="mt-2 text-sm text-zk-muted">
          The newest {FEED_PAGE_SIZE} issues{project ? ` in ${project.name}` : " in your organisation"}, newest first.
        </p>
      </div>
      {issues.length ? (
        <ul className="divide-y divide-zk-divider overflow-hidden rounded-panel border border-zk-border bg-zk-surface">
          {issues.map((issue) => (
            <li key={issue.id} className="p-4">
              <Link href={issueHref(issue)} className="font-semibold text-zk-accent hover:underline">
                #{issue.number} {issue.title}
              </Link>
              <p className="mt-1 text-sm text-zk-muted">
                <span className="inline-flex items-center rounded-full bg-zk-info-bg px-2 py-0.5 text-xs font-semibold text-zk-info-fg">
                  {issue.status.replaceAll("_", " ")}
                </span>
                {" · "}
                <LocalTime date={issue.createdAt} />
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-panel border border-zk-border bg-zk-surface p-6 text-zk-muted">
          {organisationId ? "No new tickets in this project yet." : "Join an organisation to see its new tickets."}{" "}
          <Link href="/feed" className="font-semibold text-zk-accent hover:underline">Refresh the feed</Link>
          {" "}or{" "}
          <Link href="/home" className="font-semibold text-zk-accent hover:underline">browse issues</Link>.
        </p>
      )}
      <Link
        href={project ? `/feed?projectId=${encodeURIComponent(project.id)}` : "/feed"}
        className="inline-flex text-sm font-semibold text-zk-accent hover:underline"
      >
        Refresh newest tickets
      </Link>
    </section>
  );
}
