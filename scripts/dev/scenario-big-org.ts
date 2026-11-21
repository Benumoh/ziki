/**
 * Local scenario: a large organisation, "Big Co" (slug `big`), with 12,000 issues across every status and 300 open
 * ideas, spread over the last 90 days. It is for working on how the Overview and lists perform at scale.
 *
 *   pnpm db:scenario:big-org
 *
 * Additive only: it never resets or reseeds. Its rows have fixed ids (`scn-big-*`), and a rerun deletes and recreates
 * just this organisation. It refuses to run against anything but a local database. The Demo login
 * (demo@fixtures.local, from `pnpm db:fixtures`) is made its owner, so it shows in the organisation switcher.
 */
import { PrismaClient, type Prisma, type Status, type Substatus } from "@prisma/client";

const P = "scn-big";
const ORGANISATION_ID = `${P}-organisation`;
const PROJECT_ID = `${P}-project`;
const ISSUES = 12_000;
const IDEAS = 300;
const DAY = 24 * 60 * 60 * 1000;

function assertLocalDatabase(url: string | undefined): void {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`Refusing to write a scenario to a non-local database (${host}).`);
  }
}

/** How the issues spread over the statuses, with the step each sits at. */
const MIX: Array<[Status, Substatus, number]> = [
  ["open", "open", 0.3],
  ["in_progress", "in_progress", 0.15],
  ["done", "requires_review", 0.12],
  ["merge", "ready_to_merge", 0.05],
  ["resolved", "on_prod", 0.33],
  ["closed", "closed", 0.05],
];

const WORDS = ["Login", "Export", "Search", "Billing", "Upload", "Profile", "Settings", "Dashboard", "Invite", "Report"];
const PROBLEMS = ["fails on Safari", "is slow with many rows", "loses the draft", "shows the wrong total", "ignores the filter", "breaks on mobile"];

async function main() {
  assertLocalDatabase(process.env.DATABASE_URL);
  const db = new PrismaClient();
  try {
    const owner = await db.user.findUnique({ where: { email: "demo@fixtures.local" }, select: { id: true } });
    if (!owner) throw new Error("Run `pnpm db:fixtures` first: the Demo login owns this organisation.");

    const existing = await db.organisation.findUnique({ where: { slug: "big" }, select: { id: true } });
    if (existing && existing.id !== ORGANISATION_ID) throw new Error('A "big" organisation exists that this scenario didn\'t make; not touching it.');
    if (existing) {
      await db.bug.deleteMany({ where: { organisationId: ORGANISATION_ID } });
      await db.idea.deleteMany({ where: { organisationId: ORGANISATION_ID } });
      await db.organisation.delete({ where: { id: ORGANISATION_ID } });
    }

    await db.organisation.create({ data: { id: ORGANISATION_ID, slug: "big", name: "Big Co", nextIssueNumber: 1, nextIdeaNumber: 1 } });
    await db.project.create({ data: { id: PROJECT_ID, organisationId: ORGANISATION_ID, slug: "big", name: "Big", workflow: { create: {} } } });
    await db.membership.create({ data: { organisationId: ORGANISATION_ID, userId: owner.id, role: "owner" } });

    const now = Date.now();
    const scoped = { organisationId: ORGANISATION_ID, projectId: PROJECT_ID, reporterId: owner.id, beneficiaryUserId: owner.id };
    const rows: Prisma.BugCreateManyInput[] = [];
    let at = 0;
    for (const [status, substatus, share] of MIX) {
      const count = Math.round(ISSUES * share);
      for (let i = 0; i < count; i += 1) {
        const n = at++;
        const updated = new Date(now - ((n * 7919) % (90 * DAY)));
        rows.push({
          ...scoped,
          id: `${P}-bug-${n}`,
          title: `${WORDS[n % WORDS.length]} ${PROBLEMS[n % PROBLEMS.length]} (${n})`,
          description: "Steps to reproduce, what happened and what should happen.",
          status,
          substatus,
          createdAt: new Date(updated.getTime() - DAY),
          updatedAt: updated,
        });
      }
    }
    for (let i = 0; i < rows.length; i += 1000) await db.bug.createMany({ data: rows.slice(i, i + 1000) });

    const ideas: Prisma.IdeaCreateManyInput[] = Array.from({ length: IDEAS }, (_, n) => ({
      ...scoped,
      id: `${P}-idea-${n}`,
      title: `${WORDS[n % WORDS.length]} could ${["remember", "suggest", "explain", "group"][n % 4]} more (${n})`,
      description: "An idea for the product.",
      status: "open",
      createdAt: new Date(now - ((n * 104729) % (60 * DAY))),
      updatedAt: new Date(now - ((n * 104729) % (60 * DAY))),
    }));
    await db.idea.createMany({ data: ideas });

    console.log(`[scenario] Big Co: ${rows.length} issues and ${ideas.length} ideas. Open /big/overview as demo@fixtures.local.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
