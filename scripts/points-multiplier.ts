/**
 * Sets a workspace's points multiplier and brings its existing balances up to it (#points-multiplier).
 *
 *   pnpm tsx --env-file=.env scripts/points-multiplier.ts <workspace-slug> <factor>            # dry run
 *   pnpm tsx --env-file=.env scripts/points-multiplier.ts <workspace-slug> <factor> --apply    # does it
 *
 * From then on every award the workspace writes is multiplied by <factor>
 * (lib/points/award.ts). This script adds the same to what is already in the
 * ledger: for each person, agent, role and issue it writes one adjustment
 * entry of (factor / old multiplier - 1) times what that group holds, so every
 * balance ends up at <factor> times what it was. History is never edited, and
 * each adjustment has a fixed `sourceKey`, so running it again changes nothing.
 * Held payouts are not touched: they are stored as the base amount and are
 * multiplied when they are paid.
 *
 * It takes the workspace's row lock while it writes, but awards in flight read
 * the multiplier without it, so run it when the workspace is quiet.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { pointsNumber, roundPoints } from "../lib/points/rules";

const CHUNK = 1000;

function arg(): { slug: string; factor: number; apply: boolean } {
  const [slug, rawFactor, ...flags] = process.argv.slice(2);
  const factor = Number(rawFactor);
  if (!slug || !Number.isFinite(factor) || factor <= 0 || factor > 1000) {
    throw new Error("Usage: points-multiplier.ts <workspace-slug> <factor, above 0 and at most 1000> [--apply]");
  }
  return { slug, factor, apply: flags.includes("--apply") };
}

type Db = PrismaClient | Prisma.TransactionClient;

/** One adjustment per person, agent, role and issue or idea that holds points in the workspace. */
async function adjustments(db: Db, tenant: { id: string }, from: number, to: number) {
  const groups = await db.pointEntry.groupBy({
    by: ["userId", "agentId", "role", "bugId", "ideaId"],
    where: { tenantId: tenant.id },
    _sum: { points: true },
  });
  const ratio = to / from;
  let before = 0;
  const rows: Prisma.PointEntryCreateManyInput[] = [];
  for (const group of groups) {
    const held = pointsNumber(group._sum.points ?? 0);
    before += held;
    const extra = roundPoints(held * (ratio - 1));
    if (extra === 0) continue;
    rows.push({
      tenantId: tenant.id,
      userId: group.userId,
      agentId: group.agentId,
      role: group.role,
      bugId: group.bugId,
      ideaId: group.ideaId,
      points: extra,
      sourceKey: `multiplier:${tenant.id}:${from}->${to}:${group.userId}:${group.agentId ?? "-"}:${group.role}:${group.bugId ?? "-"}:${group.ideaId ?? "-"}`,
    });
  }
  return { rows, before: roundPoints(before), groups: groups.length };
}

async function main() {
  const { slug, factor, apply } = arg();
  const db = new PrismaClient();
  try {
    const tenant = await db.tenant.findUnique({ where: { slug }, select: { id: true, name: true, pointsMultiplier: true } });
    if (!tenant) throw new Error(`No workspace with the slug "${slug}".`);
    const current = Number(tenant.pointsMultiplier);
    if (current === factor) {
      console.log(`${tenant.name} already multiplies by ${factor}. Nothing to do.`);
      return;
    }

    const plan = await adjustments(db, tenant, current, factor);
    const added = roundPoints(plan.rows.reduce((sum, row) => sum + Number(row.points), 0));
    console.log(`${tenant.name} (${slug}): multiplier ${current} -> ${factor}`);
    console.log(`  ${plan.groups} balance groups, ${plan.rows.length} adjustments, total ${plan.before} -> ${roundPoints(plan.before + added)}`);
    if (!apply) {
      console.log("Dry run: nothing written. Add --apply to do it.");
      return;
    }

    const result = await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${tenant.id} FOR UPDATE`;
        const fresh = await adjustments(tx, tenant, current, factor);
        let written = 0;
        for (let start = 0; start < fresh.rows.length; start += CHUNK) {
          const { count } = await tx.pointEntry.createMany({ data: fresh.rows.slice(start, start + CHUNK), skipDuplicates: true });
          written += count;
        }
        await tx.tenant.update({ where: { id: tenant.id }, data: { pointsMultiplier: factor } });
        const after = await tx.pointEntry.aggregate({ where: { tenantId: tenant.id }, _sum: { points: true } });
        return { written, before: fresh.before, after: pointsNumber(after._sum.points ?? 0) };
      },
      { timeout: 10 * 60 * 1000, maxWait: 60 * 1000 },
    );
    const expected = roundPoints(result.before * (factor / current));
    console.log(`Done: ${result.written} adjustments written, multiplier now ${factor}.`);
    console.log(`  total ${result.before} -> ${result.after} (expected ${expected}, difference ${roundPoints(result.after - expected)} from rounding)`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
