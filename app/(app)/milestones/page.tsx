import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { loadMilestoneSummaries, type MilestoneSummary } from "@/lib/milestone-stats";
import { dueDateValue, milestoneIssuesHref } from "@/lib/milestones";
import { firstProjectRefFor } from "@/lib/project-route";
import { orgPath, type ProjectRef } from "@/lib/project-paths";
import { MilestoneProgressBar } from "@/components/milestone-progress";
import { MilestoneDue } from "@/components/milestone-due";

export const metadata = { title: "Milestones" };

function MilestoneCard({ m, slug }: { m: MilestoneSummary; slug: ProjectRef | null }) {
  const left = m.progress.total - m.progress.done;
  return (
    <li className="rounded-panel border border-zk-border bg-zk-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-zk-text">{m.title}</h2>
        <MilestoneDue due={dueDateValue(m.dueDate) || null} isClosed={m.isClosed} />
      </div>
      {m.description ? <p className="mt-1 text-sm text-zk-text2">{m.description}</p> : null}
      <div className="mt-3">
        <MilestoneProgressBar progress={m.progress} label={m.title} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {slug ? (
          <Link href={milestoneIssuesHref(slug, m.id)} className="font-medium text-zk-accent hover:underline">
            All {m.progress.total} issue{m.progress.total === 1 ? "" : "s"}
          </Link>
        ) : null}
        {/* No link: "left" spans open and in progress, which no single
            status filter covers, and a link to half of it would mislead. */}
        {m.progress.total > 0 ? (
          <span className="text-zk-text2">{left === 0 ? "All done" : `${left} left`}</span>
        ) : null}
      </div>
    </li>
  );
}

/** Every milestone with its progress (#289): "what's left for this release?" */
export default async function MilestonesPage() {
  const user = await requireUser();
  const { organisationId, admin } = await currentOrganisationAccess(user.id, user.role);
  const all = organisationId ? await loadMilestoneSummaries({ organisationId }) : [];
  const slug = await firstProjectRefFor(user.id);
  const open = all.filter((m) => !m.isClosed);
  const closed = all.filter((m) => m.isClosed);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">Milestones</h1>
          <p className="text-sm text-zk-text2">Releases and sprints, soonest due first.</p>
        </div>
        {admin && slug ? (
          <Link
            href={orgPath(slug, "milestones")}
            className="inline-flex items-center rounded-full border border-zk-border bg-zk-surface px-3.5 py-2 text-sm font-medium text-zk-text hover:bg-zk-chip"
          >
            Manage milestones
          </Link>
        ) : null}
      </div>

      {open.length === 0 ? (
        <p className="rounded-panel border border-dashed border-zk-border bg-zk-surface px-6 py-10 text-center text-sm text-zk-text2">
          No open milestones.
        </p>
      ) : (
        <ul className="space-y-3">
          {open.map((m) => (
            <MilestoneCard key={m.id} m={m} slug={slug} />
          ))}
        </ul>
      )}

      {closed.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium text-zk-text2">
            {closed.length} closed milestone{closed.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-3 space-y-3">
            {closed.map((m) => (
              <MilestoneCard key={m.id} m={m} slug={slug} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
