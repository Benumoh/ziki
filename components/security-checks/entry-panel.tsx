import Link from "next/link";
import { CHECK_STATUS_LABEL, TARGET_KIND_LABEL } from "@/lib/security-checks";
import { nextStepPath, siteStage, SITE_FILTERS, type SiteFilter, type WorkspaceCheckRow } from "@/lib/security-checks/entry";
import { LocalTime } from "@/components/local-time";
import { KindIcon } from "./entry-box";
import { SecurityWelcome } from "./security-welcome";
import { CheckSiteButton } from "./entry-dialog";
import { FlashNote } from "./flash-note";
import { StageSidebar, type SidebarStep } from "@/components/stage-sidebar";

/** One panel for everything, as wide as the tabs above it, like a project's Ideas and Issues. */
const PANEL = "mx-auto w-full max-w-6xl overflow-hidden rounded-[20px] border border-zk-border bg-zk-surface";
const PRIMARY_ROW_BUTTON =
  "inline-flex h-9 items-center rounded-full bg-electric-blue-strong px-4 text-sm font-bold text-white transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2";
const ROW_BUTTON =
  "inline-flex h-9 items-center rounded-full border border-zk-border bg-zk-surface px-4 text-sm font-semibold text-zk-text transition hover:border-zk-accent hover:text-zk-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2";

function PrivacyNote({ className = "" }: { className?: string }) {
  return (
    <p className={`m-0 flex items-start gap-2 text-xs text-zk-muted ${className}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-px shrink-0"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
      Agents only look. They never log in as you, change anything, or use what they find. Results stay private to you.
    </p>
  );
}

/**
 * What the Security page opens on (#security-checks, part 1). The box waits
 * behind "Add asset" and opens in a pop-up. A workspace with no checks yet
 * sees a short card; a returning one sees its checks. The findings dashboard
 * sits behind the "Findings" link.
 */
export function SecurityChecksPanel({
  checks,
  highlight,
  show = "all",
}: {
  checks: WorkspaceCheckRow[];
  highlight?: { checkId: string; unlocked: number; added?: boolean };
  show?: SiteFilter;
}) {
  // Nothing added yet: the welcome, inside the same panel, like a project's Ideas page with no ideas.
  if (checks.length === 0) {
    return (
      <section aria-label="Assets" className={PANEL}>
        <div className="flex items-center justify-end gap-3 border-b border-zk-divider px-4 py-3 sm:px-6">
          <CheckSiteButton variant="inline" />
        </div>
        <SecurityWelcome />
      </section>
    );
  }

  const count = (filter: SiteFilter) => (filter === "all" ? checks.length : checks.filter((check) => siteStage(check) === filter).length);
  const shown = show === "all" ? checks : checks.filter((check) => siteStage(check) === show);
  const steps: SidebarStep[] = SITE_FILTERS.map((filter) => ({
    label: SITE_FILTER_TEXT[filter].label,
    count: count(filter),
    href: filter === "all" ? "/security" : `/security?show=${filter}`,
    selected: filter === show,
  }));

  return (
    <section aria-labelledby="security-checks-heading" className={PANEL}>
      {/* Like a project's Ideas: what's shown on the left of the top bar, the add button on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zk-divider px-4 py-3 sm:px-6">
        <h2 id="security-checks-heading" className="m-0 text-sm font-normal text-zk-muted">
          {show === "all" ? "Assets, newest first" : `${SITE_FILTER_TEXT[show].label}, newest first`}
        </h2>
        <CheckSiteButton variant="inline" />
      </div>
      {highlight?.added && !highlight.unlocked ? (
        <FlashNote>Saved. Show it&apos;s yours and the scan starts.</FlashNote>
      ) : null}
      {highlight?.unlocked ? (
        <FlashNote>
          {highlight.unlocked === 1 ? "1 fix unlocked." : `${highlight.unlocked} fixes unlocked.`} Open the report to read each one in full, with how to fix it.
        </FlashNote>
      ) : null}
      {/* Where each site is, down the left, like the steps beside a project's issues. */}
      <div className="flex items-start gap-5 p-3 max-lg:flex-col max-lg:gap-3 sm:p-6">
        <StageSidebar steps={steps} />
        <div className="w-full min-w-0 flex-1 overflow-hidden rounded-[14px] border border-zk-border">
          {shown.length ? (
            <ul className="m-0 list-none divide-y divide-zk-border p-0">
              {shown.map((check) => (
                <CheckRow key={check.id} check={check} highlighted={highlight?.checkId === check.id} />
              ))}
            </ul>
          ) : (
            <div className="bg-zk-bg px-6 py-12 text-center">
              <p className="m-0 font-semibold text-zk-text">{SITE_FILTER_TEXT[show].empty}</p>
              <Link href="/security" className="mt-2 inline-flex text-sm font-semibold text-zk-accent hover:underline">Show all assets</Link>
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-zk-border bg-zk-bg px-4 py-3 sm:px-6">
        <PrivacyNote />
      </div>
    </section>
  );
}

const SITE_FILTER_TEXT: Record<SiteFilter, { label: string; empty: string }> = {
  all: { label: "All", empty: "No assets yet" },
  prove: { label: "Show it's yours", empty: "Nothing waiting for proof" },
  checking: { label: "Checking", empty: "Nothing being checked right now" },
  fix: { label: "Fix", empty: "No reports ready yet" },
};

function CheckRow({ check, highlighted }: { check: WorkspaceCheckRow; highlighted: boolean }) {
  const cancelled = check.status === "cancelled";
  const proving = check.status === "awaiting_ownership" && !check.verified;
  const payHref = `/security/checks/${check.id}/pay`;
  const running = !proving && !cancelled;
  // Findings can be unlocked once the report is posted, while any are still locked.
  const allUnlocked = check.posted && check.findings > 0 && check.unlocked === check.findings;
  const canUnlock = check.posted && check.unlocked < check.findings;

  return (
    <li className={`flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-6 ${highlighted ? "bg-zk-tint" : ""}`}>
      {/* The site, then its three steps under it; the button stays on the right. */}
      <div className="flex min-w-[14rem] flex-1 items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-zk-border bg-zk-bg">
          <KindIcon kind={check.kind} className="text-zk-text2" />
        </span>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="min-w-0">
            <p className="m-0 truncate text-base font-bold text-zk-text">{check.value}</p>
            <p className="m-0 text-sm text-zk-muted">
              {TARGET_KIND_LABEL[check.kind]} · added <LocalTime date={check.createdAt} />
            </p>
          </div>
      {cancelled ? (
        <span className="inline-flex w-fit rounded-full bg-zk-chip px-2.5 py-0.5 text-xs font-bold text-zk-muted">{CHECK_STATUS_LABEL[check.status]}</span>
      ) : (
        <ol aria-label={`Steps for ${check.value}`} className="m-0 flex list-none flex-wrap items-center gap-x-1.5 gap-y-1 p-0 text-[13px]">
          <Step state={proving ? "now" : "done"}>Show it&apos;s yours</Step>
          <StepLine />
          <Step state={check.status === "done" ? "done" : running ? "now" : "later"}>
            {/* Always "Checking"; once it's done, it opens the report. */}
            {check.status === "done" ? (
              <Link href={`/security/checks/${check.id}`} className="hover:underline">Checking</Link>
            ) : (
              "Checking"
            )}
          </Step>
          <StepLine />
          <Step state={allUnlocked ? "done" : canUnlock ? "now" : "later"}>
            {!check.posted ? (
              "Fix"
            ) : check.findings === 0 ? (
              "Nothing to fix"
            ) : allUnlocked ? (
              "Fixes unlocked"
            ) : (
              <Link href={payHref} className="hover:underline">
                Fix · <span className="tabular-nums">{check.unlocked ? `${check.unlocked} of ${check.findings}` : check.findings}</span> {check.unlocked ? "unlocked" : check.findings === 1 ? "finding" : "findings"}
              </Link>
            )}
          </Step>
        </ol>
      )}
        </div>
      </div>

      <div className="flex shrink-0 items-center">
        {proving ? (
          <Link href={nextStepPath({ targetId: check.targetId, checkId: check.id, verified: false })} className={PRIMARY_ROW_BUTTON}>
            Continue
          </Link>
        ) : canUnlock ? (
          <Link href={payHref} className={PRIMARY_ROW_BUTTON}>Unlock fixes</Link>
        ) : (
          <Link href={`/security/checks/${check.id}`} className={ROW_BUTTON}>Open</Link>
        )}
      </div>
    </li>
  );
}

/** One step of a check: done (a tick), now (the step to do next) or later. */
function Step({ state, children }: { state: "done" | "now" | "later"; children: React.ReactNode }) {
  const tone = state === "done" ? "text-zk-ok-fg" : state === "now" ? "font-semibold text-zk-text" : "text-zk-muted";
  return (
    <li aria-current={state === "now" ? "step" : undefined} className={`inline-flex items-center gap-1.5 whitespace-nowrap ${tone}`}>
      {state === "done" ? (
        <span aria-hidden="true" className="grid h-4 w-4 place-items-center rounded-full bg-zk-ok-bg">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L19 7" /></svg>
        </span>
      ) : (
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${state === "now" ? "bg-electric-blue-strong ring-4 ring-electric-blue-strong/15" : "border border-zk-border bg-zk-surface"}`} />
      )}
      {state === "done" ? <span className="sr-only">Done: </span> : null}
      {children}
    </li>
  );
}

function StepLine() {
  return <li aria-hidden="true" className="h-px w-3 bg-zk-border sm:w-6" />;
}
