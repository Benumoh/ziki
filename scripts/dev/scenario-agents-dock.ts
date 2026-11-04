/**
 * Local scenario: the Demo owner's agents in every state the agents dock shows
 * (#agents-dock), so each robot can be seen locally:
 * - Demo Builder works on #109 (its claim gets a fresh heartbeat);
 * - Demo Lead waits for you (an unanswered question about #2);
 * - Demo Fixer is stuck on #114 (it holds the claim, with no pull request,
 *   but its last heartbeat was two hours ago);
 * - Demo Scout is idle (its key was used a minute ago);
 * - Demo Tester is offline (never seen).
 *
 *   pnpm db:fixtures && pnpm db:scenario:agents-dock
 *   pnpm db:scenario:agents-dock --three   # just Lead, Fixer and Builder, for screenshots
 *   pnpm db:scenario:agents-dock --three --calm       # all three at work: the usual view
 *   pnpm db:scenario:agents-dock --three --needs-you  # all at work but Lead, which asks you something
 *   pnpm db:scenario:agents-dock --three --stuck      # all at work but Fixer, which has gone quiet on #114
 *   pnpm db:scenario:agents-dock --three --all idle     # all three seen a minute ago, with nothing to do
 *   pnpm db:scenario:agents-dock --three --all offline  # all three not seen for over a day
 *
 * `--all` lets go of the three agents' claims and sets their keys' last use
 * (with `idle`, each gets a key of its own, `scn-ad-key-*`); any other run
 * takes the claims up again, and `pnpm db:fixtures` puts the keys back.
 *
 * Additive only: it never resets or reseeds. Its own rows have fixed ids
 * (`scn-ad-*`) and a rerun replaces just those; it also refreshes the
 * fixtures' claim on #109 and hands the one on #114 to Demo Fixer, both of
 * which `pnpm db:fixtures` puts back. A working
 * agent turns idle 15 minutes after its last heartbeat, so rerun it then.
 * It refuses to run against anything but a local database.
 *
 * Sign in as demo@fixtures.local.
 */
import { PrismaClient } from "@prisma/client";

const P = "scn-ad";
const DEMO_EMAIL = "demo@fixtures.local";
const WORKING_CLAIM = "fx-claim-109";
const WAITING_AGENT = "fx-agent-demo-m";
const ASKED_ABOUT = "fx-bug-2";
const STUCK_CLAIM = "fx-claim-114";
const STUCK_AGENT = `${P}-stuck`;
/** Leaves out Scout (idle) and Tester (offline): one agent that needs you, one stuck, one working. */
const THREE = process.argv.includes("--three");
/** Everyone at work, the way the dock usually looks: no question waiting and nobody stuck. */
const CALM = process.argv.includes("--calm");
/** As calm, except Lead has a question for you: the one extraordinary state. */
const NEEDS_YOU = process.argv.includes("--needs-you");
/** As calm, except Fixer has gone quiet on its issue: stuck, the other extraordinary state. */
const STUCK_ONE = process.argv.includes("--stuck");
/** Every agent in the same plain state: all idle (seen a minute ago, nothing to do) or all offline (not seen for a day). */
const ALL = ((): "idle" | "offline" | null => {
  const at = process.argv.indexOf("--all");
  if (at < 0) return null;
  const state = process.argv[at + 1];
  if (state !== "idle" && state !== "offline") throw new Error("--all takes idle or offline.");
  return state;
})();
/** Builder, Lead and Fixer each holding an issue and at work (Fixer gone quiet with --stuck). */
const AT_WORK = CALM || NEEDS_YOU || STUCK_ONE;
/** In those, Lead works too, on a fixture claim it takes over. */
const LEAD_CLAIM = "fx-claim-101";
const BUILDER = "fx-agent-demo-w";
/** The keys --all idle gives the three agents. */
const KEYS = `${P}-key`;

function assertLocalDatabase(url: string | undefined): void {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`Refusing to write a scenario to a non-local database (${host}).`);
  }
}

async function main() {
  assertLocalDatabase(process.env.DATABASE_URL);
  const prisma = new PrismaClient();
  try {
    const demo = await prisma.user.findUnique({ where: { email: DEMO_EMAIL }, select: { id: true } });
    const claim = await prisma.issueClaim.findUnique({ where: { id: WORKING_CLAIM }, select: { agent: { select: { tenantId: true } } } });
    if (!demo || !claim) throw new Error("The Demo workspace isn't loaded. Run `pnpm db:fixtures` first.");
    const tenantId = claim.agent.tenantId;
    const now = new Date();
    // Held, or with --all let go of so nobody is at work; any other run takes them up again.
    const held = ALL ? { status: "released" as const, releasedAt: now } : { status: "active" as const, releasedAt: null };
    // With --all idle, every key was used a minute ago; with --all offline, none has been used.
    const lastUsedAt = ALL === "idle" ? new Date(now.getTime() - 60_000) : null;

    await prisma.$transaction([
      prisma.agentQuestion.deleteMany({ where: { id: { startsWith: P } } }),
      // Demo Fixer is kept, not deleted: deleting it would take the #114 claim with it.
      prisma.agent.deleteMany({ where: { id: { startsWith: P, not: STUCK_AGENT } } }),
      prisma.agentApiKey.deleteMany({ where: { id: { startsWith: KEYS } } }),
      // Working: the latest claim, on an issue in progress, with a heartbeat just now.
      prisma.issueClaim.update({ where: { id: WORKING_CLAIM }, data: { claimedAt: now, lastHeartbeatAt: now, ...held } }),
      // At work (or let go of with --all): Lead works on #101 as well.
      ...(AT_WORK || ALL
        ? [prisma.issueClaim.update({ where: { id: LEAD_CLAIM }, data: { agentId: WAITING_AGENT, beneficiaryUserId: demo.id, claimedAt: now, lastHeartbeatAt: now, deliverBy: new Date(now.getTime() + 6 * 3_600_000), waitingOnOwnerSince: null, ...held } })]
        : []),
      // Waiting: a question its owner hasn't answered (only in the default and needs-you views).
      ...(CALM || STUCK_ONE || ALL ? [] : [prisma.agentQuestion.create({
        data: {
          id: `${P}-question`,
          agentId: WAITING_AGENT,
          ownerUserId: demo.id,
          bugId: ASKED_ABOUT,
          body: "Two testers say this is good to merge and one says it loses the draft on a slow network. Should I fix that first or open a separate issue?",
          createdAt: now,
        },
      })]),
      // Stuck: holds #114 (no pull request yet) but went quiet two hours ago.
      prisma.agent.upsert({
        where: { id: STUCK_AGENT },
        create: { id: STUCK_AGENT, tenantId, ownerUserId: demo.id, name: "Demo Fixer", avatar: "tangerine" },
        update: { revokedAt: null },
      }),
      prisma.issueClaim.update({
        where: { id: STUCK_CLAIM },
        data: {
          agentId: STUCK_AGENT,
          beneficiaryUserId: demo.id,
          claimedAt: new Date(now.getTime() - 5 * 3_600_000),
          // Stuck went quiet two hours ago; in the calm and needs-you views it is at work, checking in now.
          lastHeartbeatAt: (CALM || NEEDS_YOU) && !STUCK_ONE ? now : new Date(now.getTime() - 2 * 3_600_000),
          deliverBy: new Date(now.getTime() + 6 * 3_600_000),
          waitingOnOwnerSince: null,
          ...held,
        },
      }),
      // --all: when the three were last seen, by their keys (Fixer's own key only when idle).
      ...(ALL
        ? [
            prisma.agentApiKey.updateMany({ where: { agentId: { in: [BUILDER, WAITING_AGENT] } }, data: { lastUsedAt } }),
            // Not every fixture agent has a key, so idle gives each of the three one of its own.
            ...(ALL === "idle"
              ? [BUILDER, WAITING_AGENT, STUCK_AGENT].map((agentId, i) =>
                  prisma.agentApiKey.create({ data: { id: `${KEYS}-${i}`, agentId, keyHash: `${KEYS}-${i}-hash`, prefix: `zk_scn${i}`, lastUsedAt } }),
                )
              : []),
          ]
        : []),
      // Idle: seen a minute ago, with nothing to work on.
      ...(THREE ? [] : [prisma.agent.create({
        data: {
          id: `${P}-idle`,
          tenantId,
          ownerUserId: demo.id,
          name: "Demo Scout",
          apiKeys: { create: { id: `${P}-idle-key`, keyHash: `${P}-idle-key-hash`, prefix: "zk_scout", lastUsedAt: new Date(now.getTime() - 60_000) } },
        },
      }),
      // Offline: never seen.
      prisma.agent.create({ data: { id: `${P}-offline`, tenantId, ownerUserId: demo.id, name: "Demo Tester" } })]),
    ]);
    if (ALL) {
      console.log(`[scenario] Demo agents: Builder, Lead and Fixer all ${ALL}${THREE ? "" : ", Scout idle, Tester offline"}. Sign in as demo@fixtures.local.`);
      return;
    }
    const lead = CALM || STUCK_ONE ? "Lead working on #101" : NEEDS_YOU ? "Lead working on #101 and asking you something" : "Lead waiting for you";
    const fixer = (CALM || NEEDS_YOU) && !STUCK_ONE ? "Fixer working on #114" : "Fixer stuck on #114";
    console.log(`[scenario] Demo agents: Builder working on #109, ${lead}, ${fixer}${THREE ? "" : ", Scout idle, Tester offline"}. Sign in as demo@fixtures.local.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
