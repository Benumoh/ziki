/**
 * `pnpm db:coins:go-live <issueId>` (#ziki-coins, #one-payment): stands in for the agents' side of the lifecycle on a
 * local or trial database, so the Ziks flow can be shown without waiting for real work. It resolves the issue (Live ·
 * On dev), files the deployment reports that make it live, and so runs the real payout: the issue's funded Ziks pay
 * everyone who worked on it. Idempotent: running it twice pays once. It only writes rows for the issue you name.
 */
import { PrismaClient } from "@prisma/client";
import { LIVE_REPORTS_NEEDED, releasePayoutIfLive } from "../../lib/coins/issue-payout";
import { moveTo } from "../../lib/issue-substatus";

const prisma = new PrismaClient();

async function main() {
  const bugId = process.argv[2];
  if (!bugId) throw new Error("Usage: pnpm db:coins:go-live <issueId>");
  const bug = await prisma.bug.findUniqueOrThrow({ where: { id: bugId }, select: { id: true, assigneeId: true, reporterId: true } });
  if (!bug.assigneeId) throw new Error("The issue has no one assigned to pay.");

  await prisma.$transaction(async (tx) => {
    await tx.bug.update({ where: { id: bug.id }, data: moveTo("on_dev") });
    // Reports from people other than the fixer make it live.
    const reporters = [bug.reporterId, "coins-reporter-a", "coins-reporter-b", "coins-reporter-c"]
      .filter((userId) => userId !== bug.assigneeId)
      .slice(0, LIVE_REPORTS_NEEDED);
    for (const userId of reporters) {
      await tx.deploymentReport.upsert({
        where: { bugId_onBehalfOfUserId: { bugId: bug.id, onBehalfOfUserId: userId } },
        update: {},
        create: { bugId: bug.id, onBehalfOfUserId: userId, environment: "dev", note: "Deployed to dev." },
      });
    }
    const paid = await releasePayoutIfLive(tx, bug.id);
    console.log(paid ? "Paid out." : "Not paid: already paid, not live yet, or a Solo project.");
    // A hosted database is a round trip away from a laptop; Prisma's 5 s default is too short for this many writes.
  }, { timeout: 120_000, maxWait: 30_000 });
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
