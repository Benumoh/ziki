import Link from "next/link";
import { UserNameWithBadges } from "@/components/user-name-with-badges";
import { LocalTime } from "@/components/local-time";
import { MilestoneDue } from "@/components/milestone-due";
import type { AppRole } from "@/lib/roles";
import type { OrganisationRole } from "@/lib/organisation-role";
import type { ReactNode } from "react";

type MetadataPerson = {
  id: string;
  name: string;
  image: string | null;
  role?: AppRole | null;
  organisationRole?: OrganisationRole | null;
};

type MetadataMilestone = {
  title: string;
  href: string;
  dueDate: string | null;
  isClosed: boolean;
};

export function IssueMetadataPanel({
  reporter,
  reporterAgent,
  assignee,
  assigneeAgent,
  assigneeAction,
  lastActivityAt,
  area,
  type,
  milestone,
}: {
  reporter: MetadataPerson;
  reporterAgent?: string | null;
  assignee: MetadataPerson | null;
  assigneeAgent?: string | null;
  assigneeAction?: ReactNode;
  lastActivityAt: Date;
  area: string | null;
  type: string | null;
  milestone: MetadataMilestone | null;
}) {
  return (
    <section aria-label="Issue details" className="flex min-w-0 flex-col gap-3 rounded-[20px] border border-zk-border bg-zk-surface px-4 py-3.5">
      <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">Details</h2>
      <dl className="grid min-w-0 grid-cols-1 gap-x-5 gap-y-3 text-sm text-zk-text2 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs font-medium text-zk-muted">Reporter</dt>
          <dd className="mt-1 min-w-0">
            <UserNameWithBadges
              name={reporter.name}
              role={reporter.role}
              organisationRole={reporter.organisationRole}
              image={reporter.image}
              avatar="sm"
              className="min-w-0 !flex-nowrap text-xs"
              userId={reporter.id}
              agentName={reporterAgent}
            />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium text-zk-muted">Assignee</dt>
          <dd className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            {assignee ? (
              <UserNameWithBadges
                name={assignee.name}
                role={assignee.role}
                organisationRole={assignee.organisationRole}
                image={assignee.image}
                avatar="sm"
                className="min-w-0 !flex-nowrap text-xs"
                userId={assignee.id}
                agentName={assigneeAgent}
              />
            ) : (
              <span className="text-xs text-zk-muted">Unassigned</span>
            )}
            {assigneeAction}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium text-zk-muted">Last activity</dt>
          <dd className="mt-1"><LocalTime date={lastActivityAt} absolute className="text-xs tabular-nums" /></dd>
        </div>
        {area ? (
          <div className="min-w-0">
            <dt className="text-xs font-medium text-zk-muted">Area</dt>
            <dd className="mt-1 break-words text-xs">{area}</dd>
          </div>
        ) : null}
        {type ? (
          <div className="min-w-0">
            <dt className="text-xs font-medium text-zk-muted">Type</dt>
            <dd className="mt-1 break-words text-xs">{type}</dd>
          </div>
        ) : null}
        {milestone ? (
          <div className="min-w-0">
            <dt className="text-xs font-medium text-zk-muted">Target milestone</dt>
            <dd className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <Link href={milestone.href} className="break-words font-semibold text-zk-accent hover:underline">{milestone.title}</Link>
              <MilestoneDue due={milestone.dueDate} isClosed={milestone.isClosed} />
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
