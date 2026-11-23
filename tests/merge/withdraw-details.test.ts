import { beforeEach, describe, expect, it, vi } from "vitest";

const walletSummary = vi.hoisted(() => vi.fn());
const beingChecked = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn(async () => ({ id: "earner" })) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/earnings", () => ({ beingChecked }));
vi.mock("@/lib/coins/ledger", async (actual) => ({ ...(await actual<typeof import("@/lib/coins/ledger")>()), walletSummary }));

import { withdrawDetailsAction } from "@/app/(app)/earnings/withdraw-actions";

/** The Withdraw window (#one-payment) shows the same money as the Withdraw page: the wallet, in every workspace. */
describe("Withdraw details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    walletSummary.mockResolvedValue({ balance: 50_040, earned: 44_040, withdrawable: 44_040 });
    beingChecked.mockResolvedValue(3250);
  });

  it("shows the person's own wallet's withdrawable Ziks and what funded issues will still pay them, in Ziks", async () => {
    expect(await withdrawDetailsAction()).toEqual({ available: 44_040, checking: 3250 });
    expect(walletSummary).toHaveBeenCalledWith({}, "earner");
    expect(beingChecked).toHaveBeenCalledWith({}, "earner");
  });
});
