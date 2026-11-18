import type { Prisma, PrismaClient } from "@prisma/client";
import { parseSecurityTarget } from "./target";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The GitHub App installation that lets a workspace read a private repo (#security-repo-scan): one of its projects
 * has this repo as its repository and the Ziki App installed. Null when no project of the workspace connected it.
 */
export async function privateRepoAccess(db: Db, organisationId: string, repo: string): Promise<{ installationId: string } | null> {
  const projects = await db.project.findMany({
    where: { organisationId, archivedAt: null, githubInstallationId: { not: null }, repoUrl: { not: null } },
    select: { repoUrl: true, githubInstallationId: true },
  });
  for (const project of projects) {
    const parsed = project.repoUrl ? parseSecurityTarget(project.repoUrl) : null;
    if (parsed?.ok && parsed.target.kind === "repo" && parsed.target.value.toLowerCase() === repo.toLowerCase() && project.githubInstallationId) {
      return { installationId: project.githubInstallationId };
    }
  }
  return null;
}

/** How a repo's parts reach their code: through Ziki's /code API (connected through the App) or a public clone. */
export async function codeRoute(db: Db, organisationId: string, repo: string): Promise<"ziki" | "clone"> {
  return (await privateRepoAccess(db, organisationId, repo)) ? "ziki" : "clone";
}
