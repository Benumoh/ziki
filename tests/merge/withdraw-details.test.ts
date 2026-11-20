import { beforeEach, describe, expect, it, vi } from "vitest";

const walletSummary = vi.hoisted(() => vi.fn());
const beingChecked = vi.hoisted(() => vi.fn());
const syncEarnedZiks = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn(async () => ({ id: "earner" })) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/earnings", () => ({ beingChecked }));
vi.mock("@/lib/coins/ledger", async (actual) => ({ ...(await actual<typeof import("@/lib/coins/ledger")>()), walletSummary }));
vi.mock("@/lib/coins/earnings-sync", async (actual) => ({ ...(await actual<typeof import("@/lib/coins/earnings-sync")>()), syncEarnedZiks }));

import { withdrawDetailsAction } from "@/app/(app)/earnings/withdraw-actions";

/** The Withdraw window (#earnings-in-ziks) shows the same money as the Withdraw page: the wallet, in every workspace. */
describe("Withdraw details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncEarnedZiks.mockResolvedValue(0);
    walletSummary.mockResolvedValue({ balance: 500.4, earned: 440.4, withdrawable: 440.4 });
    beingChecked.mockResolvedValue(3.25);
  });

  it("moves what was just earned in first, then shows the wallet's withdrawable Ziks and what is being checked in Ziks", async () => {
    expect(await withdrawDetailsAction()).toEqual({ available: 440.4, checking: 32.5 });
    expect(syncEarnedZiks).toHaveBeenCalledWith("earner");
    expect(syncEarnedZiks.mock.invocationCallOrder[0]).toBeLessThan(walletSummary.mock.invocationCallOrder[0]);
  });

  it("still answers when moving earnings in fails; the sweep will catch up", async () => {
    syncEarnedZiks.mockRejectedValue(new Error("busy"));
    expect((await withdrawDetailsAction()).available).toBe(440.4);
  });
});
