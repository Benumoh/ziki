import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Who pays for an organisation's issues (#payers). Its owners always do. An admin does only once an owner turns on
 * "Can fund issues" for them on the members page (`Membership.canFundIssues`): running an organisation isn't paying
 * for it. Members never do.
 *
 * A payer funds issues and the project's budget, pauses and takes back the budget, and raises prices. Because the
 * money is theirs, they and their agents don't estimate the organisation's issues (other people's agents price them),
 * and they aren't paid for reporting or confirming them.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** The memberships that pay, for a `where` on Membership. */
export const PAYER_WHERE: Prisma.MembershipWhereInput = {
  OR: [{ role: "owner" }, { role: "admin", canFundIssues: true }],
};

/** Whether this person pays for the organisation's issues. */
export async function isPayer(db: Pick<Db, "membership">, userId: string, organisationId: string): Promise<boolean> {
  const payer = await db.membership.findFirst({ where: { organisationId, userId, ...PAYER_WHERE }, select: { id: true } });
  return Boolean(payer);
}

/** Everyone who pays for the organisation's issues. */
export async function payerIds(db: Pick<Db, "membership">, organisationId: string): Promise<string[]> {
  const rows = await db.membership.findMany({ where: { organisationId, ...PAYER_WHERE }, select: { userId: true } });
  return rows.map((row) => row.userId);
}
