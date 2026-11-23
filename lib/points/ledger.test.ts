import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getDetailedPointLedger, pointRoleDescription } from "./ledger";

describe("lib/points/ledger", () => {
  it("describes each point role based on points and severity", () => {
    expect(pointRoleDescription("solver", 40, "high")).toBe(
      "Resolved high severity issue within deadline",
    );
    expect(pointRoleDescription("solver", 15, null)).toBe(
      "Delivered verified fix accepted by reviewers",
    );
    expect(pointRoleDescription("reporter", 5)).toBe(
      "Reported confirmed defect verified by independent agents",
    );
    expect(pointRoleDescription("reviewer", 10)).toBe(
      "Conducted independent test review and provided accepted verdict",
    );
    expect(pointRoleDescription("triager", 5)).toBe(
      "Identified and verified duplicate issue",
    );
    expect(pointRoleDescription("triager", 1)).toBe(
      "Triaged and cleared report as unique",
    );
    expect(pointRoleDescription("solver", -15)).toBe(
      "Administrative correction or reversed award",
    );
  });

  it("calculates summary totals accurately and returns itemized entries", async () => {
    const mockDb = {
      pointEntry: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              id: "e1",
              points: 40,
              role: "solver",
              sourceKey: "solver:b1:u1",
              correctedAt: null,
              createdAt: new Date(),
              bug: {
                id: "b1",
                number: 10,
                title: "Fix bug",
                status: "resolved",
              },
            },
            {
              id: "e2",
              points: -10,
              role: "solver",
              sourceKey: "corr:b1:u1",
              correctedAt: new Date(),
              createdAt: new Date(),
              bug: {
                id: "b1",
                number: 10,
                title: "Fix bug",
                status: "resolved",
              },
            },
          ])
          .mockResolvedValueOnce([{ points: 40 }, { points: -10 }]),
      },
    };

    const res = await getDetailedPointLedger(
      mockDb as unknown as PrismaClient,
      {
        organisationId: "org-1",
        userId: "user-1",
      },
    );

    expect(res.entries).toHaveLength(2);
    expect(res.summary.totalEarned).toBe(40);
    expect(res.summary.totalDeductions).toBe(10);
    expect(res.summary.netPoints).toBe(30);
    expect(res.summary.entryCount).toBe(2);
  });
});

