import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { account: string; userId?: string | null; bugId?: string | null; kind: string; amount: number; sourceKey: string };
type Where = Record<string, unknown>;

/** The ledger tables in memory, so the real ledger code runs against them. */
const world = vi.hoisted(() => ({
  rows: [] as Array<{ account: string; userId?: string | null; bugId?: string | null; kind: string; amount: number; sourceKey: string }>,
  purchases: [] as Array<{ stripeSessionId?: string; stripeInvoiceId?: string; subscriptionId?: string | null; userId?: string; zik?: number }>,
  /** Monthly plans (#ziki-coins): our mirror of Stripe's subscriptions, and what Stripe says each one is. */
  subscriptions: [] as Array<{ id: string; userId: string; stripeSubscriptionId: string; planId: string; status: string; cancelAtPeriodEnd: boolean }>,
  stripeSubscription: { id: "sub_1", status: "active", cancelAtPeriodEnd: false, userId: "owner", planId: "plus" },
  stripeCalls: [] as Array<{ name: string; args: unknown[] }>,
  withdrawals: [] as Array<{
    id: string;
    userId: string;
    zik: number;
    status: string;
    amountCents?: number;
    idempotencyKey?: string;
    stripeTransferId?: string | null;
    failureReason?: string | null;
    createdAt?: Date;
  }>,
  /** What Stripe's transfers.create does next; a test sets it. */
  transfer: { create: async (_params: unknown, _options: { idempotencyKey: string }): Promise<{ id: string }> => ({ id: "tr_default" }) },
  bug: { id: "bug", projectId: "proj", assigneeId: null as string | null, status: "open", payoutReleasedAt: null as Date | null, organisationId: "org", reporterId: "owner", isDeleted: false, reward: 1, rewardOverrideZik: null as number | null },
  /** The project the issue is in (#project-budget). */
  project: { id: "proj", organisationId: "org", archivedAt: null as Date | null, budgetEnabled: false, budgetAlert: null as string | null, budgetPausedAt: null as Date | null },
  /** How many planning-poker estimates the issue has; an issue has no price, and can't be funded, before three. */
  estimates: 3,
}));

function matches(row: Record<string, unknown>, where: Where = {}): boolean {
  return Object.entries(where).every(([key, want]) => {
    if (want && typeof want === "object" && "in" in (want as object)) return ((want as { in: unknown[] }).in).includes(row[key]);
    return row[key] === want;
  });
}

const db = vi.hoisted(() => {
  const fake = {
    coinEntry: {
      createMany: async ({ data }: { data: Row[] }) => {
        let count = 0;
        for (const row of data) {
          if (world.rows.some((r) => r.sourceKey === row.sourceKey)) continue;
          if (row.amount === 0) throw new Error("amount must not be zero");
          world.rows.push({ userId: null, bugId: null, ...row });
          count += 1;
        }
        return { count };
      },
      aggregate: async ({ where }: { where: Where }) => {
        const found = world.rows.filter((r) => matches(r, where));
        return { _sum: { amount: found.length ? found.reduce((s, r) => s + r.amount, 0) : null } };
      },
      groupBy: async ({ by, where }: { by: string[]; where: Where }) => {
        const groups = new Map<string, { key: Record<string, unknown>; sum: number }>();
        for (const row of world.rows.filter((r) => matches(r, where))) {
          const key = Object.fromEntries(by.map((field) => [field, (row as Record<string, unknown>)[field]]));
          const id = JSON.stringify(key);
          const group = groups.get(id) ?? { key, sum: 0 };
          group.sum += row.amount;
          groups.set(id, group);
        }
        return [...groups.values()].map((g) => ({ ...g.key, _sum: { amount: g.sum } }));
      },
      findUnique: async ({ where }: { where: { sourceKey: string } }) => world.rows.find((r) => r.sourceKey === where.sourceKey) ?? null,
      count: async ({ where }: { where: Where }) => world.rows.filter((r) => matches(r, where)).length,
    },
    bug: {
      findUnique: async () => ({ ...world.bug, rewardEstimateCount: world.estimates, project: { budgetEnabled: world.project.budgetEnabled, budgetPausedAt: world.project.budgetPausedAt } }),
      findUniqueOrThrow: async () => ({ ...world.bug, rewardEstimateCount: world.estimates, project: { budgetEnabled: world.project.budgetEnabled, budgetPausedAt: world.project.budgetPausedAt } }),
      findMany: async () => [{ ...world.bug, rewardEstimateCount: world.estimates }],
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(world.bug, data),
    },
    project: {
      findUnique: async () => ({ ...world.project }),
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(world.project, data),
    },
    rewardEstimate: { count: async () => world.estimates },
    // "budget-owner" is an owner of the organisation (#project-budget); anyone else is no member.
    membership: { findUnique: async ({ where }: { where: { organisationId_userId: { userId: string } } }) => (where.organisationId_userId.userId === "budget-owner" ? { role: "owner" } : null) },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, stripeCustomerId: "cus_1" }),
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({ id: where.id, stripeCustomerId: "cus_1" }),
      updateMany: async () => ({ count: 0 }),
    },
    coinPurchase: {
      findUnique: async ({ where }: { where: { stripeSessionId?: string; stripeInvoiceId?: string } }) =>
        world.purchases.find((p) => (where.stripeSessionId && p.stripeSessionId === where.stripeSessionId) || (where.stripeInvoiceId && p.stripeInvoiceId === where.stripeInvoiceId)) ?? null,
      create: async ({ data }: { data: { stripeSessionId?: string; stripeInvoiceId?: string } }) => {
        world.purchases.push(data);
        return { id: `purchase-${world.purchases.length}`, ...data };
      },
    },
    coinSubscription: {
      findUnique: async ({ where }: { where: { stripeSubscriptionId: string } }) => world.subscriptions.find((s) => s.stripeSubscriptionId === where.stripeSubscriptionId) ?? null,
      findFirst: async ({ where }: { where: { userId: string; status: { in: string[] } } }) =>
        world.subscriptions.find((s) => s.userId === where.userId && where.status.in.includes(s.status)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const made = { id: `csub-${world.subscriptions.length + 1}`, cancelAtPeriodEnd: false, ...data } as (typeof world.subscriptions)[number];
        world.subscriptions.push(made);
        return made;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
        Object.assign(world.subscriptions.find((s) => s.id === where.id) ?? {}, data),
      upsert: async ({ where, create, update }: { where: { stripeSubscriptionId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const found = world.subscriptions.find((s) => s.stripeSubscriptionId === where.stripeSubscriptionId);
        if (found) return Object.assign(found, update);
        const made = { id: `csub-${world.subscriptions.length + 1}`, ...create } as (typeof world.subscriptions)[number];
        world.subscriptions.push(made);
        return made;
      },
    },
    withdrawal: {
      findUnique: async ({ where }: { where: { id: string } }) => world.withdrawals.find((w) => w.id === where.id) ?? null,
      findMany: async ({ where }: { where: { status: string; createdAt: { lt: Date } } }) =>
        world.withdrawals
          .filter((w) => w.status === where.status && (w.stripeTransferId ?? null) === null && (w.createdAt ?? new Date(0)) < where.createdAt.lt)
          .map((w) => ({ ...w, user: { stripeAccountId: "acct_fixer" } })),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = world.withdrawals.filter((w) => {
          const row = w as Record<string, unknown>;
          return Object.entries(where).every(([key, want]) => {
            if (want && typeof want === "object" && "in" in (want as object)) return ((want as { in: unknown[] }).in).includes(row[key]);
            if (want === null) return (row[key] ?? null) === null;
            return row[key] === want;
          });
        });
        for (const w of found) Object.assign(w, data);
        return { count: found.length };
      },
    },
    $queryRaw: async () => [],
    $transaction: async (run: (tx: unknown) => unknown) => run(fake),
  };
  return fake;
});

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/coins/stripe", () => {
  /** A Stripe subscription as the API returns it, from what a test says it is. */
  const stripeSubscriptionNow = () => ({
    id: world.stripeSubscription.id,
    status: world.stripeSubscription.status,
    metadata: { userId: world.stripeSubscription.userId, planId: world.stripeSubscription.planId },
    cancel_at_period_end: world.stripeSubscription.cancelAtPeriodEnd,
    cancel_at: null,
    latest_invoice: "in_1",
    items: { data: [{ current_period_end: 1_800_000_000 }] },
  });
  return {
  getStripe: () => ({
    paymentIntents: { retrieve: async () => Promise.reject(new Error("offline")) },
    transfers: { create: (params: unknown, options: { idempotencyKey: string }) => world.transfer.create(params, options) },
    invoicePayments: { list: async () => Promise.reject(new Error("offline")) },
    invoices: { retrieve: async () => ({ hosted_invoice_url: "https://pay.stripe.test/in_1" }) },
    customers: { create: async () => ({ id: "cus_1" }) },
    subscriptions: {
      retrieve: async () => stripeSubscriptionNow(),
      update: async (id: string, params: { cancel_at_period_end: boolean }) => {
        world.stripeCalls.push({ name: "subscriptions.update", args: [id, params] });
        world.stripeSubscription.cancelAtPeriodEnd = params.cancel_at_period_end;
        return stripeSubscriptionNow();
      },
    },
    checkout: {
      sessions: {
        create: async (params: unknown) => {
          world.stripeCalls.push({ name: "checkout.sessions.create", args: [params] });
          return { url: "https://checkout.stripe.test/c_1" };
        },
      },
    },
  }),
  stripeConfigured: () => true,
  };
});
vi.mock("@/lib/site-url", () => ({ absoluteUrl: (path: string) => `https://ziki.test${path}` }));
vi.mock("@/lib/notify", () => ({ notifyLater: vi.fn() }));

import { fundIssue } from "@/lib/coins/fund";
import { budgetBalance, budgetBlock, fundBudget, issuePriceZik, raiseIssuePrice, reserveForIssue, returnUnusedBudget, setBudgetPaused, takeBackBudget, unaffordableIssueIds } from "@/lib/coins/budget";
import { budgetStatusOf, classifyIssues } from "@/lib/coins/budget-states";
import { budgetAlertState } from "@/lib/coins/budget-sweeps";
import { refundEscrow, releaseEscrow } from "@/lib/coins/escrow";
import { escrowBalance, escrowByBug, walletBalance, walletSummary } from "@/lib/coins/ledger";
import { dollarsToZiks, estimateToZik, feeOf, planRelease, splitByWeight, ziksToDollars } from "@/lib/coins/math";
import { ledgerBalances } from "@/lib/coins/money";
import { createPackCheckout, createTestPurchase, recordPurchase } from "@/lib/coins/purchase";
import { testPayments } from "@/lib/coins/test-mode";
import { discountedCents, planBreakEvenCents, ZIK_PLANS } from "@/lib/coins/plans";
import { createSubscriptionCheckout, recordSubscriptionPayment, setSubscriptionEnding, startTestSubscription } from "@/lib/coins/subscription";
import Stripe from "stripe";
import { failWithdrawal, retryPendingWithdrawals } from "@/lib/coins/withdraw";

const buy = (userId: string, zik: number, session: string) =>
  db.coinEntry.createMany({ data: [{ account: "wallet", userId, kind: "purchase", amount: zik, sourceKey: `purchase:${session}` }] });
const total = () => world.rows.reduce((sum, row) => sum + row.amount, 0);

beforeEach(() => {
  world.rows.length = 0;
  world.purchases.length = 0;
  world.subscriptions.length = 0;
  world.stripeCalls.length = 0;
  Object.assign(world.stripeSubscription, { id: "sub_1", status: "active", cancelAtPeriodEnd: false, userId: "owner", planId: "plus" });
  world.withdrawals.length = 0;
  world.transfer.create = async () => ({ id: "tr_default" });
  world.estimates = 3;
  Object.assign(world.bug, { status: "open", payoutReleasedAt: null, reward: 1, rewardOverrideZik: null, assigneeId: null });
  Object.assign(world.project, { budgetEnabled: false, budgetAlert: null, archivedAt: null, budgetPausedAt: null });
});

describe("Ziks arithmetic", () => {
  it("takes the fee first and splits the rest by award, handing out every Zik", () => {
    expect(feeOf(100, 10)).toBe(10);
    expect(feeOf(105, 10)).toBe(11);
    const plan = planRelease(100, new Map([["solver", 6], ["tester", 3]]), 10);
    expect(plan?.fee).toBe(10);
    expect([...(plan?.shares ?? [])]).toEqual([["solver", 60], ["tester", 30]]);
    // Thirds don't divide evenly: the split still adds up exactly.
    const odd = splitByWeight(100, new Map([["a", 1], ["b", 1], ["c", 1]]));
    expect([...odd.values()].reduce((s, n) => s + n, 0)).toBe(100);
  });

  it("turns a reward estimate in dollars into whole Ziks, never fewer than one", () => {
    expect(estimateToZik(6.33)).toBe(63);
    expect(estimateToZik(3.67)).toBe(37);
    expect(estimateToZik(10)).toBe(100);
    expect(estimateToZik(0.01)).toBe(1);
  });

  it("converts between the dollars an estimate is stored in and the Ziks it is shown in, at 10 Ziks to the dollar", () => {
    expect(dollarsToZiks(6.33)).toBe(63);
    expect(dollarsToZiks(10)).toBe(100);
    expect(ziksToDollars(60)).toBe(6);
    for (const dollars of [1, 4, 7, 10]) expect(ziksToDollars(dollarsToZiks(dollars))).toBe(dollars);
  });

  it("releases nothing when nobody earned anything", () => {
    expect(planRelease(100, new Map(), 10)).toBeNull();
  });
});

describe("funding an issue", () => {
  it("never takes a wallet below zero, and funds once per request", async () => {
    await buy("owner", 50, "s1");
    await expect(fundIssue("owner", "bug", 60, "request-0001")).rejects.toMatchObject({ code: "insufficient_ziks" });
    expect(await walletBalance(db as never, "owner")).toBe(50);

    expect(await fundIssue("owner", "bug", 20, "request-0002")).toEqual({ funded: true, escrow: 20 });
    expect(await fundIssue("owner", "bug", 20, "request-0002")).toEqual({ funded: false, escrow: 20 });
    expect(await walletBalance(db as never, "owner")).toBe(30);
    expect(total()).toBe(50);
  });

  it("tells a list which issues have Ziks behind them, and leaves out the rest", async () => {
    await buy("owner", 50, "s1b");
    await fundIssue("owner", "bug", 20, "request-0013");
    expect(await escrowByBug(db as never, ["bug", "other"])).toEqual(new Map([["bug", 20]]));
    expect(await escrowByBug(db as never, [])).toEqual(new Map());
  });

  it("won't fund an estimated issue below its estimate, but lets the owner add more once it is reached", async () => {
    await buy("owner", 500, "s7");
    world.estimates = 3;
    world.bug.reward = 6.33; // 63 Ziks

    await expect(fundIssue("owner", "bug", 40, "request-0007")).rejects.toMatchObject({ code: "invalid_amount" });
    expect(await walletBalance(db as never, "owner")).toBe(500);

    expect(await fundIssue("owner", "bug", 63, "request-0008")).toEqual({ funded: true, escrow: 63 });
    // At the estimate, any amount adds to it.
    expect(await fundIssue("owner", "bug", 5, "request-0009")).toEqual({ funded: true, escrow: 68 });
  });

  it("can't be funded before three agents have estimated it, unless its owner has set a price; then it asks for only what is missing", async () => {
    await buy("owner", 500, "s8");
    world.estimates = 2;
    await expect(fundIssue("owner", "bug", 1, "request-0010")).rejects.toMatchObject({ code: "invalid_amount", message: expect.stringContaining("Waiting for estimates: 2 of 3") });
    expect(await walletBalance(db as never, "owner")).toBe(500);

    world.bug.rewardOverrideZik = 50; // the owner's price counts as a price before the estimates are in
    await expect(fundIssue("owner", "bug", 49, "request-0011")).rejects.toMatchObject({ code: "invalid_amount", message: expect.stringContaining("Fund at least 50") });
    expect(await fundIssue("owner", "bug", 50, "request-0012")).toEqual({ funded: true, escrow: 50 });
    // At its price, any amount adds to it.
    expect(await fundIssue("owner", "bug", 5, "request-0013")).toEqual({ funded: true, escrow: 55 });
  });

  it("refuses someone who doesn't own the issue, and a finished issue", async () => {
    await buy("stranger", 50, "s2");
    await expect(fundIssue("stranger", "bug", 10, "request-0003")).rejects.toMatchObject({ code: "not_allowed" });
    await buy("owner", 50, "s3");
    world.bug.status = "closed";
    await expect(fundIssue("owner", "bug", 10, "request-0004")).rejects.toMatchObject({ code: "closed" });
  });
});

describe("releasing and refunding escrow", () => {
  it("pays the earners by their awards, keeps the fee, and balances to the Ziks bought", async () => {
    await buy("owner", 100, "s4");
    await fundIssue("owner", "bug", 100, "request-0005");
    const awards = [{ userId: "solver", points: 6 }, { userId: "tester", points: 3 }];

    const result = await releaseEscrow(db as never, "bug", awards);

    expect(result).toEqual({ released: 90, fee: 10, paidTo: ["solver", "tester"] });
    expect(await walletBalance(db as never, "solver")).toBe(60);
    expect(await walletBalance(db as never, "tester")).toBe(30);
    expect(await escrowBalance(db as never, "bug")).toBe(0);
    expect(world.rows.filter((r) => r.account === "revenue").reduce((s, r) => s + r.amount, 0)).toBe(10);
    expect(total()).toBe(100);
    expect(ledgerBalances({ bought: 100, withdrawn: 0, inLedger: total() }).difference).toBe(0);

    // The same release again finds the escrow empty and pays nothing more.
    expect(await releaseEscrow(db as never, "bug", awards)).toBeNull();
    expect(await walletBalance(db as never, "solver")).toBe(60);
  });

  it("gives unused escrow back to whoever funded it when the issue closes", async () => {
    await buy("owner", 100, "s5");
    await fundIssue("owner", "bug", 40, "request-0006");
    expect(await refundEscrow(db as never, "bug")).toBe(40);
    expect(await walletBalance(db as never, "owner")).toBe(100);
    expect(await escrowBalance(db as never, "bug")).toBe(0);
    expect(await refundEscrow(db as never, "bug")).toBe(0);
  });
});

describe("project budgets (#project-budget)", () => {
  const OWNER = "budget-owner";
  const fund = async (amount: number, request: string) => {
    await buy(OWNER, amount, `b-${request}`);
    return fundBudget(OWNER, "proj", amount, request);
  };
  const budgetRows = () => world.rows.filter((row) => row.account === "budget").reduce((sum, row) => sum + row.amount, 0);

  it("funds a project once per request from the owner's wallet, switches the budget on, and refuses anyone who isn't an owner or admin", async () => {
    await buy(OWNER, 300, "b-wallet");
    expect(await fundBudget(OWNER, "proj", 200, "request-b001")).toEqual({ funded: true, balance: 200 });
    expect(await fundBudget(OWNER, "proj", 200, "request-b001")).toEqual({ funded: false, balance: 200 });
    expect(await walletBalance(db as never, OWNER)).toBe(100);
    expect(world.project.budgetEnabled).toBe(true);
    await expect(fundBudget(OWNER, "proj", 500, "request-b002")).rejects.toMatchObject({ code: "insufficient_ziks" });
    await buy("stranger", 50, "b-stranger");
    await expect(fundBudget("stranger", "proj", 10, "request-b003")).rejects.toMatchObject({ code: "not_allowed" });
    // Everything bought (the owner's 300 and the stranger's 50) is still in the ledger, with 200 of it in the budget.
    expect(total()).toBe(350);
    expect(ledgerBalances({ bought: 350, withdrawn: 0, inLedger: total() }).difference).toBe(0);
  });

  it("prices an issue from three estimates, or from its owner's price, and from nothing before that", () => {
    expect(issuePriceZik({ reward: 6.33, rewardEstimateCount: 3, rewardOverrideZik: null })).toBe(63);
    expect(issuePriceZik({ reward: 6.33, rewardEstimateCount: 2, rewardOverrideZik: null })).toBeNull();
    expect(issuePriceZik({ reward: 1, rewardEstimateCount: 0, rewardOverrideZik: 40 })).toBe(40);
    expect(issuePriceZik({ reward: 6.33, rewardEstimateCount: 3, rewardOverrideZik: 100 })).toBe(100);
  });

  it("reserves an issue's price from the budget into its escrow, takes only what it doesn't hold, and refuses without writing when the budget is short", async () => {
    world.bug.reward = 5; // 50 Ziks
    await fund(120, "request-b010");
    expect(await reserveForIssue(db as never, "bug")).toBe(50);
    expect(await escrowBalance(db as never, "bug")).toBe(50);
    expect(await budgetBalance(db as never, "proj")).toBe(70);
    // Already holding its price: awarding it again takes nothing twice.
    expect(await reserveForIssue(db as never, "bug")).toBe(0);
    expect(await budgetBalance(db as never, "proj")).toBe(70);

    world.bug.rewardOverrideZik = 200; // now it needs 150 more and the budget has 70
    await expect(reserveForIssue(db as never, "bug")).rejects.toMatchObject({ code: "out_of_funds" });
    expect(await budgetBalance(db as never, "proj")).toBe(70);
    expect(await escrowBalance(db as never, "bug")).toBe(50);
    expect(total()).toBe(120);
  });

  it("reserves nothing in a project without a budget", async () => {
    expect(await reserveForIssue(db as never, "bug")).toBe(0);
    expect(world.rows).toHaveLength(0);
  });

  it("says why an issue can't be awarded: no price yet, or no funds; and says nothing in a project without a budget", async () => {
    expect(await budgetBlock(db as never, "bug")).toBeNull();
    await fund(30, "request-b020");
    world.estimates = 1;
    expect(await budgetBlock(db as never, "bug")).toMatchObject({ code: "not_priced" });
    world.estimates = 3;
    world.bug.reward = 5; // 50 Ziks, the budget has 30
    expect(await budgetBlock(db as never, "bug")).toMatchObject({ code: "out_of_funds" });
    expect(await unaffordableIssueIds(db as never, "proj", ["bug"])).toEqual(new Set(["bug"]));
    await fund(20, "request-b021");
    expect(await budgetBlock(db as never, "bug")).toBeNull();
    expect(await unaffordableIssueIds(db as never, "proj", ["bug"])).toEqual(new Set());
  });

  it("puts what a closed, unpaid issue was reserved back into the budget first, and the rest to whoever funded the issue itself", async () => {
    world.bug.reward = 5;
    await fund(100, "request-b030");
    await reserveForIssue(db as never, "bug"); // 50 from the budget
    await buy("owner", 20, "b-direct");
    await fundIssue("owner", "bug", 20, "request-b031"); // 20 more, from the reporter
    expect(await escrowBalance(db as never, "bug")).toBe(70);

    expect(await refundEscrow(db as never, "bug")).toBe(70);
    expect(await budgetBalance(db as never, "proj")).toBe(100);
    expect(await walletBalance(db as never, "owner")).toBe(20);
    expect(await escrowBalance(db as never, "bug")).toBe(0);
    expect(await refundEscrow(db as never, "bug")).toBe(0);
  });

  it("takes back only what is unreserved, to whoever funded it, and says so when there is nothing left", async () => {
    world.bug.reward = 5;
    await fund(100, "request-b040");
    await reserveForIssue(db as never, "bug");
    expect(await takeBackBudget(OWNER, "proj")).toBe(50);
    expect(await walletBalance(db as never, OWNER)).toBe(50);
    expect(await escrowBalance(db as never, "bug")).toBe(50);
    expect(budgetRows()).toBe(0);
    await expect(takeBackBudget(OWNER, "proj")).rejects.toMatchObject({ code: "invalid_amount" });
    await expect(takeBackBudget("stranger", "proj")).rejects.toMatchObject({ code: "not_allowed" });
    expect(total()).toBe(100);
  });

  it("returns an idle budget to each funder in proportion to what they put in", async () => {
    await buy(OWNER, 100, "b-a");
    await buy("admin-2", 300, "b-b");
    world.rows.push(
      { account: "wallet", userId: OWNER, bugId: null, kind: "fund_budget", amount: -100, sourceKey: "f-a:wallet", projectId: "proj" } as never,
      { account: "budget", userId: null, bugId: null, kind: "fund_budget", amount: 100, sourceKey: "f-a:budget", projectId: "proj" } as never,
      { account: "wallet", userId: "admin-2", bugId: null, kind: "fund_budget", amount: -300, sourceKey: "f-b:wallet", projectId: "proj" } as never,
      { account: "budget", userId: null, bugId: null, kind: "fund_budget", amount: 300, sourceKey: "f-b:budget", projectId: "proj" } as never,
    );
    expect(await returnUnusedBudget(db as never, "proj")).toBe(400);
    expect(await walletBalance(db as never, OWNER)).toBe(100);
    expect(await walletBalance(db as never, "admin-2")).toBe(300);
    expect(await returnUnusedBudget(db as never, "proj")).toBe(0);
  });

  it("lets the owner raise an issue's price but never lower it, reserving the difference when someone already holds the issue", async () => {
    world.bug.reward = 5; // 50 Ziks
    await fund(200, "request-b050");
    await expect(raiseIssuePrice(OWNER, "bug", 40)).rejects.toMatchObject({ code: "invalid_amount" });
    await expect(raiseIssuePrice("stranger", "bug", 90)).rejects.toMatchObject({ code: "not_allowed" });
    expect(await raiseIssuePrice(OWNER, "bug", 90)).toBe(90);
    expect(world.bug.rewardOverrideZik).toBe(90);
    expect(await escrowBalance(db as never, "bug")).toBe(0); // nobody holds it yet: nothing reserved

    world.bug.assigneeId = "fixer";
    expect(await raiseIssuePrice(OWNER, "bug", 120)).toBe(120);
    expect(await escrowBalance(db as never, "bug")).toBe(120);
    await expect(raiseIssuePrice(OWNER, "bug", 100)).rejects.toMatchObject({ code: "invalid_amount" });
    // More than the budget can reserve: refused (the database rolls the price back with it).
    await expect(raiseIssuePrice(OWNER, "bug", 1000)).rejects.toMatchObject({ code: "out_of_funds" });
  });

  it("pauses and resumes: a paused budget awards and reserves nothing new, keeps its money, and only an owner or admin can pause it", async () => {
    world.bug.reward = 5; // 50 Ziks
    await expect(setBudgetPaused(OWNER, "proj", true)).rejects.toMatchObject({ code: "invalid_amount" }); // no budget yet
    await fund(100, "request-b060");
    await expect(setBudgetPaused("stranger", "proj", true)).rejects.toMatchObject({ code: "not_allowed" });
    expect(await budgetBlock(db as never, "bug")).toBeNull();

    await setBudgetPaused(OWNER, "proj", true);
    expect(world.project.budgetPausedAt).toBeInstanceOf(Date);
    expect(await budgetBlock(db as never, "bug")).toMatchObject({ code: "paused" });
    expect(await unaffordableIssueIds(db as never, "proj", ["bug"])).toEqual(new Set(["bug"]));
    await expect(reserveForIssue(db as never, "bug")).rejects.toMatchObject({ code: "paused" });
    expect(await budgetBalance(db as never, "proj")).toBe(100);
    expect(await escrowBalance(db as never, "bug")).toBe(0);

    await setBudgetPaused(OWNER, "proj", false);
    expect(await budgetBlock(db as never, "bug")).toBeNull();
    expect(await reserveForIssue(db as never, "bug")).toBe(50);
  });

  it("gives a budget one status: none before it starts, paused over everything, then out of funds, low, or active", () => {
    expect(budgetStatusOf({ enabled: false, paused: false, alert: null })).toBe("none");
    expect(budgetStatusOf({ enabled: true, paused: true, alert: "empty" })).toBe("paused");
    expect(budgetStatusOf({ enabled: true, paused: false, alert: "empty" })).toBe("empty");
    expect(budgetStatusOf({ enabled: true, paused: false, alert: "low" })).toBe("low");
    expect(budgetStatusOf({ enabled: true, paused: false, alert: null })).toBe("active");
  });

  it("sorts issues against the budget in order: funded and paid ones first, then the waiting ones the budget covers, stopping at the first it can't carry", () => {
    const states = classifyIssues(
      [
        { id: "paid", price: 40, held: 0, paid: true, waiting: false },
        { id: "funded", price: 50, held: 50, paid: false, waiting: false },
        { id: "partly", price: 50, held: 20, paid: false, waiting: false },
        { id: "working", price: 30, held: 0, paid: false, waiting: false },
        { id: "a", price: 40, held: 0, paid: false, waiting: true },
        { id: "unpriced", price: null, held: 0, paid: false, waiting: true },
        { id: "b", price: 50, held: 0, paid: false, waiting: true },
        { id: "c", price: 20, held: 0, paid: false, waiting: true },
      ],
      100,
    );
    expect(Object.fromEntries(states)).toEqual({
      paid: "paid", funded: "funded", partly: "partly_funded", working: "not_reserved",
      a: "covered", unpriced: "needs_price", b: "covered", c: "not_covered",
    });
    // 40 + 50 leaves 10 of 100, which c (20) can't take. With 80, b stops the run, so c is not covered even though it costs 1.
    const tight = classifyIssues(
      [{ id: "a", price: 40, held: 0, paid: false, waiting: true }, { id: "b", price: 50, held: 0, paid: false, waiting: true }, { id: "c", price: 1, held: 0, paid: false, waiting: true }],
      80,
    );
    expect(Object.fromEntries(tight)).toEqual({ a: "covered", b: "not_covered", c: "not_covered" });
  });

  it("warns that the budget is out when it can't cover the next issue, low when it can't cover the next three, and not at all with nothing waiting", () => {
    expect(budgetAlertState(500, [])).toBeNull();
    expect(budgetAlertState(10, [50, 50])).toBe("empty");
    expect(budgetAlertState(120, [50, 50, 50, 50])).toBe("low");
    expect(budgetAlertState(150, [50, 50, 50, 50])).toBeNull();
    expect(budgetAlertState(60, [50])).toBeNull();
  });
});

describe("Stripe webhook purchases", () => {
  const session = (over: Record<string, unknown> = {}) =>
    ({ id: "cs_1", mode: "payment", payment_status: "paid", amount_total: 500, currency: "usd", payment_intent: "pi_1", metadata: { userId: "owner", packId: "starter" }, ...over }) as never;

  it("credits the wallet once, however many times Stripe delivers the event", async () => {
    expect(await recordPurchase(session())).toBe("recorded");
    expect(await recordPurchase(session())).toBe("duplicate");
    expect(await walletBalance(db as never, "owner")).toBe(50);
    expect(world.purchases).toHaveLength(1);
  });

  it("credits nothing for an unpaid session, or one that paid less than the pack costs", async () => {
    expect(await recordPurchase(session({ payment_status: "unpaid" }))).toBe("ignored");
    expect(await recordPurchase(session({ id: "cs_2", amount_total: 100 }))).toBe("ignored");
    expect(await walletBalance(db as never, "owner")).toBe(0);
  });
});

describe("Test payments (no card step while the Stripe key is a test key)", () => {
  it("credits the pack at once, marked as a test purchase, without asking Stripe", async () => {
    expect(await createTestPurchase("owner", "starter")).toBe("/coins?bought=1");
    expect(await walletBalance(db as never, "owner")).toBe(50);
    expect(world.purchases).toHaveLength(1);
    expect((world.purchases[0] as { currency?: string }).currency).toBe("test");
    // The database refuses a purchase with neither a Stripe session nor an invoice (CoinPurchase_source_check).
    expect((world.purchases[0] as { stripeSessionId?: string }).stripeSessionId).toMatch(/^test_session_/);
    expect(world.stripeCalls).toHaveLength(0);
  });

  it("refuses a pack that does not exist, and credits nothing", async () => {
    await expect(createTestPurchase("owner", "nope")).rejects.toThrow("Choose one of the packs.");
    expect(await walletBalance(db as never, "owner")).toBe(0);
  });

  it("starts a plan at once, once, and ending it never calls Stripe", async () => {
    await startTestSubscription("owner", "plus");
    expect(world.subscriptions).toHaveLength(1);
    expect(world.subscriptions[0].status).toBe("active");
    await expect(startTestSubscription("owner", "pro")).rejects.toThrow("already have a monthly plan");
    await setSubscriptionEnding("owner", true);
    expect(world.subscriptions[0].cancelAtPeriodEnd).toBe(true);
    expect(world.stripeCalls).toHaveLength(0);
  });

  it("is on for a test key and off for a live one, unless forced", () => {
    const keep = { key: process.env.STRIPE_SECRET_KEY, flag: process.env.ZIKI_TEST_PAYMENTS };
    try {
      delete process.env.ZIKI_TEST_PAYMENTS;
      process.env.STRIPE_SECRET_KEY = "sk_test_abc";
      expect(testPayments()).toBe(true);
      process.env.STRIPE_SECRET_KEY = "sk_live_abc";
      expect(testPayments()).toBe(false);
      process.env.ZIKI_TEST_PAYMENTS = "0";
      process.env.STRIPE_SECRET_KEY = "sk_test_abc";
      expect(testPayments()).toBe(false);
    } finally {
      for (const [name, value] of [["STRIPE_SECRET_KEY", keep.key], ["ZIKI_TEST_PAYMENTS", keep.flag]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe("Ziki plans (a discount on Ziks packs)", () => {
  const invoice = (over: Record<string, unknown> = {}) =>
    ({
      id: "in_1",
      status: "paid",
      billing_reason: "subscription_create",
      amount_paid: 500,
      currency: "usd",
      parent: { subscription_details: { subscription: "sub_1", metadata: { userId: "owner", planId: "plus" } } },
      ...over,
    }) as never;
  const live = (status = "active", planId = "pro") =>
    world.subscriptions.push({ id: "csub-9", userId: "owner", stripeSubscriptionId: "sub_1", planId, status, cancelAtPeriodEnd: false });
  const lastCheckout = () => world.stripeCalls.at(-1)?.args[0] as { mode: string; line_items: Array<{ price_data: { unit_amount: number; recurring?: { interval: string } } }>; metadata: Record<string, string>; subscription_data?: { metadata: unknown }; success_url?: string; cancel_url?: string };

  it("takes the plan's discount off a pack's price, to the cent", () => {
    expect(discountedCents(500, 0)).toBe(500);
    expect(discountedCents(500, 10)).toBe(450);
    expect(discountedCents(500, 15)).toBe(425);
    expect(discountedCents(15000, 20)).toBe(12000);
    expect(ZIK_PLANS.map((plan) => [plan.id, plan.monthlyCents, plan.discountPercent, planBreakEvenCents(plan)])).toEqual([
      ["plus", 500, 10, 5000],
      ["pro", 1500, 15, 10000],
      ["team", 4000, 20, 20000],
    ]);
  });

  it("records a paid month's fee once as income, and gives no Ziks for it", async () => {
    expect(await recordSubscriptionPayment(invoice())).toBe("recorded");
    expect(await recordSubscriptionPayment(invoice())).toBe("duplicate");
    expect(world.purchases).toHaveLength(1);
    expect(world.purchases[0]).toMatchObject({ stripeInvoiceId: "in_1", planId: "plus", zik: 0, amountCents: 500 });
    // The fee buys no Ziks: nothing reaches the wallet or the ledger.
    expect(await walletBalance(db as never, "owner")).toBe(0);
    expect(world.rows).toHaveLength(0);
    // The purchase points at our mirror of the subscription, made from Stripe's own record of it.
    expect(world.subscriptions).toHaveLength(1);
    expect(world.purchases[0].subscriptionId).toBe(world.subscriptions[0].id);

    // The next month's invoice is a separate payment.
    expect(await recordSubscriptionPayment(invoice({ id: "in_2", billing_reason: "subscription_cycle" }))).toBe("recorded");
    expect(world.purchases).toHaveLength(2);
  });

  it("records nothing for an unpaid invoice, a different amount, an unknown plan or one that isn't a plan's month", async () => {
    expect(await recordSubscriptionPayment(invoice({ status: "open" }))).toBe("ignored");
    expect(await recordSubscriptionPayment(invoice({ id: "in_2", amount_paid: 400 }))).toBe("ignored");
    expect(await recordSubscriptionPayment(invoice({ id: "in_3", parent: { subscription_details: { subscription: "sub_1", metadata: { userId: "owner", planId: "gold" } } } }))).toBe("ignored");
    expect(await recordSubscriptionPayment(invoice({ id: "in_4", billing_reason: "manual" }))).toBe("ignored");
    expect(await recordSubscriptionPayment(invoice({ id: "in_5", parent: null }))).toBe("ignored");
    expect(world.purchases).toHaveLength(0);
  });

  it("sends a person to Stripe for a plan at its monthly fee, and only lets them have one at a time", async () => {
    expect(await createSubscriptionCheckout("owner", "owner@ziki.test", "pro")).toBe("https://checkout.stripe.test/c_1");
    expect(lastCheckout().mode).toBe("subscription");
    expect(lastCheckout().line_items[0].price_data).toMatchObject({ unit_amount: 1500, recurring: { interval: "month" } });
    expect(lastCheckout().subscription_data?.metadata).toEqual({ userId: "owner", planId: "pro" });

    // Started from the pricing page, cancelling at Stripe comes back to it; otherwise to the Ziks page's plan section.
    await createSubscriptionCheckout("owner", undefined, "plus", "pricing");
    expect((lastCheckout() as unknown as { cancel_url: string }).cancel_url).toBe("https://ziki.test/pricing");
    await createSubscriptionCheckout("owner", undefined, "plus");
    expect((lastCheckout() as unknown as { cancel_url: string }).cancel_url).toBe("https://ziki.test/coins?section=plan");

    await expect(createSubscriptionCheckout("owner", undefined, "gold")).rejects.toMatchObject({ code: "invalid_amount" });

    live();
    await expect(createSubscriptionCheckout("owner", undefined, "plus")).rejects.toMatchObject({ code: "not_allowed" });
  });

  it("charges a subscriber the discounted price for a pack while the plan is paid up, and the full price otherwise", async () => {
    await createPackCheckout("owner", undefined, "starter");
    expect(lastCheckout().line_items[0].price_data.unit_amount).toBe(500);
    expect(lastCheckout().metadata.discountPercent).toBe("0");

    live("active", "pro");
    await createPackCheckout("owner", undefined, "starter");
    expect(lastCheckout().line_items[0].price_data.unit_amount).toBe(425);
    expect(lastCheckout().metadata).toMatchObject({ packId: "starter", zik: "50", discountPercent: "15" });

    // A plan whose payment failed gives no discount until it is paid.
    world.subscriptions[0].status = "past_due";
    await createPackCheckout("owner", undefined, "starter");
    expect(lastCheckout().line_items[0].price_data.unit_amount).toBe(500);
  });

  it("sends a buyer who came from a scan's checkout back to that scan after paying, and never anywhere else (#deeper-scan-gate)", async () => {
    await createPackCheckout("owner", undefined, "starter", "/security/checks/cm123");
    expect(lastCheckout().success_url).toMatch(/\/security\/checks\/cm123\?bought=1$/);
    expect(lastCheckout().cancel_url).toMatch(/\/coins\?returnTo=%2Fsecurity%2Fchecks%2Fcm123$/);

    for (const elsewhere of ["https://evil.example/x", "//evil.example/security/checks/x", "/settings", undefined]) {
      await createPackCheckout("owner", undefined, "starter", elsewhere);
      expect(lastCheckout().success_url).toMatch(/\/coins\?bought=1$/);
    }
  });

  it("credits a discounted pack's full Ziks, but only for a price a plan really gives", async () => {
    const discounted = (over: Record<string, unknown> = {}) =>
      ({ id: "cs_9", mode: "payment", payment_status: "paid", amount_total: 425, currency: "usd", payment_intent: "pi_9", metadata: { userId: "owner", packId: "starter", discountPercent: "15" }, ...over }) as never;

    expect(await recordPurchase(discounted())).toBe("recorded");
    expect(await walletBalance(db as never, "owner")).toBe(50);
    expect(world.purchases.at(-1)).toMatchObject({ zik: 50, amountCents: 425 });

    // Paid less than the pack costs and claims no discount, or less than the discount it claims allows, or a
    // discount no plan gives: nothing is credited.
    expect(await recordPurchase(discounted({ id: "cs_10", metadata: { userId: "owner", packId: "starter" } }))).toBe("ignored");
    expect(await recordPurchase(discounted({ id: "cs_11", amount_total: 400 }))).toBe("ignored");
    expect(await recordPurchase(discounted({ id: "cs_12", amount_total: 450, metadata: { userId: "owner", packId: "starter", discountPercent: "12" } }))).toBe("ignored");
    expect(await walletBalance(db as never, "owner")).toBe(50);
  });

  it("ends and keeps only the person's own plan, at the end of the month they paid for", async () => {
    await expect(setSubscriptionEnding("stranger", true)).rejects.toMatchObject({ code: "not_found" });

    live("active", "plus");
    await setSubscriptionEnding("owner", true);
    expect(world.stripeCalls.at(-1)).toEqual({ name: "subscriptions.update", args: ["sub_1", { cancel_at_period_end: true }] });
    expect(world.subscriptions[0].cancelAtPeriodEnd).toBe(true);

    await setSubscriptionEnding("owner", false);
    expect(world.subscriptions[0].cancelAtPeriodEnd).toBe(false);
  });
});

describe("withdrawals", () => {
  it("lets a person withdraw what they earned, not what they bought", async () => {
    await buy("fixer", 500, "s6");
    expect((await walletSummary(db as never, "fixer")).withdrawable).toBe(0);
    await db.coinEntry.createMany({ data: [{ account: "wallet", userId: "fixer", kind: "release", amount: 120, sourceKey: "release:x:fixer:wallet" }] });
    expect(await walletSummary(db as never, "fixer")).toEqual({ balance: 620, earned: 120, withdrawable: 120 });
  });

  it("puts a failed transfer's Ziks back once, however many times Stripe says so", async () => {
    await db.coinEntry.createMany({
      data: [
        { account: "wallet", userId: "fixer", kind: "release", amount: 400, sourceKey: "release:y:fixer:wallet" },
        { account: "wallet", userId: "fixer", kind: "withdrawal", amount: -400, sourceKey: "withdrawal:w1" },
      ],
    });
    world.withdrawals.push({ id: "w1", userId: "fixer", zik: 400, status: "pending" });
    expect(await walletBalance(db as never, "fixer")).toBe(0);

    expect(await failWithdrawal("w1", "Stripe reversed the transfer.")).toBe(true);
    expect(await failWithdrawal("w1", "Stripe reversed the transfer.")).toBe(false);

    expect(await walletBalance(db as never, "fixer")).toBe(400);
    expect(world.withdrawals[0].status).toBe("failed");
    expect((await walletSummary(db as never, "fixer")).withdrawable).toBe(400);
  });

  describe("when Stripe is still holding the platform's money", () => {
    const noFundsYet = () =>
      Promise.reject(new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", code: "balance_insufficient", message: "insufficient available funds" }));
    const debited = (id: string, createdAt: Date) => {
      world.withdrawals.push({ id, userId: "fixer", zik: 450, amountCents: 4500, status: "pending", idempotencyKey: `key-${id}`, stripeTransferId: null, createdAt });
      return db.coinEntry.createMany({
        data: [
          { account: "wallet", userId: "fixer", kind: "release", amount: 450, sourceKey: `release:${id}:fixer:wallet` },
          { account: "wallet", userId: "fixer", kind: "withdrawal", amount: -450, sourceKey: `withdrawal:${id}` },
        ],
      });
    };
    const now = new Date("2026-11-15T12:00:00Z");
    const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

    it("keeps the withdrawal waiting with the Ziks reserved, then sends it once the money is available", async () => {
      await debited("w3", minutesAgo(10));
      const usedKeys: string[] = [];
      world.transfer.create = (_params, options) => {
        usedKeys.push(options.idempotencyKey);
        return noFundsYet();
      };

      expect(await retryPendingWithdrawals(now)).toMatchObject({ checked: 1, waiting: 1, sent: 0, returned: 0 });
      expect(world.withdrawals[0].status).toBe("pending");
      expect(await walletBalance(db as never, "fixer")).toBe(0);

      world.transfer.create = async (_params, options) => {
        usedKeys.push(options.idempotencyKey);
        return { id: "tr_1" };
      };
      expect(await retryPendingWithdrawals(now)).toMatchObject({ checked: 1, sent: 1, waiting: 0 });
      expect(world.withdrawals[0].stripeTransferId).toBe("tr_1");
      // Stripe would replay the refusal for the first key, so the second try used a new one.
      expect(usedKeys[1]).not.toBe(usedKeys[0]);

      // Sent once: nothing left to retry.
      expect(await retryPendingWithdrawals(now)).toMatchObject({ checked: 0 });
    });

    it("doesn't touch a withdrawal made moments ago, and gives the Ziks back after two weeks of waiting", async () => {
      await debited("w4", minutesAgo(0.5));
      world.transfer.create = noFundsYet;
      expect(await retryPendingWithdrawals(now)).toMatchObject({ checked: 0 });

      world.withdrawals[0].createdAt = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
      expect(await retryPendingWithdrawals(now)).toMatchObject({ checked: 1, returned: 1 });
      expect(world.withdrawals[0].status).toBe("failed");
      expect(await walletBalance(db as never, "fixer")).toBe(450);
    });
  });
});
