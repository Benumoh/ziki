import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { beingChecked, earningsSummary, headerEarnings, parseWeeklyGoal, totalEarned, weeklyGoalState } from "@/lib/earnings";
import { workspaceTotals } from "@/lib/earnings";

/** Earnings (#earnings): the header's $ and the Earnings page read the ledger across every organisation. */
describe("earnings across every project (#earnings)", () => {
  it("adds up every ledger row in every organisation, corrections included", async () => {
    const aggregate = vi.fn(async ({ where }: { where: { userId: string } }) => ({ _sum: { points: where.userId === "earner" ? 7.4 : 0 } }));
    expect(await totalEarned({ pointEntry: { aggregate } } as never, "earner")).toBe(7.4);
    // No organisation filter: money from every project counts.
    expect(aggregate).toHaveBeenCalledWith({ where: { userId: "earner" }, _sum: { points: true } });
  });

  it("counts as being checked only this person's awards still held on live work", async () => {
    const findMany = vi.fn(async () => [
      { heldPayout: [{ userId: "earner", points: 2 }, { userId: "someone-else", points: 5 }] },
      { heldPayout: [{ userId: "earner", points: 1.5 }] },
      { heldPayout: null },
    ]);
    expect(await beingChecked({ bug: { findMany } } as never, "earner")).toBe(3.5);
  });
});

/** Your own weekly goal (#earnings): what is left, what that needs per day, and only real amounts accepted. */
describe("weekly earnings goal (#earnings)", () => {
  it("works out what is left and what that needs per day for the days left", () => {
    // Thursday: Thursday to Sunday is 4 days left.
    const state = weeklyGoalState(20, 100, new Date("2026-11-05T10:00:00Z"));
    expect(state).toMatchObject({ left: 80, daysLeft: 4, perDay: 20, reached: false });
  });

  it("accepts a positive amount of Ziks, stored as dollars, and refuses anything else", () => {
    expect(parseWeeklyGoal("1,000")).toBe(100);
    expect(parseWeeklyGoal("755 Ziks")).toBe(75.5);
    for (const bad of ["0", "-5", "abc", "1.23", "$75", "", null]) expect(parseWeeklyGoal(bad)).toBeNull();
  });
});

/** The header's $ and Withdraw (#earnings): for people who work on projects, not for those who only post them. */
describe("who sees $ and Withdraw in the header (#earnings)", () => {
  const db = (entry: boolean, joined: boolean) => ({
    pointEntry: { findFirst: vi.fn(async () => (entry ? { id: "e" } : null)), aggregate: vi.fn(async () => ({ _sum: { points: 4.5 } })) },
    projectMembership: { findFirst: vi.fn(async () => (joined ? { id: "m" } : null)) },
  }) as never;

  it("counts only payments for work: posting ideas, votes and the sign-up bonus don't show it", async () => {
    const d = db(false, false) as unknown as { pointEntry: { findFirst: ReturnType<typeof vi.fn> } };
    await headerEarnings(d as never, "poster");
    const where = d.pointEntry.findFirst.mock.calls[0][0].where;
    expect(where.role.in).toEqual(expect.arrayContaining(["solver", "reviewer"]));
    for (const posting of ["reporter", "idea", "comment", "vote", "signup"]) expect(where.role.in).not.toContain(posting);
  });

  it("hides it from someone who has never earned and never joined a project", async () => {
    expect(await headerEarnings(db(false, false), "poster")).toBeNull();
  });

  it("shows someone who just joined a project their real total, the signup bonus included, and the same once they earn", async () => {
    expect(await headerEarnings(db(false, true), "joiner")).toBe(4.5);
    expect(await headerEarnings(db(true, true), "earner")).toBe(4.5);
  });
});

/** Per workspace (#earnings, Chloe's call): the header shows what you earned where you are. */
describe("earnings in one workspace (#earnings)", () => {
  it("adds up only that workspace's rows when one is given, and every row when not", async () => {
    const aggregate = vi.fn(async () => ({ _sum: { points: 2 } }));
    await totalEarned({ pointEntry: { aggregate } } as never, "earner", "org-ziki");
    expect(aggregate).toHaveBeenLastCalledWith({ where: { userId: "earner", organisationId: "org-ziki" }, _sum: { points: true } });
    await totalEarned({ pointEntry: { aggregate } } as never, "earner");
    expect(aggregate).toHaveBeenLastCalledWith({ where: { userId: "earner" }, _sum: { points: true } });
  });
});

/** Your earnings (#earnings, Chloe's call): everything, in every workspace and project you're in. */
describe("Your earnings covers everywhere you work", () => {
  const base = (memberships: string[], joined: string[], yourTasks: unknown[]) => {
    const findMany = vi.fn(async ({ where }: { where: { OR?: unknown; status?: string } }) => where.status !== "open" ? [] : (where.OR ? yourTasks : [{ id: "open-1", number: 9, title: "Open to join", reward: 3, _count: { bids: 0 }, project: { name: "Docs", slug: "docs", organisation: { slug: "demo" } } }]));
    const db = {
      pointEntry: {
        aggregate: vi.fn(async () => ({ _sum: { points: 1.5 } })),
        groupBy: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
      },
      bug: { findMany: vi.fn(async () => []) },
      user: { findUnique: vi.fn(async () => ({ weeklyEarningsGoal: null })) },
      projectMembership: { findMany: vi.fn(async () => joined.map((projectId) => ({ projectId }))) },
      membership: { findMany: vi.fn(async () => memberships.map((organisationId) => ({ organisationId }))) },
    };
    db.bug.findMany = findMany as never;
    return { db: db as never, findMany, aggregate: db.pointEntry.aggregate };
  };

  it("adds up money from every workspace, and lists tasks from every workspace and joined project", async () => {
    const task = { id: "t-1", number: 4, title: "Post about Ziki", reward: 5, _count: { bids: 1 }, project: { name: "Marketing", slug: "ziki-marketing", organisation: { slug: "ziki" } } };
    const { db, findMany, aggregate } = base(["org-zedu"], ["p-marketing"], [task]);
    const summary = await earningsSummary(db, "earner");
    // No workspace filter on the money.
    expect(aggregate).toHaveBeenCalledWith({ where: { userId: "earner" }, _sum: { points: true } });
    const taskQuery = findMany.mock.calls.map((call) => call[0].where).find((where) => where.OR);
    expect(taskQuery?.OR).toEqual([{ organisationId: { in: ["org-zedu"] } }, { projectId: { in: ["p-marketing"] } }]);
    expect(summary.tasksAreYours).toBe(true);
    expect(summary.tasks.map((t) => t.title)).toEqual(["Post about Ziki"]);
  });

  it("falls back to projects open to join when there is nothing to do where you are", async () => {
    const { db } = base([], [], []);
    const summary = await earningsSummary(db, "newcomer");
    expect(summary.tasksAreYours).toBe(false);
    expect(summary.tasks.map((t) => t.title)).toEqual(["Open to join"]);
  });
});

/** The earnings page lists what each workspace holds next to the all-workspaces total (#862). */
describe("workspaceTotals", () => {
  it("lists the biggest workspace first and drops empty ones", () => {
    const rows = workspaceTotals([
      { organisationId: "o1", name: "Ziki", total: 82.42 },
      { organisationId: "o2", name: "Zedu", total: 1259.28 },
      { organisationId: "o3", name: "Empty", total: 0 },
    ]);
    expect(rows.map((row) => row.name)).toEqual(["Zedu", "Ziki"]);
  });
  it("keeps a workspace that has only been corrected below zero, and breaks ties by name", () => {
    const rows = workspaceTotals([
      { organisationId: "b", name: "Beta", total: 5 },
      { organisationId: "a", name: "Alpha", total: 5 },
      { organisationId: "c", name: "Gamma", total: -1 },
    ]);
    expect(rows.map((row) => row.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});
