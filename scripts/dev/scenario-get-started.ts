/**
 * Local scenario: Demo Builder (the Demo Owner's working agent) as if just
 * connected: both setup questions unanswered (how it works, how much it takes
 * on) and a welcome work alert waiting, so the Get started card on its page
 * (#agent-get-started) asks them one at a time and then shows the work Ziki
 * picked out for it, with what each item pays. Answer on the page, or as the
 * agent through the API (`set-work-mode`, `answer-alert`), and the other side
 * moves on.
 *
 *   pnpm db:scenario:get-started
 *
 * Additive only: it never resets or reseeds. Its alert has a fixed id
 * (`scn-gs-alert`), and a rerun deletes and recreates just that alert and its
 * held items. The share is real Demo fixture work: two issues waiting for
 * confirmation, one delivery waiting for a judgement and one idea waiting for
 * votes. It refuses to run against anything but a local database.
 *
 * Sign in as demo@fixtures.local and open /agent/demo-builder.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { buildAlertSummary, itemKey, HOLD_MS, PROJECT_LINE_KEYS, type ProjectCounts, type ShareItem } from "@/lib/agents/work-alerts";
import { ideaPath, projectRef } from "@/lib/project-paths";
import { issuePath } from "@/lib/issue-ref";

const ALERT_ID = "scn-gs-alert";
const AGENT_USERNAME = "demo-builder";

function assertLocalDatabase(url: string | undefined): void {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`Refusing to write a scenario to a non-local database (${host}).`);
  }
}

async function main() {
  assertLocalDatabase(process.env.DATABASE_URL);
  const db = new PrismaClient();
  try {
    const project = await db.project.findFirst({
      where: { slug: "demo", organisation: { slug: "demo" } },
      select: { id: true, name: true, slug: true, organisationId: true, organisation: { select: { slug: true } } },
    });
    if (!project) throw new Error("No Demo project: run pnpm db:fixtures first.");
    const agent = await db.agent.findUnique({ where: { username: AGENT_USERNAME }, select: { id: true, name: true } });
    if (!agent) throw new Error(`No @${AGENT_USERNAME} agent: run pnpm db:fixtures first.`);
    // As if just connected: both setup questions unanswered, so the card and the terminal both ask them.
    await db.agent.update({
      where: { id: agent.id },
      data: { workMode: null, workModeSetAt: null, paceSetAt: null, maxActiveTasks: null, dailyTaskLimit: null },
    });

    const ref = projectRef(project.organisation.slug, project.slug);
    const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001").replace(/\/$/, "");
    const live = { projectId: project.id, isDeleted: false };
    const [confirm, judge, ideas] = await Promise.all([
      db.bug.findMany({ where: { ...live, substatus: "requires_confirmation" }, orderBy: { number: "asc" }, take: 2, select: { id: true, number: true, title: true } }),
      db.bug.findMany({ where: { ...live, substatus: "requires_review" }, orderBy: { number: "asc" }, take: 1, select: { id: true, number: true, title: true } }),
      db.idea.findMany({ where: { projectId: project.id, status: "open" }, orderBy: { number: "asc" }, take: 1, select: { id: true, number: true, title: true } }),
    ]);

    const items: ShareItem[] = [
      ...confirm.map((row) => ({ key: itemKey("issue", row.number), line: "issues_need_confirmation" as const, type: "issue" as const, id: row.id, number: row.number, title: row.title, url: origin + issuePath(ref, row.number) })),
      ...judge.map((row) => ({ key: itemKey("issue", row.number), line: "deliveries_need_judgement" as const, type: "issue" as const, id: row.id, number: row.number, title: row.title, url: origin + issuePath(ref, row.number) })),
      ...ideas.map((row) => ({ key: itemKey("idea", row.number), line: "ideas_waiting" as const, type: "idea" as const, id: row.id, number: row.number, title: row.title, url: origin + ideaPath(ref, row.number) })),
    ];
    if (!items.length) throw new Error("The Demo project has no work waiting to share.");

    const counts = Object.fromEntries(PROJECT_LINE_KEYS.map((key) => [key, { waiting: items.filter((item) => item.line === key).length, stuck: 0 }])) as ProjectCounts;
    const now = new Date();
    const summary = buildAlertSummary({
      projectName: project.name,
      level: "working",
      counts,
      past: null,
      offers: [],
      now,
      kind: "welcome",
      share: { items, reason: { turn: 1, drafted: 1, received24h: 0, lapseScore: 0, factor: 1, lines: {}, text: "You are new here, so you pick first." } },
    });
    if (!summary) throw new Error("No alert to build from this share.");

    await db.workAlert.deleteMany({ where: { id: ALERT_ID } });
    await db.workAlert.create({
      data: {
        id: ALERT_ID,
        organisationId: project.organisationId,
        projectId: project.id,
        agentId: agent.id,
        kind: "welcome",
        status: "sent",
        summary: summary as unknown as Prisma.InputJsonObject,
        sentAt: now,
        asks: 1,
        lastAskedAt: now,
      },
    });
    const heldUntil = new Date(now.getTime() + HOLD_MS);
    await db.workAlertItem.createMany({
      data: items.map((item) => ({
        alertId: ALERT_ID,
        organisationId: project.organisationId,
        projectId: project.id,
        agentId: agent.id,
        line: item.line,
        itemType: item.type,
        itemId: item.id,
        number: item.number,
        heldUntil,
      })),
    });

    console.log(`${agent.name} has a welcome alert with ${items.length} items (${summary.paysText || "no pay"}).`);
    console.log(`Sign in as demo@fixtures.local and open ${origin}/agent/${AGENT_USERNAME}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
