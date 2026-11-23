import { requireUser } from "@/lib/auth-helpers";
import { TARGET_KIND_LABEL } from "@/lib/security-checks";
import { listAgentJobs, listOwnWorkspaces, type AgentJobRow } from "@/lib/security-checks/your-work";
import { formatZik } from "@/lib/coins/math";
import { KindIcon } from "@/components/security-checks/entry-box";
import { SecurityTabs } from "@/components/security-checks/security-tabs";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { listWorkspaceChecks } from "@/lib/security-checks/entry";
import { LocalTime } from "@/components/local-time";
import Link from "next/link";
// The same table as a project's Your Work list, so this reads like the rest of Ziki.
import "../../[org]/[project]/issues/_list/issues.css";

export const metadata = { title: "Your work" };

/**
 * Your work on Security (#security-checks): what your agents are checking for
 * other people. Only the job (the site, the part, checking or done) and what it
 * pays you, never the client's stages, payment or results. Fixing happens later,
 * in a project's issues, once the client sends a problem there.
 */
export default async function SecurityYourWorkPage() {
  const user = await requireUser();
  const access = await currentOrganisationAccess(user.id, user.role);
  const [jobs, checks, ownWorkspaces] = await Promise.all([
    listAgentJobs(user.id),
    access.organisationId && access.admin ? listWorkspaceChecks(access.organisationId, user.id) : Promise.resolve([]),
    // A plain member can switch to a workspace they own, where their own scans live (never moved there unasked).
    access.admin ? Promise.resolve([]) : listOwnWorkspaces(user.id, access.organisationId),
  ]);
  // Removed (cancelled) scans don't count.
  const checkCount = checks.filter((check) => check.status !== "cancelled").length;
  // One list, no sidebar: everything your agents worked on, each with its own status.
  const shown = jobs;

  return (
    <div className="flex w-full flex-col pb-10">
      <h1 className="sr-only">Your work</h1>
      <SecurityTabs selected="work" checks={checkCount} jobs={jobs.length} canAdd={access.admin} />

      <section aria-label="Jobs" className="mx-auto w-full max-w-6xl rounded-panel border border-zk-border bg-zk-surface p-3 sm:p-6">
        <p className="mb-4 mt-0 px-1 text-sm text-zk-muted">Jobs your agents do for others. You see the job and the pay, not their results.</p>
        {ownWorkspaces.length > 0 ? (
          <p className="mb-4 mt-0 px-1 text-sm text-zk-text2" data-testid="own-workspaces">
            You&apos;re a member of {access.organisationName ?? "this workspace"}, so you see your agents&apos; work here. To scan your own sites, switch to{" "}
            {ownWorkspaces.map((workspace, index) => (
              <span key={workspace.id}>
                {index > 0 ? ", " : ""}
                <Link href={`/organisations/open?organisation=${encodeURIComponent(workspace.id)}&next=${encodeURIComponent("/security")}`} className="font-semibold text-zk-accent hover:underline">
                  {workspace.name}
                </Link>
              </span>
            ))}
            .
          </p>
        ) : null}

        <div className="w-full min-w-0">
        {shown.length === 0 ? (
          <div className="rounded-control border border-zk-border bg-zk-bg px-6 py-12 text-center">
            <p className="m-0 font-semibold text-zk-text">
              Your agents haven&apos;t worked on anything yet
            </p>
            <p className="mx-auto mb-0 mt-1 max-w-md text-sm text-zk-text2">
              When one of your agents is given part of a security check, it shows here while it works and after it reports back.
            </p>
          </div>
        ) : (
          <>
            <div className="issues-table">
              <div className="issues-table-heading">
                <span className="w-[76px] shrink-0 text-center">Earned</span>
                <span className="min-w-0 flex-1">Job</span>
                <span className="hidden w-[120px] shrink-0 md:block">Status</span>
              </div>
              <ul className="m-0 list-none p-0">
                {shown.map((job, index) => (
                  <JobRow key={job.id} job={job} last={index === shown.length - 1} />
                ))}
              </ul>
            </div>
            <p className="mb-0 mt-4 px-1 text-sm text-zk-text2">
              Showing <b className="text-zk-text">{shown.length}</b> {shown.length === 1 ? "job" : "jobs"}
            </p>
          </>
        )}
        </div>
      </section>
    </div>
  );
}

function JobRow({ job, last }: { job: AgentJobRow; last: boolean }) {
  const status = statusOf(job);
  return (
    <li className={`issues-row flex items-center ${last ? "" : "border-b border-zk-divider"}`}>
      {/* A finding pays its price once the client unlocks it: until then, nothing is earned yet. */}
      <span className="flex w-[76px] shrink-0 justify-center">
        {job.earned > 0 ? (
          <span className="font-mono text-[14px] font-bold tabular-nums text-zk-ok-fg" title={`Earned ${formatZik(job.earned)} from unlocked findings`}>
            {formatZik(job.earned)}
          </span>
        ) : (
          <span className="text-sm text-zk-muted" title="Earns once the client unlocks its findings">–</span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className="hidden h-8 w-8 shrink-0 place-items-center rounded-lg bg-zk-bg sm:grid">
          <KindIcon kind={job.targetKind} className="h-4 w-4 text-zk-text2" />
        </span>
        <span className="min-w-0">
          <span className="issues-row-title text-zk-text">{job.title}</span>
          <span className="issues-row-meta flex items-center text-zk-muted">
            <span className="font-medium text-zk-text2">{job.targetValue}</span>
            <span>{TARGET_KIND_LABEL[job.targetKind]}</span>
            <span>{job.agentName}</span>
            {job.status === "done" ? <span>{job.findings === 1 ? "1 finding" : `${job.findings} findings`}</span> : null}
            {job.status === "checking" && job.assignedAt ? <LocalTime date={job.assignedAt} /> : job.reportedAt ? <LocalTime date={job.reportedAt} /> : null}
            <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold md:hidden ${status.tone}`}>{status.label}</span>
          </span>
        </span>
      </span>
      <span className="hidden w-[120px] shrink-0 md:flex">
        <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${status.tone}`}>{status.label}</span>
      </span>
    </li>
  );
}

/** The job's status in one word: checking, reported, or earned. */
function statusOf(job: AgentJobRow): { label: string; tone: string } {
  if (job.status === "checking") return { label: "Checking", tone: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" };
  if (job.earned > 0) return { label: job.paid ? "Paid" : "Earned", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" };
  return { label: "Reported", tone: "bg-zk-chip text-zk-text2" };
}
