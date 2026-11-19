import { PortalSearch } from "@/components/portal-search";
import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { publicSubmissionStatus } from "@/lib/public-submission-status";
import { publicIssueDetailPath } from "@/lib/public-project-paths";
import { LocalTime } from "@/components/local-time";
import { PublicSubmissionsSync } from "@/components/public-submissions-sync";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My submissions", robots: { index: false, follow: false } };

export default async function MySubmissionsPage({ searchParams }: { searchParams: Promise<{ q?: string; project?: string }> }) {
  const user = await requireUser();
  const search = await searchParams;
  const query = (search.q ?? "").trim().slice(0, 200);
  const projectId = search.project?.slice(0, 100) ?? "";
  const rows = await prisma.publicSubmission.findMany({
    where: { userId: user.id, idea: { source: "public", isDeleted: false,
      ...(query ? { title: { contains: query, mode: "insensitive" as const } } : {}),
      ...(projectId ? { projectId } : {}),
    } },
    orderBy: { createdAt: "desc" }, take: 100,
    select: { idea: { select: {
      number: true, title: true, status: true, createdAt: true,
      issue: { select: { number: true, status: true, substatus: true } },
      project: { select: { id: true, name: true, slug: true, visibility: true, organisation: { select: { name: true, slug: true } } } },
    } } },
  });
  const projects = await prisma.project.findMany({
    where: { ideas: { some: { publicSubmission: { is: { userId: user.id } }, isDeleted: false, source: "public" } } },
    select: { id: true, name: true, organisation: { select: { name: true } } }, orderBy: { name: "asc" },
  });
  return <div className="mx-auto w-full max-w-[920px] space-y-6 pb-10">
    <Link href="/home" className="inline-flex min-h-8 items-center text-sm font-semibold text-zk-accent hover:underline">← Back to your app</Link>
    <div><h1 className="text-[28px] font-extrabold tracking-tight text-zk-text">My submissions</h1><p className="mt-2 text-sm text-zk-text2">Feedback you have shared across projects.</p></div>
    <PublicSubmissionsSync />
    <form method="get" className="flex flex-wrap items-center justify-between gap-3">
      <PortalSearch label="Search your submissions" defaultValue={query} />
      <select name="project" aria-label="Filter by project" defaultValue={projectId} className="rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-sm text-zk-text"><option value="">All projects</option>{projects.map(project => <option key={project.id} value={project.id}>{project.organisation.name} / {project.name}</option>)}</select>
      <button type="submit" className="inline-flex h-8 items-center rounded-lg border border-zk-border bg-zk-surface px-3 text-xs font-semibold text-zk-text hover:bg-zk-chip">Apply filters</button>
    </form>
    {rows.length ? <div className="overflow-x-auto rounded-2xl border border-zk-border bg-zk-surface"><table className="w-full text-left text-sm"><thead className="border-b border-zk-border bg-zk-chip text-zk-muted"><tr>{["Feedback", "Project", "Status", "Submitted"].map(label => <th key={label} scope="col" className="px-5 py-3 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-zk-divider">{rows.map(({ idea }) => {
      const ref = { orgSlug: idea.project.organisation.slug, projectSlug: idea.project.slug };
      return <tr key={`${idea.project.id}-${idea.number}`}><td className="px-5 py-4"><Link href={`/my-submissions/${idea.project.id}/${idea.number}`} className="font-semibold text-zk-text hover:text-zk-accent hover:underline"><span className="mr-2 text-zk-muted">#{idea.number}</span>{idea.title}</Link></td><td className="px-5 py-4 text-zk-text2">{idea.project.organisation.name} / {idea.project.name}</td><td className="px-5 py-4"><span className="inline-flex rounded-full bg-zk-tint px-2.5 py-1 text-xs font-semibold text-zk-accent">{publicSubmissionStatus(idea)}</span>{idea.issue && idea.project.visibility === "public" ? <Link href={publicIssueDetailPath(ref, idea.issue.number)} className="mt-1 block text-xs text-zk-accent hover:underline">Issue #{idea.issue.number}</Link> : null}</td><td className="whitespace-nowrap px-5 py-4 text-zk-muted"><LocalTime date={idea.createdAt} /></td></tr>;
    })}</tbody></table></div> : <div className="rounded-2xl border border-zk-border bg-zk-surface px-6 py-14 text-center"><h2 className="font-bold text-zk-text">{query || projectId ? "No matching submissions" : "No submissions yet"}</h2><p className="mx-auto mt-2 max-w-lg text-sm text-zk-text2">{query || projectId ? "Try a different search or choose all projects." : "Reports submitted while signed in appear here. Reports saved in this browser can also be added when you sign in. Keep your private tracking links for reports from other browsers."}</p></div>}
  </div>;
}
