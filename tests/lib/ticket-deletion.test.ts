import { describe, expect, it } from "vitest";
import {
  deleteSummary,
  deletedSummary,
  deletionCounts,
  restoreSummary,
} from "@/lib/ticket-deletion";
import { buildVoterSummary, type RawVoterRow } from "@/lib/voters";

/**
 * Delete and restore messages count what the vote button shows (#413). Since
 * downvotes were removed (#1059), old dislike rows (value -1) still come back
 * from lib/voter-summaries.ts and fill the dislikes bucket; they are history,
 * not marks anyone can see, so no message may count them.
 */
const row = (userId: string, value: number, rn: number, total: number): RawVoterRow => ({
  bugId: "bug_1",
  value,
  userId,
  name: userId,
  image: null,
  total_count: BigInt(total),
  rn: BigInt(rn),
});

describe("delete and restore wording with an old dislike row (#413)", () => {
  it("counts the two upvotes, not the three vote rows", () => {
    const voters = buildVoterSummary([
      row("ada", 1, 1, 2),
      row("bob", 1, 2, 2),
      row("cy", -1, 1, 1),
    ]);
    expect(voters.likes.count).toBe(2);
    expect(voters.dislikes.count).toBe(1);

    const counts = deletionCounts(4, voters);
    expect(counts).toEqual({ comments: 4, votes: 2 });

    expect(deleteSummary(counts)).toContain("Its 4 comments, 2 importance marks and history are kept.");
    expect(deletedSummary(counts)).toContain("Its 4 comments, 2 importance marks and history are kept.");
    expect(restoreSummary(counts)).toContain("with its 4 comments, 2 importance marks and history as they were.");
    for (const message of [deleteSummary(counts), deletedSummary(counts), restoreSummary(counts)]) {
      expect(message).not.toContain("3 importance marks");
    }
  });

  it("says no importance marks when the only vote row is an old dislike", () => {
    const counts = deletionCounts(1, buildVoterSummary([row("cy", -1, 1, 1)]));
    expect(counts.votes).toBe(0);

    expect(deleteSummary(counts)).toContain("Its 1 comment, 0 importance marks and history are kept.");
    expect(deletedSummary(counts)).toContain("Its 1 comment, 0 importance marks and history are kept.");
    expect(restoreSummary(counts)).toContain("with its 1 comment, 0 importance marks and history as they were.");
  });

  it("uses the singular for one upvote alongside old dislikes", () => {
    const counts = deletionCounts(0, buildVoterSummary([
      row("ada", 1, 1, 1),
      row("cy", -1, 1, 2),
      row("dee", -1, 2, 2),
    ]));
    expect(counts.votes).toBe(1);

    expect(deleteSummary(counts)).toContain("Its 0 comments, 1 importance mark and history are kept.");
    expect(restoreSummary(counts)).toContain("with its 0 comments, 1 importance mark and history as they were.");
  });
});
