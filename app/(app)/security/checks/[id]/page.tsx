import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { CheckList } from "@/components/security-checks/check-list";
import { ReportLive } from "@/components/security-checks/report-live";
import { CheckHeader, phaseOf } from "@/components/security-checks/check-header";
import { ScanChat, ScanPageTop } from "@/components/security-checks/scan-page-top";
import { checkListTabs } from "@/lib/security-checks/check-list";
import { requireUser } from "@/lib/auth-helpers";
import { substatusClass } from "@/lib/labels";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { CHECK_STATUS_LABEL, FINISHED_CHECK_STATUSES, TARGET_KIND_LABEL } from "@/lib/security-checks";
import { loadCheckReport, type CheckReport } from "@/lib/security-checks/report";
import { orgCard } from "../../../[org]/[project]/org/org-ui";

export const metadata = { title: "Security check" };

/**
 * A scan's page: its **quick scan** (18 Nov call, Mark: the quick scan and the deeper scan on separate pages). The
 * steps at the top open each page; the quick scan's findings can be ticked and fixed here; one button at the bottom
 * opens the deeper scan's page (`/security/checks/<id>/deeper`), where it is started, followed and fixed. Only the
 * person who asked for the check sees it.
 */
export default async function SecurityCheckPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fix?: string | string[] }> }) {
  const [{ id }, query, user] = await Promise.all([params, searchParams, requireUser()]);
  // `?fix=id1,id2`: tick these and open the fix panel (a quick scan finding's "Fix it for me").
  const initialFix = (Array.isArray(query.fix) ? query.fix.join(",") : query.fix ?? "").split(",").filter(Boolean).slice(0, 100);
  const access = await currentOrganisationAccess(user.id, user.role);
  if (!access.organisationId) notFound();
  const report = await loadCheckReport(id, access.organisationId, user.id);
  if (!report) notFound();

  // While agents work, the steps (and the button below) follow them; waiting for payment, nothing moves.
  const working = !FINISHED_CHECK_STATUSES.has(report.status) && !report.paymentRequired;
  const kind = TARGET_KIND_LABEL[report.target.kind].toLowerCase();
  const [quick] = checkListTabs(report);

  return (
    <div className="flex w-full flex-col gap-4 pb-10 sm:gap-6">
      {working && !report.posted ? <ReportLive /> : null}
      <ScanPageTop report={report} />

      {/* Only while ownership proof is on: with it off, the report shows such a check as waiting to start. */}
      {report.status === "awaiting_ownership" ? (
        <section aria-labelledby="ownership-heading" className={orgCard}>
          <Badge className={substatusClass.requires_confirmation}>{CHECK_STATUS_LABEL.awaiting_ownership}</Badge>
          <h1 id="ownership-heading" className="mt-2 wrap-break-word text-xl font-bold tracking-tight text-zk-text">
            Show {report.target.value} is yours
          </h1>
          <p className="mt-1 text-sm text-zk-text2">Agents start only once you prove this {kind} is yours. You do this once.</p>
          <Link href={`/security/targets/${report.target.id}/verify`} className="mt-3 inline-block font-semibold text-zk-accent hover:underline">
            Prove ownership
          </Link>
        </section>
      ) : (
        <section aria-labelledby="check-headline" className="overflow-hidden rounded-panel border border-zk-border bg-zk-surface">
          <CheckHeader report={report} view="quick" />
          {/* Keyed by `?fix`, so "Fix it for me" on this same page ticks its findings afresh. */}
          <CheckList key={initialFix.join(",")} checkId={report.checkId} tab={quick} show="quick" initialFix={initialFix} />
          <DeeperScanNext report={report} />
        </section>
      )}
      <ScanChat report={report} />
    </div>
  );
}

/** The one button on the quick scan's page (18 Nov call, Mark: one call to action): on to the deeper scan's page. */
function DeeperScanNext({ report }: { report: CheckReport }) {
  const phase = phaseOf(report);
  const { done, total } = report.progress;
  const line = report.paymentRequired
    ? "Agents check what the quick scan can't see: exposed files, admin pages, forms and more."
    : phase === "done"
      ? "The deeper scan is done."
      : phase === "stopped"
        ? "The deeper scan was stopped."
        : total
          ? `Agents are checking: ${done} of ${total} parts done.`
          : "Agents are planning the checks.";
  return (
    <div className="flex flex-col gap-3 border-t border-zk-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <p className="m-0 text-sm text-zk-text2">{line}</p>
      <Link
        href={`/security/checks/${encodeURIComponent(report.checkId)}/deeper`}
        className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl bg-electric-blue-strong px-4 text-sm font-semibold text-white hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent"
      >
        {report.paymentRequired ? "Go to the deeper scan" : "See the deeper scan"} &rarr;
      </Link>
    </div>
  );
}
