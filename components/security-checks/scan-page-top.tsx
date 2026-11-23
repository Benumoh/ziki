import Link from "next/link";
import { ScanActionsMenu } from "@/components/security-checks/scan-actions-menu";
import { ScanChat as ScanChatLink } from "@/components/security-checks/scan-chat";
import type { CheckReport } from "@/lib/security-checks/report";

const CRUMB = "block truncate rounded-md px-1.5 py-0.5 font-bold text-zk-text hover:bg-zk-chip hover:text-zk-text focus-visible:outline-2 focus-visible:outline-zk-accent";

/**
 * The top of a scan's pages, the quick scan's and its further steps' (18 Nov call): the breadcrumb, More actions,
 * and, for a scan scanned again since, the way to the newest one. `step`: one of the further steps' pages, so the
 * breadcrumb goes one step further (Security / site / Deeper scan, or Code scan) and the site links back to the quick
 * scan.
 */
export function ScanPageTop({ report, step }: { report: CheckReport; step?: "Deeper scan" | "Code scan" }) {
  const scanHref = `/security/checks/${encodeURIComponent(report.checkId)}`;
  return (
    <>
      {/* The top row. The site's chat is at the bottom of the page now, in the reading order (ScanChat). */}
        <div className="flex flex-col">
          {/* Same look as the issue pages' breadcrumb (components/project-breadcrumb.tsx), with the same "More actions" menu on the right. */}
          <div className="flex w-full items-center justify-between gap-3">
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center px-0.5 text-[13px] text-zk-text2">
              <ol className="flex min-w-0 flex-wrap items-center gap-0.5">
                <li className="min-w-0">
                  <Link href="/security" className={CRUMB}>Security</Link>
                </li>
                <li aria-hidden="true" className="text-zk-muted">/</li>
                {step ? (
                  <>
                    <li className="min-w-0">
                      <Link href={scanHref} className={CRUMB}>{report.target.value}</Link>
                    </li>
                    <li aria-hidden="true" className="text-zk-muted">/</li>
                    <li aria-current="page" className="truncate px-1.5">{step}</li>
                  </>
                ) : (
                  <li aria-current="page" className="truncate px-1.5">{report.target.value}</li>
                )}
              </ol>
            </nav>
            {/* Scan again, the PDF and Remove sit here, like Delete issue on an issue page, for any scan that isn't removed yet. */}
            {report.status !== "cancelled" ? (
              <div className="flex shrink-0 items-center gap-2">
                <ScanActionsMenu checkId={report.checkId} site={report.target.value} posted={report.posted} nextCheckId={report.nextCheckId} />
              </div>
            ) : null}
          </div>
        </div>

      {/* Scanned again (#security-rescan): an older scan points to the newest. */}
      {report.nextCheckId ? (
        <p role="status" className="m-0 rounded-2xl border border-zk-border bg-zk-tint px-4 py-3 text-sm text-zk-text">
          This site was scanned again since.{" "}
          <Link href={`/security/checks/${encodeURIComponent(report.nextCheckId)}`} className="font-semibold text-zk-accent hover:underline">
            Open the newest scan
          </Link>
        </p>
      ) : null}
    </>
  );
}

/** The site's chat at the bottom of both scan pages, for any scan that isn't removed (see ScanChatLink). */
export function ScanChat({ report }: { report: CheckReport }) {
  if (report.status === "cancelled") return null;
  return <ScanChatLink checkId={report.checkId} site={report.target.value} />;
}
