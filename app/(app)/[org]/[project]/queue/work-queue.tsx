import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma, Substatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireProject } from "@/lib/project-route";
import { PRODUCT_TRACK } from "@/lib/marketing/track";
import { issueHref } from "@/lib/issue-ref";
import { ISSUE_PRIORITY_LABELS, normalizeIssuePriority, type IssuePriority } from "@/lib/issue-priority";
import { PILL_TONES } from "@/lib/pill-tones";
import { formatIssueNumber } from "@/lib/issue-number";
import { stateLabel, statusLabel, substatusLabel } from "@/lib/labels";
import { yourWorkWhere } from "@/lib/my-work-filter";
import { PipelineSteps } from "@/components/pipeline-steps";
import { StageSidebar } from "@/components/stage-sidebar";
import { SUBSTATUSES } from "@/lib/issue-substatus";
import { issuesPath, orgRefOf, projectPath, queuePath, refOf } from "@/lib/project-paths";
import { ProjectFilter } from "@/components/project-filter";
import { ProjectWeekPanel } from "@/components/project-week-panel";
import { StatCards } from "@/components/stat-cards";
import { readWorkStats } from "@/lib/work-stats";
import { weeklyDeliveries } from "@/lib/project-week";
import { isOnlineNow, loadProjectAgents } from "@/lib/agents/project-agents";
import { OnlineAgentsPanel } from "@/components/online-agents-panel";


/** The steps where an issue still has work to move it: everything before Live and Closed. */
const ACTIVE: Prisma.BugWhereInput["status"] = { in: ["open", "in_progress", "done", "merge"] };
/** The most rows the queue shows at once. */
const LIMIT = 300;
/** The tab bar's sections: each main status still in play, with its detailed steps as tabs. */
const SECTIONS = (["open", "in_progress", "done", "merge"] as const).map((status) => ({ status, steps: SUBSTATUSES[status] }));
const STAGE_PARAM = "status";
/** The Your Work tab's value: what you and your agents hold. */
const MINE = "mine";
/** The Overview tab's value, the queue's default: the top contributors this week. */
const OVERVIEW = "overview";
/** The Online tab's value (#online-agents): the agents online now, what each is on, and what you can do about it. */
const ONLINE = "online";
const STEP_PARAM = "step";

type Row = {
  id: string;
  number: number;
  title: string;
  substatus: Substatus;
  updatedAt: Date;
  pullRequestUrl: string | null;
  priority: string;
  project: { name: string; slug: string; organisation: { slug: string } };
  claims: Array<{ status: string; deliverBy: Date | null; agent: { name: string } | null; beneficiary: { name: string | null } }>;
  testVerdicts: Array<{ goodToMerge: boolean; pullRequestUrl: string | null }>;
  _count: { bids: number };
};

/** What the issue needs next, in a few words, and whether it is late. */
function nextAction(row: Row, now: number): { text: string; tone: "act" | "wait" | "late" } {
  const claim = row.claims[0];
  switch (row.substatus) {
    case "requires_confirmation":
      return { text: "Confirm it", tone: "act" };
    case "open":
      if (claim?.status === "offered") return { text: `Offer to ${claim.agent?.name ?? "an agent"}`, tone: "wait" };
      return row._count.bids > 0 ? { text: `Award one of ${row._count.bids} ${row._count.bids === 1 ? "bid" : "bids"}`, tone: "act" } : { text: "Bid on it", tone: "act" };
    case "plan_review":
      return { text: "Plan awaits its owner", tone: "wait" };
    case "in_progress":
      return claim?.deliverBy && claim.deliverBy.getTime() < now ? { text: "Delivery overdue", tone: "late" } : { text: "Being worked on", tone: "wait" };
    case "requires_review":
      return { text: "Judge the delivery", tone: "act" };
    case "accepted":
      return { text: "Manager review", tone: "act" };
    case "ready_to_merge":
      return { text: "Merge it", tone: "act" };
    case "error":
      return { text: "Fix the pull request", tone: "late" };
    default:
      return { text: "—", tone: "wait" };
  }
}

/** One table cell: roomy rows with a light line under each, no lines between columns. */
const CELL = "h-12 whitespace-nowrap border-b border-zk-divider px-2.5 align-middle";
/** The column headings: small, spaced capitals on a light band. */
const HEAD = "h-10 whitespace-nowrap px-2.5 align-middle font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-zk-muted first:rounded-l-lg last:rounded-r-lg";

/** What the issue needs next, as a tinted pill: blue to act on, grey while it waits, red when it is in trouble. */
const NEXT_TONE = { act: PILL_TONES.blue, wait: PILL_TONES.grey, late: PILL_TONES.red } as const;

/** The priority groups, most urgent first, each with its signal colour. */
const PRIORITY_GROUPS: ReadonlyArray<{ priority: IssuePriority; colour: string }> = [
  { priority: "urgent", colour: "#dc2626" },
  { priority: "high", colour: "#ea580c" },
  { priority: "medium", colour: "#d97706" },
  { priority: "low", colour: "#94a3b8" },
];

/** A tinted pill, with a dot in its colour. */
function Pill({ tone, children }: { tone: { backgroundColor: string; color: string }; children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-[12rem] items-center gap-1.5 truncate rounded-md px-2 py-1 text-[12px] font-medium" style={tone}>
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />
      {children}
    </span>
  );
}

/** An outlined pill for a name or project, with an initial when it is a person or agent. */
function Outline({ initial, children }: { initial?: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-[12rem] items-center gap-1.5 truncate rounded-md border border-zk-border bg-zk-surface px-2 py-1 text-[12px] font-medium text-zk-text">
      {initial ? (
        <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold" style={PILL_TONES.blue}>
          {initial}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** The priority signal: three rising bars, as many lit as the priority is high. */
function PriorityBars({ priority, colour }: { priority: IssuePriority; colour: string }) {
  const lit = priority === "urgent" || priority === "high" ? 3 : priority === "medium" ? 2 : 1;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      {[0, 1, 2].map((bar) => (
        <rect key={bar} x={1 + bar * 4.5} y={9 - bar * 3.5} width="3" height={4 + bar * 3.5} rx="1" fill={bar < lit ? colour : "#d4d8e0"} />
      ))}
    </svg>
  );
}

const COLUMN_ICONS = {
  text: "M4 7V5h16v2M9 19h6M12 5v14",
  tag: "M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  check: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  arrow: "M5 12h14M12 5l7 7-7 7",
  calendar: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 2v4M8 2v4M3 10h18",
} as const;

/** A column heading: its small icon, then its name in spaced capitals. */
function ColumnHead({ icon, children }: { icon: keyof typeof COLUMN_ICONS; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={COLUMN_ICONS[icon]} />
      </svg>
      {children}
    </span>
  );
}

/** "in 3h", "2d ago": a deadline relative to now. */
function relative(date: Date, now: number): string {
  const minutes = Math.round((date.getTime() - now) / 60_000);
  const abs = Math.abs(minutes);
  const value = abs < 60 ? `${abs}m` : abs < 48 * 60 ? `${Math.round(abs / 60)}h` : `${Math.round(abs / 1440)}d`;
  return minutes >= 0 ? `in ${value}` : `${value} ago`;
}

/**
 * The work queue (#work-queue): `/<org>/queue` for every project, `/<org>/<project>/queue` for one. The issue list for
 * people reads as a story; this one is for working through tickets: every
 * issue that still has a step to go, one dense row each, with its step, who
 * holds it, its deadline, its judgements, its pull request and what it needs
 * next. Every project by default, or one with the project filter; most
 * recently moved first. The Online tab lists the agents online now
 * (#online-agents). The agents bar's › opens it.
 */
export async function WorkQueue({
  org,
  slug,
  everyProject = false,
  query,
}: {
  org: string;
  /** The project in the address, or (with `everyProject`) the one the organisation-wide queue is drawn through. */
  slug: string;
  everyProject?: boolean;
  query: Record<string, string | string[] | undefined>;
}) {
  const { user, organisationId, project, isOrgMember } = await requireProject(org, slug);
  if (!isOrgMember || !organisationId) notFound();
  // The queue's own links stay organisation-wide on `/<org>/queue`.
  const listRef = everyProject ? orgRefOf(project.ref) : project.ref;

  const projects = await prisma.project.findMany({
    where: { organisationId, archivedAt: null },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, slug: true, name: true, organisation: { select: { slug: true } } },
  });
  const filter = everyProject ? null : projects.find((item) => item.id === project.id) ?? null;
  const scope: Prisma.BugWhereInput = { organisationId, ...PRODUCT_TRACK, isDeleted: false, status: ACTIVE, ...(filter ? { projectId: filter.id } : {}) };
  // As on the lists: the top bar picks the overall status, the sidebar its detailed step (its first by default).
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  // Your Work: what is offered to, awarded to or being worked on by you or your agents, and not live yet.
  const mineWhere = yourWorkWhere(user.id);
  const mine = one(query[STAGE_PARAM]) === MINE;
  // Overview, the first tab and the default: who delivered what this week.
  const overview = !one(query[STAGE_PARAM]) || one(query[STAGE_PARAM]) === OVERVIEW;
  const online = one(query[STAGE_PARAM]) === ONLINE;
  const section = SECTIONS.find((item) => item.status === one(query[STAGE_PARAM])) ?? SECTIONS[0];
  // The Overview's stat cards (#work-stats): this week against last, for the organisation or the picked project.
  const stats = overview ? await readWorkStats({ organisationId, projectId: filter?.id ?? null }) : [];
  const at = new Date();
  const [grouped, mineGrouped, weekPeople, agents] = await Promise.all([
    prisma.bug.groupBy({ by: ["substatus"], where: scope, _count: { _all: true } }),
    prisma.bug.groupBy({ by: ["substatus"], where: { AND: [scope, mineWhere] }, _count: { _all: true } }),
    // The top contributors: who delivered what this week, in the project picked (or all of them).
    weeklyDeliveries(organisationId, filter?.id ?? null),
    // The Online tab (#online-agents): the agents at work in the project picked (or all of them). Every tab shows its count.
    loadProjectAgents({ projectId: filter?.id ?? null, organisationId, now: at }),
  ]);
  const onlineCount = agents.filter((agent) => isOnlineNow(agent, at)).length;
  const counts = new Map(grouped.map((row) => [row.substatus, row._count._all]));
  const mineCounts = new Map(mineGrouped.map((row) => [row.substatus, row._count._all]));
  const mineTotal = mineGrouped.reduce((sum, row) => sum + row._count._all, 0);
  // Your Work's sidebar: every step you have something at, in the pipeline's order.
  const mineSteps = SECTIONS.flatMap((item) => item.steps).filter((value) => (mineCounts.get(value) ?? 0) > 0);
  // Your Work shows all of it unless a step is picked; a status shows one step, its first by default.
  const step: Substatus | null = mine
    ? mineSteps.find((value) => value === one(query[STEP_PARAM])) ?? null
    : section.steps.find((value) => value === one(query[STEP_PARAM])) ?? section.steps[0];
  const href = (status: string, value?: Substatus) => {
    const next = new URLSearchParams();
    next.set(STAGE_PARAM, status);
    if (value) next.set(STEP_PARAM, value);
    return queuePath(listRef, next);
  };
  // The same tab and step, in another project or in all of them.
  const keep = new URLSearchParams();
  for (const key of [STAGE_PARAM, STEP_PARAM]) {
    const value = one(query[key]);
    if (value) keep.set(key, value);
  }

  const rows: Row[] = overview || online ? [] : await prisma.bug.findMany({
    where: mine ? { AND: [scope, mineWhere, ...(step ? [{ substatus: step }] : [])] } : { ...scope, substatus: step ?? undefined },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: LIMIT,
    select: {
      id: true,
      number: true,
      priority: true,
      title: true,
      substatus: true,
      updatedAt: true,
      pullRequestUrl: true,
      project: { select: { name: true, slug: true, organisation: { select: { slug: true } } } },
      claims: {
        where: { releasedAt: null, status: { in: ["offered", "planning", "active"] } },
        orderBy: [{ createdAt: "desc" }],
        take: 1,
        select: { status: true, deliverBy: true, agent: { select: { name: true } }, beneficiary: { select: { name: true } } },
      },
      testVerdicts: { select: { goodToMerge: true, pullRequestUrl: true } },
      _count: { select: { bids: { where: { withdrawnAt: null, awardedAt: null } } } },
    },
  });
  const now = at.getTime();
  const several = projects.length > 1;

  // Every tab is as wide as the Overview page and the lists (max-w-[920px]), so the cards line up from page to page.
  return (
    <div className="mx-auto w-full max-w-[920px] space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="sr-only">Work queue</h1>
        {/* Where you are: the project's lists, then this page. */}
        <nav aria-label="Breadcrumb" className="text-[13px] text-zk-text2">
          <ol className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
            <li>
              <Link href={issuesPath(listRef, "your_work")} className="rounded-md px-1 py-0.5 font-bold text-zk-text hover:bg-zk-chip">
                {filter ? filter.name : "All projects"}
              </Link>
            </li>
            <li aria-hidden="true" className="text-zk-muted">/</li>
            <li aria-current="page" className="px-1 font-medium">Work queue</li>
          </ol>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          {/* The project's notes: what agents and people learned while working on it. */}
          <Link
            href={projectPath(project.ref, "/notes")}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zk-border bg-zk-surface px-3 text-[13px] font-medium text-zk-text2 hover:bg-zk-chip hover:text-zk-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue"
          >
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="3" width="15" height="18" rx="2" /><path d="M9 3v18M3 7h4M3 12h4M3 17h4M12 8h5M12 12h5" /></svg>
            Project notes
          </Link>
          {several ? (
            <ProjectFilter
              allHref={queuePath(orgRefOf(project.ref), keep)}
              projects={projects.map((item) => ({ slug: item.slug, name: item.name, href: queuePath(refOf(item), keep) }))}
              current={filter?.slug ?? null}
            />
          ) : null}
        </div>
      </header>

      {/* The overall statuses across the top, as on the lists. */}
      <div className="flex justify-center">
        <PipelineSteps
          label="Statuses"
          stages={[
            { label: "Overview", count: weekPeople.length, href: href(OVERVIEW), selected: overview },
            { label: "Online", count: onlineCount, href: href(ONLINE), selected: online },
            { label: "Your Work", count: mineTotal, href: href(MINE), selected: mine },
            ...SECTIONS.map((item) => ({
              label: statusLabel[item.status],
              count: item.steps.reduce((sum, value) => sum + (counts.get(value) ?? 0), 0),
              href: href(item.status),
              selected: !mine && !overview && !online && item.status === section.status,
            })),
          ]}
        />
      </div>

      {overview ? (
        <div className="flex flex-col gap-4">
          <StatCards stats={stats} />
          <ProjectWeekPanel people={weekPeople} viewerId={user.id} />
        </div>
      ) : online ? (
        <OnlineAgentsPanel agents={agents} viewerId={user.id} place={filter ? filter.name : "every project"} now={at} />
      ) : (
      <div className="flex items-start gap-5 max-lg:flex-col max-lg:gap-3">
        {/* The detailed steps of that status down the left, as on the lists. */}
        <StageSidebar
          steps={
            mine
              ? [
                  { label: "All", count: mineTotal, href: href(MINE), selected: !step },
                  ...mineSteps.map((value) => ({
                    label: stateLabel(value),
                    count: mineCounts.get(value) ?? 0,
                    href: href(MINE, value),
                    selected: value === step,
                    ...(value === "error" ? { tone: "warn" as const } : {}),
                  })),
                ]
              : section.steps.map((value) => ({
                  label: substatusLabel[value],
                  count: counts.get(value) ?? 0,
                  href: href(section.status, value),
                  selected: value === step,
                  ...(value === "error" && (counts.get(value) ?? 0) > 0 ? { tone: "warn" as const } : {}),
                }))
          }
        />
        <div className="min-w-0 flex-1">
      {/* A table grouped by priority: a light heading band, roomy rows, tinted pills, and a summary at the foot. */}
      <div className="rounded-xl border border-zk-border bg-zk-surface p-3">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="bg-[#f4f6f9]">
                <th scope="col" className={`${HEAD} w-16`}>#</th>
                <th scope="col" className={HEAD}><ColumnHead icon="text">Issue</ColumnHead></th>
                {several ? <th scope="col" className={HEAD}><ColumnHead icon="tag">Project</ColumnHead></th> : null}
                {step ? null : <th scope="col" className={HEAD}><ColumnHead icon="arrow">Step</ColumnHead></th>}
                <th scope="col" className={HEAD}><ColumnHead icon="user">Held by</ColumnHead></th>
                <th scope="col" className={HEAD}><ColumnHead icon="clock">Deadline</ColumnHead></th>
                <th scope="col" className={HEAD}><ColumnHead icon="check">Tests</ColumnHead></th>
                <th scope="col" className={HEAD}><ColumnHead icon="link">PR</ColumnHead></th>
                <th scope="col" className={HEAD}><ColumnHead icon="arrow">Next</ColumnHead></th>
                <th scope="col" className={HEAD}><ColumnHead icon="calendar">Moved</ColumnHead></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-sm text-zk-muted">
                    {mine ? (step ? `Nothing of yours at ${stateLabel(step)}.` : "Nothing of yours in play: no offers, plans or work in hand.") : `Nothing at ${step ? substatusLabel[step] : "this step"} right now.`}
                  </td>
                </tr>
              ) : (
                PRIORITY_GROUPS.map(({ priority, colour }) => {
                  const group = rows.filter((row) => normalizeIssuePriority(row.priority) === priority);
                  if (group.length === 0) return null;
                  return (
                    <Fragment key={priority}>
                      {/* The group's heading: its signal, its name and how many. */}
                      <tr>
                        <td colSpan={10} className="border-b border-zk-divider px-3 pb-2 pt-4">
                          <span className="inline-flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-zk-muted">
                            <PriorityBars priority={priority} colour={colour} />
                            {ISSUE_PRIORITY_LABELS[priority]} priority
                            <span className="rounded bg-zk-chip px-1.5 py-px tabular-nums text-zk-text2">{group.length}</span>
                          </span>
                        </td>
                      </tr>
                      {group.map((row) => {
                        const claim = row.claims[0];
                        const judged = row.testVerdicts.filter((verdict) => verdict.pullRequestUrl === row.pullRequestUrl);
                        const good = judged.filter((verdict) => verdict.goodToMerge).length;
                        const notGood = judged.length - good;
                        const next = nextAction(row, now);
                        const late = Boolean(claim?.deliverBy && claim.deliverBy.getTime() < now);
                        const pr = row.pullRequestUrl ? /\/pull\/(\d+)/.exec(row.pullRequestUrl)?.[1] : null;
                        const holder = claim ? claim.agent?.name ?? claim.beneficiary.name ?? "Someone" : null;
                        return (
                          <tr key={row.id} className="group hover:bg-zk-bg">
                            <td className={`${CELL} font-mono text-[12px] tabular-nums text-zk-muted`}>{formatIssueNumber(row.number)}</td>
                            <td className={`${CELL} w-full max-w-0`}>
                              <Link href={issueHref(row)} className="block truncate text-[14px] font-semibold text-zk-text group-hover:text-zk-accent">
                                {row.title}
                              </Link>
                            </td>
                            {several ? <td className={CELL}><Outline>{row.project.name}</Outline></td> : null}
                            {step ? null : (
                              <td className={CELL} title={stateLabel(row.substatus)}>
                                <Pill tone={PILL_TONES.grey}>{substatusLabel[row.substatus]}</Pill>
                              </td>
                            )}
                            <td className={CELL}>
                              {holder ? (
                                <span title={claim?.beneficiary.name ? `For ${claim.beneficiary.name}` : undefined}>
                                  <Outline initial={holder.charAt(0).toUpperCase()}>
                                    {holder}
                                    {claim?.status === "offered" ? <span className="text-zk-muted"> · offered</span> : null}
                                  </Outline>
                                </span>
                              ) : <span className="text-zk-muted">–</span>}
                            </td>
                            <td className={`${CELL} tabular-nums ${late ? "font-semibold text-zk-bad-fg" : "text-zk-text2"}`}>
                              {claim?.deliverBy ? relative(claim.deliverBy, now) : <span className="text-zk-muted">–</span>}
                            </td>
                            <td className={CELL}>
                              <span className="flex gap-1" title={judged.length ? `${good} good to merge, ${notGood} not` : undefined}>
                                {good ? <Pill tone={PILL_TONES.green}>{good} good</Pill> : null}
                                {notGood ? <Pill tone={PILL_TONES.red}>{notGood} not</Pill> : null}
                                {judged.length === 0 ? <span className="text-zk-muted">–</span> : null}
                              </span>
                            </td>
                            <td className={`${CELL} font-mono text-[12px]`}>
                              {row.pullRequestUrl ? (
                                <a href={row.pullRequestUrl} target="_blank" rel="noopener noreferrer" className="text-zk-accent hover:underline">
                                  {pr ? `#${pr}` : "PR"}
                                </a>
                              ) : <span className="text-zk-muted">–</span>}
                            </td>
                            <td className={CELL}>
                              <Pill tone={NEXT_TONE[next.tone]}>{next.text}</Pill>
                            </td>
                            <td className={`${CELL} tabular-nums text-zk-text2`}>{relative(row.updatedAt, now)}</td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {/* The summary at the foot: how many, and how many are late or have an offer waiting. */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 px-3 pt-3 font-mono text-[12px] text-zk-muted">
          <span><span className="tabular-nums text-zk-text">{rows.length}</span> {rows.length === 1 ? "issue" : "issues"}{rows.length === LIMIT ? ` (the ${LIMIT} most recently moved)` : ""}</span>
          <span><span className="tabular-nums text-zk-bad-fg">{rows.filter((row) => row.claims[0]?.deliverBy && row.claims[0].deliverBy.getTime() < now).length}</span> late</span>
          <span><span className="tabular-nums text-zk-text">{rows.filter((row) => row.claims[0]?.status === "offered").length}</span> offered</span>
          <span><span className="tabular-nums text-zk-text">{rows.filter((row) => row.pullRequestUrl).length}</span> with a PR</span>
        </div>
      </div>
        </div>
      </div>
      )}
    </div>
  );
}

