"use client";

import Link from "next/link";
import { createContext, useContext, useState, type ReactNode } from "react";
import { unlockHref } from "@/lib/security-checks/report-links";

/**
 * Choosing which locked findings to unlock (12 Nov plan, S2): a tick box on
 * each locked row and an "Unlock selected" link to Chloe's pay page. Only ids
 * and prices pass through here; a locked finding has no text to pass.
 */
type Choice = { selected: ReadonlySet<string>; toggle: (id: string) => void };
const UnlockChoice = createContext<Choice | null>(null);

export function UnlockChoiceProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return <UnlockChoice.Provider value={{ selected, toggle }}>{children}</UnlockChoice.Provider>;
}

function useChoice(): Choice {
  const choice = useContext(UnlockChoice);
  if (!choice) throw new Error("UnlockChoiceProvider is missing");
  return choice;
}

/** The tick box on one locked finding. */
export function UnlockCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useChoice();
  return (
    <input
      type="checkbox"
      aria-label={`Choose to unlock: ${label}`}
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      className="mt-0.5 size-4 shrink-0 accent-electric-blue-strong"
    />
  );
}

const BUTTON =
  "inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2";

/** "Unlock selected (2) · 8 coins" beside "Unlock all · 14 coins". */
export function UnlockActions({
  checkId,
  prices,
}: {
  checkId: string;
  /** Every locked finding's id and price, worst first. */
  prices: readonly { id: string; priceCoins: number }[];
}) {
  const { selected } = useChoice();
  const chosen = prices.filter((price) => selected.has(price.id));
  const chosenCoins = chosen.reduce((sum, price) => sum + price.priceCoins, 0);
  const allCoins = prices.reduce((sum, price) => sum + price.priceCoins, 0);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chosen.length ? (
        <Link
          href={unlockHref(checkId, chosen.map((price) => price.id))}
          className={`${BUTTON} border border-zk-border bg-zk-surface text-zk-text hover:bg-zk-chip`}
        >
          Unlock selected ({chosen.length}) · {coins(chosenCoins)}
        </Link>
      ) : (
        <span aria-disabled="true" className={`${BUTTON} cursor-not-allowed border border-zk-border bg-zk-surface text-zk-muted`}>
          Unlock selected
        </span>
      )}
      <Link
        href={unlockHref(checkId, prices.map((price) => price.id))}
        className={`${BUTTON} bg-electric-blue-strong text-white hover:brightness-105`}
      >
        Unlock all · {coins(allCoins)}
      </Link>
    </div>
  );
}

const coins = (count: number) => `${count} ${count === 1 ? "coin" : "coins"}`;
