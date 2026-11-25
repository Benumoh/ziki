import { PrismaClient } from "@prisma/client";

const P = "scn-br";
const DEMO_ISSUE_ID = "fx-bug-76";

function assertLocalDatabase(url: string | undefined): void {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`Refusing to write a scenario to a non-local database (${host}).`);
  }
}

async function main() {
  assertLocalDatabase(process.env.DATABASE_URL);
  const db = new PrismaClient();
  try {
    const issue = await db.bug.findUnique({
      where: { id: DEMO_ISSUE_ID },
      select: { id: true, organisationId: true, project: { select: { slug: true, organisation: { select: { slug: true } } } } },
    });
    if (!issue) throw new Error("No Demo issue #76. Run `pnpm db:fixtures` first.");
    const amara = await db.agent.findUnique({ where: { id: "fx-agent-amara-w" }, select: { id: true, ownerUserId: true } });
    const amaraReviewer = await db.agent.findUnique({ where: { id: "fx-agent-amara-m" }, select: { id: true } });
    const dara = await db.agent.findUnique({ where: { id: "fx-agent-dara-w" }, select: { id: true, ownerUserId: true } });
    if (!amara || !amaraReviewer || !dara) throw new Error("No Demo bidder agents. Run `pnpm db:fixtures` first.");

    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const at = (days: number) => new Date(now - days * day);

    await db.issueClaim.deleteMany({ where: { id: { startsWith: `${P}-` } } });

    const finished = [
      ["fx-bug-2", amara.id, amara.ownerUserId, 1],
      ["fx-bug-3", amara.id, amara.ownerUserId, 2],
      ["fx-bug-4", amaraReviewer.id, amara.ownerUserId, 3],
      ["fx-bug-7", amara.id, amara.ownerUserId, 4],
      ["fx-bug-5", amara.id, amara.ownerUserId, 5],
      ["fx-bug-6", amaraReviewer.id, amara.ownerUserId, 6],
      ["fx-bug-8", amara.id, amara.ownerUserId, 7],
      ["fx-bug-10", amaraReviewer.id, amara.ownerUserId, 8],
      ["fx-bug-11", amara.id, amara.ownerUserId, 9],
      ["fx-bug-13", dara.id, dara.ownerUserId, 1],
      ["fx-bug-14", dara.id, dara.ownerUserId, 2],
    ] as const;
    // Finished: claims that ended with the work resolved (Live).
    await db.issueClaim.createMany({
      data: finished.map(([bugId, agentId, userId, daysAgo]) => ({
        id: `${P}-finished-${bugId}`,
        bugId,
        beneficiaryUserId: userId,
        agentId,
        status: "released" as const,
        claimedAt: at(daysAgo + 2),
        releasedAt: at(daysAgo),
        releaseReason: "resolved",
        createdAt: at(daysAgo + 3),
      })),
    });
    await db.issueClaim.create({
      data: {
        id: `${P}-claim-1`,
        bugId: "fx-bug-12",
        beneficiaryUserId: amara.ownerUserId,
        agentId: amara.id,
        status: "released",
        claimedAt: at(4),
        releasedAt: at(1),
        releaseReason: "silence",
        createdAt: at(5),
      },
    });

    console.log(`Open /${issue.project.organisation.slug}/${issue.project.slug}/76 as demo@fixtures.local.`);
    console.log("Amara has 9 finished and 1 dropped; Dara has 2 finished and is new here.");
  } finally {
    await db.$disconnect();
  }
}

main();
