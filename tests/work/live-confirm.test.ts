import { beforeEach, describe, expect, it, vi } from "vitest";

/** On prod needs three people other than the solver (#live-confirm): one agent's prod report doesn't move the issue, the solver's reports don't count, and a lower report moves at once. */
const db = vi.hoisted(() => {
  // Each person's latest report (#live-payout): owner -> environment.
  const reports = new Map<string, string>();
  const tx = {
    bug: { findFirst: vi.fn(), update: vi.fn() },
    bugActivity: { create: vi.fn() },
    deploymentReport: {
      upsert: vi.fn(async ({ create }: { create: { onBehalfOfUserId: string; environment: string } }) => {
        reports.set(create.onBehalfOfUserId, create.environment);
      }),
      findMany: vi.fn(async ({ where }: { where: { environment?: string } }) =>
        [...reports].filter(([, environment]) => !where.environment || environment === where.environment).map(([onBehalfOfUserId]) => ({ onBehalfOfUserId }))),
    },
  };
  return { $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)), tx, reports };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agent-api/events", () => ({ publish: vi.fn() }));
vi.mock("@/lib/agents/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/coins/issue-payout", () => ({
  LIVE_REPORTS_NEEDED: 3,
  releasePayoutIfLive: vi.fn(async () => false),
  liveReporters: vi.fn(async () => []),
}));

import { reportDeployment } from "@/lib/agent-api/deployment";

const scope = { organisationId: "t1", projectId: "p1" };
const agent = (owner: string) => ({ agentId: `agent-${owner}`, ownerId: owner, organisationId: "t1" });
const prod = { environment: "prod", note: "Saw build 1.4.2 on app.zedu.chat with the fix." };

/** A Live issue On staging, solved by Cara. */
let bug: { id: string; organisationId: string; status: string; substatus: string; assigneeId: string };

beforeEach(() => {
  vi.clearAllMocks();
  db.reports.clear();
  bug = { id: "bug1", organisationId: "t1", status: "resolved", substatus: "on_staging", assigneeId: "cara" };
  db.tx.bug.findFirst.mockImplementation(async () => ({ ...bug }));
  db.tx.bug.update.mockImplementation(async ({ data }: { data: { substatus: string } }) => {
    bug.substatus = data.substatus;
  });
});

describe("reportDeployment on prod (#live-confirm)", () => {
  it("keeps the issue where it is until three different people report prod", async () => {
    const first = await reportDeployment(agent("erin"), scope, "bug1", prod);
    expect(first).toMatchObject({ substatus: "on_staging", changed: false, prodReports: 1 });
    const second = await reportDeployment(agent("femi"), scope, "bug1", prod);
    expect(second).toMatchObject({ substatus: "on_staging", changed: false, prodReports: 2 });
    const third = await reportDeployment(agent("gbenga"), scope, "bug1", prod);
    expect(third).toMatchObject({ substatus: "on_prod", previousSubstatus: "on_staging", changed: true, prodReports: 3 });
  });

  it("counts the same person once, however often they report", async () => {
    await reportDeployment(agent("erin"), scope, "bug1", prod);
    const again = await reportDeployment(agent("erin"), scope, "bug1", prod);
    expect(again).toMatchObject({ substatus: "on_staging", prodReports: 1 });
  });

  it("doesn't count the solver's own prod report", async () => {
    await reportDeployment(agent("erin"), scope, "bug1", prod);
    await reportDeployment(agent("femi"), scope, "bug1", prod);
    const solver = await reportDeployment(agent("cara"), scope, "bug1", prod);
    expect(solver).toMatchObject({ substatus: "on_staging", changed: false, prodReports: 2 });
  });

  it("moves at once to a lower environment, and that person's report stops counting for prod", async () => {
    await reportDeployment(agent("erin"), scope, "bug1", prod);
    const dev = await reportDeployment(agent("erin"), scope, "bug1", { environment: "dev", note: "Only on the dev server." });
    expect(dev).toMatchObject({ substatus: "on_dev", changed: true, prodReports: 0 });
  });

  it("only takes reports on Live issues", async () => {
    bug.status = "in_progress";
    await expect(reportDeployment(agent("erin"), scope, "bug1", prod)).rejects.toMatchObject({ status: 409 });
  });
});
