import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { PublicProjectRef } from "@/lib/public-project-paths";

export function publicTrackingTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A non-login identity keeps required reporter relations intact without impersonating a person. */
export function publicReporterEmail(projectId: string): string {
  const projectHash = createHash("sha256").update(projectId).digest("hex").slice(0, 32);
  return `public-intake-${projectHash}@system.ziki.invalid`;
}

export async function findPublicProject(
  ref: PublicProjectRef,
  options: { requireGuestIntake?: boolean } = {},
) {
  return prisma.project.findFirst({
    where: {
      slug: ref.projectSlug,
      archivedAt: null,
      visibility: "public",
      ...(options.requireGuestIntake ? { acceptsGuestIdeas: true } : {}),
      organisation: { slug: ref.orgSlug, archivedAt: null },
    },
    select: {
      id: true,
      organisationId: true,
      slug: true,
      name: true,
      goal: true,
      repoUrl: true,
      siteUrl: true,
      isOpenForContributors: true,
      acceptsGuestIdeas: true,
      contributorGuidelines: true,
      organisation: { select: { name: true, slug: true } },
    },
  });
}

export type FeedbackPortalProject = {
  id: string;
  organisationId: string;
  slug: string;
  name: string;
  goal: string | null;
  visibility: "public" | "private";
  acceptsGuestIdeas: boolean;
  organisation: { name: string; slug: string };
};

export function feedbackProjectDescription(project: {
  name: string;
  goal?: string | null;
  visibility?: "public" | "private";
}): string {
  if (project.visibility === "public" && project.goal?.trim()) {
    return project.goal.trim();
  }
  return `Feedback for the ${project.name.trim().toLowerCase()} app.`;
}

const PLATFORM_PRIORITY: Record<string, number> = {
  web: 0,
  mobile: 1,
  desktop: 2,
};

function isMarketingProject(project: { slug: string; name: string }): boolean {
  const slug = project.slug.toLowerCase();
  const name = project.name.trim().toLowerCase();
  return slug === "marketing" || slug.endsWith("-marketing") || name === "marketing";
}

export function sortAndFilterFeedbackProjects<T extends { slug: string; name: string }>(
  projects: readonly T[],
): T[] {
  const nonMarketing = projects.filter((project) => !isMarketingProject(project));
  const list = nonMarketing.length > 0 ? nonMarketing : [...projects];
  return [...list].sort((a, b) => {
    const pa = PLATFORM_PRIORITY[a.slug.toLowerCase()] ?? PLATFORM_PRIORITY[a.name.trim().toLowerCase()] ?? 99;
    const pb = PLATFORM_PRIORITY[b.slug.toLowerCase()] ?? PLATFORM_PRIORITY[b.name.trim().toLowerCase()] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Resolves a project for its shared customer feedback portal (`/<org>/<project>/feedback`).
 * Supports private projects without exposing internal project data (goal, repoUrl, or issues).
 */
export async function findFeedbackProject(
  ref: PublicProjectRef,
): Promise<FeedbackPortalProject | null> {
  const project = await prisma.project.findFirst({
    where: {
      slug: ref.projectSlug,
      archivedAt: null,
      organisation: { slug: ref.orgSlug, archivedAt: null },
    },
    select: {
      id: true,
      organisationId: true,
      slug: true,
      name: true,
      goal: true,
      visibility: true,
      acceptsGuestIdeas: true,
      organisation: { select: { name: true, slug: true } },
    },
  });
  if (!project) return null;
  return {
    ...project,
    // Never expose internal goal text for a private project on external feedback pages.
    goal: project.visibility === "public" ? project.goal : null,
  };
}

export async function listOrgFeedbackProjects(orgSlug: string) {
  const organisation = await prisma.organisation.findFirst({
    where: { slug: orgSlug, archivedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      projects: {
        where: { archivedAt: null },
        orderBy: { name: "asc" },
        select: {
          id: true,
          slug: true,
          name: true,
          goal: true,
          visibility: true,
          acceptsGuestIdeas: true,
        },
      },
    },
  });
  if (!organisation) return null;

  const projects = sortAndFilterFeedbackProjects(organisation.projects).map((project) => ({
    id: project.id,
    slug: project.slug,
    name: project.name,
    description: feedbackProjectDescription(project),
    visibility: project.visibility,
  }));

  return {
    organisation: {
      id: organisation.id,
      name: organisation.name,
      slug: organisation.slug,
    },
    projects,
  };
}
