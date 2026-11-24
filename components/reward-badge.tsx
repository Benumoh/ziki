import { ZikSymbol } from "@/components/zik-symbol";

/**
 * Ziks in a few characters, for the issue list where there is little room: 670, 5k, 5.3k, 12k, 1.2M. Exact to a tenth
 * of the unit, never rounded up into a different-looking amount, and no "+": a locked price is exact.
 */
export function compactZiks(ziks: number): string {
  const amount = Math.round(ziks);
  const short = (value: number, unit: string) => `${Number((Math.floor(value * 10) / 10).toFixed(1))}${unit}`;
  if (amount >= 1_000_000) return short(amount / 1_000_000, "M");
  if (amount >= 1_000) return short(amount / 1_000, "k");
  return String(amount);
}

/**
 * An issue's price on the list (#price-lock), in Ziks: green once it is funded and locked (the Ziks are held for the
 * fixer), grey while it is priced but waiting for funding, and nothing while agents are still estimating it. The full
 * amount and where it stands are in its title.
 */
export function RewardBadge({ price, held, className = "text-[14px]" }: { price: number | null; held: number; className?: string }) {
  if (price === null) return <span data-testid="reward" aria-hidden="true" />;
  const funded = held >= price;
  const label = `${price.toLocaleString("en-US")} Ziks, ${funded ? "funded" : "waiting for funding"}`;
  return (
    <span
      className={`inline-flex items-baseline gap-[0.12em] whitespace-nowrap font-mono font-bold tabular-nums ${className} ${funded ? "text-zk-ok-fg" : "text-zk-muted"}`}
      title={label}
      aria-label={label}
      data-testid="reward"
      data-funded={funded ? "true" : "false"}
    >
      <ZikSymbol />
      {compactZiks(price)}
    </span>
  );
}
