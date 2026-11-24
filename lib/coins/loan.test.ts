import { describe, expect, it, vi } from "vitest";
import { ZIKS_LOAN, assertCanSpendOnSecurity, loanState, owedOf, takeZiksLoan } from "./loan";

/** A fake database: the wallet's balance, whether the person bought Ziks, and when they borrowed. */
function fakeDb({ balance = 0, bought = false, borrowedAt = null as Date | null } = {}) {
  return {
    coinEntry: {
      count: vi.fn(async () => (bought ? 1 : 0)),
      aggregate: vi.fn(async () => ({ _sum: { amount: balance } })),
    },
    user: {
      findUnique: vi.fn(async () => ({ ziksLoanAt: borrowedAt })),
      updateMany: vi.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({ count: borrowedAt ? 0 : 1 })),
    },
  };
}
const asDb = (db: ReturnType<typeof fakeDb>) => db as never;

describe("borrowing Ziks to try Security (16 Nov call)", () => {
  it("is 2,000 Ziks ($2), once, for someone who has never bought Ziks", async () => {
    expect(ZIKS_LOAN).toBe(2000);
    expect(await loanState(asDb(fakeDb()), "u1")).toEqual({ canBorrow: true, overdraft: 0 });
    expect(await loanState(asDb(fakeDb({ borrowedAt: new Date() })), "u1")).toEqual({ canBorrow: false, overdraft: 2000 });
    // A purchase pays it back and ends it; a buyer was never offered one.
    expect(await loanState(asDb(fakeDb({ bought: true, borrowedAt: new Date() })), "u1")).toEqual({ canBorrow: false, overdraft: 0 });
    expect(await loanState(asDb(fakeDb({ bought: true })), "u1")).toEqual({ canBorrow: false, overdraft: 0 });
  });

  it("is only taken by an explicit borrow, and only once", async () => {
    const fresh = fakeDb();
    expect(await takeZiksLoan(asDb(fresh), "u1")).toBe(true);
    expect(fresh.user.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "u1", ziksLoanAt: null } });
    expect(await takeZiksLoan(asDb(fakeDb({ borrowedAt: new Date() })), "u1")).toBe(false);
    expect(await takeZiksLoan(asDb(fakeDb({ bought: true })), "u1")).toBe(false);
  });

  it("lets a Security payment go down to -2,000 while the loan is open, and no further", async () => {
    await expect(assertCanSpendOnSecurity(asDb(fakeDb({ balance: 0, borrowedAt: new Date() })), "u1", 2000)).resolves.toBeUndefined();
    await expect(assertCanSpendOnSecurity(asDb(fakeDb({ balance: -1500, borrowedAt: new Date() })), "u1", 500)).resolves.toBeUndefined();
    await expect(assertCanSpendOnSecurity(asDb(fakeDb({ balance: -1500, borrowedAt: new Date() })), "u1", 501)).rejects.toMatchObject({ code: "insufficient_ziks" });
    // Without a loan, the usual rule: never below zero.
    await expect(assertCanSpendOnSecurity(asDb(fakeDb({ balance: 300 })), "u1", 500)).rejects.toMatchObject({ code: "insufficient_ziks" });
  });

  it("owes what's below zero", () => {
    expect(owedOf(-1200)).toBe(1200);
    expect(owedOf(0)).toBe(0);
    expect(owedOf(3800)).toBe(0);
  });
});
