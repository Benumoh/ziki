import { marketingIdeaFieldsSchema } from "@/lib/validations/marketing";
import { reopenSubstatus, trackRules } from "@/lib/marketing/track";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "@/lib/agents/require-agent";
import { resetWorkflowCache, soloWorkflow } from "@/lib/workflow";
import { DEFAULT_PROJECT_WORKFLOW } from "@/lib/workflow-config";

/** Idea verdicts and conversion (#idea-table, #727): verdict weights, the score, the threshold, conversion to an issue at Requires confirmation, and rejecting a bad idea. */
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  ideaVerdict: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  idea: { update: vi.fn(), findUniqueOrThrow: vi.fn() },
  bug: { create: vi.fn(), update: vi.fn() },
  issueClaim: { count: vi.fn(async () => 0), create: vi.fn(async () => ({ id: "c1" })) },
  user: { findUnique: vi.fn(async () => ({ name: "Ada" })) },
  bugActivity: { createMany: vi.fn() },
  attachment: { updateMany: vi.fn() },
  securityFinding: { updateMany: vi.fn() },
  issueStake: { updateMany: vi.fn(), findMany: vi.fn(async () => []), update: vi.fn() },
  projectWorkflow: { findUnique: vi.fn() },
}));
const publish = vi.hoisted(() => vi.fn());
const audit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agent-api/events", () => ({ publish }));
vi.mock("@/lib/agents/audit", () => ({ audit }));

import { convertClientVettedIdea, convertIdea, convertVettedIdea, giveIdeaVerdict, maxVotesFor, rejectIdea, verdictScore } from "@/lib/agent-api/idea-verdicts";
import { formatRejectDetail, ideaNextStep } from "@/lib/next-step";

/** The locked idea row (#idea-table): ideas have their own table, numbers and status. */
const idea = (overrides: Record<string, unknown> = {}) => ({
  id: "i1",
  number: 7,
  organisationId: "t1",
  projectId: "p1",
  status: "open", substatus: "open",
  track: "product",
  source: "internal",
  score: 3,
  reporterId: "ada",
  beneficiaryUserId: "ada",
  createdByOwnerId: "ada",
  ...overrides,
});

const report = {
  title: "Show an icon for the activity log",
  summary: "The activity list is long and hard to scan without an icon.",
  description: "The activity list is long.",
  typeId: null,
  areaId: null,
  proofLinks: [],
  reporterId: "ada",
  beneficiaryUserId: "ada",
  createdByAgentId: "agent-ada",
};

const input = { opinion: "good" as const, summary: "Useful. It saves a click.", description: "The activity list is long; an icon would keep the page short." };
const person = { organisationId: "t1", userId: "bob" };

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkflowCache();
  db.$transaction.mockImplementation((run: (tx: unknown) => unknown) => run(db));
  db.$queryRaw.mockResolvedValue([idea()]);
  db.ideaVerdict.findUnique.mockResolvedValue(null);
  db.ideaVerdict.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({ id: "v1", ...create }));
  db.ideaVerdict.findMany.mockResolvedValue([{ opinion: "good", votes: 1 }]);
  db.projectWorkflow.findUnique.mockResolvedValue(null);
  db.idea.findUniqueOrThrow.mockResolvedValue(report);
  db.bug.create.mockResolvedValue({ id: "b9", number: 42 });
});

describe("Solo projects (#solo)", () => {
  it("need one vote at every step, from the owner's own agents or the owner, and no other person's approval", () => {
    const solo = soloWorkflow({ ...DEFAULT_PROJECT_WORKFLOW });
    expect(solo).toMatchObject({ confirmationsNeeded: 1, verdictsNeeded: 1, ideaThreshold: 1, awardThreshold: 1, acceptThreshold: 1, humanApprovalsNeeded: 0 });
    // The rest of the project's dials stay as they were.
    expect(solo.deliveryMinutes).toBe(DEFAULT_PROJECT_WORKFLOW.deliveryMinutes);
  });
});

describe("the verdict rules", () => {

  it("gives managers and mergers up to the project's manager vote weight, everyone else 1", () => {
    for (const weight of [3, 4]) {
      expect(maxVotesFor(person, weight)).toBe(1);
      expect(maxVotesFor({ ...person, agent: { id: "a", level: "working" } }, weight)).toBe(1);
      expect(maxVotesFor({ ...person, agent: { id: "a", level: "manager" } }, weight)).toBe(weight);
      expect(maxVotesFor({ ...person, agent: { id: "a", level: "merger" } }, weight)).toBe(weight);
    }
  });

  it("scores good minus bad, neutral adding nothing", () => {
    expect(verdictScore([{ opinion: "good", votes: 5 }, { opinion: "bad", votes: 1 }, { opinion: "neutral", votes: 3 }])).toBe(4);
  });
});

describe("giveIdeaVerdict", () => {
  // An idea still short of the threshold (3), so a good verdict counts.
  beforeEach(() => {
    db.$queryRaw.mockResolvedValue([idea({ score: 0 })]);
  });

  it("records the verdict on the idea and rescores it, paying nothing (#one-payment)", async () => {
    const result = await giveIdeaVerdict(person, "p1", "7", input);
    expect(db.ideaVerdict.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { ideaId_onBehalfOfUserId_weightClass: { ideaId: "i1", onBehalfOfUserId: "bob", weightClass: "working" } },
      create: expect.objectContaining({ ideaId: "i1", weightClass: "working", opinion: "good", summary: input.summary, description: input.description }),
    }));
    expect(db.idea.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { score: 1 } });
    expect(result).toMatchObject({ ideaScore: 1, ideaThreshold: 3, convertible: false, replaced: false });
    expect(result).not.toHaveProperty("pointsAwarded");
    // An idea's event names its project: there is no issue for the trigger to read it from.
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({
      type: "idea.verdict",
      projectId: "p1",
      payload: expect.objectContaining({ ideaId: "i1", ideaNumber: 7 }),
    }));
    expect(publish.mock.calls[0][1]).not.toHaveProperty("bugId");
  });

  it("replaces the person's earlier verdict", async () => {
    db.ideaVerdict.findUnique.mockResolvedValue({ id: "v1" });
    const result = await giveIdeaVerdict(person, "p1", "i1", { ...input, opinion: "bad" });
    expect(result).toMatchObject({ replaced: true });
  });

  it("takes a verdict from the idea's own reporter (#owner-agents)", async () => {
    db.$queryRaw.mockResolvedValue([idea({ score: 0 })]);
    const result = await giveIdeaVerdict({ organisationId: "t1", userId: "ada" }, "p1", "i1", input);
    expect(result).toMatchObject({ replaced: false });
    expect(db.ideaVerdict.upsert).toHaveBeenCalled();
  });

  it("refuses votes on marketing ideas already rejected or converted", async () => {
    db.$queryRaw.mockResolvedValue([idea({ track: "marketing", status: "rejected" })]);
    await expect(giveIdeaVerdict(person, "p1", "i1", input)).rejects.toMatchObject({ status: 409, body: { error: "idea_rejected" } });
    db.$queryRaw.mockResolvedValue([idea({ track: "marketing", status: "converted" })]);
    await expect(giveIdeaVerdict(person, "p1", "i1", input)).rejects.toMatchObject({ status: 409, body: { error: "idea_converted" } });
    expect(db.ideaVerdict.upsert).not.toHaveBeenCalled();
  });

  it("locks the idea inside its organisation and project before applying a verdict", async () => {
    await giveIdeaVerdict(person, "p1", "7", input);
    const [query, organisationId, projectId] = db.$queryRaw.mock.calls[0] as [TemplateStringsArray, string, string, ...unknown[]];
    const sql = query.join("?");
    expect(organisationId).toBe("t1");
    expect(projectId).toBe("p1");
    expect(sql).toContain('WHERE i."organisationId" = ?');
    expect(sql).toContain('AND i."projectId" = ?');
    expect(sql).toContain("FOR NO KEY UPDATE OF i");
  });

  it("refuses another good verdict once the idea reached the threshold (#727)", async () => {
    db.$queryRaw.mockResolvedValue([idea({ score: 3 })]);
    await expect(giveIdeaVerdict(person, "p1", "i1", input)).rejects.toMatchObject({
      status: 409,
      body: { error: "enough_verdicts", ideaScore: 3, ideaThreshold: 3 },
    });
    // A bad verdict on the way in doesn't turn it into a good one either.
    db.ideaVerdict.findUnique.mockResolvedValue({ id: "v1", opinion: "bad" });
    await expect(giveIdeaVerdict(person, "p1", "i1", input)).rejects.toMatchObject({ status: 409, body: { error: "enough_verdicts" } });
    expect(db.ideaVerdict.upsert).not.toHaveBeenCalled();
  });

  it("still takes a bad verdict at the threshold, so a late problem can stop the idea (#727)", async () => {
    db.$queryRaw.mockResolvedValue([idea({ score: 3 })]);
    db.ideaVerdict.findMany.mockResolvedValue([{ opinion: "good", votes: 3 }, { opinion: "bad", votes: 1 }]);
    const result = await giveIdeaVerdict(person, "p1", "i1", { ...input, opinion: "bad" });
    expect(result).toMatchObject({ ideaScore: 2, convertible: false });
    expect(db.ideaVerdict.upsert).toHaveBeenCalled();
  });

  it("refuses more votes than the giver may give", async () => {
    await expect(giveIdeaVerdict(person, "p1", "i1", { ...input, votes: 2 })).rejects.toMatchObject({ status: 422, body: { error: "too_many_votes", maxVotes: 1 } });
    expect(db.ideaVerdict.upsert).not.toHaveBeenCalled();
  });

  it("opens a marketing idea on the verdict that reaches its threshold, with no agent converting it", async () => {
    db.projectWorkflow.findUnique.mockResolvedValue(DEFAULT_PROJECT_WORKFLOW);
    db.$queryRaw.mockResolvedValue([idea({ track: "marketing", score: 2 })]);
    db.ideaVerdict.findMany.mockResolvedValue([{ opinion: "good", votes: 2 }, { opinion: "good", votes: 1 }]);

    const result = await giveIdeaVerdict(person, "p1", "7", input);

    expect(result).toMatchObject({ ideaScore: 3, convertible: false, decided: { outcome: "converted", issueId: "b9", issueNumber: 42 } });
    expect(db.bug.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ track: "marketing", status: "open", substatus: "open" }),
    }));
  });

  it("leaves a product idea at its threshold for an agent to convert", async () => {
    db.projectWorkflow.findUnique.mockResolvedValue(DEFAULT_PROJECT_WORKFLOW);
    db.$queryRaw.mockResolvedValue([idea({ track: "product", score: 2 })]);
    db.ideaVerdict.findMany.mockResolvedValue([{ opinion: "good", votes: 2 }, { opinion: "good", votes: 1 }]);

    const result = await giveIdeaVerdict(person, "p1", "7", input);

    expect(result).toMatchObject({ ideaScore: 3, convertible: true, decided: null });
    expect(db.bug.create).not.toHaveBeenCalled();
  });

  it("doesn't open a bad marketing idea at its threshold: a manager agent rejects it", async () => {
    db.projectWorkflow.findUnique.mockResolvedValue(DEFAULT_PROJECT_WORKFLOW);
    db.$queryRaw.mockResolvedValue([idea({ track: "marketing", score: 2 })]);
    db.ideaVerdict.findMany.mockResolvedValue([{ opinion: "good", votes: 3 }, { opinion: "neutral", votes: 4 }]);

    const result = await giveIdeaVerdict(person, "p1", "7", input);

    expect(result).toMatchObject({ ideaScore: 3, decided: null });
    expect(db.bug.create).not.toHaveBeenCalled();
  });

  it("converts a marketing idea to Open in the vote transaction under threshold-only governance", async () => {
    db.projectWorkflow.findUnique.mockResolvedValue({ ...DEFAULT_PROJECT_WORKFLOW, governance: "threshold" });
    db.$queryRaw.mockResolvedValue([idea({ track: "marketing", score: 2 })]);
    db.ideaVerdict.findMany.mockResolvedValue([{ opinion: "good", votes: 2 }, { opinion: "good", votes: 1 }]);

    const result = await giveIdeaVerdict(person, "p1", "7", input);

    expect(result).toMatchObject({
      ideaScore: 3,
      convertible: false,
      decided: { outcome: "converted", issueId: "b9", issueNumber: 42 },
    });
    expect(db.bug.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ track: "marketing", status: "open", substatus: "open" }),
    }));
  });

  it("rejects a bad marketing idea in the vote transaction under threshold-only governance", async () => {
    db.projectWorkflow.findUnique.mockResolvedValue({ ...DEFAULT_PROJECT_WORKFLOW, governance: "threshold" });
    db.$queryRaw.mockResolvedValue([idea({ track: "marketing", score: 1 })]);
    db.ideaVerdict.findMany.mockResolvedValue([{ opinion: "bad", votes: 2 }, { opinion: "bad", votes: 1 }]);

    const result = await giveIdeaVerdict(person, "p1", "7", { ...input, opinion: "bad" });

    expect(result).toMatchObject({ ideaScore: -3, convertible: false, decided: { outcome: "rejected" } });
    expect(db.idea.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { status: "rejected", rejectedAt: expect.any(Date), rejectedByAgentId: null },
    });
    expect(db.bug.create).not.toHaveBeenCalled();
  });

});

describe("convertIdea", () => {
  const agentOf = (level: AgentContext["level"], ownerId = "dana"): AgentContext => ({
    agentId: `agent-${ownerId}`, name: ownerId, ownerId, organisationId: "t1", level, burst: false, keyId: "k1",
  });

  it("creates the issue from the idea's report, moves its files, and marks the idea converted", async () => {
    const result = await convertIdea(agentOf("working"), "p1", "7", "complex");
    expect(result).toMatchObject({ ideaId: "i1", ideaNumber: 7, issueId: "b9", issueNumber: 42, ideaScore: 3, ideaThreshold: 3, difficulty: "complex" });
    expect(db.bug.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organisationId: "t1",
        projectId: "p1",
        title: report.title,
        summary: report.summary,
        description: report.description,
        reporterId: "ada",
        beneficiaryUserId: "ada",
        createdByAgentId: "agent-ada",
        status: "open", substatus: "requires_confirmation",
        // #plan-review: the converter's call; a complex issue's award goes through plan review.
        difficulty: "complex",
      }),
    }));
    expect(db.attachment.updateMany).toHaveBeenCalledWith({ where: { ideaId: "i1" }, data: { bugId: "b9" } });
    expect(db.idea.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { status: "converted", convertedAt: expect.any(Date), convertedByAgentId: "agent-dana", issueId: "b9" },
    });
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({
      type: "issue.converted",
      bugId: "b9",
      payload: expect.objectContaining({ ideaId: "i1", issueId: "b9", issueNumber: 42 }),
    }));
    expect(audit).toHaveBeenCalledWith(expect.anything(), "idea.converted", "idea:i1", expect.objectContaining({ issueId: "b9" }), { bugId: "b9" });
  });

  it("converts marketing ideas straight to Open and pays the beneficiary from project reporter rewards", async () => {
    db.$queryRaw.mockResolvedValue([idea({ track: "marketing" })]);

    const result = await convertIdea(agentOf("working"), "p1", "7", "medium");

    expect(result).toMatchObject({ issueId: "b9", issueNumber: 42 });
    expect(db.bug.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        track: "marketing",
        status: "open",
        substatus: "open",
      }),
    }));
  });

  it("does not subscribe the synthetic reporter of a public-source idea", async () => {
    db.$queryRaw.mockResolvedValue([idea({ source: "public" })]);

    await convertIdea(agentOf("working"), "p1", "7", "medium");

    const data = db.bug.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("watches");
  });

  it("needs an open idea and a score at the threshold", async () => {
    db.$queryRaw.mockResolvedValue([idea({ score: 2 })]);
    await expect(convertIdea(agentOf("working"), "p1", "i1", "medium")).rejects.toMatchObject({ status: 409, body: { error: "below_threshold", ideaScore: 2, ideaThreshold: 3 } });
    db.$queryRaw.mockResolvedValue([idea({ status: "converted" })]);
    await expect(convertIdea(agentOf("working"), "p1", "i1", "medium")).rejects.toMatchObject({ status: 409, body: { error: "idea_converted" } });
    expect(db.bug.create).not.toHaveBeenCalled();
    expect(db.idea.update).not.toHaveBeenCalled();
  });
});

/**
 * Already vetted (#vetted-start-now): an idea its owner says was vetted becomes an issue at once that counts as
 * confirmed, and the agent that filed it holds it In progress, with no verdicts, confirmations, bids or offer.
 */
describe("convertVettedIdea", () => {
  const owner: AgentContext = { agentId: "agent-ada", name: "ada", ownerId: "ada", organisationId: "t1", level: "working", burst: false, keyId: "k1" };

  it("makes a confirmed issue the filing agent holds at once, In progress", async () => {
    db.$queryRaw.mockResolvedValue([idea({ score: 0 })]);
    const result = await convertVettedIdea(db as never, owner, "p1", "i1", "Approved by Mark, sheet row 42", "medium");
    expect(result).toMatchObject({ ideaId: "i1", issueId: "b9", issueNumber: 42, ideaScore: 0, claimId: "c1", claimStatus: "active" });
    expect(result.deliverBy).toEqual(expect.any(String));
    expect(db.bug.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        vettedAt: expect.any(Date),
        activities: { create: expect.objectContaining({ summary: expect.stringContaining("marked already vetted: Approved by Mark, sheet row 42"), metadata: { fromIdea: 7, vettedNote: "Approved by Mark, sheet row 42" } }) },
      }),
    }));
    // The filer's agent holds it: an active claim with a delivery deadline, no offer to accept.
    expect(db.issueClaim.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ bugId: "b9", beneficiaryUserId: "ada", agentId: "agent-ada", status: "active", deliverBy: expect.any(Date) }),
    }));
    expect(db.bug.update).toHaveBeenCalledWith({ where: { id: "b9" }, data: expect.objectContaining({ assigneeId: "ada", status: "in_progress", substatus: "in_progress" }) });
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({
      type: "issue.converted",
      payload: expect.objectContaining({ via: "already_vetted", decidedByUserId: "ada", vettedNote: "Approved by Mark, sheet row 42" }),
    }));
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({
      type: "claim.accepted",
      payload: expect.objectContaining({ claimId: "c1", issueId: "b9", beneficiaryUserId: "ada", via: "already_vetted" }),
    }));
  });

  it("opens plan review instead on a complex issue", async () => {
    db.$queryRaw.mockResolvedValue([idea({ score: 0 })]);
    const result = await convertVettedIdea(db as never, owner, "p1", "i1", "Approved by Mark", "complex");
    expect(result).toMatchObject({ claimStatus: "planning", deliverBy: null });
    expect(db.issueClaim.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "planning", agentId: "agent-ada" }) }));
    expect(db.bug.update).toHaveBeenCalledWith({ where: { id: "b9" }, data: expect.objectContaining({ assigneeId: "ada", substatus: "plan_review" }) });
  });

  it("refuses at the owner's capacity, so nothing is held", async () => {
    db.$queryRaw.mockResolvedValue([idea({ score: 0 })]);
    db.issueClaim.count.mockResolvedValue(DEFAULT_PROJECT_WORKFLOW.maxActiveClaims);
    await expect(convertVettedIdea(db as never, owner, "p1", "i1", "Approved by Mark", "medium")).rejects.toMatchObject({ status: 409, body: { error: "at_capacity" } });
    expect(db.issueClaim.create).not.toHaveBeenCalled();
    expect(db.bug.update).not.toHaveBeenCalled();
  });

  it("does not convert an idea that is not open", async () => {
    db.$queryRaw.mockResolvedValue([idea({ score: 0, status: "rejected" })]);
    await expect(convertVettedIdea(db as never, owner, "p1", "i1", "Approved by Mark", "medium")).rejects.toMatchObject({ status: 409, body: { error: "idea_rejected" } });
    expect(db.bug.create).not.toHaveBeenCalled();
  });
});

describe("convertClientVettedIdea", () => {
  it("opens a vetted issue and links the private finding without inventing an agent claim", async () => {
    db.$queryRaw.mockResolvedValue([idea({ score: 0 })]);
    await convertClientVettedIdea(db as never, { organisationId: "t1", projectId: "p1" }, "i1", "ada");

    expect(db.bug.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ substatus: "open", vettedAt: expect.any(Date) }),
    }));
    expect(db.securityFinding.updateMany).toHaveBeenCalledWith({
      where: { ideaId: "i1" }, data: { bugId: "b9" },
    });
    expect(db.issueClaim.create).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({
      type: "issue.converted", actorAgentId: null,
      payload: expect.objectContaining({ via: "already_vetted", decidedByAgentId: null }),
    }));
  });
});

describe("rejectIdea (#idea-rejected)", () => {
  const manager = (level: AgentContext["level"], ownerId = "dana"): AgentContext => ({
    agentId: `agent-${ownerId}`, name: ownerId, ownerId, organisationId: "t1", level, burst: false, keyId: "k1",
  });
  const verdicts = (good: number, bad: number) => [
    ...Array.from({ length: good }, () => ({ opinion: "good", votes: 1 })),
    ...Array.from({ length: bad }, () => ({ opinion: "bad", votes: 1 })),
  ];

  it("rejects a bad idea (votes reach the threshold, more bad than good), and says so", async () => {
    db.ideaVerdict.findMany.mockResolvedValue(verdicts(2, 4));
    const result = await rejectIdea(manager("manager"), "p1", "7");
    expect(result).toMatchObject({ ideaId: "i1", ideaNumber: 7, status: "rejected", totalVotes: 6, goodVotes: 2, rejectReason: null });
    expect(db.idea.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { status: "rejected", rejectedAt: expect.any(Date), rejectedByAgentId: "agent-dana", rejectReason: null },
    });
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({
      type: "idea.rejected",
      projectId: "p1",
      payload: expect.objectContaining({ ideaId: "i1", ideaNumber: 7, totalVotes: 6, goodVotes: 2 }),
    }));
    expect(audit).toHaveBeenCalledWith(expect.anything(), "idea.rejected", "idea:i1", { totalVotes: 6, goodVotes: 2 });
  });

  it("records rejectReason when provided and publishes it", async () => {
    db.ideaVerdict.findMany.mockResolvedValue(verdicts(2, 4));
    const result = await rejectIdea(manager("manager"), "p1", "7", "it doesn't align with the product's vision");
    expect(result).toMatchObject({
      ideaId: "i1",
      ideaNumber: 7,
      status: "rejected",
      rejectReason: "it doesn't align with the product's vision",
      totalVotes: 6,
      goodVotes: 2,
    });
    expect(db.idea.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: {
        status: "rejected",
        rejectedAt: expect.any(Date),
        rejectedByAgentId: "agent-dana",
        rejectReason: "it doesn't align with the product's vision",
      },
    });
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({
      type: "idea.rejected",
      projectId: "p1",
      payload: expect.objectContaining({
        ideaId: "i1",
        ideaNumber: 7,
        totalVotes: 6,
        goodVotes: 2,
        rejectReason: "it doesn't align with the product's vision",
      }),
    }));
    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      "idea.rejected",
      "idea:i1",
      { totalVotes: 6, goodVotes: 2, reason: "it doesn't align with the product's vision" },
    );
  });

  it("needs a manager agent", async () => {
    db.ideaVerdict.findMany.mockResolvedValue(verdicts(0, 6));
    await expect(rejectIdea(manager("working"), "p1", "i1")).rejects.toMatchObject({ name: "AgentLevelError" });
    expect(db.idea.update).not.toHaveBeenCalled();
  });

  it("refuses an idea below the idea threshold, or with as many good votes as others, as not_rejectable", async () => {
    // The project's idea threshold is the default, 3.
    db.ideaVerdict.findMany.mockResolvedValue(verdicts(0, 2));
    await expect(rejectIdea(manager("manager"), "p1", "i1")).rejects.toMatchObject({ status: 409, body: { error: "not_rejectable", totalVotes: 2, goodVotes: 0 } });
    db.ideaVerdict.findMany.mockResolvedValue(verdicts(2, 2));
    await expect(rejectIdea(manager("manager"), "p1", "i1")).rejects.toMatchObject({ status: 409, body: { error: "not_rejectable", totalVotes: 4, goodVotes: 2 } });
    expect(db.idea.update).not.toHaveBeenCalled();
  });

  describe("ideaNextStep for rejected ideas (#idea-rejected)", () => {
    it("formats rejectReason with context to why it was rejected", () => {
      const step = ideaNextStep({
        status: "rejected",
        score: 1,
        threshold: 3,
        totalVotes: 3,
        bad: true,
        convertible: false,
        issueNumber: null,
        rejectReason: "it doesn't align with the product's vision",
      });
      expect(step).toEqual({
        tone: "bad",
        title: "Idea rejected",
        detail: "Idea rejected because it doesn't align with the product's vision.",
        actor: null,
        action: null,
      });
    });

    it("handles various reason casings and prefixes cleanly", () => {
      expect(formatRejectDetail("because it doesn't align with the product's vision")).toBe(
        "Idea rejected because it doesn't align with the product's vision.",
      );
      expect(formatRejectDetail("Idea rejected because it doesn't align with the product's vision.")).toBe(
        "Idea rejected because it doesn't align with the product's vision.",
      );
      expect(formatRejectDetail("It doesn't align with the product's vision.")).toBe(
        "Idea rejected because it doesn't align with the product's vision.",
      );
    });

    it("falls back to generic manager agent message when no reason is given", () => {
      const step = ideaNextStep({
        status: "rejected",
        score: 1,
        threshold: 3,
        totalVotes: 3,
        bad: true,
        convertible: false,
        issueNumber: null,
        rejectReason: null,
      });
      expect(step.detail).toBe("A manager agent rejected it. It takes no more verdicts.");
    });
  });
});

describe("the marketing track at conversion", () => {
  it("skips confirmation for marketing and keeps it for product", () => {
    expect(trackRules("marketing").convertsTo).toBe("open");
    expect(trackRules("product").convertsTo).toBe("requires_confirmation");
  });

  it("reopens marketing work to Open, with no confirmation step to return to", () => {
    expect(reopenSubstatus("marketing", false)).toBe("open");
    expect(reopenSubstatus("product", false)).toBe("requires_confirmation");
    expect(reopenSubstatus("product", true)).toBe("open");
  });

  it("refuses a marketing idea that doesn't say why it is worth doing", () => {
    expect(marketingIdeaFieldsSchema.safeParse({ track: "marketing" }).success).toBe(false);
    expect(marketingIdeaFieldsSchema.safeParse({ track: "marketing", rationale: "   " }).success).toBe(false);
    expect(marketingIdeaFieldsSchema.safeParse({ track: "marketing", rationale: "People keep asking." }).success).toBe(true);
  });
});
