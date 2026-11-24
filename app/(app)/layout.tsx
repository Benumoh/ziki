import { cache } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { requireUser } from "@/lib/auth-helpers";
import { hasEarnedZiks } from "@/lib/coins/ledger";
import { isLinkPreviewBot } from "@/lib/link-preview";
import { isPublicAgentPath } from "@/lib/public-agent-paths";
import { projectOverviewSegments } from "@/lib/project-slug";
import { publicIntakeSegments, publicIssuesSegments, publicOrgFeedbackSegments } from "@/lib/public-project-paths";
import { AppHeader } from "@/components/app-header";
import { getUnreadCount } from "@/lib/lookups";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/skip-link";
import { PAGE_CONTAINER_CLASS } from "@/components/page-container";
import { FocusMainOnNavigate } from "@/components/focus-main-on-navigate";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import type { OrganisationOption, ExternalProjectChoice } from "@/components/organisation-switcher";
import { prisma } from "@/lib/prisma";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { firstProjectRefFor } from "@/lib/project-route";
import { organisationsForUser } from "@/lib/organisations";
import type { OrganisationRole } from "@/lib/organisation-role";
import { countPendingEscalations } from "@/lib/agent-questions";
import { loadOwnAgents } from "@/lib/dashboard-overview";
import { AgentsDock, type DockAgent } from "@/components/agents-dock";
import { appVersionLabel } from "@/lib/deployed-version";
import { agentActivity, agentEarnings } from "@/lib/coins/agent-earnings";
import { headerEarnings } from "@/lib/earnings";
import { JoinQuestions } from "@/components/get-started/join-questions";

async function getOrganisationProjects(organisationId: string) {
  return prisma.project.findMany({
    where: { organisationId, archivedAt: null },
    select: { id: true, name: true, slug: true, organisationId: true },
    orderBy: { name: "asc" },
  });
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // Link-preview crawlers may reach /bugs/[id] without a session. Render a
  // minimal shell so generateMetadata + the public preview body can respond.
  if (!session?.user) {
    const ua = (await headers()).get("user-agent");
    if (isLinkPreviewBot(ua)) {
      return (
        <div className="flex min-h-screen flex-col bg-background">
          <main
            id={MAIN_CONTENT_ID}
            className={`${PAGE_CONTAINER_CLASS} flex-1 py-8`}
          >
            {children}
          </main>
        </div>
      );
    }
  }

  const reqPath = (await headers()).get("x-ziki-path") ?? "";
  // A guest on /security gets the public Ziki Security page, which brings its own header and footer.
  if (!session?.user && reqPath === "/security") return <>{children}</>;
  const intakeSegments = !session?.user ? publicIntakeSegments(reqPath) : null;
  const publicIssues = !session?.user ? publicIssuesSegments(reqPath) : null;
  const orgFeedback = !session?.user ? publicOrgFeedbackSegments(reqPath) : null;
  const overviewSegments = !session?.user && !orgFeedback ? projectOverviewSegments(reqPath) ?? intakeSegments ?? publicIssues : null;
  const isFeedbackOrTrack = intakeSegments?.kind === "feedback" || intakeSegments?.kind === "track";
  const overviewProject = overviewSegments
    ? await prisma.project.findFirst({
        where: {
          slug: overviewSegments.projectSlug,
          // Only a public project gets the guest shell for overview/public-issues;
          // shared feedback portal and tracking links also support private projects (#1048).
          ...(isFeedbackOrTrack ? {} : { visibility: "public" }),
          archivedAt: null,
          ...(intakeSegments?.kind === "report" || intakeSegments?.kind === "contribute" ? { acceptsGuestIdeas: true } : {}),
          organisation: { slug: overviewSegments.orgSlug, archivedAt: null },
        },
        select: { id: true },
      })
    : orgFeedback
      ? await prisma.organisation.findFirst({
          where: { slug: orgFeedback.orgSlug, archivedAt: null },
          select: { id: true },
        })
      : null;
  // Guests may read a project's public overview. The page itself decides
  // whether the project is public or the viewer is a member.
  const isPublicSkillsPath = reqPath === "/skills" || reqPath.startsWith("/skills/");
  const isPublicDocsPath = reqPath === "/docs" || reqPath.startsWith("/docs/");
  if (!session?.user && (isPublicAgentPath(reqPath) || reqPath === "/discover" || isPublicSkillsPath || isPublicDocsPath || overviewProject)) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <header className="border-b border-zk-border bg-zk-surface">
          <div className={`${PAGE_CONTAINER_CLASS} flex items-center justify-between py-3`}>
            <Link href="/" className="text-lg font-extrabold tracking-tight text-zk-text">
              Ziki
            </Link>
            <Link href="/login" className="text-sm font-bold text-zk-accent hover:underline">
              Sign in
            </Link>
          </div>
        </header>
        <main id={MAIN_CONTENT_ID} className={`${PAGE_CONTAINER_CLASS} flex-1 py-8`}>
          {children}
        </main>
      </div>
    );
  }

  const user = await requireUser();
  const requestPath = (await headers()).get("x-ziki-path") ?? "";
  // The header lists this person's organisations. Pages still resolve the active
  // project inside the current organisation, so a foreign project id is ignored.
  let organisationOptions: OrganisationOption[] = [];
  let externalProjects: ExternalProjectChoice[] = [];
  let activeOrganisationId: string | null = null;
  let organisationId: string | null = null;
  let organisationRole: OrganisationRole | null = null;
  try {
    organisationId = await currentOrganisationIdFor(user.id);
    activeOrganisationId = organisationId;
    const memberships = await organisationsForUser(prisma, user.id, user.role);
    const activeOrganisations = memberships.filter((organisation) => organisation.archivedAt === null);

    const pathSegments = requestPath.split("/").filter(Boolean);
    const routeOrg = pathSegments[0] ? decodeURIComponent(pathSegments[0]) : null;
    const matchedOrg = routeOrg ? activeOrganisations.find((t) => t.slug === routeOrg) : null;
    if (matchedOrg) {
      organisationId = matchedOrg.id;
      activeOrganisationId = matchedOrg.id;
    }

    const [orgProjects, userProjectMemberships] = await Promise.all([
      organisationId ? getOrganisationProjects(organisationId) : Promise.resolve([]),
      prisma.projectMembership.findMany({
        where: {
          userId: user.id,
          project: {
            archivedAt: null,
            organisation: { archivedAt: null },
          },
        },
        select: {
          project: {
            select: {
              id: true,
              name: true,
              slug: true,
              organisationId: true,
              organisation: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      }),
    ]);

    const projectsByOrg = new Map<string, Array<{ id: string; name: string; slug: string }>>();
    const orgProjectIds = new Set<string>();
    for (const p of orgProjects) {
      orgProjectIds.add(p.id);
      const list = projectsByOrg.get(p.organisationId) ?? [];
      list.push({ id: p.id, name: p.name, slug: p.slug });
      projectsByOrg.set(p.organisationId, list);
    }

    organisationRole = activeOrganisations.find((organisation) => organisation.id === activeOrganisationId)?.role ?? null;

    organisationOptions = activeOrganisations.map((organisation) => ({
      id: organisation.id,
      name: organisation.name,
      slug: organisation.slug,
      projects: projectsByOrg.get(organisation.id) ?? [],
    }));

    externalProjects = userProjectMemberships
      .filter((m) => !orgProjectIds.has(m.project.id))
      .map((m) => ({
        id: m.project.id,
        name: m.project.name,
        slug: m.project.slug,
        organisationId: m.project.organisationId,
        organisationName: m.project.organisation.name,
        organisationSlug: m.project.organisation.slug,
      }));
  } catch (error) {
    console.error("[layout] organisation context failed", error);
  }
  // Join questions (#join-questions): every member who hasn't answered them yet is asked, once per organisation.
  let askJoinQuestions = false;
  if (organisationRole === "member" && activeOrganisationId) {
    const membership = await prisma.membership
      .findUnique({
        where: { organisationId_userId: { organisationId: activeOrganisationId, userId: user.id } },
        select: { joinAnsweredAt: true },
      })
      .catch(() => null);
    askJoinQuestions = Boolean(membership && !membership.joinAnsweredAt);
  }
  // For links on pages whose URL names no project yet (#project-urls).
  const defaultProjectSlug = await firstProjectRefFor(user.id).catch(() => null);
  // A missing Notification table must not take down every signed-in page.
  let unreadCount = 0;
  try {
    // Cached per user and expired by every write that changes it (#317), so
    // ordinary navigation doesn't pay for a count query.
    unreadCount = await getUnreadCount(user.id);
  } catch (error) {
    console.error("[layout] notification count failed", error);
  }

  let pendingEscalationsCount = 0;
  let dockAgents: DockAgent[] = [];
  // Members of this organisation, for the Leaderboard link: nobody ranks against no one. Null when it couldn't be read.
  let memberCount: number | null = null;
  const dockOrganisationId = organisationId;
  if (organisationId) {
    try {
      pendingEscalationsCount = await countPendingEscalations(user.id, organisationId);
    } catch (error) {
      console.error("[layout] pending escalations count failed", error);
    }
    try {
      memberCount = await prisma.membership.count({ where: { organisationId } });
    } catch (error) {
      console.error("[layout] member count failed", error);
    }
    try {
      const agents = dockOrganisationId ? await loadOwnAgents({ userId: user.id, organisationId: dockOrganisationId }) : [];
      // #710: what each agent earned, from the Ziks its work was paid.
      const ids = agents.map((agent) => agent.id);
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const [earned, activity, pending] = await Promise.all([
        agentEarnings(prisma, dockOrganisationId ?? organisationId, ids),
        agentActivity(prisma, dockOrganisationId ?? organisationId, ids, startOfToday),
        prisma.agentRequest.groupBy({ by: ["agentId"], where: { agentId: { in: ids }, doneAt: null }, _count: { _all: true } }),
      ]);
      const pendingBy = new Map(pending.map((row) => [row.agentId, row._count._all]));
      dockAgents = agents.map((agent) => ({ id: agent.id, name: agent.name, username: agent.username, avatar: agent.avatar, status: agent.status, activity: agent.activity, issue: agent.issue, question: agent.question, needsSetup: agent.needsSetup, earnedZiks: earned.get(agent.id) ?? 0, ...(activity.get(agent.id) ?? { bids: 0, comments: 0, ziksToday: 0 }), pendingRequests: pendingBy.get(agent.id) ?? 0 }));
    } catch (error) {
      console.error("[layout] agents failed", error);
    }
  }

  // Earnings (#earnings-in-ziks): everything this person has earned, every workspace together, shown with Withdraw on
  // every page to anyone who works on projects (not to people who only post them). Your earnings shows how it adds
  // up. A failed read hides it.
  const earned = await headerEarnings(prisma, user.id).catch((error) => {
    console.error("[layout] earnings total failed", error);
    return null;
  });
  // The account menu's Withdraw is only for people who have earned Ziks; a failed read hides it. Earnings move into
  // the wallet on the next sweep (#earnings-in-ziks), so money earned here shows it straight away too.
  const showWithdraw = (earned !== null && earned > 0) || (await hasEarnedZiks(prisma, user.id).catch(() => false));

  // #287: one primary-key read; a failure leaves shortcuts on, the default.
  let shortcutsEnabled = true;
  try {
    const prefs = await prisma.user.findUnique({
      where: { id: user.id },
      select: { keyboardShortcuts: true },
    });
    shortcutsEnabled = prefs?.keyboardShortcuts ?? true;
  } catch (error) {
    console.error("[layout] shortcut setting failed", error);
  }

  return (
    // data-app-shell marks the signed-in app shell for the on-screen guide.
    <div data-app-shell="" className="flex min-h-screen flex-col bg-background">
      <SkipLink />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          userName={user.name ?? user.email}
          userImage={user.image}
          role={user.role}
          isRealSuperAdmin={user.isRealSuperAdmin}
          isRealAdmin={user.isRealAdmin}
          unreadCount={unreadCount}
          pendingEscalationsCount={pendingEscalationsCount}
          userId={user.id}
          organisationOptions={organisationOptions}
          externalProjects={externalProjects}
          activeOrganisationId={activeOrganisationId}
          organisationRole={organisationRole}
          defaultProjectSlug={defaultProjectSlug}
          earned={earned}
          showWithdraw={showWithdraw}
          version={appVersionLabel()}
        />
        <main
          id={MAIN_CONTENT_ID}
          /* Focusable so the skip link and the route announcer can move focus
             here; -1 keeps it out of the normal tab order. */
          tabIndex={-1}
          // Below lg the bottom nav strip covers the last ~4.5rem of the screen.
          className={`${PAGE_CONTAINER_CLASS} min-w-0 flex-1 overflow-x-clip py-6 outline-none max-lg:pb-28 max-sm:px-2 max-sm:pt-2.5 sm:px-6 sm:py-8 max-lg:sm:pb-28`}
        >
          {children}
        </main>
      </div>
      {/* The agents dock keeps the page's foot clear of its floor line itself, as tall as what stands on it, and draws nothing (no spacer either) where it doesn't help. */}
      <AgentsDock agents={dockAgents} defaultProjectSlug={defaultProjectSlug} memberCount={memberCount} />
      <FocusMainOnNavigate />
      {/* A member of an organisation gets the join questions once, ending on one real thing to do
          (#join-questions); its owner and admins set the project up through First questions instead. The card
          stays mounted for every member, so a refresh after the answers are saved (which turns `ask` off)
          doesn't take the open card away mid-way. */}
      {organisationRole === "member" && activeOrganisationId ? (
        <JoinQuestions
          key={activeOrganisationId}
          ask={askJoinQuestions}
          organisationId={activeOrganisationId}
          organisationName={organisationOptions.find((organisation) => organisation.id === activeOrganisationId)?.name ?? null}
          firstName={(user.name ?? "").trim().split(/\s+/)[0] || null}
        />
      ) : null}
      <KeyboardShortcuts
        enabled={shortcutsEnabled}
      />
    </div>
  );
}
