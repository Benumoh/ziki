import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

async function openableOrganisationIds(user: { id: string; role: string }): Promise<string[] | null> {
  if (user.role === "super_admin") return null;
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id, organisation: { archivedAt: null } },
    select: { organisationId: true },
  });
  return memberships.map((m) => m.organisationId);
}

/**
 * Read-only access check for `/<org>/forum` routes.
 * Verifies the signed-in user belongs to the organisation without forcing an
 * active-workspace cookie redirect (`zk_active_org`), allowing seamless soft
 * navigation across organisation forums.
 */
export const requireForumOrg = cache(async (orgParam: string) => {
  const user = await requireUser();
  const orgSlug = decode(orgParam);
  const organisationIds = await openableOrganisationIds(user);
  const organisation = await prisma.organisation.findFirst({
    where: {
      slug: orgSlug,
      archivedAt: null,
      ...(organisationIds ? { id: { in: organisationIds } } : {}),
    },
    select: { id: true, slug: true, name: true },
  });
  if (!organisation) return { user, organisation: null };
  return {
    user,
    organisation: { id: organisation.id, slug: organisation.slug, name: organisation.name },
  };
});

/**
 * Read-only access check for `/<org>/<project>/forum` routes.
 * Verifies the signed-in user has access to the project (via org membership,
 * direct project membership, or public project visibility) without forcing an
 * active-workspace cookie redirect.
 */
export const requireForumProject = cache(async (orgParam: string, projectParam: string) => {
  const user = await requireUser();
  const orgSlug = decode(orgParam);
  const slug = decode(projectParam);
  const organisationIds = await openableOrganisationIds(user);

  const userProjectMemberships = await prisma.projectMembership.findMany({
    where: { userId: user.id, project: { archivedAt: null, organisation: { archivedAt: null } } },
    select: { projectId: true },
  });
  const directProjectIds = userProjectMemberships.map((m) => m.projectId);

  const where: Prisma.ProjectWhereInput = {
    slug,
    archivedAt: null,
    organisation: { slug: orgSlug, archivedAt: null },
  };

  if (user.role !== "super_admin") {
    where.OR = [
      { visibility: "public" },
      { id: { in: directProjectIds } },
      ...(organisationIds && organisationIds.length > 0 ? [{ organisationId: { in: organisationIds } }] : []),
    ];
  }

  const project = await prisma.project.findFirst({
    where,
    select: {
      id: true,
      slug: true,
      name: true,
      organisationId: true,
      organisation: { select: { slug: true, name: true } },
    },
  });
  if (!project) notFound();

  return {
    user,
    organisationId: project.organisationId,
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      organisationId: project.organisationId,
      orgSlug: project.organisation.slug,
      orgName: project.organisation.name,
    },
  };
});
