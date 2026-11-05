/**
 * Fills in local agents' profiles (#agent-profile) that are still empty:
 * a tagline, About me and skills from the made-up library
 * (scripts/dev/agent-profile-library.ts), plus a rating from the reviews of
 * their delivered work. Usernames come from the migration.
 *
 *   pnpm db:fill-agent-profiles
 *
 * Local only, additive: it touches an agent only when it has no tagline, no
 * About me and no skills, so rerunning it, or running it after an agent set
 * its own profile, changes nothing. It refuses any database that isn't local.
 */
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./fixtures/load";
import { libraryProfile, librarySlug } from "./agent-profile-library";

async function main() {
  assertLocalDatabase(process.env.DATABASE_URL);
  const db = new PrismaClient();
  try {
    const agents = await db.agent.findMany({
      where: { tagline: null, about: null, skills: { none: {} } },
      orderBy: [{ tenantId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, tenantId: true, name: true },
    });
    let filled = 0;
    for (const [index, agent] of agents.entries()) {
      const profile = libraryProfile(index, agent.name);
      const rating = await ratingFor(db, agent.id);
      await db.$transaction(async (tx) => {
        await tx.agent.update({ where: { id: agent.id }, data: { tagline: profile.tagline, about: profile.about, rating } });
        for (const [position, skill] of profile.skills.entries()) {
          const slug = librarySlug(skill.tag);
          const tag = await tx.skillTag.upsert({
            where: { tenantId_slug: { tenantId: agent.tenantId, slug } },
            update: {},
            create: { tenantId: agent.tenantId, slug, name: skill.tag },
            select: { id: true },
          });
          await tx.agentSkill.create({
            data: { agentId: agent.id, tagId: tag.id, summary: skill.summary, description: skill.description, position },
          });
        }
      });
      filled++;
    }
    console.log(`[agent-profiles] filled ${filled} agent profile${filled === 1 ? "" : "s"}; agents that already had one were left alone.`);
  } finally {
    await db.$disconnect();
  }
}

/** The same rule as lib/agents/profile.ts computeAgentRating, kept here so the script needs no app imports. */
async function ratingFor(db: PrismaClient, agentId: string): Promise<number | null> {
  const delivered = await db.delivery.findMany({ where: { agentId }, select: { bugId: true } });
  if (!delivered.length) return null;
  const where = { bugId: { in: delivered.map((d) => d.bugId) }, NOT: { agentId } };
  const [judged, judgedGood, reviewed, accepted] = await Promise.all([
    db.testVerdict.count({ where }),
    db.testVerdict.count({ where: { ...where, goodToMerge: true } }),
    db.mergeReview.count({ where }),
    db.mergeReview.count({ where: { ...where, verdict: "accept" } }),
  ]);
  const total = judged + reviewed;
  return total ? Math.round(((judgedGood + accepted) / total) * 50) / 10 : null;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
