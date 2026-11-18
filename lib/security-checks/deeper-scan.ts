import "server-only";
import { prisma } from "@/lib/prisma";
import { appendRows, CoinError, lockUser, walletBalance } from "@/lib/coins/ledger";
import { assertCanSpendOnSecurity, loanState } from "@/lib/coins/loan";
import { DEEPER_SCAN_PRICE_ZIKS, isTargetProven } from "@/lib/security-checks";
import { readQuickScan } from "./entry";

export type DeeperScanFailure =
  | { ok: false; reason: "not_found" | "quick_scan_required" | "ownership_required"; error: string }
  | { ok: false; reason: "insufficient_ziks"; error: string; needed: number; balance: number; canBorrow: boolean };
export type DeeperScanOutcome =
  | { ok: true; checkId: string; charged: number; reused: boolean }
  | DeeperScanFailure;
export type DeeperScanQuote =
  | { ok: true; checkId: string; site: string; price: number; balance: number; canBorrow: boolean; state: "payment_required" | "started" }
  | DeeperScanFailure;

const select = {
  id: true, status: true, free: true, paidAt: true,
  target: { select: { value: true, verifiedAt: true, previewSummary: true } },
} as const;
const notFound = { ok: false, reason: "not_found", error: "That scan isn't in your scans." } as const;

function eligibility(check: NonNullable<Awaited<ReturnType<typeof ownCheck>>>): DeeperScanFailure | null {
  if (check.status === "cancelled") return notFound;
  // Already started or historical free: no new charge, including retries after completion.
  if (check.free || check.paidAt) return null;
  if (!readQuickScan(check.target.previewSummary)) return { ok: false, reason: "quick_scan_required", error: "Complete the quick scan before starting a deeper scan." };
  if (!isTargetProven(check.target)) return { ok: false, reason: "ownership_required", error: "Show that this site is yours before paying for its deeper scan." };
  if (check.status !== "queued" && check.status !== "awaiting_ownership") return notFound;
  return null;
}

function ownCheck(organisationId: string, userId: string, checkId: string) {
  return prisma.securityCheck.findFirst({ where: { id: checkId, organisationId, requestedById: userId }, select });
}

/** Read-only checkout contract. The browser never supplies the amount or payment status. */
export async function deeperScanQuote(organisationId: string, userId: string, checkId: string): Promise<DeeperScanQuote> {
  const check = await ownCheck(organisationId, userId, checkId);
  if (!check) return notFound;
  const failure = eligibility(check);
  if (failure) return failure;
  const [balance, loan] = await Promise.all([walletBalance(prisma, userId), loanState(prisma, userId)]);
  const started = check.free || check.paidAt !== null;
  return { ok: true, checkId, site: check.target.value, price: started ? 0 : DEEPER_SCAN_PRICE_ZIKS, balance, canBorrow: loan.canBorrow, state: started ? "started" : "payment_required" };
}

class ScanChanged extends Error {}

/** Charge and record permission to start in one transaction. The user lock serializes wallet spends and retries. */
export async function payAndStartDeeperScan(organisationId: string, userId: string, checkId: string, now = new Date()): Promise<DeeperScanOutcome> {
  try {
    return await prisma.$transaction(async (tx): Promise<DeeperScanOutcome> => {
      await lockUser(tx, userId);
      const check = await tx.securityCheck.findFirst({ where: { id: checkId, organisationId, requestedById: userId }, select });
      if (!check) return notFound;
      const failure = eligibility(check);
      if (failure) return failure;
      if (check.free || check.paidAt) return { ok: true, checkId, charged: 0, reused: true };
      try {
        await assertCanSpendOnSecurity(tx, userId, DEEPER_SCAN_PRICE_ZIKS);
      } catch (error) {
        if (!(error instanceof CoinError) || error.code !== "insufficient_ziks") throw error;
        const [balance, loan] = await Promise.all([walletBalance(tx, userId), loanState(tx, userId)]);
        return { ok: false, reason: "insufficient_ziks", error: `A deeper scan costs ${DEEPER_SCAN_PRICE_ZIKS} Ziks.`, needed: DEEPER_SCAN_PRICE_ZIKS, balance, canBorrow: loan.canBorrow };
      }
      const changed = await tx.securityCheck.updateMany({
        where: { id: checkId, organisationId, requestedById: userId, free: false, paidAt: null, status: { in: ["queued", "awaiting_ownership"] } },
        data: { paidAt: now, priceCoins: DEEPER_SCAN_PRICE_ZIKS, status: "queued" },
      });
      if (changed.count !== 1) throw new ScanChanged();
      // Never skip duplicate ledger rows: a failed write must roll the payment marker back too.
      const recorded = await appendRows(tx, [
        { account: "wallet", userId, kind: "check_payment", amount: -DEEPER_SCAN_PRICE_ZIKS, sourceKey: `deeper-scan:${checkId}:wallet` },
        { account: "revenue", kind: "check_payment", amount: DEEPER_SCAN_PRICE_ZIKS, sourceKey: `deeper-scan:${checkId}:revenue` },
      ]);
      if (!recorded) throw new Error("Deeper scan payment ledger conflict");
      return { ok: true, checkId, charged: DEEPER_SCAN_PRICE_ZIKS, reused: false };
    });
  } catch (error) {
    if (error instanceof ScanChanged) return notFound;
    throw error;
  }
}
