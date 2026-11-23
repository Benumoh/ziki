import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { issueHref } from "@/lib/issue-ref";
import { earningsWhere, PAYOUT_ROLE_LABELS } from "./earned";
import { zikOf } from "./ledger";

/**
 * A person's earnings in one organisation, one payment at a time (#one-payment): the Ziks ledger's rows that paid them
 * for work on the organisation's issues, newest first, a page at a time. Amounts are whole Ziks.
 */

const timestamp = z.string().datetime({ offset: true });
const dateBound = z.union([timestamp, z.string().date()]);
const cursorSchema = z.object({ at: timestamp, id: z.string().min(1).max(191) });

/** A date-only `to` covers that whole UTC day. */
function endOf(to: string | undefined): string | undefined {
  return to?.length === 10 ? `${to}T23:59:59.999Z` : to;
}

export const earningEntriesQuerySchema = z.object({
  from: dateBound.optional(),
  to: dateBound.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(1024).optional(),
}).refine((q) => !q.from || !q.to || new Date(q.from) <= new Date(endOf(q.to)!), { message: "from must not be after to" });
export type EarningEntriesQuery = z.infer<typeof earningEntriesQuerySchema>;

export function decodeEarningCursor(raw: string) {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
  } catch {
    throw new Error("Invalid earnings cursor.");
  }
}

/** One page of a person's earnings in an organisation. Issues they can no longer see are left out of the row. */
export async function earningEntries(
  db: PrismaClient | Prisma.TransactionClient,
  scope: { organisationId: string; userId: string },
  query: EarningEntriesQuery,
) {
  const cursor = query.cursor ? decodeEarningCursor(query.cursor) : null;
  const to = endOf(query.to);
  const where: Prisma.CoinEntryWhereInput = {
    ...earningsWhere(scope.userId, { organisationId: scope.organisationId }),
    ...(query.from || to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
    ...(cursor ? { OR: [{ createdAt: { lt: new Date(cursor.at) } }, { createdAt: new Date(cursor.at), id: { lt: cursor.id } }] } : {}),
  };
  const rows = await db.coinEntry.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    select: {
      id: true, amount: true, payoutRole: true, agentId: true, createdAt: true,
      bug: { select: { id: true, number: true, title: true, isDeleted: true, project: { select: { slug: true, organisation: { select: { slug: true } } } } } },
    },
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      ziks: zikOf(row.amount),
      role: row.payoutRole,
      source: row.payoutRole ? PAYOUT_ROLE_LABELS[row.payoutRole] : "Earned",
      agentId: row.agentId,
      createdAt: row.createdAt.toISOString(),
      issue: row.bug && !row.bug.isDeleted ? { id: row.bug.id, number: row.bug.number, title: row.bug.title, path: issueHref(row.bug) } : null,
    })),
    nextCursor: rows.length > query.limit && last
      ? Buffer.from(JSON.stringify({ at: last.createdAt.toISOString(), id: last.id })).toString("base64url")
      : null,
  };
}
