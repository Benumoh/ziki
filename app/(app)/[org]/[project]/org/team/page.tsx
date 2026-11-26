import type { Metadata } from "next";
import { activeIn, activeLevels, levelIn } from "@/lib/agents/active-in";
import { INVITE_TTL_DAYS, organisationInvites } from "@/lib/invites";
import { joinAnswersSummary } from "@/lib/join-questions";
import { MEMBERSHIP_ROLE_LABELS, organisationMembersFrom } from "@/lib/organisations";
import { prisma } from "@/lib/prisma";
import { issuesPath, projectRef } from "@/lib/project-paths";
import { listShareLinks } from "@/lib/share-invites";
import { loadOrg } from "../org-context";
import { OrgPageHeader, ReadOnlyNote, oneParam } from "../org-ui";
import { ShareLinkList } from "./share-link-list";
import {
  TeamManager,
  type TeamCollaborator,
  type TeamDeactivated,
  type TeamInviteRow,
  type TeamMember,
  type TeamRequest,
} from "./team-manager";
import { teamViewFrom } from "./team-views";

export const metadata: Metadata = { title: "Team" };

const MEMBER_LIMIT = 1000;

async function loadQuietly<T>(label: string, task: Promise<T>, empty: T): Promise<T> {
  try {
    return await task;
  } catch (error) {
    console.error(`[team] ${label} failed`, error);
    return empty;
  }
}

/**
 * Memberships and users are loaded apart so a membership whose user row is gone is skipped
 * rather than failing the page (see organisationMembersFrom). Owners and admins also get what
 * each person said when they joined (#join-questions) and whose invite they accepted.
 */
async function loadMembers(
  organisationId: string,
  withAdminDetails: boolean,
  invitedBy: Map<string, { name: string; acceptedAt: Date }>,
): Promise<TeamMember[]> {
  const rows = await prisma.membership.findMany({
    where: { organisationId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    take: MEMBER_LIMIT,
    select: { role: true, createdAt: true, userId: true, strengths: true, canFundIssues: true },
  });
  if (rows.length === 0) return [];
  // #payers: owners always pay; an admin only once an owner lets them.
  const pays = new Set(
    rows.filter((row) => row.role === "owner" || (row.role === "admin" && row.canFundIssues)).map((row) => row.userId),
  );
  const userIds = rows.map((row) => row.userId);
  const [people, agents] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, image: true, role: true },
    }),
    prisma.agent.findMany({
      where: { ...activeIn(organisationId), ownerUserId: { in: userIds }, revokedAt: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, ownerUserId: true, activations: activeLevels },
    }),
  ]);
  const joinedAs = new Map(rows.map((row) => [row.userId, withAdminDetails ? joinAnswersSummary(row) : null]));
  const agentsByOwner = new Map<string, TeamMember["agents"]>();
  for (const agent of agents) {
    const list = agentsByOwner.get(agent.ownerUserId) ?? [];
    list.push({ id: agent.id, name: agent.name, level: levelIn(agent, organisationId) });
    agentsByOwner.set(agent.ownerUserId, list);
  }
  return organisationMembersFrom(rows, people).map((member) => {
    const invite = withAdminDetails && member.user.email ? invitedBy.get(member.user.email.toLowerCase()) : undefined;
    return {
      id: member.user.id,
      name: member.user.name,
      email: member.user.email,
      image: member.user.image,
      role: member.role,
      roleLabel: MEMBERSHIP_ROLE_LABELS[member.role],
      siteSuperAdmin: member.user.role === "super_admin",
      joinedAt: member.createdAt.toISOString(),
      agents: agentsByOwner.get(member.user.id) ?? [],
      joinedAs: joinedAs.get(member.user.id) ?? null,
      invitedByName: invite?.name ?? null,
      fundsIssues: pays.has(member.user.id),
    };
  });
}

async function loadDeactivated(organisationId: string): Promise<TeamDeactivated[]> {
  const rows = await prisma.membershipDeactivation.findMany({
    where: { organisationId },
    orderBy: { deactivatedAt: "desc" },
    take: MEMBER_LIMIT,
    select: {
      userId: true,
      role: true,
      joinedAt: true,
      deactivatedAt: true,
      user: { select: { name: true, email: true, image: true } },
      deactivatedBy: { select: { name: true, email: true } },
    },
  });
  return rows.map((row) => ({
    id: row.userId,
    name: row.user.name,
    email: row.user.email,
    image: row.user.image,
    role: row.role,
    roleLabel: MEMBERSHIP_ROLE_LABELS[row.role],
    joinedAt: row.joinedAt.toISOString(),
    deactivatedAt: row.deactivatedAt.toISOString(),
    deactivatedByName: row.deactivatedBy?.name ?? row.deactivatedBy?.email ?? null,
  }));
}

async function loadRequests(organisationId: string): Promise<TeamRequest[]> {
  const rows = await prisma.projectJoinRequest.findMany({
    where: { project: { organisationId }, status: "pending" },
    include: {
      project: { select: { id: true, name: true, slug: true, organisation: { select: { slug: true } } } },
      user: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    userId: row.user.id,
    name: row.user.name,
    email: row.user.email,
    image: row.user.image,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    projectId: row.project.id,
    projectName: row.project.name,
    projectHref: issuesPath(projectRef(row.project.organisation.slug, row.project.slug), "your_work"),
  }));
}

async function loadCollaborators(organisationId: string): Promise<TeamCollaborator[]> {
  const rows = await prisma.projectMembership.findMany({
    where: { project: { organisationId } },
    include: {
      project: { select: { id: true, name: true, slug: true, organisation: { select: { slug: true } } } },
      user: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: `${row.projectId}:${row.userId}`,
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    image: row.user.image,
    createdAt: row.createdAt.toISOString(),
    projectId: row.projectId,
    projectName: row.project.name,
    projectHref: issuesPath(projectRef(row.project.organisation.slug, row.project.slug), "your_work"),
  }));
}

/**
 * The organisation's one Team page (#team-page): everyone in it, everyone invited (and whether
 * they accepted), project join requests, outside collaborators and deactivated people, in one
 * filterable list with each row's actions. Inviting by email or by link starts here too.
 */
export default async function OrgTeamPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, org } = await loadOrg();
  if (!org) return null;
  const query = searchParams ? await searchParams : {};
  const initialView = teamViewFrom(oneParam(query.show));
  const openInvite = org.admin && oneParam(query.invite) === "1";

  const invites = org.admin ? await loadQuietly("invites", organisationInvites(prisma, org.id), []) : [];
  const invitedBy = new Map<string, { name: string; acceptedAt: Date }>();
  for (const invite of invites) {
    if (invite.state === "accepted" && invite.acceptedAt && !invitedBy.has(invite.email.toLowerCase())) {
      invitedBy.set(invite.email.toLowerCase(), { name: invite.invitedByName, acceptedAt: invite.acceptedAt });
    }
  }

  const [members, deactivated, requests, collaborators, shareLinks] = await Promise.all([
    loadQuietly("members", loadMembers(org.id, org.admin, invitedBy), []),
    org.admin ? loadQuietly("deactivated", loadDeactivated(org.id), []) : Promise.resolve([]),
    org.admin ? loadQuietly("join requests", loadRequests(org.id), []) : Promise.resolve([]),
    loadQuietly("collaborators", loadCollaborators(org.id), []),
    org.admin ? loadQuietly("share links", listShareLinks(prisma, org.id), []) : Promise.resolve([]),
  ]);

  // Everyone already in has their invite settled; only the others are waiting.
  const settled = new Set(members.map((person) => person.email?.toLowerCase()).filter(Boolean) as string[]);
  const inviteRows: TeamInviteRow[] = invites
    .filter((invite) => invite.state !== "accepted" && !settled.has(invite.email.toLowerCase()))
    .map((invite) => ({
      id: invite.id,
      email: invite.email,
      state: invite.state as "pending" | "expired",
      createdAt: invite.createdAt.toISOString(),
      expiresAt: invite.expiresAt.toISOString(),
      invitedByName: invite.invitedByName,
    }));

  const ownerCount = members.filter((member) => member.role === "owner").length;

  return (
    <div className="space-y-6">
      <OrgPageHeader title="Team">
        Everyone in {org.name}, everyone you&apos;ve invited and whether they&apos;ve joined, people asking to
        join a project, and anyone you&apos;ve deactivated. Roles apply only here. Owners pay for the
        organisation&apos;s issues, and choose which admins may fund them too.
      </OrgPageHeader>
      {org.admin ? null : (
        <ReadOnlyNote>
          You can see who is here and leave the organisation. Only owners and admins can invite people, change
          roles, deactivate or remove anyone.
        </ReadOnlyNote>
      )}
      <TeamManager
        organisationId={org.id}
        organisationName={org.name}
        viewerId={user.id}
        canManage={org.admin}
        canChangeRoles={org.owner}
        ownerCount={ownerCount}
        inviteTtlDays={INVITE_TTL_DAYS}
        initialView={initialView}
        openInvite={openInvite}
        members={members}
        invites={inviteRows}
        requests={requests}
        collaborators={collaborators}
        deactivated={deactivated}
      />
      {org.admin ? <ShareLinkList links={shareLinks} /> : null}
    </div>
  );
}
