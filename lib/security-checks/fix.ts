import "server-only";

import type { Prisma, PrismaClient, SecuritySeverity } from "@prisma/client";
import { z } from "zod";
import { convertClientVettedIdea } from "@/lib/agent-api/idea-verdicts";
import { issuePath } from "@/lib/issue-ref";
import { prisma } from "@/lib/prisma";
import { refOf } from "@/lib/project-paths";
import { isReportPosted, isResultUnlocked } from "@/lib/security-checks";
import { createFinding, PLACEHOLDER_DESCRIPTION, PLACEHOLDER_SUMMARY, placeholderTitle } from "@/lib/security-findings";

const id = z.string().trim().min(1).max(128);
export const fixCheckId = id;
export const fixSelection = z.object({
  checkId: id,
  projectId: id,
  resultIds: z.array(id).min(1),
});

export type FixProject = { id: string; name: string };
export type FixOptions = { projects: FixProject[]; projectId: string | null };
export type FixOutcome =
  | { ok: true; created: number; reused: number; issues: { number: number; href: string }[] }
  | { ok: false; error: string };

type Client = { userId: string; organisationId: string; superAdmin: boolean };
type Check = { postedAt: Date | null; projectId: string | null };
type Result = { id: string; severity: SecuritySeverity; finding: { bug: { number: number } | null } | null };

const unavailable = { ok: false, error: "This check is unavailable in your workspace." } as const;
const locked = { ok: false, error: "Unlock every selected finding before sending it to a project." } as const;

// Workspace members can contribute to its projects under the board's existing
// access rules. Recheck membership in the same query that scopes the project.
function eligibleProjects(client: Client): Prisma.ProjectWhereInput {
  return {
    organisationId: client.organisationId,
    archivedAt: null,
    organisation: {
      archivedAt: null,
      ...(client.superAdmin ? {} : { memberships: { some: { userId: client.userId } } }),
    },
  };
}

export async function listFixProjects(client: Client, checkId: string, db = prisma): Promise<FixOptions | null> {
  const check = await db.securityCheck.findFirst({
    where: {
      id: checkId,
      requestedById: client.userId,
      organisationId: client.organisationId,
      results: { some: { unlockedAt: { not: null } } },
    },
    select: { postedAt: true, projectId: true },
  });
  if (!check || !isReportPosted(check)) return null;
  const projects = await db.project.findMany({
    where: { ...eligibleProjects(client), ...(check.projectId ? { id: check.projectId } : {}) },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
  return { projects, projectId: check.projectId };
}

export async function sendCheckFindings(
  client: Client,
  selection: z.infer<typeof fixSelection>,
  db: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<FixOutcome> {
  const { checkId, projectId } = selection;
  const resultIds = [...new Set(selection.resultIds)];
  return db.$transaction(async (tx) => {
    // The check row serializes all submissions for this report. A waiter reads
    // the committed destination and finding links after the preceding commit.
    const [check] = await tx.$queryRaw<Check[]>`
      SELECT "postedAt", "projectId" FROM "SecurityCheck"
      WHERE "id" = ${checkId} AND "organisationId" = ${client.organisationId}
        AND "requestedById" = ${client.userId}
      FOR NO KEY UPDATE
    `;
    if (!check) return unavailable;
    if (!isReportPosted(check)) return { ok: false, error: "Wait for the report to be posted before sending findings." };
    const project = await tx.project.findFirst({
      where: { ...eligibleProjects(client), id: projectId },
      select: { slug: true, organisation: { select: { slug: true } } },
    });
    if (!project) return { ok: false, error: "Choose an available project in this workspace." };
    if (check.projectId && check.projectId !== projectId) {
      return { ok: false, error: "This check already has a destination project. Refresh and choose that project." };
    }

    const results = await tx.securityCheckResult.findMany({
      where: { checkId, id: { in: resultIds } },
      select: { id: true, severity: true, unlockedAt: true, finding: { select: { bug: { select: { number: true } } } } },
    });
    if (results.length !== resultIds.length) {
      return { ok: false, error: "One or more selected findings are unavailable in this check." };
    }

    // Reject the entire selection before any writes if one finding is locked.
    if (results.some((result) => !isResultUnlocked(result))) return locked;

    let created = 0;
    const issues: { number: number; href: string }[] = [];
    for (const result of results) {
      const number = result.finding
        ? result.finding.bug?.number
        : await createResultIssue(tx, client, projectId, checkId, result);
      if (!result.finding) created += 1;
      if (number !== undefined) issues.push({ number, href: issuePath(refOf(project), number) });
    }
    if (!check.projectId) await tx.securityCheck.update({ where: { id: checkId }, data: { projectId } });
    return { ok: true, created, reused: results.length - created, issues };
  }, { timeout: 30_000 });
}

async function createResultIssue(tx: Prisma.TransactionClient, client: Client, projectId: string, checkId: string, result: Result) {
  const scope = { organisationId: client.organisationId, projectId };
  const title = placeholderTitle(result.severity);
  const idea = await tx.idea.create({
    data: {
      ...scope,
      reporterId: client.userId,
      beneficiaryUserId: client.userId,
      title,
      summary: PLACEHOLDER_SUMMARY,
      description: PLACEHOLDER_DESCRIPTION,
    },
    select: { id: true },
  });
  const finding = await createFinding(tx, {
    ...scope,
    ideaId: idea.id,
    reporterId: client.userId,
    severity: result.severity,
    title,
    description: PLACEHOLDER_DESCRIPTION,
  });
  // Copy private text inside PostgreSQL. It never becomes a query parameter,
  // a client response, or an input to shared issue and event code.
  const copied = await tx.$executeRaw`
    UPDATE "SecurityFinding" AS f
    SET "title" = r."title",
        "description" = CASE WHEN r."howToFix" = '' THEN r."description"
          ELSE r."description" || E'\\n\\n## How to fix\\n\\n' || r."howToFix" END
    FROM "SecurityCheckResult" AS r
    WHERE f."id" = ${finding.id} AND r."id" = ${result.id} AND r."checkId" = ${checkId}
  `;
  if (copied !== 1) throw new Error("Security finding could not be linked.");
  const issue = await convertClientVettedIdea(tx, scope, idea.id, client.userId);
  await tx.securityCheckResult.update({ where: { id: result.id }, data: { findingId: finding.id } });
  return issue.issueNumber;
}
