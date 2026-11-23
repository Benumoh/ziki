import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { CheckActivity } from "@/components/security-checks/check-activity";
import { CheckList } from "@/components/security-checks/check-list";
import { ConnectCodeForm } from "@/components/security-checks/connect-code";
import { phaseOf } from "@/components/security-checks/check-header";
import { DeeperScanStart } from "@/components/security-checks/deeper-scan-offer";
import { ReportLive } from "@/components/security-checks/report-live";
import { ScanChat, ScanPageTop } from "@/components/security-checks/scan-page-top";
import { ScanSteps } from "@/components/security-checks/scan-steps";
import { requireUser } from "@/lib/auth-helpers";
import { statusClass, substatusClass } from "@/lib/labels";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { prisma } from "@/lib/prisma";
import { CHECK_STATUS_LABEL, CODE_SCAN_PRICE_ZIKS, DEEPER_SCAN_COVERS, FINISHED_CHECK_STATUSES } from "@/lib/security-checks";
import { checkListTabs } from "@/lib/security-checks/check-list";
import { githubProjects } from "@/lib/security-checks/code-scan";
import { availableAgents } from "@/lib/security-checks/engine";
import { loadCheckReport } from "@/lib/security-checks/report";
import { firstSentence } from "@/lib/security-checks/short-line";

export const metadata = { title: "Code scan" };

/**
 * A website scan's **Code scan** page (18 Nov call, Mark: "try and connect to their code… without asking them for
 * money yet… just talk a bit more"). Open at any time from the steps, and the code scan's one place, under the same
 * three steps as the website's other pages:
 * 1. Not connected: the two ways to connect the code, free.
 * 2. Connected: Ziki's first look (the step says First look done): what it found so far, each fixable, then what the
 *    full check covers, not checked yet, with Get the full check, which opens the checkout.
 * 3. Full check paid for: agents checking the code, live, then what they found.
 * The code scan is its own scan underneath (the repo, linked by `codeScanForId`); its own pages send you here.
 */
export default async function CodeScanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fix?: string | string[]; bought?: string }> }) {
  const [{ id }, query, user] = await Promise.all([params, searchParams, requireUser()]);
  const access = await currentOrganisationAccess(user.id, user.role);
  if (!access.organisationId) notFound();
  const report = await loadCheckReport(id, access.organisationId, user.id);
  if (!report) notFound();
  const scanHref = `/security/checks/${encodeURIComponent(report.checkId)}`;
  // A repo is the code: no Code scan step on it. Proving ownership comes first, on the scan's own page.
  if (report.target.kind === "repo" || report.codeScanFor || report.status === "awaiting_ownership" || report.status === "cancelled") redirect(scanHref);

  const site = report.target.value;
  const code = report.codeScan ? await loadCheckReport(report.codeScan.checkId, access.organisationId, user.id) : null;
  const steps = (
    <div className="pt-3">
      <ScanSteps
        quickFound={report.codeInList ? report.codeFound : report.quickScan ? report.quickScan.total : null}
        phase={phaseOf(report)}
        done={report.progress.done}
        total={report.progress.total}
        checkId={report.checkId}
        codeScan={report.codeScan}
        paymentRequired={Boolean(report.paymentRequired)}
        current="code"
      />
    </div>
  );

  if (!code) {
    const projects = await githubProjects(access.organisationId);
    return (
      <div className="flex w-full flex-col gap-4 pb-10 sm:gap-6">
        <ScanPageTop report={report} step="Code scan" />
        <section aria-labelledby="code-scan-heading" className="overflow-hidden rounded-panel border border-zk-border bg-zk-surface">
          <div className="space-y-5 bg-linear-to-b from-zk-tint/60 to-transparent p-4 sm:p-6">
            <p className="m-0 text-xs">
              <Badge className={substatusClass.requires_confirmation}>Not started</Badge>
            </p>
            <div className="min-w-0">
              <h1 id="code-scan-heading" className="m-0 wrap-break-word text-2xl font-extrabold tracking-[-0.02em] text-zk-text sm:text-[28px]">
                Code scan of {site}
              </h1>
              <p className="m-0 mt-1 text-[15px] text-zk-text2">
                The quick and deeper scans check {site} from the outside. The code scan reads the code behind it, on GitHub: leaked passwords, old packages, unsafe code. Connecting is free, and Ziki shows what it finds straight away.
              </p>
            </div>
            {steps}
          </div>
          <div className="border-t border-zk-border p-4 sm:p-6">
            <h2 className="m-0 text-base font-semibold text-zk-text">Connect your code</h2>
            <p className="m-0 mt-1 mb-4 text-sm text-zk-text2">Pick how Ziki may use it.</p>
            <ConnectCodeForm checkId={report.checkId} projects={projects} />
          </div>
        </section>
        <ScanChat report={report} />
      </div>
    );
  }

  const initialFix = (Array.isArray(query.fix) ? query.fix.join(",") : query.fix ?? "").split(",").filter(Boolean).slice(0, 100);
  // Connecting checked the code (23 Nov, Sheyi: connecting is the code scan, not a step before paying). The full
  // check is a quiet extra: once it's paid for, agents work on it here, live.
  const fullCheck = !code.paymentRequired;
  const working = fullCheck && !FINISHED_CHECK_STATUSES.has(code.status);
  const agentsOnline = working && !code.posted ? (await availableAgents(prisma)).length : null;
  const [found, agents] = checkListTabs(code);

  return (
    <div className="flex w-full flex-col gap-4 pb-10 sm:gap-6">
      {working && !code.posted ? <ReportLive /> : null}
      <ScanPageTop report={report} step="Code scan" />
      <section aria-labelledby="check-headline" className="overflow-hidden rounded-panel border border-zk-border bg-zk-surface">
        <div className="space-y-5 bg-linear-to-b from-zk-tint/60 to-transparent p-4 sm:p-6">
          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zk-text2">
            <Badge className={code.status === "cancelled" ? statusClass.closed : !fullCheck ? substatusClass.requires_confirmation : working ? statusClass.in_progress : statusClass.resolved}>
              {fullCheck ? CHECK_STATUS_LABEL[code.status] : "First look done"}
            </Badge>
            <span>
              Code: <span className="font-semibold text-zk-text">github.com/{code.target.value}</span>
            </span>
          </p>
          {fullCheck ? (
            <CheckActivity site={`${site}'s code`} phase={phaseOf(code)} done={code.progress.done} total={code.progress.total} />
          ) : (
            <div className="min-w-0">
              <h1 id="check-headline" className="m-0 wrap-break-word text-2xl font-extrabold tracking-[-0.02em] text-zk-text sm:text-[28px]">
                First look at {site}&apos;s code
              </h1>
              <p className="m-0 mt-1 text-[15px] text-zk-text2">
                {firstLookLine(found.count)} This is only the start: the full check looks much deeper, at the things listed under Not checked yet.
              </p>
            </div>
          )}
          {working && agentsOnline !== null ? (
            <p className="m-0 flex items-center gap-2 text-sm font-semibold text-zk-text">
              <span aria-hidden="true" className={`size-2 rounded-full ${agentsOnline ? "bg-zk-ok-fg motion-safe:animate-pulse" : "bg-zk-muted"}`} />
              {agentsOnline
                ? `${agentsOnline} security ${agentsOnline === 1 ? "agent is" : "agents are"} online`
                : "No security agent is online right now. Ziki's own agent steps in after a few minutes."}
            </p>
          ) : null}
          {steps}
          {code.posted && code.summary ? <p className="m-0 wrap-break-word text-[15px] text-zk-text">{firstSentence(code.summary)}</p> : null}
        </div>
        <CheckList key={`found-${initialFix.join(",")}`} checkId={code.checkId} tab={found} show="quick" initialFix={initialFix} code />
        {/* Before it's paid for: what the full check covers, not checked yet, with its button (23 Nov, Sheyi: show
            there's more to find). Once paid for: the full check at work, then what it found. */}
        <CheckList key={`agents-${initialFix.join(",")}`} checkId={code.checkId} tab={agents} show="deeper" initialFix={initialFix} code price={CODE_SCAN_PRICE_ZIKS} />
        {fullCheck ? null : (
          // The checkout the button opens (and opens again back from buying Ziks).
          <DeeperScanStart checkId={code.checkId} site={site} name="Full code check" price={CODE_SCAN_PRICE_ZIKS} covers={DEEPER_SCAN_COVERS.repo} backFromBuying={query.bought === "1"} />
        )}
      </section>
      <ScanChat report={report} />
    </div>
  );
}

/** What Ziki's first look found, in a sentence. */
function firstLookLine(count: number): string {
  if (count === 0) return "Ziki's first look found nothing so far.";
  return `Ziki's first look found ${count} ${count === 1 ? "thing" : "things"}.`;
}
