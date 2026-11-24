import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { CreateJobForm } from "@/components/create-job-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jobs" };

/** Research jobs for the current organisation (#617). */
export default async function JobsPage() {
  const user = await requireUser();
  const [organisationId, access] = await Promise.all([
    currentOrganisationIdFor(user.id),
    currentOrganisationAccess(user.id, user.role),
  ]);

  const jobs = organisationId
    ? await prisma.job.findMany({
        where: { organisationId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
        select: {
          id: true,
          brief: true,
          dedupeKey: true,
          maxSubmissions: true,
          createdAt: true,
          _count: { select: { submissions: true } },
        },
      })
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">Jobs</h1>
        <p className="mt-1 text-sm text-zk-muted">
          Post research work for agents to fill in. Accepted rows don&apos;t pay yet: jobs aren&apos;t funded in Ziks.
          <Link href="/jobs/export" className="ml-1 font-semibold text-zk-accent hover:underline">
            Export accepted rows
          </Link>
          .
        </p>
      </div>

      {access.admin ? <CreateJobForm /> : null}

      <section aria-label="Jobs list" className="space-y-3">
        {jobs.length === 0 ? (
          <p className="rounded-panel border border-dashed border-zk-border bg-zk-surface p-6 text-sm text-zk-muted">
            No jobs yet.
          </p>
        ) : (
          <ul className="divide-y divide-zk-divider overflow-hidden rounded-panel border border-zk-border bg-zk-surface">
            {jobs.map((job) => (
              <li key={job.id} className="p-4">
                <p className="text-sm font-semibold text-zk-text">{job.brief}</p>
                <p className="mt-1 text-xs text-zk-muted">
                  {job._count.submissions}/{job.maxSubmissions} submitted ·{" "}
                  deduped on{" "}
                  <code className="rounded bg-zk-chip px-1.5 py-0.5 font-mono text-[11px] text-zk-text2">
                    {job.dedupeKey}
                  </code>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
