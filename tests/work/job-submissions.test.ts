import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  job: { findFirst: vi.fn() },
  jobSubmission: {
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agents/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/jobs/review", () => ({ createJobReviewOffers: vi.fn(async () => 0) }));

import { submitJobRow } from "@/lib/jobs/submit";
import type { AgentContext } from "@/lib/agents/require-agent";

const job = {
  id: "job-1",
  tenantId: "tenant-1",
  projectId: "project-1",
  dedupeKey: "sourceId",
  maxSubmissions: 1,
  pointsPerAccepted: 10,
  submissionSchema: null,
};

const agent = (agentId: string, ownerId: string) =>
  ({
    agentId,
    ownerId,
    tenantId: "tenant-1",
    projectId: "project-1",
    projectSlug: "ziki",
    level: "working",
    burst: false,
    keyId: `key-${agentId}`,
  }) as AgentContext;

describe("research job submissions", () => {
  let rows: Record<string, unknown>[];
  let lockTail: Promise<void>;
  let lockStatements: { sql: string; values: unknown[] }[];

  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    lockTail = Promise.resolve();
    lockStatements = [];
    db.job.findFirst.mockResolvedValue(job);
    db.jobSubmission.findFirst.mockImplementation(async ({ where }: { where: { jobId: string; dedupeKey: string } }) =>
      rows.find((row) => row.jobId === where.jobId && row.dedupeKey === where.dedupeKey) ?? null,
    );
    db.jobSubmission.count.mockImplementation(async () => {
      const count = rows.length;
      await Promise.resolve();
      return count;
    });
    db.jobSubmission.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      if (rows.some((row) => row.jobId === data.jobId && row.dedupeKey === data.dedupeKey)) {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "6",
          meta: { target: ["jobId", "dedupeKey"] },
        });
      }
      const row = { id: `submission-${rows.length + 1}`, ...data, reviewsNeeded: 2 };
      rows.push(row);
      return row;
    });
    db.$transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => {
      let releaseLock = () => {};
      const tx = {
        job: db.job,
        jobSubmission: db.jobSubmission,
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = strings.join("?");
          if (sql.includes("FOR UPDATE")) {
            const previous = lockTail;
            lockTail = new Promise<void>((resolve) => {
              releaseLock = resolve;
            });
            await previous;
            lockStatements.push({ sql, values });
          }
          return [{ id: job.id }];
        },
      };
      try {
        return await run(tx);
      } finally {
        releaseLock();
      }
    });
  });

  it("serializes two concurrent submissions for the last available slot", async () => {
    const results = await Promise.allSettled([
      submitJobRow(agent("agent-1", "owner-1"), job.id, { data: { sourceId: "row-1" } }),
      submitJobRow(agent("agent-2", "owner-2"), job.id, { data: { sourceId: "row-2" } }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { status: 409, message: "This job has reached its maximum number of submissions." },
    });
    expect(rows).toHaveLength(1);
    expect(lockStatements).toHaveLength(2);
    expect(lockStatements[0].sql).toContain('FROM "Job"');
    expect(lockStatements[0].sql).toContain("FOR UPDATE");
    expect(lockStatements[0].values).toEqual([job.id, job.tenantId]);
  });

  it("maps a dedupe unique-constraint race to 409 already submitted", async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6",
      meta: { target: ["jobId", "dedupeKey"] },
    });
    db.jobSubmission.create.mockRejectedValueOnce(duplicate);

    await expect(
      submitJobRow(agent("agent-1", "owner-1"), job.id, { data: { sourceId: "row-1" } }),
    ).rejects.toMatchObject({
      status: 409,
      message: "A row with this sourceId was already submitted.",
    });
  });

  it("does not reclassify an unrelated unique-constraint error", async () => {
    const unrelated = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6",
      meta: { target: ["id"] },
    });
    db.jobSubmission.create.mockRejectedValueOnce(unrelated);

    await expect(
      submitJobRow(agent("agent-1", "owner-1"), job.id, { data: { sourceId: "row-1" } }),
    ).rejects.toBe(unrelated);
  });
});
