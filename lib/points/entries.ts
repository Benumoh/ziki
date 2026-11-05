import { ideaPath } from "@/lib/project-paths";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { pointsNumber } from "./rules";
import { issueHref } from "@/lib/issue-ref";

const timestamp = z.string().datetime({ offset: true });
const dateBound = z.union([timestamp, z.string().date()]);
const cursorSchema = z.object({ at: timestamp, id: z.string().min(1).max(191) });
export const pointEntriesQuerySchema = z.object({
  from: dateBound.optional(), to: dateBound.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(1024).optional(),
}).refine(q => !q.from || !q.to || new Date(q.from) <= new Date(q.to.length === 10 ? `${q.to}T23:59:59.999Z` : q.to), {
  message: "from must not be after to",
});
export type PointEntriesQuery = z.infer<typeof pointEntriesQuerySchema>;

export function decodePointCursor(raw: string) {
  try { return cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))); }
  catch { throw new Error("Invalid points cursor."); }
}

function entrySource(role: string, points: number, sourceKey: string): string {
  if (points < 0) return "Correction";
  const labels: Record<string, string> = {
    "reviewer-confirm": "Issue confirmation review",
    reviewer: "Fix review",
    "triager-clear": "Duplicate clearance",
    "duplicate-marker": "Duplicate detection",
    idea: "Idea contribution",
    signup: "Signup bonus",
    "comment-upvote": "Comment upvote",
    importance: "Importance mark",
    "bid-vote": "Bid vote",
    multiplier: "Points multiplier adjustment",
  };
  return labels[sourceKey.split(":")[0]] ?? `${role[0].toUpperCase()}${role.slice(1)} award`;
}

/** Owner-scoped, append-only ledger; inaccessible issue details are never serialized. */
export async function pointEntries(db: PrismaClient | Prisma.TransactionClient, scope: {
  tenantId: string; userId: string; visibleProjectId?: string | null;
}, query: PointEntriesQuery) {
  const cursor = query.cursor ? decodePointCursor(query.cursor) : null;
  const to = query.to?.length === 10 ? `${query.to}T23:59:59.999Z` : query.to;
  const where: Prisma.PointEntryWhereInput = {
    tenantId: scope.tenantId, userId: scope.userId,
    ...(query.from || to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
    ...(cursor ? { OR: [
      { createdAt: { lt: new Date(cursor.at) } },
      { createdAt: new Date(cursor.at), id: { lt: cursor.id } },
    ] } : {}),
  };
  const rows = await db.pointEntry.findMany({
    where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1,
    select: { id: true, role: true, points: true, createdAt: true, sourceKey: true,
      bug: { select: { id: true, number: true, title: true, tenantId: true, projectId: true, isDeleted: true, project: { select: { slug: true } } } },
      idea: { select: { id: true, number: true, title: true, tenantId: true, projectId: true, isDeleted: true, project: { select: { slug: true } } } } },
  });
  const visible = (row: { tenantId: string; projectId: string; isDeleted: boolean } | null) =>
    !!row && !row.isDeleted && row.tenantId === scope.tenantId && (!scope.visibleProjectId || row.projectId === scope.visibleProjectId);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(row => {
      const points = pointsNumber(row.points);
      return {
        id: row.id,
        role: row.role,
        points,
        createdAt: row.createdAt.toISOString(),
        source: entrySource(row.role, points, row.sourceKey),
        issue: row.bug && visible(row.bug) ? { id: row.bug.id, number: row.bug.number, title: row.bug.title, path: issueHref(row.bug) } : null,
        // #idea-table: an `idea` entry was earned on an idea, which is numbered apart from issues.
        idea: row.idea && visible(row.idea) ? { id: row.idea.id, number: row.idea.number, title: row.idea.title, path: ideaPath(row.idea.project.slug, row.idea.number) } : null,
      };
    }),
    nextCursor: rows.length > query.limit && last
      ? Buffer.from(JSON.stringify({ at: last.createdAt.toISOString(), id: last.id })).toString("base64url") : null,
  };
}
export type PointEntriesPage = Awaited<ReturnType<typeof pointEntries>>;
