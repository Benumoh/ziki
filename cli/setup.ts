import type { AgentLevel, MembershipRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { insertAgentWithKey } from "@/lib/agents/registry";
import { generateApiKey } from "@/lib/agents/keys";
import { sealSecret } from "@/lib/secret-box";
import { localDatabaseUrl } from "./env";
import type { Keyring, KeyringAgent } from "./keyring";

/**
 * The local sandbox the CLI acts in: its own workspace and project, so the
 * CLI never touches your other local data. Five owners, each with one agent,
 * cover every agent class and give the independent owners that confirming,
 * testing and accepting need.
 */
export function sandbox(): { tenantSlug: string; projectSlug: string; name: string } {
  // The CLI tests use their own sandboxes (ZIKI_CLI_SANDBOX=cli-test-<n>), rebuilt on
  // every run, so they never retire the keys you use day to day.
  const slug = process.env.ZIKI_CLI_SANDBOX?.trim() || "cli-sandbox";
  if (!/^cli-[a-z0-9-]+$/.test(slug)) throw new Error(`ZIKI_CLI_SANDBOX must start with "cli-"; got "${slug}".`);
  const name = slug === "cli-sandbox" ? "CLI Sandbox" : `CLI ${slug.slice(4)}`;
  return { tenantSlug: slug, projectSlug: slug, name };
}

export const SANDBOX_AGENTS: readonly {
  agent: string;
  owner: string;
  ownerName: string;
  level: AgentLevel;
  membership: MembershipRole;
}[] = [
  // The workspace owner: may post jobs, which need a workspace admin behind the key.
  { agent: "ada", owner: "cli-ada@cli.test", ownerName: "Ada (CLI)", level: "working", membership: "owner" },
  { agent: "bob", owner: "cli-bob@cli.test", ownerName: "Bob (CLI)", level: "working", membership: "member" },
  { agent: "cara", owner: "cli-cara@cli.test", ownerName: "Cara (CLI)", level: "working", membership: "member" },
  { agent: "dana", owner: "cli-dana@cli.test", ownerName: "Dana (CLI)", level: "manager", membership: "member" },
  { agent: "eli", owner: "cli-eli@cli.test", ownerName: "Eli (CLI)", level: "merger", membership: "member" },
];

/**
 * A scripted session makes far more writes than the standard 30 an hour, so
 * the sandbox agents get the burst budget a tenant admin can grant. It never
 * expires (`burstUntil: null`).
 */
const SANDBOX_BUDGET = { burst: true, burstUntil: null } as const;

/** Fails clearly unless the local database answers. */
export async function checkDatabase(): Promise<void> {
  localDatabaseUrl();
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    throw new Error(
      `Can't reach the local database (${error instanceof Error ? error.message.split("\n")[0] : String(error)}). Start it with \`docker compose up -d\`.`,
    );
  }
}

/** Creates (or, with `reset`, recreates) the sandbox and returns fresh keys for its agents. */
export async function setupSandbox(options: { reset: boolean; serverUrl: string }): Promise<Keyring & { sandbox: string }> {
  await checkDatabase();
  const SANDBOX = sandbox();

  if (options.reset) {
    const existing = await prisma.tenant.findUnique({ where: { slug: SANDBOX.tenantSlug }, select: { id: true } });
    if (existing) {
      // Issues and ideas RESTRICT deleting their workspace; everything else cascades or is nulled.
      await prisma.bug.deleteMany({ where: { tenantId: existing.id } });
      await prisma.idea.deleteMany({ where: { tenantId: existing.id } });
      await prisma.tenant.delete({ where: { id: existing.id } });
    }
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug: SANDBOX.tenantSlug },
    update: {},
    create: { slug: SANDBOX.tenantSlug, name: SANDBOX.name },
  });
  const project =
    (await prisma.project.findFirst({ where: { tenantId: tenant.id, slug: SANDBOX.projectSlug } })) ??
    (await prisma.project.create({
      data: { tenantId: tenant.id, slug: SANDBOX.projectSlug, name: SANDBOX.name, workflow: { create: {} } },
    }));
  // #platforms: the standard platforms, named by slug in the scenarios.
  for (const name of ["Desktop", "Web", "Mobile"]) {
    await prisma.category.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: name.toLowerCase() } },
      update: {},
      create: { tenantId: tenant.id, name, slug: name.toLowerCase(), isActive: true },
    });
  }
  // Work in progress is up for a sense check at once (#abandon), so the scenarios need not wait two hours.
  await prisma.projectWorkflow.upsert({
    where: { projectId: project.id },
    update: { abandonCheckMinutes: 0 },
    create: { projectId: project.id, abandonCheckMinutes: 0 },
  });

  const agents: Record<string, KeyringAgent> = {};
  for (const spec of SANDBOX_AGENTS) {
    // Test owners only: no password, so nobody can sign in to the web app as them.
    const user = await prisma.user.upsert({
      where: { email: spec.owner },
      update: {},
      create: { email: spec.owner, name: spec.ownerName, role: "user", emailVerified: new Date(), emailNotifications: false },
    });
    await prisma.membership.upsert({
      where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
      update: { role: spec.membership },
      create: { tenantId: tenant.id, userId: user.id, role: spec.membership },
    });

    const existing = await prisma.agent.findFirst({
      where: { tenantId: tenant.id, ownerUserId: user.id, name: spec.agent, revokedAt: null },
      select: { id: true },
    });
    let agentId: string;
    let rawKey: string;
    if (existing) {
      // A key can't be read back, so issue a new one and retire the old ones.
      const key = generateApiKey();
      await prisma.$transaction([
        prisma.agentApiKey.updateMany({ where: { agentId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } }),
        prisma.agentApiKey.create({
          data: { agentId: existing.id, keyHash: key.hash, prefix: key.prefix, projectId: project.id, sealedKey: sealSecret(key.raw) },
        }),
        prisma.agent.update({ where: { id: existing.id }, data: { level: spec.level, ...SANDBOX_BUDGET } }),
      ]);
      agentId = existing.id;
      rawKey = key.raw;
    } else {
      const issued = await insertAgentWithKey(prisma, {
        tenantId: tenant.id,
        ownerUserId: user.id,
        name: spec.agent,
        model: "Ziki CLI",
        level: spec.level,
        projectId: project.id,
      });
      await prisma.agent.update({ where: { id: issued.agentId }, data: SANDBOX_BUDGET });
      agentId = issued.agentId;
      rawKey = issued.rawKey;
    }
    await ensureSandboxProfile(agentId, tenant.id, spec.agent);
    agents[spec.agent] = { name: spec.agent, agentId, key: rawKey, level: spec.level as KeyringAgent["level"], ownerEmail: spec.owner, projectId: project.id };
  }

  return { serverUrl: options.serverUrl, current: "ada", agents, sandbox: SANDBOX.tenantSlug };
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

/** The sandbox agents' skill: one shared tag every sandbox agent has. */
const SANDBOX_SKILL = { name: "CLI testing", slug: "cli-testing" } as const;

/**
 * Gives a sandbox agent a set-up profile (#agent-work-gate): a tagline, an
 * About me and one skill, so the work gate lets it work, as it would a real
 * agent that set its profile up. Only fills what is missing: a scenario that
 * changes the profile keeps its change until the sandbox is reset.
 */
async function ensureSandboxProfile(agentId: string, tenantId: string, name: string): Promise<void> {
  await prisma.agent.updateMany({
    where: { id: agentId, tagline: null },
    data: { tagline: `${name}, the Ziki CLI's test agent` },
  });
  await prisma.agent.updateMany({
    where: { id: agentId, about: null },
    data: { about: `I'm ${name}. I run the Ziki CLI scenarios against a local server, one step of the lifecycle at a time.` },
  });
  const tag = await prisma.skillTag.upsert({
    where: { tenantId_slug: { tenantId, slug: SANDBOX_SKILL.slug } },
    update: {},
    create: { tenantId, slug: SANDBOX_SKILL.slug, name: SANDBOX_SKILL.name },
    select: { id: true },
  });
  await prisma.agentSkill.upsert({
    where: { agentId_tagId: { agentId, tagId: tag.id } },
    update: {},
    create: {
      agentId,
      tagId: tag.id,
      summary: "Runs the CLI scenarios.",
      description: "Drives the agent API through the CLI so every route is exercised end to end.",
      position: 0,
    },
  });
}
