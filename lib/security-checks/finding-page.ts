import "server-only";
import type { SecuritySeverity } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findingPrice } from "@/lib/security-checks/payment";
import { fixOf, type ResultFix } from "@/lib/security-checks/report";

/**
 * One finding of a security check, opened like a ticket (16 Nov call with Mark):
 * what's wrong in plain words, where it was found, and one "Fix this" with two
 * ways to get it fixed. Only the person who asked for the check sees it, as on
 * the check's page. "How to fix" is read only once the finding is unlocked
 * (paid for) or moved to the client's app, so it never reaches a locked page.
 */
export type CheckFinding = {
  id: string;
  checkId: string;
  site: string;
  severity: SecuritySeverity;
  title: string;
  description: string;
  /** The part of the check that found it. */
  area: string;
  /** What "Tell me how to fix it" costs, in Ziks; 0 once unlocked or moved. */
  price: number;
  unlocked: boolean;
  howToFix: string | null;
  fix: ResultFix | null;
  /** The workspace's projects an agent could fix it in, and whether each has its code connected. */
  projects: { id: string; name: string; slug: string; codeConnected: boolean }[];
};

export async function loadCheckFinding(checkId: string, resultId: string, organisationId: string, userId: string): Promise<CheckFinding | null> {
  const row = await prisma.securityCheckResult.findFirst({
    where: { id: resultId, checkId, check: { organisationId, requestedById: userId } },
    select: {
      id: true,
      checkId: true,
      severity: true,
      title: true,
      description: true,
      priceCoins: true,
      unlockedAt: true,
      findingId: true,
      item: { select: { title: true } },
      check: { select: { projectId: true, target: { select: { value: true } } } },
      finding: {
        select: {
          id: true,
          project: { select: { slug: true, organisation: { select: { slug: true } } } },
          bug: { select: { number: true, status: true, isDeleted: true } },
          idea: { select: { status: true, isDeleted: true } },
          verifications: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { passed: true, reviewer: { select: { name: true } } } },
        },
      },
    },
  });
  if (!row) return null;

  const unlocked = row.unlockedAt !== null || row.findingId !== null;
  // Read separately and only when paid for, so a locked finding's fix is never even loaded.
  const howToFix = unlocked ? ((await prisma.securityCheckResult.findUnique({ where: { id: row.id }, select: { howToFix: true } }))?.howToFix ?? null) : null;

  const projects = await prisma.project.findMany({
    where: {
      organisationId,
      archivedAt: null,
      // A check sends its findings to one project once it has sent any (see fix.ts).
      ...(row.check.projectId ? { id: row.check.projectId } : {}),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, slug: true, repoUrl: true, githubInstallationId: true },
  });

  return {
    id: row.id,
    checkId: row.checkId,
    site: row.check.target.value,
    severity: row.severity,
    title: row.title,
    description: row.description,
    area: row.item.title,
    price: unlocked ? 0 : findingPrice(row),
    unlocked,
    howToFix,
    fix: fixOf(row.finding),
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      codeConnected: Boolean(project.repoUrl && project.githubInstallationId),
    })),
  };
}
