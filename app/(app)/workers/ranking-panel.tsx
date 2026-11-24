import Link from "next/link";
import { redirect } from "next/navigation";
import "./team.css";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import {
  paginatedOrganisationLeaderboard,
  earnedTotals,
  organisationRankFor,
  DEFAULT_LEADERBOARD_LIMIT,
  type LeaderboardEntry,
} from "@/lib/coins/leaderboard";
import { getPlatformRewardConfig } from "@/lib/rewards/platform";
import { earnedZiks } from "@/lib/coins/earned";
import { formatZik as money, ziksFor } from "@/lib/coins/math";
import { Avatar } from "@/components/avatar";
import {
  StatusPage,
  primaryActionClass,
  secondaryActionClass,
} from "@/components/status-page";
import { databaseErrorReason } from "@/lib/db-error";
import { workflowFor } from "@/lib/workflow";
import { DEFAULT_PROJECT_WORKFLOW } from "@/lib/workflow-config";
import { projectContextFor } from "@/lib/project-context";
import { teamAgentsForMembers, teamAssignedWorkForMembers, type TeamAgent, type TeamAgentWork } from "@/lib/team-directory";
import { MemberAssignedWork } from "@/components/member-assigned-work";
import { isOrganisationAdminRole } from "@/lib/agents/membership";
import { settableLevels } from "@/lib/agents/levels";
import { TeamAgentTable } from "./team-agent-table";
import { RankingRow } from "./ranking-row";
import { WeeklyPaceBar } from "@/components/weekly-pace-bar";

type SortKey = "earnings" | "solved";

export type RankingSearchParams = {
  page?: string;
  limit?: string;
  sort?: string;
  q?: string;
  online?: string;
  capacity?: string;
};

const PODIUM_MEDALS = [
  { fg: "#E0A100", bg: "rgba(224,161,0,0.16)" },
  { fg: "#94A3B8", bg: "rgba(148,163,184,0.18)" },
  { fg: "#C2703D", bg: "rgba(194,112,61,0.16)" },
] as const;

/** One shape for every Ranking link, so the redirect, filters and Previous/Next agree. */
export function rankingHref(opts: {
  page: number;
  limit: number;
  sort?: SortKey;
  q?: string;
  online?: boolean;
  capacity?: boolean;
}): string {
  const params = new URLSearchParams();
  params.set("page", String(opts.page));
  params.set("limit", String(opts.limit));
  if (opts.sort && opts.sort !== "earnings") params.set("sort", opts.sort);
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  if (opts.online) params.set("online", "1");
  if (opts.capacity) params.set("capacity", "1");
  return `/workers?${params.toString()}`;
}

/** Monday 00:00 UTC of the current week: where "this week" starts. */
function startOfWeekUtc(now = new Date()): Date {
  const day = (now.getUTCDay() + 6) % 7; // Monday is 0
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
}

function progressPct(ziks: number, target: number): number {
  const goal = target > 0 ? target : 1;
  return Math.min(100, Math.max(0, Math.round((ziks / goal) * 100)));
}

function parseSort(raw: string | undefined): SortKey {
  return raw === "solved" ? "solved" : "earnings";
}

/** Every ranked member: the list below joins them with the whole team, so it needs them all. */
async function loadAllEntries(organisationId: string): Promise<LeaderboardEntry[]> {
  const first = await paginatedOrganisationLeaderboard(prisma, organisationId, { page: 1, limit: 100 });
  if (first.totalPages <= 1) return first.entries;
  const rest = await Promise.all(
    Array.from({ length: first.totalPages - 1 }, (_, i) =>
      paginatedOrganisationLeaderboard(prisma, organisationId, { page: i + 2, limit: 100 }),
    ),
  );
  return [first.entries, ...rest.map((r) => r.entries)].flat();
}

/** An organisation member with their leaderboard standing and their Team details. */
type RankedMember = {
  userId: string;
  name: string;
  image: string | null;
  /** Null for members who earned nothing yet; they list after everyone ranked. */
  rank: number | null;
  /** Ziks earned all time in this organisation. */
  ziks: number;
  solvedTasks: number;
  /** Ziks earned this week (since Monday, UTC). */
  ziksThisWeek: number;
  role: "Owner" | "Admin" | "Member";
  claims: number;
  agents: TeamAgent[];
  /** #447: assigned to the member, not claimed by any of their agents. */
  assignedWork: TeamAgentWork[];
};

function sortMembers(members: RankedMember[], sort: SortKey): RankedMember[] {
  return [...members].sort((a, b) => {
    if (sort === "solved") {
      return b.solvedTasks - a.solvedTasks || b.ziks - a.ziks || a.name.localeCompare(b.name);
    }
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
    if (a.rank !== null) return -1;
    if (b.rank !== null) return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Ranking: the leaderboard's podium and your standing on top, then every
 * member of the organisation with their earnings, plus the Team details (role,
 * active claims, this week's earnings and agents) the leaderboard didn't show (#428, #657).
 */
export default async function RankingPanel({
  searchParams,
}: {
  searchParams?: Promise<RankingSearchParams>;
}) {
  const params = searchParams ? await searchParams : {};
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const limit = Math.min(
    100,
    Math.max(10, parseInt(params.limit ?? String(DEFAULT_LEADERBOARD_LIMIT), 10) || DEFAULT_LEADERBOARD_LIMIT),
  );
  const sort = parseSort(params.sort);
  const q = (params.q ?? "").trim();
  const showOnlineOnly = params.online === "1";
  const showCapacityOnly = params.capacity === "1";

  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) {
    return (
      <section className="team-empty">
        <h2>No organisation yet</h2>
        <p>Join or create an organisation to see its ranking and team.</p>
        <Link href="/organisations" className="team-primary">Create or join an organisation</Link>
      </section>
    );
  }

  let standing: Awaited<ReturnType<typeof organisationRankFor>>;
  let myTotals: { ziks: number; fixedIssues: number };
  let ranked: LeaderboardEntry[];
  let targetZiks: number;
  let members;
  let agentsMap;
  let assignedMap: Map<string, TeamAgentWork[]>;
  let ziksThisWeek: { userId: string; ziks: number }[];
  let activeClaims;
  let myInMotion = 0;
  let maxActiveClaims: number;
  let activeProjectId: string | null;
  try {
    const context = await projectContextFor(prisma, organisationId);
    activeProjectId = context.activeProjectId;
    members = await prisma.membership.findMany({
      where: { organisationId },
      orderBy: { user: { name: "asc" } },
      select: { role: true, user: { select: { id: true, name: true, image: true } } },
    });
    const memberIds = members.map(({ user: member }) => member.id);
    // The leaderboard shows Ziks earned this week (since Monday, UTC) beside all time.
    const since = startOfWeekUtc();
    [standing, myTotals, ranked, targetZiks, agentsMap, ziksThisWeek, activeClaims] = await Promise.all([
      organisationRankFor(prisma, organisationId, user.id),
      earnedTotals(prisma, organisationId, user.id),
      loadAllEntries(organisationId),
      // The goal is set in dollars (super admin's reward settings); shown in Ziks.
      getPlatformRewardConfig(prisma).then((config) => ziksFor(config.target)),
      teamAgentsForMembers(prisma, organisationId, memberIds),
      Promise.all(memberIds.map(async (userId) => ({ userId, ziks: await earnedZiks(prisma, userId, { organisationId, since }) }))),
      prisma.issueClaim.groupBy({
        by: ["beneficiaryUserId"],
        where: {
          beneficiaryUserId: { in: memberIds },
          status: "active",
          releasedAt: null,
          bug: { organisationId, ...(activeProjectId ? { projectId: activeProjectId } : {}) },
        },
        _count: { _all: true },
      }),
    ]);
    // The funded prices of the viewer's own active claims: what is "in motion" this week.
    const myClaims = await prisma.issueClaim.findMany({
      where: {
        beneficiaryUserId: user.id,
        status: "active",
        releasedAt: null,
        bug: { organisationId },
      },
      select: { bug: { select: { lockedPriceZik: true } } },
    });
    myInMotion = myClaims.reduce((sum, claim) => sum + (claim.bug.lockedPriceZik ?? 0), 0);
    // #447: assigned issues no agent has claimed, shown once per member.
    assignedMap = await teamAssignedWorkForMembers(prisma, organisationId, agentsMap);
    maxActiveClaims = activeProjectId
      ? (await workflowFor(activeProjectId)).maxActiveClaims
      : DEFAULT_PROJECT_WORKFLOW.maxActiveClaims;
  } catch (error) {
    console.error("[ranking] load failed", error);
    const reason = databaseErrorReason(error) ?? "The ranking could not be read.";
    return (
      <StatusPage
        title="This page didn't load"
        actions={
          <>
            <Link href="/workers" className={primaryActionClass}>
              Try again
            </Link>
            <Link href="/home" className={secondaryActionClass}>
              Go to issues
            </Link>
          </>
        }
      >
        <p>{reason}</p>
      </StatusPage>
    );
  }

  const viewerMembership = members.find((membership) => membership.user.id === user.id);
  const manageLevels = isOrganisationAdminRole(viewerMembership?.role, user.role)
    ? settableLevels({ isOwner: false, isAdminOfOrganisation: true })
    : null;
  const capacityScope = activeProjectId ? "selected project" : "organisation";
  const rankedById = new Map(ranked.map((entry) => [entry.userId, entry]));
  const recentById = new Map(ziksThisWeek.map((row) => [row.userId, row.ziks]));
  const claimsById = new Map(activeClaims.map((row) => [row.beneficiaryUserId, row._count._all]));

  const everyone: RankedMember[] = members.map(({ role, user: member }) => {
    const entry = rankedById.get(member.id);
    return {
      userId: member.id,
      name: member.name,
      image: entry?.image ?? member.image ?? null,
      rank: entry?.rank ?? null,
      ziks: entry?.ziks ?? 0,
      solvedTasks: entry?.fixedIssues ?? 0,
      ziksThisWeek: recentById.get(member.id) ?? 0,
      role: role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Member",
      claims: claimsById.get(member.id) ?? 0,
      agents: agentsMap.get(member.id) ?? [],
      assignedWork: assignedMap.get(member.id) ?? [],
    };
  });

  const matching = everyone.flatMap((member) => {
    if (q && !member.name.toLowerCase().includes(q.toLowerCase())) return [];
    const onlineAgents = member.agents.filter((agent) => agent.online);
    if (showOnlineOnly && onlineAgents.length === 0) return [];
    if (showCapacityOnly && (member.agents.length === 0 || member.claims >= maxActiveClaims)) return [];
    return [{ ...member, agents: showOnlineOnly ? onlineAgents : member.agents }];
  });
  const sorted = sortMembers(matching, sort);
  const total = sorted.length;
  const totalPages = Math.ceil(total / limit) || 1;

  // A page past the end (an old link, a hand-edited URL) would otherwise show
  // an empty list. Send it to the last page.
  if (total > 0 && page > totalPages) {
    redirect(rankingHref({ page: totalPages, limit, sort, q, online: showOnlineOnly, capacity: showCapacityOnly }));
  }
  const offset = (page - 1) * limit;
  const rows = sorted.slice(offset, offset + limit);
  const startIdx = total === 0 ? 0 : offset + 1;
  const endIdx = Math.min(page * limit, total);
  const filtered = Boolean(q) || showOnlineOnly || showCapacityOnly;
  const linkFor = (overrides: Partial<Parameters<typeof rankingHref>[0]>) =>
    rankingHref({ page: 1, limit, sort, q, online: showOnlineOnly, capacity: showCapacityOnly, ...overrides });

  const podium = ranked.slice(0, 3);
  const secondPlaceZiks = ranked[1]?.ziks ?? null;
  const goalMet = myTotals.ziks >= targetZiks;
  const myPct = progressPct(myTotals.ziks, targetZiks);
  const standingDetail =
    standing?.rank === 1 && secondPlaceZiks != null
      ? `${money(Math.max(0, myTotals.ziks - secondPlaceZiks))} ahead of #2 · ${myTotals.fixedIssues} issues fixed`
      : `${myTotals.fixedIssues} issues fixed`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-xl text-sm leading-relaxed text-zk-muted">
          Ziks earned from funded issues that went live (fixing, testing, reviewing, reporting, confirming and estimating), this week and all time. The goal is {money(targetZiks)}.
        </p>
      </div>

      {podium.length === 0 ? (
        <p className="rounded-panel border border-zk-border bg-zk-surface p-6 text-sm text-zk-text2">
          No earnings yet. Work on a funded issue: everyone who worked on it is paid when it goes live.
        </p>
      ) : (
        <div className="flex flex-wrap items-stretch gap-4">
          <div className="grid min-w-0 flex-[999_1_640px] grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
            {podium.map((entry, i) => {
              const medal = PODIUM_MEDALS[i] ?? PODIUM_MEDALS[2];
              const pct = progressPct(entry.ziks, targetZiks);
              const met = entry.ziks >= targetZiks;
              return (
                <div
                  key={entry.userId}
                  className="zk-motion group relative flex flex-col gap-4 overflow-hidden rounded-panel border border-zk-border bg-zk-surface p-5 motion-safe:animate-[leaderboard-in_0.5s_cubic-bezier(0.2,0.7,0.2,1)_both] motion-safe:transition-[transform,box-shadow,border-color] motion-safe:duration-250 hover:border-[#BFD6FB] hover:shadow-[0_18px_40px_rgba(11,23,51,0.10),0_2px_6px_rgba(57,120,246,0.10)] motion-safe:hover:-translate-y-1 dark:hover:border-electric-blue-strong dark:hover:shadow-[0_18px_40px_rgba(0,0,0,0.45),0_0_0_1px_rgba(57,120,246,0.25)]"
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 bg-gradient-to-r from-electric-blue to-sky-tint motion-safe:transition-transform motion-safe:duration-350 group-hover:scale-x-100"
                  />
                  <div className="flex items-center justify-between">
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-xl"
                      style={{ background: medal.bg, color: medal.fg }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1 1.2-1.2.5-2 2-2 3.8M14 14.7V17c0 .6.5 1 1 1.2 1.2.5 2 2 2 3.8M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                      </svg>
                    </span>
                    <span className="text-[13px] font-extrabold text-zk-muted">#{entry.rank}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className="inline-flex rounded-full"
                      style={{ boxShadow: `0 0 0 3px var(--zk-surface), 0 0 0 5px ${medal.fg}` }}
                    >
                      <Avatar name={entry.name} image={entry.image} size="lg" className="!h-12 !w-12 text-base font-extrabold" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <Link
                        href={`/users/${entry.userId}`}
                        className="truncate text-base font-bold text-zk-text hover:underline"
                      >
                        {entry.name}
                        {entry.userId === user.id ? (
                          <span className="ml-1 text-sm font-normal text-zk-muted">(you)</span>
                        ) : null}
                      </Link>
                      <span className="text-[13px] text-zk-muted">{entry.fixedIssues} fixed</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[32px] font-extrabold leading-none text-zk-text motion-safe:transition-colors group-hover:text-zk-accent" title="Earned all time">
                      {money(entry.ziks)}
                    </span>
                    <span className="text-[13px] font-semibold text-zk-muted">
                      {money(recentById.get(entry.userId) ?? 0)} this week · all time {money(entry.ziks)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="h-2 overflow-hidden rounded-full bg-zk-tint">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: met ? "#2E6FEF" : "#8FC9FF" }}
                      />
                    </div>
                    <span className={`text-xs font-bold ${met ? "text-zk-ok-fg" : "text-zk-muted"}`}>
                      {met
                        ? `Goal reached · +${money(entry.ziks - targetZiks)}`
                        : `${money(targetZiks - entry.ziks)} to goal`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="relative flex min-w-0 flex-[1_1_300px] flex-col gap-4 overflow-hidden rounded-panel bg-deep-ocean p-[22px] text-white">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-[90px] -top-[90px] h-60 w-60 rounded-full"
              style={{ background: "radial-gradient(circle, rgba(57,120,246,0.45), rgba(57,120,246,0) 70%)" }}
            />
            <span className="relative text-xs font-bold uppercase tracking-[0.08em] text-[#A9BCDF]">
              Your standing
            </span>
            <div className="relative flex items-baseline gap-2.5">
              <span className="text-[44px] font-extrabold leading-none">
                {standing ? `#${standing.rank}` : "—"}
              </span>
              <span className="text-sm text-[#C9D6EF]">
                of {standing?.total ?? ranked.length} {(standing?.total ?? ranked.length) === 1 ? "person" : "people"}
              </span>
            </div>
            <div className="relative flex flex-col gap-2">
              <div className="flex justify-between text-[13px]">
                <span className="text-[#C9D6EF]">
                  {money(myTotals.ziks)} / {money(targetZiks)}
                </span>
                {goalMet ? (
                  <span className="rounded-full bg-[#0F3326] px-2 py-px font-bold text-[#6EE7A8]">
                    Goal reached · +{money(myTotals.ziks - targetZiks)}
                  </span>
                ) : (
                  <span className="rounded-full bg-blue-slate px-2 py-px font-bold text-[#C9D6EF]">
                    {money(targetZiks - myTotals.ziks)} to goal
                  </span>
                )}
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-blue-slate">
                <div className="h-full rounded-full bg-electric-blue" style={{ width: `${myPct}%` }} />
              </div>
            </div>
            <WeeklyPaceBar earned={recentById.get(user.id) ?? 0} inMotion={myInMotion} target={targetZiks} />
            <span className="relative text-[13px] text-[#C9D6EF]">{standingDetail}</span>
          </div>
        </div>
      )}

      <section aria-label="Team" className="flex flex-col gap-3.5 rounded-panel border border-zk-border bg-zk-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-lg font-bold text-zk-text">Team</h2>
            <span className="text-[13px] text-zk-muted">
              {filtered ? `${total} of ${everyone.length} people` : `${total} people`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <form
              action="/workers"
              method="get"
              className="flex h-10 w-60 max-w-full items-center gap-2 rounded-full border border-zk-border bg-zk-surface px-3.5"
            >
              <input type="hidden" name="limit" value={limit} />
              {sort !== "earnings" ? <input type="hidden" name="sort" value={sort} /> : null}
              {showOnlineOnly ? <input type="hidden" name="online" value="1" /> : null}
              {showCapacityOnly ? <input type="hidden" name="capacity" value="1" /> : null}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-zk-muted">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <label className="sr-only" htmlFor="ranking-search">
                Search people
              </label>
              <input
                id="ranking-search"
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search people"
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-zk-text outline-none placeholder:text-zk-muted"
              />
            </form>
            {/* Team's filters, as toggles: each link flips one and keeps the rest. */}
            <div className="flex gap-1" aria-label="Filter team" role="group">
              {(
                [
                  ["online", "Online now", showOnlineOnly],
                  ["capacity", "Has capacity", showCapacityOnly],
                ] as const
              ).map(([key, label, on]) => (
                <Link
                  key={key}
                  href={linkFor({ [key]: !on })}
                  aria-current={on ? "true" : undefined}
                  className={`inline-flex min-h-8 items-center rounded-full border px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue ${
                    on
                      ? "border-electric-blue-strong bg-electric-blue-strong font-bold text-white"
                      : "border-zk-border bg-zk-surface font-medium text-zk-text2 hover:text-zk-text"
                  }`}
                >
                  {label}
                </Link>
              ))}
            </div>
            <div role="tablist" aria-label="Sort by" className="flex gap-0.5 rounded-full bg-zk-seg p-1">
              {(
                [
                  ["earnings", "Earnings"],
                  ["solved", "Fixed"],
                ] as const
              ).map(([key, label]) => {
                const on = sort === key;
                return (
                  <Link
                    key={key}
                    href={linkFor({ sort: key })}
                    role="tab"
                    aria-selected={on}
                    className={`inline-flex min-h-8 items-center rounded-full px-3.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue ${
                      on
                        ? "bg-zk-surface font-bold text-zk-text shadow-[0_1px_3px_rgba(21,18,31,0.12)]"
                        : "font-medium text-zk-text2 hover:text-zk-text"
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <details className="team-activity-note">
          <summary>How activity and permissions work</summary>
          <p className="text-sm text-zk-muted">
            Online means an agent has used the API, claimed an issue or sent a claim heartbeat in the last 15 minutes.
            Recent earnings and accepted fixes cover the last 30 days; active claims count the {capacityScope}.
            {manageLevels ? " As an admin you can change anyone's agent class here, including manager and merger." : ""}
          </p>
        </details>

        {rows.length === 0 ? (
          <p className="px-1 py-6 text-sm text-zk-muted">
            {everyone.length === 0 ? "This organisation has no members yet." : "No people match these filters."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="flex items-center gap-4 rounded-full bg-zk-tint px-4 py-3.5 text-xs font-bold uppercase tracking-[0.05em] text-zk-accent">
                <span className="w-10">#</span>
                <span className="min-w-0 flex-1">Person</span>
                <span className="w-[200px]">Progress to {money(targetZiks)}</span>
                <span className="w-[70px] text-right">Fixed</span>
                <span className="w-[110px] text-right">Earnings</span>
                <span className="w-[90px] text-right" title={`Active claims in the ${capacityScope}`}>Claims</span>
                <span className="w-[190px]">Agents</span>
              </div>
              <ul>
                {rows.map((row, i) => {
                  const medal = row.rank !== null && row.rank <= 3 ? PODIUM_MEDALS[row.rank - 1]?.fg : undefined;
                  return (
                    <RankingRow
                      key={row.userId}
                      member={{ id: row.userId, name: row.name, image: row.image }}
                      rank={row.rank}
                      medal={medal}
                      isYou={row.userId === user.id}
                      role={row.role}
                      pct={progressPct(row.ziks, targetZiks)}
                      goalMet={row.ziks >= targetZiks}
                      solved={row.solvedTasks}
                      ziks={row.ziks}
                      ziksThisWeek={row.ziksThisWeek}
                      claims={row.claims}
                      claimLimit={maxActiveClaims}
                      agentCount={row.agents.length}
                      onlineCount={row.agents.filter((agent) => agent.online).length}
                      last={i === rows.length - 1}
                    >
                      <TeamAgentTable agents={row.agents} manageLevels={manageLevels} memberName={row.name} />
                      <MemberAssignedWork work={row.assignedWork} className="mt-3" />
                    </RankingRow>
                  );
                })}
              </ul>
            </div>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-sm text-zk-text2">
            <div>
              Showing {startIdx}–{endIdx} of {total}
            </div>
            <div className="flex items-center gap-2">
              {page > 1 ? (
                <Link
                  href={linkFor({ page: page - 1 })}
                  className="rounded-full border border-zk-border bg-zk-surface px-3.5 py-1.5 text-sm font-medium text-zk-text hover:bg-zk-chip"
                >
                  Previous
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="cursor-not-allowed rounded-full border border-zk-border bg-zk-chip px-3.5 py-1.5 text-sm font-medium text-zk-muted"
                >
                  Previous
                </span>
              )}
              <span className="text-sm text-zk-text2">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  href={linkFor({ page: page + 1 })}
                  className="rounded-full border border-zk-border bg-zk-surface px-3.5 py-1.5 text-sm font-medium text-zk-text hover:bg-zk-chip"
                >
                  Next
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="cursor-not-allowed rounded-full border border-zk-border bg-zk-chip px-3.5 py-1.5 text-sm font-medium text-zk-muted"
                >
                  Next
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      <style>{`
        @keyframes leaderboard-in {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .zk-motion, .zk-motion * {
            animation: none !important;
            transition: none !important;
          }
          .zk-motion:hover {
            transform: none !important;
          }
        }
      `}</style>
    </div>
  );
}
