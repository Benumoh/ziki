import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { orgHomePath, projectPath, projectRef, withoutFlightMarker, type ProjectRef } from "@/lib/project-paths";

/**
 * The project a page shows comes from its URL, `/<org>/<project>/…`
 * (#project-urls), never a cookie. This resolves it and is the access check
 * for every project page:
 *
 * - The organisation slug is looked up among the organisations the signed-in
 *   person belongs to, direct project memberships, or public projects (any for
 *   the site super admin), and the project slug inside it. No match is a 404,
 *   so a project you can't see looks the same as one that doesn't exist.
 * - When the organisation isn't the current one, the request goes through
 *   /projects/<slug>/open, which makes it current and comes back, so
 *   everything the page and its actions read agrees with the URL.
 */
export type ProjectContext = {
  user: Awaited<ReturnType<typeof requireUser>>;
  organisationId: string;
  project: {
    id: string;
    slug: string;
    name: string;
    goal: string | null;
    organisationId: string;
    orgSlug: string;
    ref: ProjectRef;
    visibility: "public" | "private";
    isOpenForContributors: boolean;
  };
  isOrgMember: boolean;
  isProjectMember: boolean;
  isOrgAdmin: boolean;
  canContribute: boolean;
};

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** This request's own address (path and query), set by middleware.ts, to come back to after switching organisation. */
async function requestPath(fallback: string): Promise<string> {
  const path = (await headers()).get("x-ziki-url");
  return path && path.startsWith("/") && !path.startsWith("//") ? withoutFlightMarker(path) : fallback;
}

/** The organisations someone may open: null means any (the site super admin). */
async function openableOrganisationIds(user: { id: string; role: string }): Promise<string[] | null> {
  if (user.role === "super_admin") return null;
  const memberships = await prisma.membership.findMany({ where: { userId: user.id, organisation: { archivedAt: null } }, select: { organisationId: true } });
  return memberships.map((m) => m.organisationId);
}

function switchTo(organisationId: string, projectSlug: string, next: string): never {
  redirect(`/projects/${encodeURIComponent(projectSlug)}/open?organisation=${encodeURIComponent(organisationId)}&next=${encodeURIComponent(next)}`);
}

export const requireProject = cache(async (orgParam: string, projectParam: string): Promise<ProjectContext> => {
  const user = await requireUser();
  const orgSlug = decode(orgParam);
  const slug = decode(projectParam);
  const organisationIds = await openableOrganisationIds(user);

  // Direct project memberships
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
      goal: true,
      organisationId: true,
      visibility: true,
      isOpenForContributors: true,
    },
  });
  if (!project) notFound();

  const isOrgMember = organisationIds === null || organisationIds.includes(project.organisationId);
  const isProjectMember = directProjectIds.includes(project.id);
  const isOrgAdmin = user.role === "super_admin" || Boolean(
    await prisma.membership.findFirst({
      where: { organisationId: project.organisationId, userId: user.id, role: { in: ["owner", "admin"] } },
      select: { id: true },
    })
  );
  const canContribute = isOrgMember || isProjectMember || user.role === "super_admin";

  const ref = projectRef(orgSlug, project.slug);
  // Only someone who really belongs to the organisation can make it current: the current organisation ignores a
  // pick they aren't a member of, so switching the site super admin into an organisation they don't belong to
  // would send them back here forever. They read it from wherever they are.
  const belongsToOrg = organisationIds === null
    ? Boolean(await prisma.membership.findFirst({ where: { organisationId: project.organisationId, userId: user.id }, select: { id: true } }))
    : isOrgMember;
  if (belongsToOrg && project.organisationId !== (await currentOrganisationIdFor(user.id))) {
    // Switch to the project's organisation first, then come back to this page.
    switchTo(project.organisationId, project.slug, await requestPath(projectPath(ref)));
  }
  return {
    user,
    organisationId: project.organisationId,
    project: { ...project, orgSlug, ref },
    isOrgMember,
    isProjectMember,
    isOrgAdmin,
    canContribute,
  };
});

/**
 * `/<org>`: the organisation an address names, checked the same way as a
 * project, made current if it isn't. Null when the person isn't in it.
 */
export const requireOrg = cache(async (orgParam: string) => {
  const user = await requireUser();
  const orgSlug = decode(orgParam);
  const organisationIds = await openableOrganisationIds(user);
  const organisation = await prisma.organisation.findFirst({
    where: { slug: orgSlug, archivedAt: null, ...(organisationIds ? { id: { in: organisationIds } } : {}) },
    select: { id: true, slug: true, name: true },
  });
  if (!organisation) return { user, organisation: null };
  if (organisation.id !== (await currentOrganisationIdFor(user.id))) {
    // Through /organisations/open, which works for an organisation with no projects yet.
    redirect(`/organisations/open?organisation=${encodeURIComponent(organisation.id)}&next=${encodeURIComponent(await requestPath(orgHomePath(organisation.slug)))}`);
  }
  return { user, organisation: { id: organisation.id, slug: organisation.slug, name: organisation.name } };
});

/**
 * Where an address from before organisations were in URLs now lives
 * (`/<project>/…` → `/<org>/<project>/…`, #project-urls), or null. The first
 * segment is the project's slug, looked up in the person's organisations (the
 * current one first); when no project has it but one of their organisations
 * does, that organisation's default project. The rest of the address is kept.
 */
export async function projectFirstTarget(user: { id: string; role: string }, path: string): Promise<string | null> {
  const queryAt = path.indexOf("?");
  const pathname = queryAt < 0 ? path : path.slice(0, queryAt);
  const query = queryAt < 0 ? "" : path.slice(queryAt);
  const [first, ...rest] = pathname.split("/").filter(Boolean);
  if (!first) return null;
  const slug = decode(first);
  const organisationIds = await openableOrganisationIds(user);
  const scope = { archivedAt: null, ...(organisationIds ? { id: { in: organisationIds } } : {}) };
  const currentOrganisationId = await currentOrganisationIdFor(user.id);

  const projects = await prisma.project.findMany({
    where: { slug, archivedAt: null, organisation: scope },
    select: { slug: true, organisationId: true, organisation: { select: { slug: true } } },
    orderBy: { createdAt: "asc" },
  });
  const project = projects.find((p) => p.organisationId === currentOrganisationId) ?? projects[0];
  let ref: ProjectRef | null = project ? projectRef(project.organisation.slug, project.slug) : null;
  if (!ref) {
    const organisation = await prisma.organisation.findFirst({ where: { slug, ...scope }, select: { id: true, slug: true } });
    const first = organisation ? await defaultProjectSlug(organisation.id) : null;
    if (organisation && first) ref = projectRef(organisation.slug, first);
  }
  if (!ref) return null;
  // The organisation's projects page was `/<project>/projects`; it is `/<org>` now.
  if (rest[0] === "projects") return `/${ref.split("/")[0]}${query}`;
  return `${projectPath(ref, rest.length ? `/${rest.join("/")}` : "")}${query}`;
}

const DEFAULT_PROJECT_SLUG = "web";

/** The project an organisation opens on when none is named: Web when it has one, else its oldest (#no-general). */
async function defaultProjectSlug(organisationId: string): Promise<string | null> {
  const web = await prisma.project.findFirst({ where: { organisationId, archivedAt: null, slug: DEFAULT_PROJECT_SLUG }, select: { slug: true } });
  if (web) return web.slug;
  const oldest = await prisma.project.findFirst({ where: { organisationId, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { slug: true } });
  return oldest?.slug ?? null;
}

/**
 * An organisation-wide list, `/<org>/overview`, `/<org>/issues/…`, `/<org>/ideas` or `/<org>/queue` (#project-filter): the
 * organisation and the project the list is drawn through (its default one), so the list keeps the project
 * page's access checks. An old `/<project>/issues/…` address, where no organisation has the slug, goes on
 * to that project; an organisation with no project yet goes to `/<org>`, which offers to create one.
 */
export async function requireOrgList(orgParam: string, path: string): Promise<{ org: string; project: string }> {
  const { user, organisation } = await requireOrg(orgParam);
  if (!organisation) {
    const target = await projectFirstTarget(user, path);
    if (target) permanentRedirect(target);
    notFound();
  }
  const project = await defaultProjectSlug(organisation.id);
  if (!project) redirect(orgHomePath(organisation.slug));
  return { org: organisation.slug, project };
}

/**
 * Marketing's pages belong to the organisation (#org-marketing), `/<org>/marketing/…`, but its work, settings and
 * agent still act through a project: the organisation's main one. `rest` is the page's address after `/marketing`.
 */
export async function requireOrgMarketing(orgParam: string, rest = ""): Promise<{ org: string; project: string }> {
  return requireOrgList(orgParam, `/${orgParam}/marketing${rest}`);
}

/** The first project someone can open, for addresses with no project (the site root, sign-in). */
export async function firstProjectRefFor(userId: string): Promise<ProjectRef | null> {
  const organisationId = await currentOrganisationIdFor(userId);
  if (organisationId) {
    const [organisation, slug] = await Promise.all([
      prisma.organisation.findUnique({ where: { id: organisationId }, select: { slug: true } }),
      defaultProjectSlug(organisationId),
    ]);
    if (organisation && slug) return projectRef(organisation.slug, slug);
  }
  const projectMember = await prisma.projectMembership.findFirst({
    where: { userId, project: { archivedAt: null, organisation: { archivedAt: null } } },
    select: { project: { select: { slug: true, organisation: { select: { slug: true } } } } },
  });
  return projectMember?.project ? projectRef(projectMember.project.organisation.slug, projectMember.project.slug) : null;
}

/** The current organisation's Projects page, for someone whose organisation has no projects yet. */
export async function currentOrgPathFor(userId: string): Promise<string | null> {
  const organisationId = await currentOrganisationIdFor(userId);
  if (!organisationId) return null;
  const organisation = await prisma.organisation.findUnique({ where: { id: organisationId, archivedAt: null }, select: { slug: true } });
  return organisation ? orgHomePath(organisation.slug) : null;
}
