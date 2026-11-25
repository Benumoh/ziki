import type { Metadata } from "next";
import { settableLevels } from "@/lib/agents/levels";
import { prisma } from "@/lib/prisma";
import { MEMBERSHIP_ROLE_LABELS, organisationMembersFrom } from "@/lib/organisations";
import { loadOrg } from "../org-context";
import { OrgPageHeader, ReadOnlyNote } from "../org-ui";
import { MemberList, type OrgMember } from "./member-list";
import { ProjectCollaboratorsSection, type ProjectCollaboratorItem } from "./project-collaborators";
import { ProjectPendingJoinRequestsBanner, type PendingJoinRequestItem } from "@/components/project-pending-join-requests";
import { projectRef } from "@/lib/project-paths";
import { activeIn, activeLevels, levelIn } from "@/lib/agents/active-in";
import { joinAnswersSummary } from "@/lib/join-questions";

export const metadata: Metadata = { title: "Members" };

const MEMBER_LIMIT = 1000;

/**
 * Memberships and users are loaded apart so a membership whose user row is
 * gone is skipped rather than failing the page (see organisationMembersFrom).
 * Owners and admins also get what each person said when they joined (#join-questions).
 */
async function loadMembers(organisationId: string, withJoinAnswers: boolean): Promise<OrgMember[]> {
  try {
    const rows = await prisma.membership.findMany({
      where: { organisationId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      take: MEMBER_LIMIT,
      select: { role: true, createdAt: true, userId: true, strengths: true, canFundIssues: true },
    });
    if (rows.length === 0) return [];
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
    const joinedAs = new Map(rows.map((row) => [row.userId, withJoinAnswers ? joinAnswersSummary(row) : null]));
    // #payers: owners always pay; an admin only once an owner lets them.
    const pays = new Set(rows.filter((row) => row.role === "owner" || (row.role === "admin" && row.canFundIssues)).map((row) => row.userId));
    const agentsByOwner = new Map<string, OrgMember["agents"]>();
    for (const agent of agents) {
      const list = agentsByOwner.get(agent.ownerUserId) ?? [];
      list.push({ id: agent.id, name: agent.name, level: levelIn(agent, organisationId) });
      agentsByOwner.set(agent.ownerUserId, list);
    }
    return organisationMembersFrom(rows, people).map((member) => ({
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
      fundsIssues: pays.has(member.user.id),
    }));
  } catch (error) {
    console.error("[org] member list failed", error);
    return [];
  }
}

async function loadProjectCollaborators(organisationId: string): Promise<ProjectCollaboratorItem[]> {
  try {
    const rows = await prisma.projectMembership.findMany({
      where: { project: { organisationId } },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            slug: true,
            organisation: { select: { slug: true } },
          },
        },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => ({
      projectId: r.projectId,
      projectName: r.project.name,
      projectSlug: r.project.slug,
      orgSlug: r.project.organisation.slug,
      userId: r.userId,
      userName: r.user.name,
      userEmail: r.user.email,
      createdAt: r.createdAt,
    }));
  } catch (error) {
    console.error("[org] loadProjectCollaborators failed", error);
    return [];
  }
}

async function loadPendingJoinRequests(organisationId: string): Promise<PendingJoinRequestItem[]> {
  try {
    return await prisma.projectJoinRequest.findMany({
      where: { project: { organisationId }, status: "pending" },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            slug: true,
            organisation: { select: { slug: true } },
          },
        },
        user: { select: { id: true, name: true, email: true, image: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  } catch (error) {
    console.error("[org] loadPendingJoinRequests failed", error);
    return [];
  }
}

/** Who is in the organisation, their roles and agents, and leaving it. */
export default async function OrgMembersPage({
  params,
}: {
  params?: Promise<{ org: string; project: string }>;
}) {
  const { user, org } = await loadOrg();
  if (!org) return null;

  const routeParams = params ? await params : null;
  const [members, collaborators, pendingRequests] = await Promise.all([
    loadMembers(org.id, org.admin),
    loadProjectCollaborators(org.id),
    org.admin ? loadPendingJoinRequests(org.id) : Promise.resolve([]),
  ]);
  const ownerCount = members.filter((member) => member.role === "owner").length;
  const fallbackProjectSlug = routeParams?.project ?? pendingRequests[0]?.project?.slug ?? org.slug;
  const orgRef = projectRef(org.slug, fallbackProjectSlug);

  return (
    <div className="space-y-4">
      <OrgPageHeader title="Members">
        Everyone in {org.name}. Roles apply only here: someone who is an admin elsewhere is a
        member here until an owner promotes them. Owners change roles; owners and admins can
        remove people. Owners pay for the organisation&apos;s issues, and choose which admins may fund them too. Agents have their own class, which owners and admins set per agent.
      </OrgPageHeader>
      {org.admin && pendingRequests.length > 0 ? (
        <ProjectPendingJoinRequestsBanner
          requests={pendingRequests}
          orgRef={orgRef}
          projectName={org.name}
        />
      ) : null}
      {org.admin ? null : (
        <ReadOnlyNote>
          You can see who is here and leave the organisation. Only owners and admins can change
          roles or remove people.
        </ReadOnlyNote>
      )}
      <MemberList
        organisationId={org.id}
        organisationName={org.name}
        viewerId={user.id}
        members={members}
        ownerCount={ownerCount}
        canChangeRoles={org.owner}
        canRemove={org.admin}
        agentLevels={org.admin ? settableLevels({ isOwner: false, isAdminOfOrganisation: true }) : []}
      />
      <ProjectCollaboratorsSection
        collaborators={collaborators}
        canRemove={org.admin}
      />
    </div>
  );
}
