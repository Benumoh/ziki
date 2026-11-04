import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

/** The issue list: the main status tabs and their counts, filters that keep search and scope, rows that link to the issue, and ideas listed apart from issues. */
/**
 * Renders the whole issue list with a small fake database, so the layout
 * changes from the Oct 20 call (#1054–#1063) are checked on real markup.
 */

const count = vi.hoisted(() => vi.fn());
const findMany = vi.hoisted(() => vi.fn());
// #idea-table: ideas come from their own table, on the Ideas tab.
const ideaCount = vi.hoisted(() => vi.fn());
const ideaFindMany = vi.hoisted(() => vi.fn());
// Each idea's votes by opinion, to mark bad ideas red (#idea-rejected).
const ideaVerdictGroupBy = vi.hoisted(() => vi.fn());
const bugFindFirst = vi.hoisted(() => vi.fn());
const groupBy = vi.hoisted(() => vi.fn(async (_args: { by: string[]; where?: Record<string, unknown> }) => {
  void _args;
  return [];
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/acme/issues/all",
  useParams: () => ({ project: "acme" }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "dave" } })) }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn(async () => ({ id: "dave", role: "user" })) }));
// #project-urls: the slug in the address picks the project and checks access.
vi.mock("@/lib/project-route", () => ({
  requireProject: vi.fn(async () => ({
    user: { id: "dave", role: "user" },
    tenantId: "tenant-acme",
    project: { id: "project-acme", slug: "acme", name: "Acme Web", goal: null, tenantId: "tenant-acme" },
  })),
}));
vi.mock("@/lib/tenant-access", () => ({ currentTenantAccess: vi.fn(async () => ({ membershipRole: "member" })) }));
vi.mock("@/lib/lookups", () => ({
  getIssueTypes: vi.fn(async () => []),
  getPlatforms: vi.fn(async () => [
    { id: "cat-web", name: "Web", isActive: true },
    { id: "cat-mobile", name: "Mobile", isActive: true },
    { id: "cat-old", name: "Desktop", isActive: false },
  ]),
}));
vi.mock("@/lib/tenant-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenant-context")>()),
  currentTenantIdFor: vi.fn(async () => "tenant-acme"),
}));
vi.mock("@/lib/issue-stage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/issue-stage")>()),
  openIssueConfirmations: vi.fn(async () => new Map([["bug-1", { stage: "confirming", accepts: 1, rejects: 0, needed: 2, confirmed: false }]])),
}));
vi.mock("@/lib/voter-summaries", () => ({
  fetchVoterSummaries: vi.fn(async () =>
    new Map([
      [
        "bug-1",
        {
          likes: { count: 2, voters: [{ id: "a", name: "Ann", image: null }, { id: "b", name: "Ben", image: null }] },
          dislikes: { count: 1, voters: [{ id: "c", name: "Cy", image: null }] },
        },
      ],
    ]),
  ),
}));
vi.mock("@/lib/workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workflow")>()),
  workflowFor: vi.fn(async () => ({ ...(await import("@/lib/workflow-config")).DEFAULT_PROJECT_WORKFLOW, ideaThreshold: 4 })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn(async () => ({ slug: "acme-web", name: "Acme Web", goal: null })) },
    bug: { count, findMany, groupBy, findFirst: bugFindFirst },
    idea: { count: ideaCount, findMany: ideaFindMany },
    ideaVerdict: { groupBy: ideaVerdictGroupBy, findMany: vi.fn(async () => []) },
    milestone: { findMany: vi.fn(async () => []) },
    projectArea: { findMany: vi.fn(async () => []) },
    user: { findUnique: vi.fn(async () => ({ keyboardShortcuts: true })) },
  },
}));

// A person's answer on Your call is posted through the ordinary comment action: here it only records what it was given.
vi.mock("@/app/actions/issues", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/app/actions/issues")>()), addCommentAction: vi.fn(async () => ({ ok: true })) }));
// Your call (#your-call) asks the database for the split issues on every view (for its step's count): the layout tests below read the list's own queries, so it gets an empty answer here.
vi.mock("@/lib/your-call", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/your-call")>()), loadYourCall: vi.fn(async () => []) }));
import { IssuesList } from "@/app/(app)/[project]/issues/_list/issues-list";
import { answerFrom, topShare, urgencyOf, yardsticksFor, type UrgencySignals } from "@/lib/your-call";
import { currentTenantAccess } from "@/lib/tenant-access";
import { addCommentAction } from "@/app/actions/issues";
import { answerYourCallAction } from "@/app/actions/your-call";

const BUG = {
  id: "bug-1",
  number: 7,
  title: "Login button does nothing",
  description: "## Summary\nLogin button does nothing\n\n## Acceptance Criteria\n- [ ] Fix login",
  createdByAgentId: null,
  status: "open",
  substatus: "requires_confirmation",
  voteCount: 2,
  proofLinks: ["https://github.com/acme/web/pull/1", "https://github.com/acme/web/pull/2"],
  isDeleted: false,
  isBoosted: false,
  duplicateOf: null,
  createdAt: new Date("2026-10-01T10:00:00Z"),
  updatedAt: new Date("2026-10-20T10:00:00Z"),
  type: null,
  reporter: { name: "Rita Reporter", role: "user", image: null },
  assignee: { name: "Bob Builder", role: "user", image: null },
  category: { id: "cat-web", name: "Web" },
  area: null,
  project: { slug: "acme" },
  votes: [],
  _count: { comments: 3, attachments: 1 },
};

const IDEA = {
  id: "idea-1",
  number: 12,
  title: "Export activity as CSV",
  score: 2,
  projectId: "project-acme",
  createdAt: new Date("2026-10-02T10:00:00Z"),
  updatedAt: new Date("2026-10-03T10:00:00Z"),
  rejectedAt: null,
  archivedAt: null,
  verdicts: [],
  reporter: { name: "Rita Reporter" },
  category: { name: "Web" },
  _count: { verdicts: 3 },
};

/** Renders `/acme/issues/<status>`, or `/acme/ideas` when no status is given. */
async function renderList({ status = "ideas", ...query }: Record<string, string> = {}) {
  const returnTo = status === "ideas" ? "/acme/ideas" : `/acme/issues/${status}`;
  const page = (await IssuesList({ slug: "acme", status, returnTo, searchParams: Promise.resolve(query) })) as ReactElement;
  return renderToStaticMarkup(page);
}

const clean = (html: string) => html.replace(/<!-- -->/g, "");
/** The stage bar above the panel, and the status list down its left. */
const stages = (html: string) => clean(html).match(/<nav aria-label="Stages"[\s\S]*?<\/nav>/)?.[0] ?? "";
const statusList = (html: string) => clean(html).match(/<nav aria-label="Status"[\s\S]*?<\/nav>/)?.[0] ?? "";
const links = (nav: string) => [...nav.matchAll(/<a [^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]).filter((link) => !/^<a [^>]*aria-hidden="true"/.test(link));
const labelOf = (link: string) => link.match(/>([A-Za-z][A-Za-z ]*?)(?:<span|<\/a>)/)?.[1] ?? "";
const current = (nav: string) => links(nav).filter((link) => link.includes('aria-current="page"')).map(labelOf);
/** Each link's label and count: beside the label in the stage bar, read out after it in the status list. */
const counted = (nav: string) => Object.fromEntries(links(nav).map((link) => [labelOf(link), Number(link.match(/(\d+)<\/span>/)?.[1])]));

beforeEach(() => {
  vi.clearAllMocks();
  count.mockResolvedValue(1);
  findMany.mockResolvedValue([BUG]);
  ideaCount.mockResolvedValue(4);
  ideaFindMany.mockResolvedValue([IDEA]);
  ideaVerdictGroupBy.mockResolvedValue([]);
});

describe("issue list layout", () => {
  it("links each row to its project address and offers Add Idea", async () => {
    const html = await renderList({ status: "all" });
    expect(html).toContain("Login button does nothing");
    // #project-urls: a row opens the issue at /<project-slug>/<number>.
    expect(html).toContain('href="/acme/7"');
    // Add Idea opens the idea chat box in the toolbar (#idea-chat).
    expect(html).toMatch(/<button[^>]*title="Add Idea"/);
  });

  it("says no issues match when the project has issues but the filters hide them", async () => {
    count.mockImplementation(async (args: { where?: { assigneeId?: unknown } }) => (args?.where?.assigneeId ? 0 : 3));
    findMany.mockResolvedValue([]);
    const html = await renderList({ mine: "assigned", status: "all" });
    expect(html).toMatch(/no issues match/i);
    expect(html).toContain("Clear filters");
    expect(html).not.toMatch(/no issues yet/i);
  });

  it("lists ideas under Ideas' New ideas, from the Idea table, with their score and no importance button (#idea-table)", async () => {
    const html = await renderList();
    expect(ideaFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: "tenant-acme", projectId: "project-acme", status: "open", isDeleted: false }),
    }));
    expect(html).toContain('href="/acme/ideas/12"');
    expect(html).toContain("Idea #12");
    expect(html).toMatch(/aria-label="[^"]*idea score 2 of 4"/);
    expect(html).toContain("3 verdicts");
    expect(html).not.toMatch(/click to mark important/);
    // No issue row matches an idea list.
    expect(findMany.mock.calls.at(-1)![0].where.id).toEqual({ in: [] });
  });

  it("keeps search and scope when switching status, and resets paging and intake", async () => {
    const html = await renderList({ q: "login", platform: "cat-web", mine: "assigned", stage: "reported", page: "2", status: "open" });
    const list = statusList(html);
    // #project-urls: the status is the path, the rest stays in the query.
    expect(list).toContain('href="/acme/issues/in-progress?q=login&amp;platform=cat-web&amp;mine=assigned"');
    expect(list).not.toContain("page=");
    expect(list).not.toContain("stage=");
    const statusCount = groupBy.mock.calls.find(([args]) => args?.by?.[0] === "status");
    expect(statusCount?.[0].where).toMatchObject({ tenantId: "tenant-acme", projectId: "project-acme", categoryId: "cat-web" });
    expect(statusCount?.[0].where).not.toHaveProperty("status");
  });

  it("lists both of Open's substatuses on its tab, by the main status (#substatus)", async () => {
    await renderList({ status: "open" });
    const where = findMany.mock.calls.at(-1)![0].where;
    expect(where.status).toBe("open");
    expect(where).not.toHaveProperty("substatus");
  });

  it("searches across every issue on All, so a just-reported issue can be found", async () => {
    const html = await renderList({ q: "login", status: "all" });
    const where = findMany.mock.calls.at(-1)![0].where;
    expect(where).not.toHaveProperty("id");
    expect(where).not.toHaveProperty("status");
    expect(current(stages(html))).toEqual([]);
  });

  it("lists each tab by its main status (Ziki #713, #substatus)", async () => {
    for (const status of ["in_progress", "done", "merge", "resolved"]) {
      await renderList({ status });
      const where = findMany.mock.calls.at(-1)![0].where;
      expect(where.status).toBe(status);
      expect(where).not.toHaveProperty("AND");
    }
  });

  it("counts each stage as its statuses added up, and each status on the left by itself", async () => {
    groupBy.mockImplementation((async (args: { by: string[] }) =>
      args.by[0] !== "status"
        ? []
        : [
          { status: "open", _count: { _all: 13 } },
          { status: "in_progress", _count: { _all: 2 } },
          { status: "done", _count: { _all: 7 } },
          { status: "merge", _count: { _all: 1 } },
          { status: "resolved", _count: { _all: 7 } },
          { status: "closed", _count: { _all: 3 } },
        ]) as never);
    const html = await renderList({ status: "open" });
    // Ideas: new ideas + rejected ideas. In Progress: Open, In progress, Closed. Delivered: Done, Merge, Live.
    // Possibly delivered is a list inside Open, so In Progress's total doesn't count it again.
    expect(counted(stages(html))).toEqual({ Ideas: 8, "In Progress": 18, Delivered: 15 });
    expect(counted(statusList(html))).toEqual({ Open: 13, "In progress": 2, Closed: 3, "Possibly delivered": 1 });
  });

});

/** The agents dock's settings (#agents-dock): saved per browser, and the dock still works when they can't be. */
describe("agents dock settings", () => {
  function fakeStorage(saved: string | null, blocked = false) {
    const store = new Map(saved === null ? [] : [["ziki-agents-dock", saved]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => { if (blocked) throw new Error("blocked"); return store.get(key) ?? null; },
      setItem: (key: string, value: string) => { if (blocked) throw new Error("blocked"); store.set(key, value); },
    });
    return store;
  }
  /** A fresh copy of the module, as after a page load: it keeps what it read in memory. */
  async function load() {
    vi.resetModules();
    return import("@/components/agents-dock-prefs");
  }

  it("starts with the face and the bar closing when the cursor leaves", async () => {
    fakeStorage(null);
    const { readPrefs, lookFor } = await load();
    expect(readPrefs().closeOnLeave).toBe(true);
    expect(lookFor(readPrefs(), "agent-1")).toBe("face");
    vi.unstubAllGlobals();
  });

  it("keeps the checkbox's choice across a page load, and ignores anything it can't read", async () => {
    const store = fakeStorage(null);
    (await load()).writePrefs({ closeOnLeave: false });
    expect(JSON.parse(store.get("ziki-agents-dock")!).closeOnLeave).toBe(false);
    expect((await load()).readPrefs().closeOnLeave).toBe(false);
    fakeStorage(JSON.stringify({ closeOnLeave: "no", pinned: 1, looks: { a: "nonsense", b: "pixel" } }));
    const junk = (await load()).readPrefs();
    expect(junk).toMatchObject({ closeOnLeave: true, pinned: true, looks: { b: "pixel" } });
    expect(junk.looks.a).toBeUndefined();
    fakeStorage("not json");
    expect((await load()).readPrefs().closeOnLeave).toBe(true);
    vi.unstubAllGlobals();
  });

  it("still works when the browser blocks storage: the choice holds until the page reloads", async () => {
    fakeStorage(null, true);
    const { readPrefs, writePrefs } = await load();
    expect(readPrefs().closeOnLeave).toBe(true);
    writePrefs({ closeOnLeave: false });
    expect(readPrefs().closeOnLeave).toBe(false);
    expect((await load()).readPrefs().closeOnLeave).toBe(true);
    vi.unstubAllGlobals();
  });
});

/** Your call (#your-call): how urgent an issue the agents split on is, and why. */
describe("Your call urgency", () => {
  const NOW = new Date("2026-11-03T12:00:00Z").getTime();
  const days = (n: number) => new Date(NOW + n * 24 * 60 * 60 * 1000);
  /** A project's open issues as the database counts them: one row per importance value. */
  const spread = (values: number[]) => [...new Set(values)].map((importance) => ({ importance, count: values.filter((v) => v === importance).length }));
  const yardsticks = yardsticksFor(spread([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  const issue = (over: Partial<UrgencySignals>): UrgencySignals => ({ isBoosted: false, importance: 0, milestone: null, since: days(-1), ...over });

  it("is Critical when boosted, due soon or overdue, or among the most important, and says why", () => {
    expect(urgencyOf(issue({ isBoosted: true }), yardsticks, NOW)).toEqual({ urgency: "critical", reasons: ["Boosted"] });
    expect(urgencyOf(issue({ milestone: { title: "Beta", dueDate: days(3) } }), yardsticks, NOW).reasons).toEqual(["Milestone Beta due in 3 days"]);
    expect(urgencyOf(issue({ milestone: { title: "Beta", dueDate: days(-2) } }), yardsticks, NOW).reasons).toEqual(["Milestone Beta overdue"]);
    expect(urgencyOf(issue({ milestone: { title: "Beta", dueDate: days(30) } }), yardsticks, NOW).urgency).toBe("low");
    expect(urgencyOf(issue({ importance: 10 }), yardsticks, NOW).urgency).toBe("critical");
  });

  it("is High for high importance or a long split, Medium for any marks, and Low otherwise", () => {
    expect(urgencyOf(issue({ importance: 8 }), yardsticks, NOW).urgency).toBe("high");
    expect(urgencyOf(issue({ since: days(-9) }), yardsticks, NOW)).toEqual({ urgency: "high", reasons: ["Split for 9 days"] });
    expect(urgencyOf(issue({ importance: 2 }), yardsticks, NOW).urgency).toBe("medium");
    expect(urgencyOf(issue({}), yardsticks, NOW).urgency).toBe("low");
  });

  it("never makes nearly every issue Critical when most share one value (95 issues on 1 mark, 5 on 2)", () => {
    const crowd = spread([...Array(95).fill(1), ...Array(5).fill(2)]);
    expect(topShare(crowd, 0.1)).toBe(2);
    expect(topShare(crowd, 0.3)).toBe(2);
    const yard = yardsticksFor(crowd);
    expect(urgencyOf(issue({ importance: 1 }), yard, NOW).urgency).toBe("medium");
    expect(urgencyOf(issue({ importance: 2 }), yard, NOW).urgency).toBe("critical");
    // Everyone on the same mark: nothing stands out, so nothing is Critical or High.
    expect(topShare(spread(Array(100).fill(1)), 0.1)).toBe(0);
    // Issues with nothing marked count towards the project's work but never qualify.
    expect(topShare(spread([...Array(90).fill(0), ...Array(10).fill(1)]), 0.1)).toBe(1);
    expect(topShare(spread([...Array(50).fill(0), ...Array(50).fill(1)]), 0.1)).toBe(0);
  });

  it("judges against the project's own work, so a project with nothing marked has no Critical issue", () => {
    expect(urgencyOf(issue({ importance: 5 }), yardsticksFor([]), NOW).urgency).toBe("medium");
  });
});

/** Your call (#your-call): what a person's plain answer sends to the agents, and who may give it. */
describe("Your call answers", () => {
  const posted = () => (vi.mocked(addCommentAction).mock.calls.at(-1)![1] as FormData).get("body") as string;
  const issue = (over: Record<string, unknown> = {}) => ({ reporterId: "dave", beneficiaryUserId: "dave", substatus: "requires_confirmation", ...over });

  beforeEach(() => {
    vi.mocked(addCommentAction).mockClear();
    bugFindFirst.mockResolvedValue(issue());
  });

  it("posts a yes or a no as a comment that starts with the decision line, with the note after it", async () => {
    expect(await answerYourCallAction("bug-1", "confirm", "yes", "  Keep it simple.  ")).toEqual({ ok: true });
    expect(posted()).toBe("**Decision from the owner:** Yes, this is a real problem. Please go ahead and fix it.\n\nKeep it simple.");
    bugFindFirst.mockResolvedValue(issue({ substatus: "requires_review" }));
    await answerYourCallAction("bug-1", "merge", "no", "");
    expect(posted()).toBe("**Decision from the owner:** No, the fix is not ready yet. Please do not merge it.");
  });

  it("is only for the person the issue is for or an admin, and only while the agents are still split", async () => {
    bugFindFirst.mockResolvedValue(issue({ reporterId: "ann", beneficiaryUserId: "ann" }));
    expect(await answerYourCallAction("bug-1", "confirm", "yes", "")).toEqual({ error: "Only the person this issue is for, or an admin, can answer for it." });
    expect(addCommentAction).not.toHaveBeenCalled();
    vi.mocked(currentTenantAccess).mockResolvedValueOnce({ membershipRole: "admin" } as never);
    expect(await answerYourCallAction("bug-1", "confirm", "yes", "")).toEqual({ ok: true });
    bugFindFirst.mockResolvedValue(issue({ substatus: "open" }));
    expect(await answerYourCallAction("bug-1", "confirm", "yes", "")).toEqual({ error: "The agents are no longer split on this one." });
    bugFindFirst.mockResolvedValue(null);
    expect(await answerYourCallAction("gone", "confirm", "yes", "")).toEqual({ error: "Issue not found" });
  });

  it("refuses anything but yes or no, and tells the person if the comment could not be posted", async () => {
    expect(await answerYourCallAction("bug-1", "confirm", "maybe" as never, "")).toEqual({ error: "Pick yes or no." });
    expect(addCommentAction).not.toHaveBeenCalled();
    vi.mocked(addCommentAction).mockResolvedValueOnce({ error: "Issue not found" });
    expect(await answerYourCallAction("bug-1", "confirm", "no", "")).toEqual({ error: "Issue not found" });
  });

  it("reads an answer back only from a decision comment, in the words it was posted with", () => {
    expect(answerFrom("confirm", "**Decision from the owner:** Yes, this is a real problem. Please go ahead and fix it.")).toBe("yes");
    expect(answerFrom("confirm", "**Decision from the owner:** No, leave it. Please do not work on this.\n\nBecause.")).toBe("no");
    expect(answerFrom("merge", "**Decision from the owner:** Yes, the fix is ready. Please go ahead and merge it.")).toBe("yes");
    expect(answerFrom("merge", "**Decision from the owner:** Yes, this is a real problem. Please go ahead and fix it.")).toBeNull();
    expect(answerFrom("confirm", "Decision from the owner: Yes, this is a real problem. Please go ahead and fix it.")).toBeNull();
  });
});

/** Your call (#your-call): which issues a person sees and what counts as the agents splitting. */
describe("Your call list", () => {
  const T = (minutes: number) => new Date(Date.UTC(2026, 10, 3, 12, minutes));
  const PR = "https://github.com/acme/web/pull/1";
  const verdict = (over: Record<string, unknown>) => ({
    goodToMerge: true, summary: "Looks fine.", pullRequestUrl: PR, headSha: "head2", createdAt: T(1), changedAt: null, updatedAt: T(1),
    agentId: "a1", onBehalfOfUserId: "tess", agent: { name: "Tess's agent", ownerUserId: "tess" }, ...over,
  });
  const decision = (authorId: string, at: number) => ({ authorId, body: "**Decision from the owner:** Yes, the fix is ready. Please go ahead and merge it.", createdAt: T(at) });
  const issue = (over: Record<string, unknown> = {}) => ({
    id: "bug-9", number: 9, title: "Fix the header", summary: null, substatus: "requires_review", pullRequestUrl: PR, pullRequestHeadSha: "head2", updatedAt: T(0),
    voteCount: 0, isBoosted: false, reporterId: "dave", beneficiaryUserId: "dave", milestone: null, project: { slug: "acme" },
    deliveries: [{ beneficiaryUserId: "carl", pullRequestUrl: PR }], comments: [],
    testVerdicts: [verdict({}), verdict({ goodToMerge: false, agentId: "a2", onBehalfOfUserId: "ben", agent: { name: "Ben's agent", ownerUserId: "ben" }, createdAt: T(5), updatedAt: T(5) })],
    confirmations: [], ...over,
  });
  const load = async (issues: unknown[], viewer = { userId: "dave", isAdmin: false }) => {
    findMany.mockResolvedValueOnce(issues as never);
    const real = await vi.importActual<typeof import("@/lib/your-call")>("@/lib/your-call");
    return real.loadYourCall("p1", viewer);
  };

  it("asks only for the issues the person filed, or every issue for an admin", async () => {
    await load([]);
    expect(findMany.mock.calls.at(-1)![0].where).toMatchObject({ OR: [{ reporterId: "dave" }, { beneficiaryUserId: "dave" }] });
    await load([], { userId: "root", isAdmin: true });
    expect(findMany.mock.calls.at(-1)![0].where).not.toHaveProperty("OR");
  });

  it("lists a report only when its confirmations split, asks for neutral ones to be left out, and shows nothing when they agree", async () => {
    const confirmation = (verdict: string, agentId: string, at: number) => ({ verdict, summary: "Checked.", createdAt: T(at), agentId, agent: { name: `${agentId}'s agent` } });
    const report = (confirmations: unknown[]) => issue({ substatus: "requires_confirmation", pullRequestUrl: null, pullRequestHeadSha: null, testVerdicts: [], deliveries: [], confirmations });
    expect(await load([report([confirmation("confirm", "a", 1), confirmation("confirm", "b", 2)])])).toHaveLength(0);
    expect(await load([report([confirmation("reject", "a", 1), confirmation("reject", "b", 2)])])).toHaveLength(0);
    const [item] = await load([report([confirmation("confirm", "a", 1), confirmation("reject", "b", 2)])]);
    expect(item).toMatchObject({ kind: "confirm", number: 9 });
    expect(item!.yes).toHaveLength(1);
    expect(item!.no).toHaveLength(1);
    // Neutral confirmations never reach the list: the query leaves them out.
    const select = findMany.mock.calls.at(-1)![0].select.confirmations;
    expect(select.where).toEqual({ undoneAt: null, verdict: { in: ["confirm", "reject"] } });
  });

  it("lists a fix only when judgements on its current commit split, leaving out old commits and the people who delivered it", async () => {
    expect(await load([issue()])).toHaveLength(1);
    // A verdict on an earlier pull request link says nothing about this one.
    const otherLink = issue({ testVerdicts: [verdict({}), verdict({ goodToMerge: false, pullRequestUrl: "https://github.com/acme/web/pull/0", agentId: "a2", onBehalfOfUserId: "ben", agent: { name: "Ben's agent", ownerUserId: "ben" } })] });
    expect(await load([otherLink])).toHaveLength(0);
    const oldCommit = issue({ testVerdicts: [verdict({}), verdict({ goodToMerge: false, headSha: "head1", agentId: "a2", onBehalfOfUserId: "ben", agent: { name: "Ben's agent", ownerUserId: "ben" } })] });
    expect(await load([oldCommit])).toHaveLength(0);
    const byDeliverer = issue({ testVerdicts: [verdict({}), verdict({ goodToMerge: false, agentId: "a3", onBehalfOfUserId: "carl", agent: { name: "Carl's agent", ownerUserId: "carl" } })] });
    expect(await load([byDeliverer])).toHaveLength(0);
  });

  it("counts a changed verdict from when it changed", async () => {
    const changed = issue({ testVerdicts: [verdict({ createdAt: T(1), changedAt: T(9) }), verdict({ goodToMerge: false, agentId: "a2", onBehalfOfUserId: "ben", agent: { name: "Ben's agent", ownerUserId: "ben" }, createdAt: T(5) })] });
    const [item] = await load([changed]);
    expect(item!.since).toEqual(T(9));
  });

  it("takes an answer only from the viewer or the person the issue is for, given after the split", async () => {
    const [none] = await load([issue({ comments: [decision("mallory", 20)] })]);
    expect(none!.answer).toBeNull();
    const [early] = await load([issue({ comments: [decision("dave", 2)] })]);
    expect(early!.answer).toBeNull();
    const [answered] = await load([issue({ comments: [decision("dave", 20)] })]);
    expect(answered!.answer).toBe("yes");
  });
});
