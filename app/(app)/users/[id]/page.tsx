import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { bugInOrganisation, currentOrganisationIdFor } from "@/lib/organisation-context";
import { pointTotals } from "@/lib/points/leaderboard";
import { getPlatformRewardConfig } from "@/lib/points/platform-rewards";
import { formatZ } from "@/lib/points/rules";
import { pointBalance } from "@/lib/points/balance";
import { decodePointCursor, pointEntries, pointEntriesQuerySchema } from "@/lib/points/entries";
import { PointsLedger } from "@/components/points-ledger";
import { PointsSources } from "@/components/points-sources";
import { pointSources } from "@/lib/points/sources";
import { PointsSummary } from "@/components/points-summary";
import { requireUser } from "@/lib/auth-helpers";
import { canViewProfile, canViewWallet } from "@/lib/profile-access";
import { roleLabels } from "@/lib/roles";
import { Badge } from "@/components/ui/badge";
import { LocalTime } from "@/components/local-time";
import { statusClass, statusLabels } from "@/lib/labels";
import { issueHref } from "@/lib/issue-ref";
import { teamAgentsForMember, teamAssignedWorkForMember } from "@/lib/team-directory";
import { TeamAgentList } from "@/components/team-agent-list";
import { MemberAssignedWork } from "@/components/member-assigned-work";
import { isAdminOfOrganisation } from "@/lib/agents/membership";
import { settableLevels } from "@/lib/agents/levels";

type ProfileProps = { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

/** How many of each list to show before pointing at the filtered list. */
const RECENT = 10;

const roleBadgeClass: Record<string, string> = {
  user: "bg-zk-chip text-zk-text2",
  admin: "bg-zk-tint text-zk-accent",
  super_admin: "bg-zk-warn-bg text-zk-warn-fg",
};

export async function generateMetadata({
  params,
}: ProfileProps): Promise<Metadata> {
  const { id } = await params;
  const viewer = await requireUser();
  // #503: the name is in the tab title, so it gets the same check as the page.
  const user = (await canViewProfile(prisma, viewer, id))
    ? await prisma.user.findUnique({ where: { id }, select: { name: true } })
    : null;
  return {
    title: user ? user.name : "Person not found",
    robots: { index: false, follow: false },
  };
}

export default async function ProfilePage({ params, searchParams }: ProfileProps) {
  const viewer = await requireUser();
  const { id } = await params;
  // #503: only people who share a organisation with this person can see them.
  if (!(await canViewProfile(prisma, viewer, id))) notFound();
  // #428: points in the viewer's organisation.
  const organisationId = await currentOrganisationIdFor(viewer.id);
  // #425, #439: a profile is another way to read issues. No membership, no issues.
  const scope = bugInOrganisation(organisationId);

  const [person, reported, assigned, counts, assignedTotal] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, role: true, createdAt: true, walletAddress: true },
    }),
    prisma.bug.findMany({
      where: { reporterId: id, isDeleted: false, ...scope },
      select: { id: true, number: true, title: true, status: true, createdAt: true, project: { select: { slug: true, organisation: { select: { slug: true } } } } },
      orderBy: { createdAt: "desc" },
      take: RECENT,
    }),
    prisma.bug.findMany({
      where: { assigneeId: id, isDeleted: false, ...scope },
      select: { id: true, number: true, title: true, status: true, updatedAt: true, project: { select: { slug: true, organisation: { select: { slug: true } } } } },
      orderBy: { updatedAt: "desc" },
      take: RECENT,
    }),
    prisma.bug.groupBy({
      by: ["status"],
      where: { reporterId: id, isDeleted: false, ...scope },
      _count: { _all: true },
    }),
    // Counted rather than taken from `assigned.length`, which stops at RECENT
    // and would quietly under-report anyone with more than that.
    prisma.bug.count({ where: { assigneeId: id, isDeleted: false, ...scope } }),
  ]);

  if (!person) notFound();

  const [points, platformRewards, balance, walletVisible] = await Promise.all([
    organisationId ? pointTotals(prisma, organisationId, person.id) : Promise.resolve({ points: 0, solvedTasks: 0 }),
    getPlatformRewardConfig(prisma),
    organisationId ? pointBalance(prisma, { organisationId, userId: person.id }) : Promise.resolve(null),
    canViewWallet(prisma, viewer, person.id, organisationId),
  ]);

  const ledgerParams = await searchParams ?? {};
  const ledgerQuery = pointEntriesQuerySchema.safeParse({
    from: ledgerParams.from || undefined, to: ledgerParams.to || undefined, cursor: ledgerParams.cursor || undefined,
  });
  let ledgerError = !ledgerQuery.success;
  if (ledgerQuery.success && ledgerQuery.data.cursor) {
    try { decodePointCursor(ledgerQuery.data.cursor); } catch { ledgerError = true; }
  }
  const ledger = organisationId && viewer.id === person.id && ledgerQuery.success && !ledgerError
    ? await pointEntries(prisma, { organisationId, userId: person.id }, ledgerQuery.data) : null;

  const reportedTotal = counts.reduce((sum, row) => sum + row._count._all, 0);
  const resolved =
    counts.find((row) => row.status === "resolved")?._count._all ?? 0;
  const organisationMembership = organisationId
    ? await prisma.membership.findFirst({
        where: { organisationId, userId: person.id },
        select: { id: true },
      })
    : null;
  const agents = organisationId && organisationMembership
    ? await teamAgentsForMember(prisma, organisationId, person.id)
    : [];
  // #447: assigned to this person, not claimed by any of their agents.
  const assignedWork = organisationId && organisationMembership
    ? await teamAssignedWorkForMember(prisma, organisationId, person.id, agents)
    : [];
  const viewerIsAdmin = organisationId ? await isAdminOfOrganisation(viewer, organisationId) : false;
  const manageLevels = organisationId && viewer.id !== person.id && viewerIsAdmin
    ? settableLevels({ isOwner: false, isAdminOfOrganisation: true })
    : null;
  // #points-sources: where their points came from, for the person and the organisation's admins (to spot farming).
  const sources = organisationId && (viewer.id === person.id || viewerIsAdmin)
    ? await pointSources(prisma, { organisationId, userId: person.id })
    : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/home" className="text-sm text-zk-accent hover:underline">
          ← Back to issues
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-extrabold tracking-tight text-zk-text">
          {person.name}
          <Badge className={roleBadgeClass[person.role]}>
            {roleLabels[person.role]}
          </Badge>
        </h1>
        <p className="text-sm text-zk-text2">
          Joined <LocalTime date={person.createdAt} />
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Issues reported" value={reportedTotal} />
        <Stat label="Of those, resolved" value={resolved} />
        <Stat label="Currently assigned" value={assignedTotal} />
      </dl>

      <PointsSummary
        points={points.points}
        solvedTasks={points.solvedTasks}
        targetPoints={platformRewards.target}
      />

      {balance || (walletVisible && person.walletAddress) ? (
        <section
          className="rounded-panel border border-zk-border bg-zk-surface p-4 sm:p-5"
          aria-labelledby="balance-heading"
        >
          <h2
            id="balance-heading"
            className="text-sm font-semibold uppercase tracking-wide text-zk-muted"
          >
            Balance
          </h2>
          {balance ? (
            <>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-zk-text">
                {formatZ(balance.lifetime.points)}
                <span className="ml-1 text-sm font-normal text-zk-text2">
                  point{balance.lifetime.points === 1 ? "" : "s"}
                </span>
              </p>
              <p className="text-sm text-zk-text2">
                {balance.lifetime.entries} ledger entr
                {balance.lifetime.entries === 1 ? "y" : "ies"}, corrections included
              </p>
            </>
          ) : null}
          {walletVisible && person.walletAddress ? (
            <p className="mt-2 break-all font-mono text-sm text-zk-text2">
              <span className="font-sans font-medium text-zk-text2">Wallet </span>
              {person.walletAddress}
            </p>
          ) : null}
        </section>
      ) : null}

      {sources ? <PointsSources sources={sources} name={person.name ?? "this person"} /> : null}

      {organisationId && viewer.id === person.id ? (
        <PointsLedger page={ledger} profileId={person.id} from={ledgerQuery.success ? ledgerQuery.data.from : undefined} to={ledgerQuery.success ? ledgerQuery.data.to : undefined} error={ledgerError} />
      ) : null}

      <section className="rounded-panel border border-zk-border bg-zk-surface p-4 sm:p-5" aria-labelledby="profile-agents-heading">
        <h2 id="profile-agents-heading" className="text-sm font-semibold uppercase tracking-wide text-zk-muted">
          Agents
        </h2>
        <TeamAgentList agents={agents} manageLevels={manageLevels} />
        <MemberAssignedWork work={assignedWork} className="mt-3" />
      </section>

      <IssueList
        heading="Reported"
        empty="Hasn't reported an issue yet."
        issues={reported}
        total={reportedTotal}
      />
      <IssueList
        heading="Assigned"
        empty="Nothing assigned right now."
        issues={assigned}
        total={assignedTotal}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-panel border border-zk-border bg-zk-surface px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-zk-muted">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-zk-text">
        {value}
      </dd>
    </div>
  );
}

type ProfileIssue = {
  id: string;
  number: number;
  project: { slug: string; organisation: { slug: string } };
  title: string;
  status: keyof typeof statusLabels;
};

function IssueList({
  heading,
  empty,
  issues,
  total,
}: {
  heading: string;
  empty: string;
  issues: ProfileIssue[];
  total?: number;
}) {
  return (
    <section className="rounded-panel border border-zk-border bg-zk-surface">
      <h2 className="border-b border-zk-divider px-4 py-3 text-sm font-semibold uppercase tracking-wide text-zk-muted">
        {heading}
        {total !== undefined && total > issues.length ? (
          <span className="ml-2 font-normal normal-case tracking-normal text-zk-muted">
            showing the {issues.length} most recent of {total}
          </span>
        ) : null}
      </h2>
      {issues.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zk-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-zk-divider">
          {issues.map((issue) => (
            <li key={issue.id}>
              <Link
                href={issueHref(issue)}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm transition hover:bg-zk-chip"
              >
                <span className="min-w-0 flex-1 break-words font-medium text-zk-text">
                  {issue.title}
                </span>
                <Badge className={statusClass[issue.status]}>
                  {statusLabels[issue.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
