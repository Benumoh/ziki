/**
 * Local scenario (#earnings-in-ziks): Felix Fixer of `pnpm db:coins:accounts` has earned money on the points ledger,
 * so his earnings can be seen moving into his Ziks wallet: $45.37 from solving and reviewing in the Coins workspace,
 * and a $2 correction, $43.37 in all, which is 433 Ziks (the 0.7 waits until it adds up). That is past the 300-Zik
 * withdraw minimum, so Withdraw shows in his menu and opens.
 *
 *   pnpm db:coins:accounts            # once, for the accounts
 *   pnpm db:scenario:earnings-in-ziks
 *
 * Additive only: it never resets or reseeds. Its rows have fixed source keys (`scn-eiz:*`), so a rerun adds nothing.
 * The wallet isn't touched here: opening the Ziks or Withdraw page (or the cron sweep) moves the earnings in, as it
 * will in production. It refuses to run against anything but a local database.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const FIXER_EMAIL = "fixer@ziki-coins.test";

function assertLocalDatabase(url: string | undefined): void {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`Refusing to write a scenario to a non-local database (${host}).`);
  }
}

const ENTRIES = [
  { key: "solver-1", role: "solver" as const, points: 28.5 },
  { key: "solver-2", role: "solver" as const, points: 12.37 },
  { key: "reviewer-1", role: "reviewer" as const, points: 4.5 },
  { key: "correction-1", role: "solver" as const, points: -2 },
];

async function main() {
  assertLocalDatabase(process.env.DATABASE_URL);
  const [fixer, organisation] = await Promise.all([
    prisma.user.findUnique({ where: { email: FIXER_EMAIL }, select: { id: true } }),
    prisma.organisation.findUnique({ where: { slug: "coins-demo" }, select: { id: true } }),
  ]);
  if (!fixer || !organisation) throw new Error("Run `pnpm db:coins:accounts` first: Felix Fixer and the Coins workspace are missing.");

  const { count } = await prisma.pointEntry.createMany({
    data: ENTRIES.map((entry) => ({ organisationId: organisation.id, userId: fixer.id, bugId: null, role: entry.role, points: entry.points, sourceKey: `scn-eiz:${entry.key}` })),
    skipDuplicates: true,
  });
  const total = await prisma.pointEntry.aggregate({ where: { userId: fixer.id }, _sum: { points: true } });

  console.log(`\nEarnings in Ziks: ${count} new points entries for ${FIXER_EMAIL}.`);
  console.log(`  points ledger total: $${Number(total._sum.points ?? 0).toFixed(2)}`);
  console.log("  sign in as Felix (password ziki-coins-2026) and open /coins/payouts to see them in Ziks.\n");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
