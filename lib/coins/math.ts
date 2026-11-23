/**
 * Ziki Coins arithmetic (#ziki-coins). Pure functions, no database: every amount
 * is a whole number of Ziks (1,000 to the dollar), and every split hands out
 * exactly what it was given, so no Zik is ever created or lost by rounding.
 */

/**
 * How many Ziks make a dollar: 1,000, so a Zik is a tenth of a cent. The one place the rate lives: every price, pack,
 * limit and conversion in Ziks is derived from it. At this rate a cent is 10 whole Ziks, so earnings, fees and splits
 * stay whole numbers.
 */
export const ZIKS_PER_DOLLAR = 1000;

/** How many Ziks make a cent: 10. */
export const ZIKS_PER_CENT = ZIKS_PER_DOLLAR / 100;

/** Dollars as whole Ziks: what a price set in dollars costs. */
export function ziksFor(dollars: number): number {
  return Math.round(dollars * ZIKS_PER_DOLLAR);
}

/**
 * Ziks as whole cents, rounded down: a bank pays whole cents, so the Ziks short of a cent stay where they are
 * (a withdrawal takes only whole cents' worth, lib/coins/withdraw.ts).
 */
export function zikToCents(zik: number): number {
  return Math.floor(zik / ZIKS_PER_CENT);
}

/** Whole cents as Ziks: exact. */
export function centsToZik(cents: number): number {
  return Math.round(cents * ZIKS_PER_CENT);
}

/** The part of `zik` that whole cents can pay out: the rest, under 10 Ziks, stays in the wallet. */
export function payableZik(zik: number): number {
  return zikToCents(zik) * ZIKS_PER_CENT;
}

/** An issue's reward estimate in dollars (the average of the planning-poker estimates), as whole Ziks. At least one. */
export function estimateToZik(dollars: number): number {
  return Math.max(1, Math.round(dollars * ZIKS_PER_DOLLAR));
}

/** Ziks as the dollars the points economy stores an estimate in. `ziksToDollars(dollarsToZiks(n)) === n` for whole dollars. */
export function ziksToDollars(ziks: number): number {
  return ziks / ZIKS_PER_DOLLAR;
}

/** Dollars as whole Ziks, with no minimum: 0 stays 0. */
export function dollarsToZiks(dollars: number): number {
  return Math.round(dollars * ZIKS_PER_DOLLAR);
}

/** Ziks as people read them: whole numbers. */
export function formatZik(zik: number): string {
  return `${Math.round(zik).toLocaleString("en-US")} Zik${zik === 1 ? "" : "s"}`;
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** The packs on the Buy Ziks page, by their price in dollars. Priced at the Zik's value, so a pack is exactly its Ziks in dollars. */
export const ZIK_PACKS = [
  { id: "starter", zik: 5 * ZIKS_PER_DOLLAR, label: "Starter" },
  { id: "builder", zik: 15 * ZIKS_PER_DOLLAR, label: "Builder" },
  { id: "team", zik: 50 * ZIKS_PER_DOLLAR, label: "Team" },
  { id: "studio", zik: 150 * ZIKS_PER_DOLLAR, label: "Studio" },
] as const;

export type ZikPack = (typeof ZIK_PACKS)[number];

export function findPack(id: unknown): ZikPack | null {
  return ZIK_PACKS.find((pack) => pack.id === id) ?? null;
}

/** The largest amount that moves in one go ($10,000): a typo can't fund a fortune. */
export const MAX_FUND_ZIK = 10_000 * ZIKS_PER_DOLLAR;

/** Ziki's share of released escrow, a whole percent from `ZIKI_FEE_PERCENT` (0–100, default 10). */
export function feePercent(raw: string | undefined = process.env.ZIKI_FEE_PERCENT): number {
  const value = raw === undefined || raw.trim() === "" ? 10 : Number(raw);
  if (!Number.isFinite(value)) return 10;
  return Math.min(100, Math.max(0, value));
}

/** The fee on `total` Ziks, rounded to the nearest Zik, never more than the total. */
export function feeOf(total: number, percent: number = feePercent()): number {
  if (total <= 0) return 0;
  return Math.min(total, Math.round((total * percent) / 100));
}

/**
 * Splits `total` Ziks across the keys by weight (largest remainder), so the
 * shares add up to exactly `total`. Ties go to the earlier key, so the same
 * input always gives the same split. Keys with no weight get nothing.
 */
export function splitByWeight(total: number, weights: ReadonlyMap<string, number>): Map<string, number> {
  const shares = new Map<string, number>();
  const entries = [...weights].filter(([, weight]) => weight > 0);
  const sum = entries.reduce((acc, [, weight]) => acc + weight, 0);
  if (total <= 0 || sum <= 0) return shares;
  let given = 0;
  const remainders: { key: string; remainder: number; order: number }[] = [];
  entries.forEach(([key, weight], order) => {
    const exact = (total * weight) / sum;
    const floor = Math.floor(exact);
    shares.set(key, floor);
    given += floor;
    remainders.push({ key, remainder: exact - floor, order });
  });
  remainders.sort((a, b) => b.remainder - a.remainder || a.order - b.order);
  for (let i = 0; given < total && i < remainders.length; i += 1, given += 1) {
    const key = remainders[i].key;
    shares.set(key, (shares.get(key) ?? 0) + 1);
  }
  for (const [key, share] of [...shares]) if (share === 0) shares.delete(key);
  return shares;
}

