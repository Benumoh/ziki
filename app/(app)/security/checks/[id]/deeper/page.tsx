import { notFound, redirect } from "next/navigation";
import { CheckList } from "@/components/security-checks/check-list";
import { ReportLive } from "@/components/security-checks/report-live";
import { CheckHeader } from "@/components/security-checks/check-header";
import { ScanChat, ScanPageTop } from "@/components/security-checks/scan-page-top";
import { checkListTabs } from "@/lib/security-checks/check-list";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { FINISHED_CHECK_STATUSES } from "@/lib/security-checks";
import { availableAgents } from "@/lib/security-checks/engine";
import { loadCheckReport } from "@/lib/security-checks/report";
import { prisma } from "@/lib/prisma";
import { codeScanPage } from "@/lib/security-checks/code-scan-page";

export const metadata = { title: "Deeper scan" };

/**
 * A scan's **deeper scan**, on its own page (18 Nov call, Mark: "this deeper scan should be on another page… put
 * the payment on that page so that people can interact"). Before payment: what agents check, how many are online,
 * and Start, which opens the checkout. After payment it stays here and shows the work live: each part Waiting,
 * Checking (and which agent), then its findings, which can be ticked and fixed. Back from buying Ziks (`?bought=1`),
 * the checkout opens again. Only the person who asked for the check sees it.
 */
export default async function DeeperScanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fix?: string | string[]; bought?: string }> }) {
  const [{ id }, query, user] = await Promise.all([params, searchParams, requireUser()]);
  // `?fix=id1,id2`: tick these and open the fix panel (a deeper scan finding's "Fix it for me").
  const initialFix = (Array.isArray(query.fix) ? query.fix.join(",") : query.fix ?? "").split(",").filter(Boolean).slice(0, 100);
  const access = await currentOrganisationAccess(user.id, user.role);
  if (!access.organisationId) notFound();
  const report = await loadCheckReport(id, access.organisationId, user.id);
  if (!report) notFound();
  // Proving ownership comes first, on the scan's own page.
  if (report.status === "awaiting_ownership") redirect(`/security/checks/${encodeURIComponent(report.checkId)}`);
  // A code scan is paid for and followed on its website's Code scan page (18 Nov call); back from buying Ziks too.
  if (report.codeScanFor) redirect(codeScanPage(report.codeScanFor.checkId, query));

  const working = !FINISHED_CHECK_STATUSES.has(report.status) && !report.paymentRequired;
  // Security agents online now, ready or at work (18 Nov call). Only counted while it can matter.
  const agentsOnline = report.paymentRequired || (working && !report.posted) ? (await availableAgents(prisma)).length : null;
  const [, deeper] = checkListTabs(report);

  return (
    <div className="flex w-full flex-col gap-4 pb-10 sm:gap-6">
      {/* Live while agents work: parts move from Waiting to Checking to done as they report. */}
      {working && !report.posted ? <ReportLive /> : null}
      <ScanPageTop report={report} step="Deeper scan" />
      <section aria-labelledby="check-headline" className="overflow-hidden rounded-panel border border-zk-border bg-zk-surface">
        {/* Back from buying Ziks (#deeper-scan-gate): the checkout opens again, to press Pay. */}
        <CheckHeader report={report} view="deeper" agentsOnline={agentsOnline} backFromBuying={query.bought === "1"} />
        {/* Keyed by `?fix`, so "Fix it for me" on this same page ticks its findings afresh. */}
        <CheckList key={initialFix.join(",")} checkId={report.checkId} tab={deeper} show="deeper" initialFix={initialFix} />
      </section>
      <ScanChat report={report} />
    </div>
  );
}
