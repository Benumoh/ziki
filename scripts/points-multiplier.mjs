/**
 * Sets a workspace's points multiplier and brings its existing balances up to it (#points-multiplier).
 *
 *   node scripts/points-multiplier.mjs <workspace-slug> <factor>            # dry run
 *   node scripts/points-multiplier.mjs <workspace-slug> <factor> --apply    # does it
 *
 * Plain JavaScript, so it runs inside the production container (`node` and the
 * app's own @prisma/client are all it needs). Locally: add `--env-file=.env`
 * after `node`.
 *
 * From then on every award the workspace writes is multiplied by <factor>
 * (lib/points/award.ts). This script adds the same to what is already in the
 * ledger: for each person, agent, role and issue it writes one adjustment
 * entry of (factor / old multiplier - 1) times what that group holds, so every
 * balance ends up at <factor> times what it was. History is never edited. It all
 * happens in one transaction, and if any adjustment is not written the whole
 * run is rolled back, so the multiplier is never set without the balances.
 * Running it again with the same factor does nothing (the multiplier is already
 * that), and changing it back and forth works: every run has its own keys.
 * Held payouts are not touched: they are stored as the base amount and are
 * multiplied when they are paid.
 *
 * It takes the workspace's row lock while it writes, but awards in flight read
 * the multiplier without it, so run it when the workspace is quiet.
 */
import prisma from "@prisma/client";
import { databaseHost, migrationDatabaseUrl } from "./migration-database-url.mjs";

const { PrismaClient } = prisma;
const CHUNK = 1000;
/** Makes this run's adjustment keys its own, so an earlier run's never stand in for them. */
const RUN = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
/** The ledger keeps four decimal places (lib/points/rules.ts, POINT_DECIMALS). */
const DECIMALS = 10 ** 4;

const round = (value) => (Number.isFinite(value) ? Math.round(value * DECIMALS) / DECIMALS : 0);
const number = (value) => round(value == null ? 0 : Number(value));

function args() {
  const [slug, rawFactor, ...flags] = process.argv.slice(2);
  const factor = Number(rawFactor);
  if (!slug || !Number.isFinite(factor) || factor <= 0 || factor > 1000) {
    throw new Error("Usage: node scripts/points-multiplier.mjs <workspace-slug> <factor, above 0 and at most 1000> [--apply]");
  }
  return { slug, factor, apply: flags.includes("--apply") };
}

/** One adjustment per person, agent, role and issue or idea that holds points in the workspace. */
async function adjustments(db, tenant, from, to) {
  const groups = await db.pointEntry.groupBy({
    by: ["userId", "agentId", "role", "bugId", "ideaId"],
    where: { tenantId: tenant.id },
    _sum: { points: true },
  });
  const ratio = to / from;
  let before = 0;
  const rows = [];
  for (const group of groups) {
    const held = number(group._sum.points);
    before += held;
    const extra = round(held * (ratio - 1));
    if (extra === 0) continue;
    rows.push({
      tenantId: tenant.id,
      userId: group.userId,
      agentId: group.agentId,
      role: group.role,
      bugId: group.bugId,
      ideaId: group.ideaId,
      points: extra,
      sourceKey: `multiplier:${tenant.id}:${from}->${to}:${RUN}:${group.userId}:${group.agentId ?? "-"}:${group.role}:${group.bugId ?? "-"}:${group.ideaId ?? "-"}`,
    });
  }
  return { rows, before: round(before), groups: groups.length };
}

async function main() {
  const { slug, factor, apply } = args();
  // A direct connection, as the container's migration step uses: the row lock below needs one session.
  const url = migrationDatabaseUrl(process.env.DATABASE_URL, process.env.DIRECT_URL);
  if (!url) throw new Error("DATABASE_URL is not set.");
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    console.log(`Database: ${databaseHost(url)}`);
    const tenant = await db.tenant.findUnique({ where: { slug }, select: { id: true, name: true, pointsMultiplier: true } });
    if (!tenant) throw new Error(`No workspace with the slug "${slug}".`);
    const current = Number(tenant.pointsMultiplier);
    if (current === factor) {
      console.log(`${tenant.name} already multiplies by ${factor}. Nothing to do.`);
      return;
    }

    const plan = await adjustments(db, tenant, current, factor);
    const added = round(plan.rows.reduce((sum, row) => sum + row.points, 0));
    console.log(`${tenant.name} (${slug}): multiplier ${current} -> ${factor}`);
    console.log(`  ${plan.groups} balance groups, ${plan.rows.length} adjustments, total ${plan.before} -> ${round(plan.before + added)}`);
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
        if (written !== fresh.rows.length) {
          throw new Error(`Only ${written} of ${fresh.rows.length} adjustments were written. Nothing was changed.`);
        }
        await tx.tenant.update({ where: { id: tenant.id }, data: { pointsMultiplier: factor } });
        const after = await tx.pointEntry.aggregate({ where: { tenantId: tenant.id }, _sum: { points: true } });
        return { written, before: fresh.before, after: number(after._sum.points) };
      },
      { timeout: 10 * 60 * 1000, maxWait: 60 * 1000 },
    );
    const expected = round(result.before * (factor / current));
    console.log(`Done: ${result.written} adjustments written, multiplier now ${factor}.`);
    console.log(`  total ${result.before} -> ${result.after} (expected ${expected}, difference ${round(result.after - expected)} from rounding)`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
