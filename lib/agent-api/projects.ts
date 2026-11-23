import { PRODUCT_TRACK } from "@/lib/marketing/track";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/site-url";
import { projectPath, projectRef } from "@/lib/project-paths";
import { IssueApiError } from "@/lib/agent-api/errors";
import { getPlatformRewardConfig } from "@/lib/rewards/platform";
import { parseProjectRewardConfig, projectDefaultsFromPlatform, type ProjectRewardConfig } from "@/lib/rewards/config";
import { ISSUE_SHARES } from "@/lib/coins/issue-shares";
import { feePercent } from "@/lib/coins/math";
import { workflowValues } from "@/lib/workflow-config";
import { effectiveHumanApprovalGuidelines } from "@/lib/human-approval";
import type { Prisma } from "@prisma/client";

/**
 * Project discovery (#607): no issue route can be called without a
 * `projectId`, and until now nothing told an agent which projects exist or
 * what each is for. `Project.goal`, `repoUrl` and `stagingUrl` are the lead's
 * brief; each project's workflow numbers expose the gates it enforces so an
 * agent can set expectations.
 *
 * `repositories` (#2) lists every repository a fix can be in: the main one
 * (`repoUrl`, kept for older agents) first, then the project's others.
 *
 * `githubInstallationId` (the project's and each repository's) is deliberately
 * not selected — it is deployment configuration, not agent-visible data.
 */
const projectSelect = {
  id: true, slug: true, name: true, goal: true, humanApprovalGuidelines: true, repoUrl: true, stagingUrl: true, rewardConfig: true,
  workflow: true,
  repositories: {
    select: { url: true, label: true, branch: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.ProjectSelect;

/**
 * What the project's work pays (#one-payment): every funded issue pays out the same split once live, Ziki's fee
 * first (`feePercent`), then each role's share (`shares`, percent of the rest); and the project's earning guidelines.
 */
function rewardRules(rewardConfig: unknown, base: ProjectRewardConfig) {
  return { feePercent: feePercent(), shares: ISSUE_SHARES, guidelines: parseProjectRewardConfig(rewardConfig, base).guidelines };
}

type AgentRepository = { url: string; label: string | null; branch: string | null; main: boolean };

function agentRepositories(project: {
  repoUrl: string | null;
  repositories: { url: string; label: string | null; branch: string | null }[];
}): AgentRepository[] {
  const main = project.repoUrl ? [{ url: project.repoUrl, label: null, branch: null, main: true }] : [];
  return [...main, ...project.repositories.map((repository) => ({ ...repository, main: false }))];
}

/** The organisation's slug, the first segment of its projects' addresses (#project-urls). */
export async function organisationSlugOf(organisationId: string): Promise<string> {
  const organisation = await prisma.organisation.findUnique({ where: { id: organisationId }, select: { slug: true } });
  if (!organisation) throw new IssueApiError(404, "Organisation not found.");
  return organisation.slug;
}

export async function listAgentProjectSummaries(organisationId: string) {
  return prisma.project.findMany({
    where: { organisationId },
    orderBy: { slug: "asc" },
    select: { id: true, slug: true, name: true },
  });
}

/** Every project in the agent's organisation, with each project's goal and open-issue count. */
export async function listAgentProjects(organisationId: string) {
  const [projects, platform] = await Promise.all([
    prisma.project.findMany({
      where: { organisationId },
      orderBy: { slug: "asc" },
      select: projectSelect,
    }),
    getPlatformRewardConfig(prisma),
  ]);
  const orgSlug = await organisationSlugOf(organisationId);
  const base = projectDefaultsFromPlatform(platform);
  const openCounts = await prisma.bug.groupBy({
    by: ["projectId"],
    where: { organisationId, projectId: { in: projects.map((project) => project.id) }, ...PRODUCT_TRACK, isDeleted: false, substatus: "open" },
    _count: { _all: true },
  });
  const openByProject = new Map(openCounts.map((row) => [row.projectId, row._count._all]));
  return projects.map((project) => ({
    ...project,
    humanApprovalGuidelines: effectiveHumanApprovalGuidelines(project.humanApprovalGuidelines),
    repositories: agentRepositories(project),
    workUrl: absoluteUrl(projectPath(projectRef(orgSlug, project.slug), "/work")),
    notesUrl: `/api/v1/projects/${project.id}/notes`,
    notesCommentsUrl: `/api/v1/projects/${project.id}/notes/comments`,
    rewardRules: rewardRules(project.rewardConfig, base),
    workflow: workflowValues(project.workflow),
    openIssueCount: openByProject.get(project.id) ?? 0,
  }));
}

/** One project in the agent's organisation; foreign project ids are a 404, not a leak. */
export async function getAgentProject(organisationId: string, projectId: string) {
  const [project, platform] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId, organisationId },
      select: projectSelect,
    }),
    getPlatformRewardConfig(prisma),
  ]);
  if (!project) throw new IssueApiError(404, "Project not found.");
  const orgSlug = await organisationSlugOf(organisationId);
  const openIssueCount = await prisma.bug.count({
    where: { organisationId, projectId: project.id, ...PRODUCT_TRACK, isDeleted: false, substatus: "open" },
  });
  return {
    ...project,
    humanApprovalGuidelines: effectiveHumanApprovalGuidelines(project.humanApprovalGuidelines),
    repositories: agentRepositories(project),
    workUrl: absoluteUrl(projectPath(projectRef(orgSlug, project.slug), "/work")),
    notesUrl: `/api/v1/projects/${project.id}/notes`,
    notesCommentsUrl: `/api/v1/projects/${project.id}/notes/comments`,
    rewardRules: rewardRules(project.rewardConfig, projectDefaultsFromPlatform(platform)),
    workflow: workflowValues(project.workflow),
    openIssueCount,
  };
}
