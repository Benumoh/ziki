import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { FixOnZiki } from "@/components/security-checks/fix-on-ziki";
import { ReportLive } from "@/components/security-checks/report-live";
import { ReportProgress } from "@/components/security-checks/report-progress";
import { ReportResults, parseFixFilter } from "@/components/security-checks/report-results";
import { ReportSummary } from "@/components/security-checks/report-summary";
import { requireUser } from "@/lib/auth-helpers";
import { substatusClass } from "@/lib/labels";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { CHECK_STATUS_LABEL, FINISHED_CHECK_STATUSES, TARGET_KIND_LABEL } from "@/lib/security-checks";
import { loadCheckReport } from "@/lib/security-checks/report";
import { orgCard } from "../../../[org]/[project]/org/org-ui";

export const metadata = { title: "Security check" };

/** What each step tells the client while there are no parts to list yet. */
const WAITING_NOTE: Partial<Record<keyof typeof CHECK_STATUS_LABEL, string>> = {
  queued: "Ziki will start planning the checks in a moment.",
  splitting: "Ziki is looking at it and planning the checks.",
};

/**
 * One security check (12 Nov plan, S1 and S2): live progress while Ziki
 * checks, then, once the report is posted, Ziki's summary and every finding
 * worst first, locked until the client unlocks it. Only the person who asked
 * for the check sees it.
 */
export default async function SecurityCheckPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const [{ id }, { show }, user] = await Promise.all([params, searchParams, requireUser()]);
  const access = await currentOrganisationAccess(user.id, user.role);
  if (!access.organisationId) notFound();
  const report = await loadCheckReport(id, access.organisationId, user.id);
  if (!report) notFound();

  const linkClass = "font-semibold text-zk-accent hover:underline";
  const working = !FINISHED_CHECK_STATUSES.has(report.status);
  const kind = TARGET_KIND_LABEL[report.target.kind].toLowerCase();

  return (
    <div className="flex w-full flex-col gap-4 pb-10 sm:gap-6">
      {/* Live until the report is posted; a cancelled check has nothing more to show. */}
      {working && !report.posted ? <ReportLive /> : null}
      {/* Same look as the issue pages' breadcrumb (components/project-breadcrumb.tsx). */}
      <nav aria-label="Breadcrumb" className="flex w-full items-center px-0.5 text-[13px] text-zk-text2">
        <ol className="flex min-w-0 flex-wrap items-center gap-0.5">
          <li className="min-w-0">
            <Link
              href="/security"
              className="block truncate rounded-md px-1.5 py-0.5 font-bold text-zk-text hover:bg-zk-chip hover:text-zk-text focus-visible:outline-2 focus-visible:outline-zk-accent"
            >
              Security
            </Link>
          </li>
          <li aria-hidden="true" className="text-zk-muted">/</li>
          <li aria-current="page" className="truncate px-1.5">{report.target.value}</li>
        </ol>
      </nav>

      {report.status === "awaiting_ownership" ? (
        <section aria-labelledby="ownership-heading" className={orgCard}>
          <Badge className={substatusClass.requires_confirmation}>{CHECK_STATUS_LABEL.awaiting_ownership}</Badge>
          <h1 id="ownership-heading" className="mt-2 wrap-break-word text-xl font-bold tracking-tight text-zk-text">
            Show {report.target.value} is yours
          </h1>
          <p className="mt-1 text-sm text-zk-text2">Agents start only once you prove this {kind} is yours. You do this once.</p>
          <Link href={`/security/targets/${report.target.id}/verify`} className={`mt-3 inline-block ${linkClass}`}>
            Prove ownership
          </Link>
        </section>
      ) : (
        <>
          <ReportSummary report={report} />

          {/* Progress only, until Ziki has summed up every part and posted the report. */}
          {!report.posted ? (
            <section aria-labelledby="progress-heading" className={orgCard}>
              <h2 id="progress-heading" className="text-base font-semibold text-zk-text">Progress</h2>
              <div className="mt-3">
                {report.parts.length ? (
                  <>
                    <ReportProgress progress={report.progress} parts={report.parts} />
                    {working && report.progress.done === report.progress.total ? (
                      <p className="mt-3 text-sm text-zk-text2">Every part is checked. Ziki is writing your report.</p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-zk-text2">{WAITING_NOTE[report.status] ?? "No parts to check yet."}</p>
                )}
              </div>
            </section>
          ) : null}

          {report.posted ? <ReportResults report={report} show={parseFixFilter(show)} /> : null}

          {/* Fix on Ziki (part N): unlocked findings only. "Fix them on Ziki" above jumps here. */}
          {report.posted && report.findings.some((finding) => !finding.locked) ? (
            <div id="fix-on-ziki" className="scroll-mt-20 rounded-lg bg-zk-surface">
              <FixOnZiki
                checkId={report.checkId}
                results={report.findings.flatMap((finding) =>
                  finding.locked ? [] : [{ id: finding.id, severity: finding.severity, title: finding.title }],
                )}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
