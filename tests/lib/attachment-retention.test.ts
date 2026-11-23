import { describe, expect, it, vi } from "vitest";
import {
  DELETED_PARENT_ATTACHMENT_TTL_DAYS,
  DELETED_PARENT_ATTACHMENT_TTL_MS,
  sweepOrphanedAttachments,
} from "@/lib/attachment-retention";

/**
 * A deleted issue keeps its attachments for a grace period so a restore brings
 * them back (#596); the sweep removes them only after that (#658).
 */

type Where = Record<string, unknown>;

/** Attachments on issues deleted `daysAgo` days before `now`, in memory. */
function fakeDb(rows: { id: string; bugDeletedAt: Date | null; bugIsDeleted: boolean }[]) {
  const matchesDeletedParent = (row: (typeof rows)[number], where: Where) => {
    const or = (where.OR ?? []) as { bug?: { isDeleted: boolean; OR: Where[] } }[];
    return or.some((clause) => {
      const bug = clause.bug;
      if (!bug || !row.bugIsDeleted) return false;
      return bug.OR.some((cond) => {
        if (cond.deletedAt === null) return row.bugDeletedAt === null;
        const lt = (cond.deletedAt as { lt: Date }).lt;
        return row.bugDeletedAt !== null && row.bugDeletedAt < lt;
      });
    });
  };
  const deleted: string[] = [];
  const db = {
    attachment: {
      findMany: vi.fn(async ({ where }: { where: Where }) => {
        if (!("OR" in where)) return [];
        return rows.filter((row) => matchesDeletedParent(row, where)).map(({ id }) => ({ id }));
      }),
      deleteMany: vi.fn(async ({ where }: { where: Where }) => {
        if (!("OR" in where)) return { count: 0 };
        const ids = (where.id as { in: string[] }).in;
        const hit = rows.filter((row) => ids.includes(row.id) && matchesDeletedParent(row, where));
        deleted.push(...hit.map((row) => row.id));
        return { count: hit.length };
      }),
    },
  };
  return { db, deleted };
}

const now = new Date("2026-11-23T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

describe("sweepOrphanedAttachments: deleted issues (#596)", () => {
  it("keeps the attachments of an issue deleted within the grace period", async () => {
    const { db, deleted } = fakeDb([{ id: "att-recent", bugDeletedAt: daysAgo(2), bugIsDeleted: true }]);

    const result = await sweepOrphanedAttachments(db as never, { now, sweep: true });

    expect(deleted).toEqual([]);
    expect(result.deletedParents).toBe(0);
  });

  it(`removes them once the issue has been deleted for more than ${DELETED_PARENT_ATTACHMENT_TTL_DAYS} days`, async () => {
    const { db, deleted } = fakeDb([
      { id: "att-old", bugDeletedAt: daysAgo(DELETED_PARENT_ATTACHMENT_TTL_DAYS + 1), bugIsDeleted: true },
      { id: "att-recent", bugDeletedAt: daysAgo(1), bugIsDeleted: true },
      { id: "att-live", bugDeletedAt: null, bugIsDeleted: false },
    ]);

    const result = await sweepOrphanedAttachments(db as never, { now, sweep: true });

    expect(deleted).toEqual(["att-old"]);
    expect(result.deletedParents).toBe(1);
  });

  it("treats a deleted issue with no deletedAt as past its grace period", async () => {
    const { db, deleted } = fakeDb([{ id: "att-legacy", bugDeletedAt: null, bugIsDeleted: true }]);

    await sweepOrphanedAttachments(db as never, { now, sweep: true });

    expect(deleted).toEqual(["att-legacy"]);
  });

  it("re-checks the parent when deleting, so an issue restored in between keeps its files", async () => {
    const { db } = fakeDb([{ id: "att-old", bugDeletedAt: daysAgo(40), bugIsDeleted: true }]);

    await sweepOrphanedAttachments(db as never, { now, sweep: true });

    const deleteWhere = db.attachment.deleteMany.mock.calls
      .map(([args]) => args.where)
      .find((where) => "OR" in where) as Where;
    expect(deleteWhere.id).toEqual({ in: ["att-old"] });
    expect(deleteWhere.OR).toEqual([
      { bug: { isDeleted: true, OR: [{ deletedAt: null }, { deletedAt: { lt: daysAgo(DELETED_PARENT_ATTACHMENT_TTL_DAYS) } }] } },
      { idea: { isDeleted: true, OR: [{ deletedAt: null }, { deletedAt: { lt: daysAgo(DELETED_PARENT_ATTACHMENT_TTL_DAYS) } }] } },
    ]);
  });

  it("measures the grace period in days", () => {
    expect(DELETED_PARENT_ATTACHMENT_TTL_MS).toBe(DELETED_PARENT_ATTACHMENT_TTL_DAYS * 24 * 60 * 60 * 1000);
  });
});
