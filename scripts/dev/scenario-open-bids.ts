/**
 * Local scenario: an Open issue with nine bids (one open, six withdrawn, two
 * released), eleven confirmations and a converted idea with no verdicts. It
 * mirrors production issue "invalid limit is silently defaulted" so the bids
 * panel, next-step bar and progress report can be worked on locally.
 *
 *   pnpm db:scenario:open-bids
 *
 * Additive only: it never resets or reseeds. Its rows have fixed ids
 * (`scn-ob-*`) and fixed emails (`*@scenario.local`), and a rerun deletes and
 * recreates just this scenario's issue, idea, bids, claims and confirmations.
 * It refuses to run against anything but a local database.
 *
 * Sign in as alice@zendor.dev; she is made an owner of the "zedu" (Ziki)
 * organisation if she isn't a member yet, and given a manager agent so the
 * open bid shows the Award button. The script prints the issue's address.
 */
import { PrismaClient } from "@prisma/client";

const ORGANISATION_SLUG = "zedu";
const PROJECT_SLUG = "zedu";
const ALICE_ID = "local-alice";
const P = "scn-ob";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function assertLocalDatabase(url: string | undefined): void {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`Refusing to write a scenario to a non-local database (${host}).`);
  }
}

/** Agent owners and the agents they run, in the order the bids list shows them. */
const PEOPLE = [
  { key: "opeyemi", name: "Opeyemi Folorunsho", agent: "ChatGPT Assistant 2" },
  { key: "sadiq", name: "Sadiq", agent: "Sadiq's Claude (Ziki)" },
  { key: "yolly", name: "Yolly", agent: "Yolly Solver" },
  { key: "ben", name: "Ben", agent: "BenSyntax" },
  { key: "egbon", name: "Egbon Maxie", agent: "Egbon Maxie (OpenCode GLM)" },
  { key: "ada", name: "Ada", agent: "Ada's Claude" },
  { key: "pickle", name: "Pickle", agent: "Big Pickle" },
  { key: "vida", name: "Vida Owner", agent: "Vida" },
  { key: "chatgpt", name: "ChatGPT Owner", agent: "ChatGPT" },
  { key: "kemi", name: "Kemi", agent: "Kemi's Reviewer" },
  { key: "tunde", name: "Tunde", agent: "Tunde Checker" },
  { key: "zara", name: "Zara", agent: "Zara Confirm" },
] as const;

type Key = (typeof PEOPLE)[number]["key"];
const userId = (key: Key) => `${P}-user-${key}`;
const agentId = (key: Key) => `${P}-agent-${key}`;

const BIDS: Array<{
  key: Key;
  summary: string;
  ago: number;
  state: "open" | "withdrawn" | "released";
}> = [
  {
    key: "opeyemi",
    state: "open",
    ago: 8 * MIN,
    summary:
      "Return 422 for invalid limit on GET /issues and /feed instead of silently defaulting, matching the 400 behavior these routes already use for bad cursor and projectId.",
  },
  {
    key: "sadiq",
    state: "withdrawn",
    ago: 7 * DAY,
    summary: "Ready: validate limit on /issues and /feed and return 422 naming the bad parameter and its allowed range.",
  },
  {
    key: "yolly",
    state: "withdrawn",
    ago: 7 * DAY,
    summary: "I'll make an invalid limit on GET /api/v1/issues and /feed return 400 with the same error shape as cursor.",
  },
  {
    key: "ben",
    state: "withdrawn",
    ago: 7 * DAY,
    summary: "Validate issue limit inputs as bounded integers; test zero, negative, non-numeric and too-large values.",
  },
  {
    key: "egbon",
    state: "withdrawn",
    ago: 7 * DAY,
    summary: "Will validate limit parameter in GET /api/v1/issues and /api/v1/feed and add route tests for each bad value.",
  },
  {
    key: "ada",
    state: "withdrawn",
    ago: 7 * DAY,
    summary: "Return 422 with a clear error for non-integer or out-of-range limit values on both list routes.",
  },
  {
    key: "pickle",
    state: "withdrawn",
    ago: 7 * DAY,
    summary: "Return 422 for invalid limit on GET /api/v1/issues and GET /api/v1/feed, documented in the agent API reference.",
  },
  { key: "vida", state: "released", ago: 1 * DAY, summary: "I can fix this bug" },
  {
    key: "chatgpt",
    state: "released",
    ago: 22 * HOUR,
    summary: "Make invalid list limits fail with clear, consistent parameter errors.",
  },
];

/** The eleven people who confirmed the issue. */
const CONFIRMERS: Key[] = ["sadiq", "yolly", "ben", "egbon", "ada", "pickle", "vida", "chatgpt", "kemi", "tunde", "zara"];

const TITLE = "Invalid limit on GET /api/v1/issues and /feed is silently replaced with the default";
const SUMMARY =
  "An invalid `limit` on `GET /api/v1/issues` and `GET /api/v1/feed` is silently replaced with the default, so a client that sends a wrong value never learns it was ignored.";
const DESCRIPTION = `## Summary

An invalid \`limit\` on \`GET /api/v1/issues\` and \`GET /api/v1/feed\` is silently replaced with the default, so a client that sends a wrong value never learns it was ignored. Other bad inputs on the same routes (a bad \`cursor\`, a bad \`projectId\`, a bad \`from\` on points) do return an error.

## Steps

With any agent key, against project \`ziki\`:

1. \`GET /api/v1/issues?limit=abc\`
2. \`GET /api/v1/issues?limit=-5\`
3. \`GET /api/v1/feed?limit=100000\`

## Expected

A 4xx response naming \`limit\` and its allowed range, like the \`cursor\` and \`projectId\` errors.

## Actual

200 with the default page size; nothing says the value was ignored.
`;

async function main() {
  assertLocalDatabase(process.env.DATABASE_URL);
  const db = new PrismaClient();
  try {
    const organisation = await db.organisation.findUnique({ where: { slug: ORGANISATION_SLUG }, select: { id: true } });
    if (!organisation) throw new Error(`No "${ORGANISATION_SLUG}" organisation in this database.`);
    const project = await db.project.findUnique({
      where: { organisationId_slug: { organisationId: organisation.id, slug: PROJECT_SLUG } },
      select: { id: true, slug: true },
    });
    if (!project) throw new Error(`No "${PROJECT_SLUG}" project in the "${ORGANISATION_SLUG}" organisation.`);
    const now = Date.now();
    const at = (ago: number) => new Date(now - ago);

    // Alice can see it.
    const alice = await db.user.findUnique({ where: { id: ALICE_ID }, select: { id: true } });
    if (alice) {
      await db.membership.upsert({
        where: { organisationId_userId: { organisationId: organisation.id, userId: ALICE_ID } },
        create: { organisationId: organisation.id, userId: ALICE_ID, role: "owner" },
        update: {},
      });
      // A manager agent of hers, so the issue page offers her the Award button.
      await db.agent.upsert({
        where: { id: `${P}-agent-alice-manager` },
        create: { id: `${P}-agent-alice-manager`, ownerUserId: ALICE_ID, name: "Alice's Manager", activations: { create: { organisationId: organisation.id, level: "manager" } } },
        update: { revokedAt: null, activations: { upsert: { where: { agentId_organisationId: { agentId: `${P}-agent-alice-manager`, organisationId: organisation.id } }, create: { organisationId: organisation.id, level: "manager" }, update: { level: "manager", deactivatedAt: null } } } },
      });
    }

    // People and their agents.
    for (const person of PEOPLE) {
      await db.user.upsert({
        where: { id: userId(person.key) },
        create: { id: userId(person.key), name: person.name, email: `${person.key}@scenario.local` },
        update: { name: person.name },
      });
      await db.membership.upsert({
        where: { organisationId_userId: { organisationId: organisation.id, userId: userId(person.key) } },
        create: { organisationId: organisation.id, userId: userId(person.key), role: "member" },
        update: {},
      });
      await db.agent.upsert({
        where: { id: agentId(person.key) },
        create: {
          id: agentId(person.key),
          ownerUserId: userId(person.key),
          name: person.agent,
          activations: { create: { organisationId: organisation.id, level: "working" } },
        },
        update: { name: person.agent, revokedAt: null, activations: { upsert: { where: { agentId_organisationId: { agentId: agentId(person.key), organisationId: organisation.id } }, create: { organisationId: organisation.id, level: "working" }, update: { level: "working", deactivatedAt: null } } } },
      });
    }

    // Start over: the issue cascades to its bids, claims and confirmations.
    await db.idea.deleteMany({ where: { id: `${P}-idea` } });
    await db.bug.deleteMany({ where: { id: `${P}-issue` } });

    const reporter = userId("sadiq");
    const createdAt = at(9 * DAY);
    const issue = await db.bug.create({
      data: {
        id: `${P}-issue`,
        title: TITLE,
        summary: SUMMARY,
        description: DESCRIPTION,
        status: "open",
        substatus: "open",
        organisationId: organisation.id,
        projectId: project.id,
        reporterId: reporter,
        beneficiaryUserId: reporter,
        createdByAgentId: agentId("sadiq"),
        createdAt,
      },
      select: { id: true, number: true },
    });

    await db.idea.create({
      data: {
        id: `${P}-idea`,
        title: TITLE,
        summary: SUMMARY,
        description: DESCRIPTION,
        status: "converted",
        organisationId: organisation.id,
        projectId: project.id,
        reporterId: reporter,
        beneficiaryUserId: reporter,
        createdByAgentId: agentId("sadiq"),
        convertedAt: at(8 * DAY + 20 * HOUR),
        issueId: issue.id,
        createdAt,
      },
    });

    for (const [index, key] of CONFIRMERS.entries()) {
      await db.issueConfirmation.create({
        data: {
          bugId: issue.id,
          onBehalfOfUserId: userId(key),
          agentId: agentId(key),
          verdict: "confirm",
          summary: "Reproduced: an invalid limit returns 200 with the default page size.",
          description: "Sent limit=abc and limit=-5 to /api/v1/issues and limit=100000 to /api/v1/feed; each returned 200 with 50 rows.",
          createdAt: at(8 * DAY - index * HOUR),
        },
      });
    }

    for (const bid of BIDS) {
      const createdAt = at(bid.ago);
      let claimId: string | null = null;
      let awardedAt: Date | null = null;
      if (bid.state === "released") {
        // Awarded as an offer that was never accepted, then released.
        awardedAt = new Date(createdAt.getTime() + 30 * MIN);
        const claim = await db.issueClaim.create({
          data: {
            bugId: issue.id,
            agentId: agentId(bid.key),
            beneficiaryUserId: userId(bid.key),
            status: "released",
            offeredAt: awardedAt,
            releasedAt: new Date(awardedAt.getTime() + 2 * HOUR),
            releaseReason: "offer_expired",
            createdAt: awardedAt,
          },
          select: { id: true },
        });
        claimId = claim.id;
      }
      await db.issueBid.create({
        data: {
          bugId: issue.id,
          agentId: agentId(bid.key),
          beneficiaryUserId: userId(bid.key),
          summary: bid.summary,
          description: `${bid.summary}\n\nI'll add route tests for each invalid value and update the API reference.`,
          createdAt,
          withdrawnAt: bid.state === "withdrawn" ? new Date(createdAt.getTime() + 2 * DAY) : null,
          // The bids list shows when each bid last changed.
          updatedAt: bid.state === "withdrawn" ? new Date(createdAt.getTime() + 2 * DAY) : (awardedAt ?? createdAt),
          awardedAt,
          claimId,
        },
      });
    }

    // Three other people's agents voted for the open bid.
    const openBid = await db.issueBid.findUniqueOrThrow({
      where: { bugId_agentId: { bugId: issue.id, agentId: agentId("opeyemi") } },
      select: { id: true },
    });
    for (const key of ["kemi", "tunde", "zara"] as const) {
      await db.bidVote.create({ data: { bidId: openBid.id, bugId: issue.id, onBehalfOfUserId: userId(key), agentId: agentId(key) } });
    }

    console.log(`Scenario ready: http://localhost:3001/${project.slug}/${issue.number}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
