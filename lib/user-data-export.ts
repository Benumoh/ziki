import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export type UserExportData = {
  user: {
    id: string;
    name: string;
    email: string;
    createdAt: Date;
    walletAddress?: string | null;
  };
  exportedAt: string;
  issues: Array<{
    id: string;
    number: number;
    title: string;
    description: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    organisationId: string;
    projectId: string;
  }>;
  comments: Array<{
    id: string;
    bugId: string;
    body: string;
    createdAt: Date;
    editedAt: Date | null;
    deletedAt: Date | null;
  }>;
  votes: Array<{
    id: string;
    bugId: string;
    value: number;
    createdAt: Date;
  }>;
  points: Array<{
    id: string;
    organisationId: string;
    bugId: string | null;
    role: string;
    points: number;
    sourceKey: string;
    correctedAt: Date | null;
    createdAt: Date;
  }>;
  /** Their Ziks: every ledger row in their name (#one-payment), earnings included. */
  ziks: Array<{
    id: string;
    account: string;
    kind: string;
    payoutRole: string | null;
    amount: number;
    bugId: string | null;
    createdAt: Date;
  }>;
};

/**
 * Exports a user's personal data (#571):
 * - Authored issues (what they filed)
 * - Comments authored by them
 * - Votes cast
 * - Points earned before Ziks were the only payment
 * - Their Ziks ledger rows: earnings, purchases, spending and withdrawals
 */
export async function exportUserData(
  db: Db,
  userId: string,
): Promise<UserExportData> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      walletAddress: true,
    },
  });

  if (!user) {
    throw new Error(`User with ID "${userId}" not found.`);
  }

  const [issues, comments, votes, points, ziks] = await Promise.all([
    db.bug.findMany({
      where: { reporterId: userId },
      select: {
        id: true,
        number: true,
        title: true,
        description: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        organisationId: true,
        projectId: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.comment.findMany({
      where: { authorId: userId },
      select: {
        id: true,
        bugId: true,
        body: true,
        createdAt: true,
        editedAt: true,
        deletedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.vote.findMany({
      where: { userId },
      select: {
        id: true,
        bugId: true,
        value: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.pointEntry.findMany({
      where: { userId },
      select: {
        id: true,
        organisationId: true,
        bugId: true,
        role: true,
        points: true,
        sourceKey: true,
        correctedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.coinEntry.findMany({
      where: { userId },
      select: { id: true, account: true, kind: true, payoutRole: true, amount: true, bugId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      walletAddress: user.walletAddress,
    },
    exportedAt: new Date().toISOString(),
    issues,
    comments,
    votes,
    points: points.map((row) => ({ ...row, points: Number(row.points) })),
    ziks: ziks.map((row) => ({ ...row, amount: Number(row.amount) })),
  };
}
