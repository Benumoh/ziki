import { requireUser } from "@/lib/auth-helpers";
import { TARGET_KIND_LABEL } from "@/lib/security-checks";
import { listAgentJobs, listOwnWorkspaces, type AgentJobRow } from "@/lib/security-checks/your-work";
import { formatZik } from "@/lib/coins/math";
import { KindIcon } from "@/components/security-checks/entry-box";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { LocalTime } from "@/components/local-time";
import { PILL_TONES } from "@/lib/pill-tones";
import Link from "next/link";

export const metadata = { title: "Your work" };

/** A status pill, as on Your App's Work Feed (#work-feed). */
const PILL = "inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[12.5px] font-semibold";

/**
 * Your work on Security (#security-checks): what your agents are checking for
 * other people in this workspace. Only the job (the site, the part, checking or done) and what it
 * pays you, never the client's stages, payment or results. Fixing happens later,
 * in a project's issues, once the client sends a problem there.
 *
 * In the app's look (23 Nov, Chloe; Mark: Security in the style set on the other pages): no tab bar on top;
 * the jobs in Your App's Work Feed sections, "Being checked" then "Done", each a white card with its status pill.
 */
export default async function SecurityYourWorkPage() {
  const user = await requireUser();
  const access = await currentOrganisationAccess(user.id, user.role);
  const [jobs, ownWorkspaces] = await Promise.all([
    // Only this workspace's jobs, not everything your agents ever did (23 Nov, Chloe).
    listAgentJobs(user.id, access.organisationId),
    // A plain member can switch to a workspace they own, where their own scans live (never moved there unasked).
    access.admin ? Promise.resolve([]) : listOwnWorkspaces(user.id, access.organisationId),
  ]);
  const checking = jobs.filter((job) => job.status === "checking");
  const done = jobs.filter((job) => job.status !== "checking");
  const workspace = access.organisationName ?? "this workspace";

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-4 pb-10">
      <h1 className="sr-only">Your work</h1>
      {ownWorkspaces.length > 0 ? (
        <p className="m-0 px-1 text-sm text-zk-text2" data-testid="own-workspaces">
          You&apos;re a member of {workspace}, so you see your agents&apos; work here. To scan your own sites, switch to{" "}
          {ownWorkspaces.map((own, index) => (
            <span key={own.id}>
              {index > 0 ? ", " : ""}
              <Link href={`/organisations/open?organisation=${encodeURIComponent(own.id)}&next=${encodeURIComponent("/security")}`} className="font-semibold text-zk-accent hover:underline">
                {own.name}
              </Link>
            </span>
          ))}
          .
        </p>
      ) : null}

      <section aria-labelledby="your-work-heading" className="rounded-panel border border-zk-border bg-zk-surface p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 id="your-work-heading" className="m-0 text-[15px] font-semibold text-zk-text">
            Your work <span className="ml-1 text-[13px] font-medium tabular-nums text-zk-muted">{jobs.length}</span>
          </h2>
          <p className="m-0 text-[13px] text-zk-muted">Jobs your agents do in {workspace}. You see the job and the pay, not the results.</p>
        </div>

        {jobs.length === 0 ? (
          // Empty, as Marketing's and Security's: one white card on the grey ground.
          <div className="rounded-xl bg-zk-bg p-4 sm:p-5">
            <div className="rounded-2xl border border-zk-border bg-zk-surface px-4 py-14 text-center">
              <p className="m-0 text-base font-semibold text-zk-text">Your agents haven&apos;t worked on anything here yet.</p>
              <p className="mx-auto mb-0 mt-1.5 max-w-md text-sm text-zk-muted">
                When one of your agents is given part of a security check in {workspace}, it shows here while it works and after it reports back.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <JobSection title="Being checked" jobs={checking} />
            <JobSection title="Done" jobs={done} />
          </div>
        )}
      </section>
    </div>
  );
}

/** A Work Feed section (#work-feed): its title and count, then its cards on the grey ground. */
function JobSection({ title, jobs }: { title: string; jobs: AgentJobRow[] }) {
  const id = `your-work-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="m-0 mb-2 px-1 text-[15px] font-semibold text-zk-text">
        {title} <span className="ml-1 text-[13px] font-medium tabular-nums text-zk-muted">{jobs.length}</span>
      </h3>
      {jobs.length === 0 ? (
        <p className="m-0 rounded-xl bg-zk-bg px-4 py-4 text-[13px] text-zk-muted">Nothing here right now.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 rounded-xl bg-zk-bg p-3 sm:p-4">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </ul>
      )}
    </section>
  );
}

function JobCard({ job }: { job: AgentJobRow }) {
  const status = statusOf(job);
  const when = job.status === "checking" ? job.assignedAt : job.reportedAt;
  return (
    <li className="flex items-center gap-4 rounded-2xl border border-zk-border bg-zk-surface px-4 py-3.5 sm:px-5 sm:py-4">
      <span aria-hidden="true" className="flex h-11 w-14 shrink-0 items-center justify-center rounded-control border border-zk-border bg-zk-bg max-sm:hidden">
        <KindIcon kind={job.targetKind} className="text-zk-text2" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-zk-text">{job.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-zk-muted">
          <span className="font-medium text-zk-text2">{job.targetValue}</span>
          <span aria-hidden="true">·</span>
          <span>{TARGET_KIND_LABEL[job.targetKind]}</span>
          <span aria-hidden="true">·</span>
          <span>{job.agentName}</span>
          {job.status === "done" ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{job.findings === 1 ? "1 finding" : `${job.findings} findings`}</span>
            </>
          ) : null}
          {when ? (
            <>
              <span aria-hidden="true">·</span>
              <LocalTime date={when} />
            </>
          ) : null}
        </span>
      </span>
      {/* Its status, and what it paid (a finding pays once the client unlocks it), as the feed's pill and action. */}
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <span className={PILL} style={PILL_TONES[status.tone]}>{status.label}</span>
        {job.earned > 0 ? (
          <span className="font-mono text-[13px] font-bold tabular-nums text-zk-ok-fg" title={`Earned ${formatZik(job.earned)} from unlocked findings`}>
            {formatZik(job.earned)}
          </span>
        ) : job.status === "done" ? (
          <span className="text-[12px] text-zk-muted" title="Earns once the client unlocks its findings">Not unlocked yet</span>
        ) : null}
      </span>
    </li>
  );
}

/** The job's status in one word: checking, reported, or earned. */
function statusOf(job: AgentJobRow): { label: string; tone: keyof typeof PILL_TONES } {
  if (job.status === "checking") return { label: "Checking", tone: "blue" };
  if (job.earned > 0) return { label: job.paid ? "Paid" : "Earned", tone: "green" };
  return { label: "Reported", tone: "grey" };
}
