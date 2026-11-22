import { beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HOLD_MS, PROJECT_LINE_KEYS, buildAlertSummary, itemKey, type AgentShare, type ProjectCounts } from "@/lib/agents/work-alerts";
import { localDatabaseUrl } from "../env";
import { ok, refused } from "./helpers";

type Feed = { project: { id: string; name: string }; ask: string[]; alert: { id: string; answer: string | null; answerPath: string; lines: { key: string }[]; share: { key: string }[] } | null };
type AnswerView = { id: string; answer: string | null; share: { key: string }[]; heldUntil: string | null };

/**
 * Work alerts (#work-alerts): the sweep sends one to a free agent when work its
 * class can do stops moving or piles up; the agent tells its person and
 * reports their answer. The sweep runs every minute over every project, so
 * this scenario writes the alert itself, as the sweep would, and drives the
 * agent's side through the CLI: its work feed and `answer-alert`.
 */
describe("work alerts", () => {
  let alertId: string;

  beforeAll(async () => {
    localDatabaseUrl();
    const me = await ok("ada", "whoami");
    const feed = (await ok("ada", "work")) as Feed;
    const counts = Object.fromEntries(PROJECT_LINE_KEYS.map((key) => [key, { waiting: 0, stuck: 0 }])) as ProjectCounts;
    counts.deliveries_need_judgement = { waiting: 6, stuck: 2 };
    const now = new Date();
    const summary = buildAlertSummary({ projectName: feed.project.name, level: "working", counts, past: null, offers: [], now });
    expect(summary).not.toBeNull();
    const alert = await prisma.workAlert.create({
      data: {
        organisationId: me.organisation_id,
        projectId: feed.project.id,
        agentId: me.id,
        status: "sent",
        summary: summary as unknown as Prisma.InputJsonObject,
        sentAt: now,
        asks: 1,
        lastAskedAt: now,
      },
    });
    alertId = alert.id;
  });

  it("shows in its own agent's work feed, first in what to do, and in no one else's", async () => {
    const mine = (await ok("ada", "work")) as Feed;
    expect(mine.alert).toMatchObject({ id: alertId, answer: null, answerPath: `/api/v1/alerts/${alertId}/answer` });
    expect(mine.alert?.lines.map((line) => line.key)).toEqual(["deliveries_need_judgement"]);
    expect(mine.ask[0]).toMatch(/^Work alert:/);
    const theirs = (await ok("bob", "work")) as Feed;
    expect(theirs.alert?.id).not.toBe(alertId);
  });

  it("can only be answered by the agent it was sent to", async () => {
    await refused("bob", "answer-alert", { id: alertId, answer: "yes" }, 404);
  });

  it("records later, then no, and refuses an answer once it is passed on", async () => {
    expect(await ok("ada", "answer-alert", { id: alertId, answer: "later" })).toMatchObject({ id: alertId, answer: "later", status: "sent" });
    expect(await ok("ada", "answer-alert", { id: alertId, answer: "no" })).toMatchObject({ id: alertId, answer: "no", status: "passed" });
    expect(await refused("ada", "answer-alert", { id: alertId, answer: "yes" }, 409)).toMatchObject({ error: "alert_not_open" });
    expect(((await ok("ada", "work")) as Feed).alert?.id).not.toBe(alertId);
  });

  it("keeps only the items the person picked from a fair share, and refuses a key that isn't in it", async () => {
    const me = await ok("ada", "whoami");
    const feed = (await ok("ada", "work")) as Feed;
    const counts = Object.fromEntries(PROJECT_LINE_KEYS.map((key) => [key, { waiting: 0, stuck: 0 }])) as ProjectCounts;
    counts.deliveries_need_judgement = { waiting: 6, stuck: 2 };
    const now = new Date();
    const picks = [990001, 990002].map((number) => ({
      key: itemKey("issue", number),
      line: "deliveries_need_judgement" as const,
      type: "issue" as const,
      id: `cli-share-${number}`,
      number,
      title: `Delivery ${number}`,
      url: `http://localhost/${number}`,
    }));
    const share: AgentShare = { items: picks, reason: { turn: 1, drafted: 1, received24h: 0, lapseScore: 0, factor: 1, lines: {}, text: "Picked 1st of 1." } };
    const summary = buildAlertSummary({ projectName: feed.project.name, level: "working", counts, past: null, offers: [], now, kind: "welcome", share });
    const alert = await prisma.workAlert.create({
      data: {
        organisationId: me.organisation_id,
        projectId: feed.project.id,
        agentId: me.id,
        kind: "welcome",
        status: "sent",
        summary: summary as unknown as Prisma.InputJsonObject,
        sentAt: now,
        asks: 1,
        lastAskedAt: now,
        items: {
          create: picks.map((item) => ({
            organisationId: me.organisation_id,
            projectId: feed.project.id,
            agentId: me.id,
            line: item.line,
            itemType: item.type,
            itemId: item.id,
            number: item.number,
            heldUntil: new Date(now.getTime() + HOLD_MS),
          })),
        },
      },
    });
    const shown = (await ok("ada", "work")) as Feed;
    expect(shown.alert?.share.map((item) => item.key)).toEqual(picks.map((item) => item.key));

    expect(await refused("ada", "answer-alert", { id: alert.id, answer: "yes", items: ["issue:990003"] }, 422)).toMatchObject({ error: "item_not_in_share" });
    const answered = (await ok("ada", "answer-alert", { id: alert.id, answer: "yes", items: [picks[0]!.key] })) as AnswerView;
    expect(answered.answer).toBe("yes");
    expect(answered.share.map((item) => item.key)).toEqual([picks[0]!.key]);
    expect(answered.heldUntil).not.toBeNull();
    const released = await prisma.workAlertItem.findFirst({ where: { alertId: alert.id, number: picks[1]!.number } });
    expect(released!.heldUntil.getTime()).toBeLessThanOrEqual(Date.now());
    // #agent-get-started: a yes (here, or by its owner on its page) settles the ask for both places.
    expect(await refused("ada", "answer-alert", { id: alert.id, answer: "no" }, 409)).toMatchObject({ error: "alert_already_answered" });
    await prisma.workAlert.update({ where: { id: alert.id }, data: { status: "ended", endedAt: new Date() } });
  });
});
