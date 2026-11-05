/**
 * Loads the local Ziki fixtures (local-ziki.json, made by generate.ts) into
 * the local database: a "Demo" workspace with 220 issues over every status and
 * substatus, 250 ideas, and their confirmations, bids, votes, claims,
 * deliveries, judgements, merge reviews, pull request reports, comments,
 * importance marks and history.
 *
 *   pnpm db:fixtures   (scripts/dev/fixtures/run.ts)
 *
 * Sign in as demo@fixtures.local with the password ziki-demo-password (the
 * workspace owner). `pnpm db:fixtures` also makes every other local account a
 * member of the Demo workspace, so you can browse it as yourself.
 *
 * Additive only (AGENTS.md: never reseed): it touches nothing outside its own
 * workspace (slug `demo`, ids `fx-*`) and its own users (`*@fixtures.local`).
 * A rerun deletes and recreates that workspace, so the data is always as
 * checked in. It refuses any database that isn't local. The CLI scenarios
 * (cli/tests/global-setup.ts) and the end-to-end seed (e2e/seed.ts) load it on
 * every run.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

type Row = Record<string, unknown>;
type Fixtures = {
  tenant: { slug: string; name: string };
  project: { slug: string; name: string; repoUrl: string };
  login: { email: string; password: string };
} & Record<string, Row[]>;

const TENANT_ID = "fx-tenant";
const PROJECT_ID = "fx-project";
/** Dates are stored as minutes before the load, so the data always looks recent. */
const DATE_FIELDS = ["convertedAt", "rejectedAt", "archivedAt", "closedAt", "awardedAt", "offeredAt", "claimedAt", "lastHeartbeatAt", "deliverBy", "releasedAt"];

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
    // Replace only this workspace. Issues and ideas restrict deleting it; everything else cascades.
    const existing = await db.tenant.findUnique({ where: { slug: fx.tenant.slug }, select: { id: true } });
    if (existing && existing.id !== TENANT_ID) throw new Error(`A "${fx.tenant.slug}" workspace exists that the fixtures didn't make; not touching it.`);
    if (existing) {
      await db.bug.deleteMany({ where: { tenantId: TENANT_ID } });
      await db.idea.deleteMany({ where: { tenantId: TENANT_ID } });
      await db.tenant.delete({ where: { id: TENANT_ID } });
    }

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

    await db.tenant.create({
      // A trigger numbers issues and ideas from these counters, in insert order,
      // so they start at 1 and the rows go in in number order.
      data: { id: TENANT_ID, slug: fx.tenant.slug, name: fx.tenant.name, description: "Local fixtures: issues in every state, from scripts/dev/fixtures.", nextIssueNumber: 1, nextIdeaNumber: 1 },
    });
    await db.project.create({ data: { id: PROJECT_ID, tenantId: TENANT_ID, slug: fx.project.slug, name: fx.project.name, repoUrl: fx.project.repoUrl, workflow: { create: {} } } });
    await db.projectArea.createMany({ data: fx.areas.map((a) => ({ id: String(a.id), projectId: PROJECT_ID, name: String(a.name), slug: String(a.id).replace(/^fx-area-/, "") })) });
    await db.membership.createMany({ data: fx.memberships.map((m) => withUsers({ ...m, tenantId: TENANT_ID })) as never });
    await db.agent.createMany({ data: fx.agents.map((a) => withUsers({ ...a, tenantId: TENANT_ID, createdAt: new Date(now - 60 * 24 * 60_000) })) as never });

    const scoped = { tenantId: TENANT_ID, projectId: PROJECT_ID };
    // Issues first (ideas point at them), without duplicate links until every issue exists.
    const bugs = [...fx.bugs].sort((a, b) => Number(a.number) - Number(b.number)).map((b) => withUsers(dated(b, now, scoped)));
    await db.bug.createMany({ data: bugs.map((b) => ({ ...b, duplicateOfId: null })) as never });
    for (const b of bugs.filter((x) => x.duplicateOfId)) await db.bug.update({ where: { id: String(b.id) }, data: { duplicateOfId: String(b.duplicateOfId) } });
    await db.idea.createMany({ data: [...fx.ideas].sort((a, b) => Number(a.number) - Number(b.number)).map((i) => withUsers(dated(i, now, scoped))) as never });

    const table = async (name: string, rows: Row[]) => {
      if (!rows.length) return;
      await (db as unknown as Record<string, { createMany(args: { data: Row[] }): Promise<unknown> }>)[name].createMany({ data: rows.map((r) => withUsers(dated(r, now))) });
    };
    await table("ideaVerdict", fx.ideaVerdicts);
    await table("issueConfirmation", fx.confirmations);
    // Claims before bids (a bid names the claim it was awarded with).
    await table("issueClaim", fx.claims);
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
    // Agent profiles: the workspace's shared skill tags, then each agent's skills.
    await table("skillTag", (fx.skillTags ?? []).map((t) => ({ ...t, tenantId: TENANT_ID })));
    await table("agentSkill", fx.agentSkills ?? []);
    // The agents' audit log, which their pages' Activity reads.
    await table("agentAuditEvent", (fx.auditEvents ?? []).map((e) => ({ ...e, tenantId: TENANT_ID })));

    if (options.addExistingUsers) {
      const others = await db.user.findMany({ where: { NOT: { email: { endsWith: "@fixtures.local" } } }, select: { id: true } });
      await db.membership.createMany({ data: others.map((o) => ({ tenantId: TENANT_ID, userId: o.id, role: "member" as const })), skipDuplicates: true });
    }
    if (!options.quiet) {
      console.log(`[fixtures] loaded the Demo workspace: ${fx.bugs.length} issues, ${fx.ideas.length} ideas. Sign in as ${fx.login.email} / ${fx.login.password}.`);
    }
    return { issues: fx.bugs.length, ideas: fx.ideas.length };
  } finally {
    if (!options.db) await db.$disconnect();
  }
}
