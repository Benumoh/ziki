"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ScanStage, WorkspaceCheckRow } from "@/lib/security-checks/entry";
import { LocalTime } from "@/components/local-time";
import { ToolbarFilterMenu } from "@/components/toolbar-filter-menu";
import { PaginationControls } from "@/components/pagination-controls";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { removeScan } from "@/app/actions/security-assistant";
import { useRescan } from "./use-rescan";
import { KindIcon } from "./entry-box";
import { PILL_TONES } from "@/lib/pill-tones";
import "@/components/security-finding.css";
import { SecurityChat, forgetChatAfterRemove } from "./security-chat";

/** Rows on each page. */
const PAGE = 10;

const STAGE: Record<ScanStage, { label: string; text: string; dot: string }> = {
  quick_only: { label: "Quick scan done", text: "text-zk-text2", dot: "bg-zk-muted" },
  scanning: { label: "Scanning", text: "text-zk-accent", dot: "bg-electric-blue-strong" },
  report: { label: "Report ready", text: "text-zk-ok-fg", dot: "bg-zk-ok-fg" },
  in_app: { label: "In your app", text: "text-zk-text2", dot: "bg-zk-muted" },
  cancelled: { label: "Cancelled", text: "text-zk-muted", dot: "bg-zk-muted" },
};

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
type Severity = (typeof SEVERITIES)[number];

/** Filter menu choices (?show=), in Ziki's own Filter menu, as on Issues. */
type Filter = "all" | "quick_only" | "scanning" | "report" | "in_app" | "severe" | "clear" | "website" | "server" | "repo";
const STAGE_FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "quick_only", label: "Quick scan done" },
  { id: "scanning", label: "Scanning" },
  { id: "report", label: "Report ready" },
  { id: "in_app", label: "In your app" },
];
const ATTENTION_FILTERS: { id: Filter; label: string }[] = [
  { id: "severe", label: "Critical or high" },
  { id: "clear", label: "No problems" },
];
const KIND_FILTERS: { id: Filter; label: string }[] = [
  { id: "website", label: "Website" },
  { id: "server", label: "Server" },
  { id: "repo", label: "GitHub repo" },
];
const ALL_FILTERS = [...STAGE_FILTERS, ...ATTENTION_FILTERS, ...KIND_FILTERS];

/** Where a scan is: the same rule as scanStage in lib/security-checks/entry.ts, kept here so this client file needs no server code. */
function stageOf(check: Pick<WorkspaceCheckRow, "status" | "posted" | "moved" | "paymentRequired">): ScanStage {
  if (check.status === "cancelled") return "cancelled";
  if (check.paymentRequired) return "quick_only";
  if (check.moved > 0) return "in_app";
  return check.posted ? "report" : "scanning";
}

/** What was found, worst first: the agents' report once it's posted, the quick scan before that. */
function problemsOf(check: WorkspaceCheckRow) {
  const agent = check.agentReport;
  const found: [Severity, number][] = agent
    ? SEVERITIES.map((severity) => [severity, agent.findings.filter((finding) => finding.severity === severity).length])
    : check.preview
      ? SEVERITIES.map((severity) => [severity, check.preview!.counts[severity]])
      : [];
  const total = found.reduce((sum, [, n]) => sum + n, 0);
  // A posted report with nothing in it counts as nothing found, even with no counts to show.
  const nothing = (found.length > 0 && total === 0) || (check.posted && check.findings === 0);
  // Worst first when sorting: critical counts most, then high, medium and low.
  const weight = found.reduce((sum, [severity, n]) => sum + n * { critical: 1000000, high: 10000, medium: 100, low: 1 }[severity], 0);
  return { found, total, nothing, weight, fromAgents: Boolean(agent) };
}

function matchesFilter(check: WorkspaceCheckRow, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "quick_only" || filter === "scanning" || filter === "report" || filter === "in_app") return stageOf(check) === filter;
  if (filter === "website" || filter === "server" || filter === "repo") return check.kind === filter;
  const { found, nothing } = problemsOf(check);
  if (filter === "clear") return nothing;
  return found.some(([severity, n]) => (severity === "critical" || severity === "high") && n > 0);
}

/** When it was last scanned: its quick scan's date (Scan again updates it), else when it was added. */
function lastScanned(check: WorkspaceCheckRow): Date {
  const at = check.preview?.checkedAt ? new Date(check.preview.checkedAt) : null;
  return at && !Number.isNaN(at.getTime()) ? at : new Date(check.createdAt);
}

/** The site's address without its scheme or path, for its icon. */
function hostOf(value: string): string | null {
  try {
    return new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`).hostname || null;
  } catch {
    return null;
  }
}

/**
 * The person's targets (#security-checks), laid out as Marketing's (24 Nov, Chloe; Mark: Security in the style set on
 * the other pages). Pills for Feed and each kind of target (Websites, Servers, Repos), as Marketing's Feed and task
 * types. The Feed is one plain list of cards, newest first: each site, where it is, and "See progress". A kind's tab is
 * Marketing's table: "All Websites" with Filter and search, then Name (the site's own icon and name), Problems (the four
 * severity boxes, where Marketing has Score), Last scanned (its Updated) and Status (our stages, as a solid pill), and a
 * "…" per row for Scan again and Remove. Security is one person's own: nothing here to vote on.
 */
export function ScanList({
  checks,
  highlightId,
  show = "all",
  page = 1,
  hideId,
}: {
  checks: WorkspaceCheckRow[];
  highlightId?: string;
  show?: string;
  page?: number;
  hideId?: string | null;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [removing, start] = useTransition();
  const { rescan, pending: rescanning } = useRescan();
  const busy = removing || rescanning;
  const filter: Filter = ALL_FILTERS.some(({ id }) => id === show) ? (show as Filter) : "all";
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const searchBox = useRef<HTMLInputElement>(null);
  // Opening the search puts the cursor in it.
  useEffect(() => {
    if (searching) searchBox.current?.focus();
  }, [searching]);

  // Removed scans leave the list, and so, for now, does the one whose result is showing in the chat.
  const live = useMemo(() => checks.filter((check) => check.status !== "cancelled" && check.id !== hideId), [checks, hideId]);
  const count = (id: Filter) => live.filter((check) => matchesFilter(check, id)).length;
  const words = query.trim().toLowerCase();
  // Newest scan first.
  const matching = useMemo(
    () =>
      live
        .filter((check) => matchesFilter(check, filter) && (!words || check.value.toLowerCase().includes(words)))
        .sort((a, b) => lastScanned(b).getTime() - lastScanned(a).getTime()),
    [live, filter, words],
  );
  // The Feed is the cards; every other choice (a kind, or a status from Filter) is the table.
  const feed = filter === "all";
  // Numbered pages like the app's issue lists; a search looks through every page.
  const totalPages = Math.max(1, Math.ceil(matching.length / PAGE));
  const current = words ? 1 : Math.min(Math.max(1, page), totalPages);
  const visible = words ? matching : matching.slice((current - 1) * PAGE, current * PAGE);
  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("show", filter);
    if (n > 1) params.set("page", String(n));
    const text = params.toString();
    return text ? `/security?${text}` : "/security";
  };
  const heading = KIND_PILLS.find(({ id }) => id === filter)?.label ?? "targets";

  // Scan again with agents (#security-rescan): paid, after one confirm, for scans whose report is in.
  function scanAgain(row: WorkspaceCheckRow) {
    if (!row.posted) {
      toast("Scan this again once its report is in.", "error");
      return;
    }
    rescan([row.id]);
  }

  async function remove(row: WorkspaceCheckRow) {
    const confirmed = await confirm({
      title: `Remove ${row.value}?`,
      body: "Agents stop checking, and any report goes too. Anything you moved to your app stays there.",
      confirmLabel: "Remove scan",
      tone: "danger",
    });
    if (!confirmed) return;
    start(async () => {
      const answer = await removeScan(row.id);
      // A removed scan's result never waits in the chat: it starts fresh and closed (18 Nov).
      if (answer.ok) forgetChatAfterRemove();
      router.refresh();
      toast(answer.ok ? "Scan removed." : "Couldn't remove it.", answer.ok ? undefined : "error");
    });
  }

  const empty = (
    // Nothing checked yet: an empty card, as Marketing's (23 Nov, Chloe); the chat box above is where to start.
    <div className="mt-4 rounded-xl bg-zk-bg p-4 sm:p-5">
      <div className="rounded-2xl border border-zk-border bg-zk-surface px-4 py-14 text-center">
        <p className="m-0 text-base font-semibold text-zk-text">Nothing checked yet.</p>
        <p className="m-0 mt-1.5 text-sm text-zk-muted">Websites you add show up here, with what the agents find.</p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col p-4 sm:p-5">
      {/* Marketing's row: Feed, then each kind of target, as pills with their counts. */}
      <nav aria-label="Kinds of target" className="flex flex-wrap items-center gap-1.5">
        {KIND_PILLS.map(({ id, label }) => {
          const on = filter === id;
          return (
            <Link
              key={id}
              href={id === "all" ? "/security" : `/security?show=${id}`}
              scroll={false}
              aria-current={on ? "page" : undefined}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue ${on ? "bg-white text-zk-text shadow-[0_1px_3px_rgba(16,24,40,0.12)] ring-1 ring-black/[0.04]" : "bg-zk-bg text-zk-text2 hover:bg-zk-chip"}`}
            >
              {label}
              <span className="text-[12px] tabular-nums text-zk-muted">
                {count(id)}
                <span className="sr-only">{count(id) === 1 ? " target" : " targets"}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      {live.length === 0 ? (
        empty
      ) : feed ? (
        // The Feed: one plain list, newest first, as Marketing's Feed.
        <ul aria-label="Feed" className="m-0 mt-4 flex list-none flex-col gap-3 rounded-xl bg-zk-bg p-3 sm:p-4">
          {matching.map((check) => (
            <FeedCard key={check.id} check={check} highlighted={highlightId === check.id} />
          ))}
        </ul>
      ) : (
        <section aria-labelledby="security-all" className="mt-4 rounded-xl bg-zk-bg p-3 sm:p-4">
          {/* The table's heading, with Filter and search on its right, as Marketing's "All Landing Pages". */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 id="security-all" className="m-0 flex items-center gap-2 text-[16px] font-medium text-zk-text">
              All {heading}
              <span className="text-[13px] font-normal tabular-nums text-zk-muted">{matching.length}</span>
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {searching ? (
                <input
                  ref={searchBox}
                  type="search"
                  aria-label="Search your targets"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onBlur={() => {
                    if (!query.trim()) setSearching(false);
                  }}
                  placeholder="Search by site"
                  className="h-8 w-44 rounded-lg border border-zk-border bg-zk-surface px-3 text-[13px] text-zk-text placeholder:text-zk-muted focus:border-electric-blue-strong/60 focus:outline-none sm:w-60"
                />
              ) : null}
              <ToolbarFilterMenu
                summary={STAGE_FILTERS.some(({ id }) => id === filter) || ATTENTION_FILTERS.some(({ id }) => id === filter) ? ALL_FILTERS.find(({ id }) => id === filter)?.label : ""}
                // The kinds are the pills above; the menu keeps the statuses and what needs attention.
                groups={[
                  { label: "Status", options: STAGE_FILTERS.filter(({ id }) => id !== "all").map(({ id, label }) => ({ label, count: count(id), href: `/security?show=${id}`, selected: filter === id })) },
                  { label: "Needs attention", options: ATTENTION_FILTERS.map(({ id, label }) => ({ label, count: count(id), href: `/security?show=${id}`, selected: filter === id })) },
                ]}
              />
              <button
                type="button"
                aria-label="Search your targets"
                aria-pressed={searching}
                onClick={() => setSearching((open) => !open)}
                className="grid h-8 w-8 place-items-center rounded-lg border border-zk-border bg-zk-surface text-zk-text2 hover:bg-zk-chip hover:text-zk-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              </button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-zk-border bg-zk-surface">
            <table aria-label="Your targets" className="w-full min-w-[620px] table-fixed border-collapse text-[13.5px]">
              <colgroup>
                <col />
                <col className="w-[160px]" />
                <col className="w-[112px]" />
                <col className="w-[150px]" />
                <col className="w-[44px]" />
              </colgroup>
              <thead className="bg-[#f7f8fa]">
                <tr>
                  <th scope="col" className={HEAD}>Name</th>
                  <th scope="col" className={HEAD}>Problems</th>
                  <th scope="col" className={HEAD}>Last scanned</th>
                  <th scope="col" className={HEAD}>Status</th>
                  <th scope="col" className={HEAD}><span className="sr-only">More</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-zk-muted">{words ? `No targets match "${query.trim()}".` : "Nothing here in that status."}</td>
                  </tr>
                ) : (
                  visible.map((check) => (
                    <TargetTableRow key={check.id} check={check} highlighted={highlightId === check.id} onScanAgain={() => scanAgain(check)} onRemove={() => remove(check)} busy={busy} />
                  ))
                )}
              </tbody>
            </table>
          </div>
          {matching.length > PAGE && !words ? (
            <div className="mt-3 px-1">
              {/* A computer gets Ziki's numbered pages; a phone gets "1–10 of 20 ‹ ›", as Gmail does on a phone. */}
              <div className="hidden md:block">
                <PaginationControls
                  page={current}
                  totalPages={totalPages}
                  totalCount={matching.length}
                  from={(current - 1) * PAGE + 1}
                  to={Math.min(current * PAGE, matching.length)}
                  basePath="/security"
                  queryParams={{ show: filter === "all" ? undefined : filter }}
                  itemLabel="target"
                />
              </div>
              <div className="flex items-center justify-end gap-2 md:hidden">
                <span className="mr-1 text-[13px] text-zk-text2 tabular-nums">
                  {(current - 1) * PAGE + 1}–{Math.min(current * PAGE, matching.length)} of {matching.length}
                </span>
                <PageArrow href={current > 1 ? pageHref(current - 1) : null} label="Previous page" glyph="‹" />
                <PageArrow href={current < totalPages ? pageHref(current + 1) : null} label="Next page" glyph="›" />
              </div>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}

/** The pills above the list: Feed, then each kind of target, as Marketing's Feed and task types. */
const KIND_PILLS: { id: Filter; label: string }[] = [
  { id: "all", label: "Feed" },
  { id: "website", label: "Websites" },
  { id: "server", label: "Servers" },
  { id: "repo", label: "Repos" },
];

/** Marketing's table cells (marketing-home.tsx). */
const HEAD = "border-b border-zk-border px-3 py-2.5 text-left text-[12px] font-semibold text-zk-muted";
const CELL = "border-b border-zk-divider px-3 py-3 align-middle";

/** Each stage's pill, in Ziki's pill colours: solid in the table, as Marketing's Status. */
const STAGE_TONE: Record<ScanStage, keyof typeof PILL_TONES> = {
  quick_only: "grey",
  scanning: "blue",
  report: "green",
  in_app: "purple",
  cancelled: "grey",
};

/** Where a site is, in a sentence: under its name in the table, and on its Feed card. */
function whereItIs(check: WorkspaceCheckRow): string {
  const stage = stageOf(check);
  const { total, nothing } = problemsOf(check);
  const found = nothing ? "nothing found" : total ? `${total} ${total === 1 ? "problem" : "problems"} found` : "";
  if (stage === "scanning") {
    const parts = check.parts && check.parts.total ? ` · ${check.parts.done} of ${check.parts.total} parts done` : "";
    return `Agents are checking it${parts}`;
  }
  if (stage === "in_app") return `${check.moved} sent to your app`;
  return [STAGE[stage].label, found].filter(Boolean).join(" · ");
}

/** A Feed card, as Marketing's: the site's icon and name, where it is, and "See progress". The card opens its page. */
function FeedCard({ check, highlighted }: { check: WorkspaceCheckRow; highlighted: boolean }) {
  return (
    <li>
      <Link
        href={`/security/checks/${check.id}`}
        className={`flex items-center gap-4 rounded-2xl border border-zk-border bg-zk-surface px-4 py-3.5 transition hover:bg-zk-chip focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue sm:px-5 sm:py-4 ${highlighted ? "ring-2 ring-electric-blue-strong/40" : ""}`}
      >
        <TargetIcon check={check} large />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-zk-text">{check.value}</span>
          <span className="mt-0.5 block truncate text-[13px] text-zk-muted">
            {whereItIs(check)} · <LocalTime date={lastScanned(check)} />
          </span>
        </span>
        <span className="shrink-0 rounded-full px-3 py-1 text-[12.5px] font-semibold" style={PILL_TONES.blue}>See progress</span>
      </Link>
    </li>
  );
}

/** One site in Marketing's table: name and where it is, its problems, when it was last scanned, its status and "…". */
function TargetTableRow({
  check,
  highlighted,
  onScanAgain,
  onRemove,
  busy,
}: {
  check: WorkspaceCheckRow;
  highlighted: boolean;
  onScanAgain: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const stage = stageOf(check);
  const href = `/security/checks/${check.id}`;
  const { found, nothing, fromAgents } = problemsOf(check);
  const source = fromAgents ? "agents' report" : "quick scan";
  return (
    <tr className={`transition hover:bg-zk-bg has-[[aria-expanded=true]]:relative has-[[aria-expanded=true]]:z-30 ${highlighted ? "bg-zk-tint/40" : ""}`}>
      <td className={CELL}>
        <span className="flex min-w-0 items-center gap-2.5">
          <TargetIcon check={check} />
          {/* A site opens its own page, with everything found on it. */}
          <Link href={href} className="block min-w-0 truncate font-semibold text-zk-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue">
            {check.value}
          </Link>
        </span>
      </td>
      <td className={CELL}>
        <Link href={href} tabIndex={-1} className="flex items-center gap-1">
          {nothing ? (
            <NoProblems />
          ) : found.length ? (
            found.map(([severity, n]) => (
              <span
                key={severity}
                title={`${n ? n : "No"} ${severity} ${n === 1 ? "problem" : "problems"}, from the ${source}.`}
                className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-xs font-bold tabular-nums security-severity security-severity--${severity} ${n ? "" : "opacity-30"}`}
              >
                <span className="sr-only">{severity}: </span>
                {n}
              </span>
            ))
          ) : (
            <span className="text-xs text-zk-muted">Checking…</span>
          )}
        </Link>
      </td>
      <td className={`${CELL} text-[12.5px] text-zk-text2`}>
        <LocalTime date={lastScanned(check)} />
      </td>
      <td className={`${CELL} bg-[#fafafb]`}>
        <span className="inline-flex max-w-full items-center truncate rounded-full px-3 py-1 text-[12px] font-semibold text-white" style={{ backgroundColor: PILL_TONES[STAGE_TONE[stage]].color }}>
          {STAGE[stage].label}
        </span>
      </td>
      <td className={`${CELL} bg-[#fafafb] px-1`}>
        <RowMenu site={check.value} href={href} onScanAgain={onScanAgain} onRemove={onRemove} busy={busy} />
      </td>
    </tr>
  );
}

function PageArrow({ href, label, glyph }: { href: string | null; label: string; glyph: string }) {
  const look = "grid h-8 w-8 place-items-center rounded-lg border border-zk-border bg-zk-surface text-base text-zk-text2";
  return href ? (
    <Link href={href} aria-label={label} className={`${look} hover:bg-zk-chip`}>{glyph}</Link>
  ) : (
    <span aria-label={label} aria-disabled="true" className={`${look} opacity-40`}>{glyph}</span>
  );
}

/** The site's own icon, like Netlify and Vercel list sites: Ziki's server finds the one the site declares (security/checks/[id]/icon). The globe, server or repo icon when there isn't one. */
function TargetIcon({ check, large = false }: { check: WorkspaceCheckRow; large?: boolean }) {
  const host = check.kind === "website" ? hostOf(check.value) : null; // only websites have an icon to look for
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  // An icon that failed before the page came alive never fires onError: check it once on mount.
  useEffect(() => {
    const img = image.current;
    if (img && img.complete && img.naturalWidth < 2) setFailed(true);
  }, []);
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden border border-zk-border bg-zk-surface ${large ? "h-10 w-10 rounded-[11px]" : "h-7 w-7 rounded-md"}`}>
      {host && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- the site's own favicon, from the site itself
        <img
          ref={image}
          src={`/security/checks/${check.id}/icon`}
          alt=""
          width={16}
          height={16}
          onError={() => setFailed(true)}
          onLoad={(event) => {
            if (event.currentTarget.naturalWidth < 2) setFailed(true);
          }}
          className={large ? "h-5 w-5" : "h-4 w-4"}
        />
      ) : (
        <KindIcon kind={check.kind} className={`${large ? "h-5 w-5" : "h-4 w-4"} text-zk-text2`} />
      )}
    </span>
  );
}

/** Nothing found: a small green label. */
function NoProblems() {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-zk-ok-fg">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      No problems
    </span>
  );
}

/** A row's "…": Open, Scan again, Copy link, and Remove scan last in red, like a Detectify or Invicti row menu. */
function RowMenu({ site, href, onScanAgain, onRemove, busy }: { site: string; href: string; onScanAgain: () => void; onRemove: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const base = "block w-full px-3.5 py-1.5 text-left text-[13px] hover:bg-zk-chip disabled:opacity-60";
  const item = `${base} text-zk-text`;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={`More for ${site}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
        className="grid h-7 w-7 place-items-center rounded-md text-zk-muted hover:bg-zk-chip hover:text-zk-text focus-visible:outline-2 focus-visible:outline-electric-blue"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-8 z-30 min-w-44 rounded-xl border border-zk-border bg-zk-surface py-1.5 shadow-[0_16px_40px_rgba(11,23,51,0.18)]">
          <Link role="menuitem" href={href} className={item}>Open</Link>
          <button role="menuitem" type="button" disabled={busy} className={item} onClick={() => { setOpen(false); onScanAgain(); }}>Scan again</button>
          <button
            role="menuitem"
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              navigator.clipboard.writeText(new URL(href, window.location.origin).toString()).then(() => toast("Link copied."), () => toast("Couldn't copy the link.", "error"));
            }}
          >
            Copy link
          </button>
          <div className="mt-1 border-t border-zk-divider pt-1">
            <button role="menuitem" type="button" disabled={busy} className={`${base} text-[#b42318]`} onClick={() => { setOpen(false); onRemove(); }}>Remove scan</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Security page (#security-checks), as Marketing's (23 Nov, Chloe): no title, the chat box first and always open,
 * then the targets in Ziki's panel below. A new site goes in through the chat; its row joins the list.
 */
export function ScansArea({
  checks,
  highlightId,
  show,
  page,
  startWith,
  me,
  top,
  bottom,
}: {
  checks: WorkspaceCheckRow[];
  highlightId?: string;
  show?: string;
  page?: number;
  startWith?: string;
  /** Who is typing, for their picture in the chat. */
  me?: { name: string | null; image: string | null };
  /** Shown at the top of the panel (a note after unlocking fixes). */
  top?: ReactNode;
  /** Shown at the foot of the panel (the privacy note). */
  bottom?: ReactNode;
}) {
  const router = useRouter();
  // The scan whose result is in the chat: its row waits until "See progress", so it isn't shown twice.
  const [inChat, setInChat] = useState<string | null>(null);
  // A scan was removed: its kept conversation is already cleared, so start the chat afresh.
  const [chatKey, setChatKey] = useState(0);
  useEffect(() => {
    const reset = () => {
      setInChat(null);
      setChatKey((key) => key + 1);
    };
    window.addEventListener("zk:chat-forget", reset);
    return () => window.removeEventListener("zk:chat-forget", reset);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-4">
      <h1 id="security-scans-heading" className="sr-only">Security</h1>
      <SecurityChat
        key={chatKey}
        id="security-chat"
        startWith={startWith}
        newChat
        me={me}
        // Marketing's words (23 Nov, Chloe): every new target starts with its address.
        placeholder="Which website should we secure? Paste its address, like https://yourproduct.com"
        onScanned={setInChat}
        onNewChat={() => setInChat(null)}
        // Straight to the scan's page; the chat is kept for when they come back.
        onSeeProgress={(checkId) => router.push(`/security/checks/${checkId}`)}
      />
      <section aria-labelledby="security-scans-heading" className="rounded-panel border border-zk-border bg-zk-surface">
        {top}
        <ScanList checks={checks} highlightId={highlightId} show={show} page={page} hideId={inChat} />
        {bottom}
      </section>
    </div>
  );
}
