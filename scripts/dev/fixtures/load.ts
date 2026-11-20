/**
 * Loads the local Ziki fixtures (local-ziki.json, made by generate.ts) into
 * the local database: a "Demo" organisation with 220 issues over every status and
 * substatus, 250 ideas, and their confirmations, bids, votes, claims,
 * deliveries, judgements, merge reviews, pull request reports, comments,
 * importance marks and history. Marketing ideas and issues come on top, in every
 * marketing state, with their task types.
 *
 *   pnpm db:fixtures   (scripts/dev/fixtures/run.ts)
 *
 * Sign in as demo@fixtures.local with the password ziki-demo-password (the
 * organisation owner). `pnpm db:fixtures` also makes every other local account a
 * member of the Demo organisation, so you can browse it as yourself.
 *
 * It also loads "Fresh Start" (fresh.ts), an empty organisation as it is right
 * after signing up: sign in as fresh@fixtures.local, same password.
 * The Demo owner also gets Demo Work and Demo Live (work-organisations.ts), to
 * see the Your Work and Live stages.
 *
 * Additive only (AGENTS.md: never reseed): it touches nothing outside its own
 * organisation (slug `demo`, ids `fx-*`) and its own users (`*@fixtures.local`).
 * A rerun deletes and recreates that organisation, so the data is always as
 * checked in. It refuses any database that isn't local. The CLI scenarios
 * (cli/tests/global-setup.ts) and the end-to-end seed (e2e/seed.ts) load it on
 * every run.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { FRESH_LOGIN_EMAIL, loadFreshOrganisation } from "./fresh";
import { loadWorkOrganisations } from "./work-organisations";

type Row = Record<string, unknown>;
type Fixtures = {
  organisation: { slug: string; name: string };
  project: { slug: string; name: string; repoUrl: string };
  brief: { product: string; audience: string; website: string; currentFocus: string; outOfScope: string };
  login: { email: string; password: string };
} & Record<string, Row[]>;

const ORGANISATION_ID = "fx-organisation";
const PROJECT_ID = "fx-project";
/** Dates are stored as minutes before the load, so the data always looks recent. */
const DATE_FIELDS = ["convertedAt", "rejectedAt", "archivedAt", "closedAt", "awardedAt", "offeredAt", "claimedAt", "lastHeartbeatAt", "deliverBy", "releasedAt", "updatedAt", "submittedAt", "decidedAt", "reviewBy"];

export function assertLocalDatabase(url: string | undefined): void {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`Refusing to load fixtures into a non-local database (${host}).`);
  }
}

function readFixtures(): Fixtures {
  // Every runner (tsx, Vitest, the e2e seed) starts in the repository root.
  return JSON.parse(readFileSync(path.join(process.cwd(), "scripts", "dev", "fixtures", "local-ziki.json"), "utf8")) as Fixtures;
}

/** Turns the fixture's relative times into dates, and drops the helper fields. */
function dated(row: Row, now: number, extra: Row = {}): Row {
  const out: Row = { ...extra };
  const at = (minutes: number) => new Date(now - minutes * 60_000);
  for (const [key, value] of Object.entries(row)) {
    if (key === "ago") continue;
    if (DATE_FIELDS.includes(key) && typeof value === "number") out[key] = at(value);
    else if (key === "withdrawnAt" && value === true) out[key] = at(Math.max(1, Number(row.ago) - 60));
    else out[key] = value;
  }
  if (typeof row.ago === "number") out.createdAt = at(row.ago);
  return out;
}

export async function loadFixtures(options: { db?: PrismaClient; addExistingUsers?: boolean; quiet?: boolean } = {}): Promise<{ issues: number; ideas: number }> {
  assertLocalDatabase(process.env.DATABASE_URL);
  const db = options.db ?? new PrismaClient();
  const fx = readFixtures();
  const now = Date.now();
  try {
    // Replace only this organisation. Issues and ideas restrict deleting it; everything else cascades.
    const existing = await db.organisation.findUnique({ where: { slug: fx.organisation.slug }, select: { id: true } });
    if (existing && existing.id !== ORGANISATION_ID) throw new Error(`A "${fx.organisation.slug}" organisation exists that the fixtures didn't make; not touching it.`);
    if (existing) {
      await db.bug.deleteMany({ where: { organisationId: ORGANISATION_ID } });
      await db.idea.deleteMany({ where: { organisationId: ORGANISATION_ID } });
      await db.organisation.delete({ where: { id: ORGANISATION_ID } });
    }
    // #user-agents: agents are their owners', so deleting the organisation leaves them; replace the fixtures' own.
    await db.agent.deleteMany({ where: { id: { in: fx.agents.map((a) => String(a.id)) } } });

    const passwordHash = await bcrypt.hash(fx.login.password, 10);
    for (const user of fx.users) {
      const email = String(user.email);
      const isLogin = email === fx.login.email;
      await db.user.upsert({
        where: { email },
        update: { name: String(user.name), ...(isLogin ? { passwordHash } : {}) },
        create: { id: String(user.id), email, name: String(user.name), emailVerified: new Date(now), emailNotifications: false, ...(isLogin ? { passwordHash } : {}) },
      });
    }
    // A user that already existed keeps its own id; map the fixture ids onto it.
    const ids = new Map<string, string>();
    for (const user of fx.users) {
      const found = await db.user.findUniqueOrThrow({ where: { email: String(user.email) }, select: { id: true } });
      ids.set(String(user.id), found.id);
    }
    const u = (value: unknown) => (typeof value === "string" && ids.has(value) ? ids.get(value)! : value);
    const withUsers = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, u(v)]));

    await db.organisation.create({
      // A trigger numbers issues and ideas from these counters, in insert order,
      // so they start at 1 and the rows go in in number order.
      data: { id: ORGANISATION_ID, slug: fx.organisation.slug, name: fx.organisation.name, description: "Local fixtures: issues in every state, from scripts/dev/fixtures.", nextIssueNumber: 1, nextIdeaNumber: 1 },
    });
    await db.project.create({ data: { id: PROJECT_ID, organisationId: ORGANISATION_ID, slug: fx.project.slug, name: fx.project.name, repoUrl: fx.project.repoUrl, workflow: { create: {} }, brief: { create: fx.brief } } });
    await db.projectArea.createMany({ data: fx.areas.map((a) => ({ id: String(a.id), projectId: PROJECT_ID, name: String(a.name), slug: String(a.id).replace(/^fx-area-/, "") })) });
    await db.membership.createMany({ data: fx.memberships.map((m) => withUsers({ ...m, organisationId: ORGANISATION_ID })) as never });
    // Each fixture agent works in the Demo organisation, with its class there.
    await db.agent.createMany({ data: fx.agents.map(({ level: _level, ...a }) => withUsers({ ...a, createdAt: new Date(now - 60 * 24 * 60_000) })) as never });
    await db.agentActivation.createMany({
      data: fx.agents.map((a) => ({ agentId: String(a.id), organisationId: ORGANISATION_ID, level: (a.level ?? "working") as never, activatedAt: new Date(now - 60 * 24 * 60_000) })),
    });

    await db.issueType.createMany({ data: fx.issueTypes.map((t) => ({ ...t, organisationId: ORGANISATION_ID })) as never });
    // Marketing's assets (#marketing-assets), before the issues and ideas that sit on them.
    await db.marketingAsset.createMany({ data: (fx.marketingAssets ?? []).map((a) => ({ ...a, organisationId: ORGANISATION_ID })) as never });

    const scoped = { organisationId: ORGANISATION_ID, projectId: PROJECT_ID };
    // Issues first (ideas point at them), without links to other issues until every issue exists.
    const bugs = [...fx.bugs].sort((a, b) => Number(a.number) - Number(b.number)).map((b) => withUsers(dated(b, now, scoped)));
    await db.bug.createMany({ data: bugs.map((b) => ({ ...b, duplicateOfId: null, linkedIssueId: null })) as never });
    for (const b of bugs.filter((x) => x.duplicateOfId)) await db.bug.update({ where: { id: String(b.id) }, data: { duplicateOfId: String(b.duplicateOfId) } });
    for (const b of bugs.filter((x) => x.linkedIssueId)) await db.bug.update({ where: { id: String(b.id) }, data: { linkedIssueId: String(b.linkedIssueId) } });
    await db.idea.createMany({ data: [...fx.ideas].sort((a, b) => Number(a.number) - Number(b.number)).map((i) => withUsers(dated(i, now, scoped))) as never });

    const table = async (name: string, rows: Row[]) => {
      if (!rows.length) return;
      await (db as unknown as Record<string, { createMany(args: { data: Row[] }): Promise<unknown> }>)[name].createMany({ data: rows.map((r) => withUsers(dated(r, now))) });
    };
    await table("ideaVerdict", fx.ideaVerdicts);
    await table("issueConfirmation", fx.confirmations);
    // Claims before bids (a bid names the claim it was awarded with).
    await table("issueClaim", fx.claims);
    // #plan-review: a complex issue's plan names its claim.
    await table("plan", fx.plans ?? []);
    await table("issueBid", fx.bids);
    await table("bidVote", fx.bidVotes);
    await table("delivery", fx.deliveries);
    await table("testVerdict", fx.testVerdicts);
    await table("mergeReview", fx.mergeReviews);
    await table("pullRequestReport", fx.pullRequestReports);
    // Replies after the comments they answer.
    await table("comment", fx.comments.filter((c) => !c.parentId));
    await table("comment", fx.comments.filter((c) => c.parentId));
    await table("vote", fx.votes);
    await table("bugActivity", fx.activities);
    // Agent profiles: the organisation's shared skill tags, then each agent's skills.
    await table("skillTag", (fx.skillTags ?? []).map((t) => ({ ...t, organisationId: ORGANISATION_ID })));
    await table("agentSkill", fx.agentSkills ?? []);
    // The agents' audit log, which their pages' Activity reads.
    await table("agentAuditEvent", (fx.auditEvents ?? []).map((e) => ({ ...e, organisationId: ORGANISATION_ID })));

    // A second, empty organisation: an account as it is right after signing up (fresh.ts).
    await loadFreshOrganisation(db, passwordHash);
    // Two more of the Demo owner's organisations: one with assigned work, one with work and live issues (work-organisations.ts).
    await loadWorkOrganisations(db, ids.get("fx-user-demo")!, now);

    if (options.addExistingUsers) {
      const others = await db.user.findMany({ where: { NOT: { email: { endsWith: "@fixtures.local" } } }, select: { id: true } });
      await db.membership.createMany({ data: others.map((o) => ({ organisationId: ORGANISATION_ID, userId: o.id, role: "member" as const })), skipDuplicates: true });
    }
    if (!options.quiet) {
      console.log(`[fixtures] loaded the Demo organisation: ${fx.bugs.length} issues, ${fx.ideas.length} ideas. Sign in as ${fx.login.email} / ${fx.login.password}. Fresh Start (empty, just signed up): ${FRESH_LOGIN_EMAIL}, same password.`);
    }
    return { issues: fx.bugs.length, ideas: fx.ideas.length };
  } finally {
    if (!options.db) await db.$disconnect();
  }
}
