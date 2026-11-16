"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TARGET_KIND_LABEL } from "@/lib/security-checks";
import type { ScanStage, WorkspaceCheckRow } from "@/lib/security-checks/entry";
import { LocalTime } from "@/components/local-time";
import { ToolbarFilterMenu } from "@/components/toolbar-filter-menu";
import { PaginationControls } from "@/components/pagination-controls";
import { KindIcon } from "./entry-box";
import "@/app/(app)/[org]/[project]/issues/_list/issues.css";
import "@/components/security-finding.css";
import { SecurityChat, chatLeftOpen, keepChatOpen, startNewChat } from "./security-chat";


/** Rows on each page. */
const PAGE = 10;

const STAGE: Record<ScanStage, { label: string; tone: string }> = {
  scanning: { label: "Scanning", tone: "bg-zk-tint text-zk-accent" },
  report: { label: "Report ready", tone: "bg-zk-ok-bg text-zk-ok-fg" },
  in_app: { label: "In your app", tone: "bg-zk-chip text-zk-text" },
  cancelled: { label: "Cancelled", tone: "bg-zk-chip text-zk-muted" },
};


/** The stage as coloured text, for the phone's status line. */
const STAGE_TEXT: Record<ScanStage, string> = {
  scanning: "text-zk-accent",
  report: "text-zk-ok-fg",
  in_app: "text-zk-text2",
  cancelled: "text-zk-muted",
};

type Filter = "all" | "scanning" | "report" | "in_app";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "scanning", label: "Scanning" },
  { id: "report", label: "Report ready" },
  { id: "in_app", label: "In your app" },
];

/** Where a scan is: the same rule as scanStage in lib/security-checks/entry.ts, kept here so this client file needs no server code. */
function stageOf(check: Pick<WorkspaceCheckRow, "status" | "posted" | "moved">): ScanStage {
  if (check.status === "cancelled") return "cancelled";
  if (check.moved > 0) return "in_app";
  return check.posted ? "report" : "scanning";
}

/**
 * The person's scans (#security-checks): the app's Filter menu (by stage, with
 * counts), a search by site, and ten rows a page with the app's numbered
 * pages. The rows use Ziki's list table (as Ideas and Issues) and the layout
 * Intruder, Snyk and Detectify use for their assets; no sidebar.
 */
export function ScanList({ checks, highlightId, show = "all", page = 1, onAdd, adding, hideId }: { checks: WorkspaceCheckRow[]; highlightId?: string; show?: string; page?: number; onAdd?: () => void; adding?: React.ReactNode; hideId?: string | null }) {
  const filter: Filter = FILTERS.some(({ id }) => id === show) ? (show as Filter) : "all";
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const searchBox = useRef<HTMLInputElement>(null);
  // Opening the search puts the cursor in it.
  useEffect(() => {
    if (searching) searchBox.current?.focus();
  }, [searching]);
  // Removed scans (cancelled) leave the list.
  // Removed scans leave the list, and so, for now, does the one whose result is showing in the chat.
  const live = useMemo(() => checks.filter((check) => check.status !== "cancelled" && check.id !== hideId), [checks, hideId]);
  const count = (id: Filter) => (id === "all" ? live.length : live.filter((check) => stageOf(check) === id).length);
  const words = query.trim().toLowerCase();
  const matching = live.filter((check) => (filter === "all" || stageOf(check) === filter) && (!words || check.value.toLowerCase().includes(words)));
  // Numbered pages like the app's issue lists; a search looks through every page.
  const totalPages = Math.max(1, Math.ceil(matching.length / PAGE));
  const current = words ? 1 : Math.min(Math.max(1, page), totalPages);
  const visible = words ? matching : matching.slice((current - 1) * PAGE, current * PAGE);

  return (
    <div className="flex flex-col gap-4">
      {/* A toolbar like the app's issue lists: what this is on the left, Filter and search on the right. */}
      <div className={`flex flex-wrap justify-between gap-2 ${adding ? "items-start" : "items-center"}`}>
        <div className="flex flex-wrap items-center gap-3">
          {/* Like "+ Add Idea": opens the chat above to scan a new site. */}
          {onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zk-border bg-zk-surface px-3 text-sm font-semibold text-zk-text hover:bg-zk-chip focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              Add asset
            </button>
          ) : null}
          {/* No visible title: the Assets tab above already says what this is. Kept for screen readers. */}
          <h2 id="security-scans-heading" className="sr-only">
            Your scans
          </h2>
        </div>
        {/* Like the app's "+ Add Idea": the box opens in this row, between the button and Filter. */}
        {adding ? <div className="order-last w-full min-w-0 lg:order-none lg:w-auto lg:flex-1">{adding}</div> : null}
        <div className="flex items-center gap-2">
          {searching ? (
            <input
              ref={searchBox}
              type="search"
              aria-label="Search your scans"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              onBlur={() => {
                if (!query.trim()) setSearching(false);
              }}
              placeholder="Search by site"
              className="h-8 w-48 rounded-lg border border-zk-border bg-zk-surface px-3 text-[13px] text-zk-text placeholder:text-zk-muted focus:border-electric-blue-strong/60 focus:outline-none sm:w-60"
            />
          ) : null}
          <ToolbarFilterMenu
            summary={filter === "all" ? "" : FILTERS.find(({ id }) => id === filter)?.label}
            groups={[
              {
                options: FILTERS.map(({ id, label }) => ({
                  label,
                  count: count(id),
                  href: id === "all" ? "/security" : `/security?show=${id}`,
                  selected: filter === id,
                })),
              },
            ]}
          />
          <button
            type="button"
            aria-label="Search your scans"
            aria-pressed={searching}
            onClick={() => setSearching((open) => !open)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-zk-border bg-zk-surface text-zk-text2 hover:bg-zk-chip hover:text-zk-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          </button>
        </div>
      </div>

      {visible.length ? (
        <div className="issues-table relative">
          <div className="issues-table-heading">
            <span className="min-w-0 flex-1">Asset</span>
            <span className="hidden w-48 shrink-0 md:block">Problems found</span>
            <span className="hidden w-28 shrink-0 md:block">Added</span>
            <span className="issues-status-cell justify-end" style={{ width: 220, flexBasis: 220 }}>Status</span>
          </div>
          <ul className="m-0 list-none p-0">
            {visible.map((check, index) => (
              <ScanRow key={check.id} check={check} highlighted={highlightId === check.id} last={index === visible.length - 1} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="m-0 rounded-2xl border border-dashed border-zk-border px-4 py-8 text-center text-sm text-zk-muted">
          {words ? `No scans match "${query.trim()}".` : "No scans here yet."}
        </p>
      )}

      {matching.length && !words ? (
        <PaginationControls
          page={current}
          totalPages={totalPages}
          totalCount={matching.length}
          from={(current - 1) * PAGE + 1}
          to={Math.min(current * PAGE, matching.length)}
          basePath="/security"
          queryParams={{ show: filter === "all" ? undefined : filter }}
          itemLabel="scan"
        />
      ) : null}
    </div>
  );
}

/** Nothing found: a small green badge, styled like the "Report ready" badge. */
function NoProblems() {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-full bg-zk-ok-bg px-2.5 text-xs font-bold text-zk-ok-fg">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      No problems
    </span>
  );
}

/** What each source of the counts means, on hover and for screen readers (15 Nov call). */
const SOURCE_HINT = {
  quick: "What any browser can see. The agents check much more, and their report replaces these numbers when it's ready.",
  agents: "Every finding from the agents' full check. This replaced the quick scan's numbers.",
} as const;

/**
 * One scan as a row, in Ziki's list table (issues.css, as on Ideas and Issues): the site
 * and what it is on the left, what was found as small coloured counts (as Intruder, Snyk and
 * Detectify list their assets), when it was added, then its status. Opening it is the row; fixes
 * are unlocked and moved from the scan's page.
 */
function ScanRow({ check, highlighted, last }: { check: WorkspaceCheckRow; highlighted: boolean; last: boolean }) {
  const stage = stageOf(check);
  const reportHref = `/security/checks/${check.id}`;
  const agent = check.agentReport;
  const severities = ["critical", "high", "medium", "low"] as const;
  const found = agent
    ? severities.map((severity) => [severity, agent.findings.filter((finding) => finding.severity === severity).length] as const)
    : check.preview
      ? severities.map((severity) => [severity, check.preview!.counts[severity]] as const)
      : [];
  const shown = found.filter(([, n]) => n > 0);
  // A posted report with nothing in it counts as nothing found, even with no counts to show.
  const nothing = (found.length > 0 && shown.length === 0) || (check.posted && check.findings === 0);
  const counts = (
    <>
        {nothing ? (
        <NoProblems />
      ) : found.length === 0 ? null : (
        found.map(([severity, n]) => (
          <span
            key={severity}
            title={`${n ? n : "No"} ${severity} ${n === 1 ? "problem" : "problems"}, from the ${agent ? "agents' report" : "quick scan"}. ${SOURCE_HINT[agent ? "agents" : "quick"]}`}
            className={`inline-flex h-6 min-w-7 items-center justify-center rounded-md px-1.5 text-xs font-bold tabular-nums security-severity security-severity--${severity} ${n ? "" : "opacity-30"}`}
          >
            <span className="sr-only">{severity}: </span>
            {n}
          </span>
        ))
      )}
    </>
  );
  const badge = (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${STAGE[stage].tone}`}>
      {stage === "scanning" ? <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> : null}
      {STAGE[stage].label}
    </span>
  );

  return (
    <li className={`issues-row relative flex cursor-pointer items-center ${last ? "" : "border-b border-zk-divider"} ${highlighted ? "bg-zk-tint/40" : ""}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-zk-border bg-zk-bg">
        <KindIcon kind={check.kind} className="text-zk-text2" />
      </span>
      {/* The whole row opens the scan's page, like an issue row: the link covers the row. */}
      <Link href={reportHref} className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-md after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-electric-blue">
        <span className="issues-row-title text-zk-text">{check.value}</span>
        <span className="issues-row-meta flex items-center text-zk-muted">
          <span>{TARGET_KIND_LABEL[check.kind]}</span>
          {/* Where the numbers come from (15 Nov call), said once: hover the label for what it means. */}
          {agent || check.preview ? (
            <span
              title={SOURCE_HINT[agent ? "agents" : "quick"]}
              // Above the row link's cover, so the hover reaches it; clicking still opens the scan.
              className="relative z-10 cursor-help underline decoration-dotted underline-offset-2"
            >
              {agent ? "Agents' report" : "Quick scan"}
              <span className="sr-only">. {SOURCE_HINT[agent ? "agents" : "quick"]}</span>
            </span>
          ) : (
            <span>Not scanned yet</span>
          )}
          {check.moved ? <span>{check.moved} moved to your app</span> : null}
          {/* On a phone the side columns are hidden (issues.css), so the date shows here, as Ideas and Issues do. */}
          <span className="md:hidden">
            <LocalTime date={check.createdAt} />
          </span>
        </span>
        {/* On a phone the status is a coloured line under the details, as Ideas shows "Idea (2/3)". */}
        <span className={`mt-1 inline-flex items-center gap-1.5 text-xs font-semibold md:hidden ${STAGE_TEXT[stage]}`}>
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full bg-current ${stage === "scanning" ? "animate-pulse" : ""}`} />
          {STAGE[stage].label}
        </span>
      </Link>
      {/* On a phone, one ring on the right instead of the four boxes: each severity a coloured piece, the total in the middle. */}
      {found.length || nothing ? (
        <span className="shrink-0 md:hidden">
          <SeverityRing found={found} nothing={nothing} />
        </span>
      ) : null}
      {/* Like Intruder and Detectify: four coloured counts in a fixed order (critical, high, medium, low), in the report's own severity colours (security-finding.css); an empty one is the same box, faded, as on Detectify. */}
      {/* Above the row link's cover so each box's hover says what it counts and where it comes from; it opens the scan too (out of the tab order: the row link is the one stop). */}
      <Link
        href={reportHref}
        tabIndex={-1}
        title={nothing ? `No problems, from the ${agent ? "agents' report" : "quick scan"}. ${SOURCE_HINT[agent ? "agents" : "quick"]}` : undefined}
        className="relative z-10 hidden w-48 shrink-0 items-center gap-1 md:flex"
      >
        {counts}
      </Link>
      <span className="hidden w-28 shrink-0 text-xs text-zk-muted md:block">
        <LocalTime date={check.createdAt} />
      </span>
      <span className="issues-status-cell justify-end gap-2" style={{ width: 220, flexBasis: 220 }}>{badge}</span>
    </li>
  );
}

/**
 * What was found, as a ring for small screens: Ziki's score ring (app/(app)/[org]/page.tsx)
 * split into one coloured piece per severity, in the severity boxes' colours, with the total
 * found in the middle. A green ring with a tick when nothing was found.
 */
/** The ring's pieces: the same colours as the severity boxes (their border shade in security-finding.css). */
const RING_COLOUR: Record<"critical" | "high" | "medium" | "low", string> = {
  critical: "var(--color-red-300)",
  high: "var(--color-orange-300)",
  medium: "var(--color-yellow-300)",
  low: "var(--color-blue-300)",
};

function SeverityRing({ found, nothing }: { found: ReadonlyArray<readonly ["critical" | "high" | "medium" | "low", number]>; nothing: boolean }) {
  const radius = 17;
  const length = 2 * Math.PI * radius;
  const total = found.reduce((sum, [, n]) => sum + n, 0);
  const gap = total > 1 ? 2.5 : 0;
  let start = 0;
  const label = nothing ? "No problems" : found.filter(([, n]) => n).map(([severity, n]) => `${n} ${severity}`).join(", ");
  return (
    <span role="img" aria-label={label} title={label} className="relative grid h-11 w-11 place-items-center">
      <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" className="absolute inset-0 -rotate-90">
        <circle cx="22" cy="22" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="5" className={nothing ? "text-zk-ok-fg" : "text-zk-muted"} />
        {nothing ? (
          <circle cx="22" cy="22" r={radius} fill="none" stroke="currentColor" strokeWidth="5" className="text-zk-ok-fg" />
        ) : (
          found.map(([severity, n]) => {
            if (!n) return null;
            const piece = (n / total) * length;
            const dash = Math.max(piece - gap, 1);
            const offset = -start;
            start += piece;
            return (
              <circle
                key={severity}
                cx="22"
                cy="22"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="5"
                strokeDasharray={`${dash} ${length - dash}`}
                strokeDashoffset={offset}
                style={{ color: RING_COLOUR[severity] }}
              />
            );
          })
        )}
      </svg>
      {/* The total found in the middle; a tick when there's nothing. */}
      <span className={`text-sm font-bold tabular-nums ${nothing ? "text-zk-ok-fg" : "text-zk-text"}`}>{nothing ? "✓" : total}</span>
    </span>
  );
}

export function ScansArea({
  checks,
  highlightId,
  show,
  page,
  startWith,
}: {
  checks: WorkspaceCheckRow[];
  highlightId?: string;
  show?: string;
  page?: number;
  startWith?: string;
}) {
  const router = useRouter();
  // Open when arriving with a site, or when it was left open (back from a scan's page).
  const [adding, setAdding] = useState(() => Boolean(startWith) || chatLeftOpen());
  // A site can arrive after the page is already showing (picking a workspace comes back to this same page
  // with ?picked=1): open the chat then too, so the site goes in and its result shows.
  // (React's "adjust state when a prop changes" pattern, during render rather than in an effect.)
  const [arrived, setArrived] = useState(startWith);
  if (startWith !== arrived) {
    setArrived(startWith);
    if (startWith) setAdding(true);
  }
  useEffect(() => {
    keepChatOpen(adding);
  }, [adding]);
  // The scan whose result is in the chat: its card waits until "See progress", so it isn't shown twice.
  const [inChat, setInChat] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  const chat = adding ? (
    <SecurityChat
      id="security-chat"
      focusOnOpen
      startWith={startWith}
      onScanned={setInChat}
      // Straight to the scan's page; the chat stays open for when they come back.
      onSeeProgress={(checkId) => router.push(`/security/checks/${checkId}`)}
      onClose={() => {
        setAdding(false);
        setInChat(null);
      }}
    />
  ) : null;

  return (
    <div ref={list} className="scroll-mt-24 p-3 sm:p-6">
      <ScanList
        checks={checks}
        highlightId={highlightId}
        show={show}
        page={page}
        // Like "+ Add Idea": a second click closes the box. Opening it starts a fresh conversation.
        onAdd={() => {
          if (!adding) startNewChat();
          setAdding((open) => !open);
          setInChat(null);
        }}
        adding={chat}
        hideId={adding ? inChat : null}
      />
    </div>
  );
}
