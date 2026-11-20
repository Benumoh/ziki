"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { raiseIssuePriceAction } from "@/app/actions/coins";
import { ZikAmount } from "@/components/zik-symbol";

/**
 * An issue's price in a project that pays from a budget (#project-budget), drawn inside the Reward card in place of the
 * funding form. It says what the issue costs the budget and what is already reserved for it; an owner or admin may set
 * a higher price (never a lower one), which also counts as a price before three agents have estimated it.
 */
export function IssuePriceBox({
  bugId,
  price,
  waiting,
  reserved,
  available,
  canSetPrice,
  budgetHref,
  fromBudget = true,
}: {
  bugId: string;
  /** What the issue costs the budget, or null until three estimates are in or its owner sets a price. */
  price: number | null;
  waiting: { have: number; need: number } | null;
  /** Ziks the budget has already moved behind this issue. */
  reserved: number;
  /** What the project's budget holds, not yet reserved. */
  available: number;
  canSetPrice: boolean;
  /** The project's Budget page. */
  budgetHref: string;
  /** False in a project without a budget: the price then only unlocks funding the issue itself. */
  fromBudget?: boolean;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const value = Number(amount);
  const valid = amount !== "" && Number.isInteger(value) && value > (price ?? 0);

  const raise = () => {
    if (!valid) return;
    setNote(null);
    startTransition(async () => {
      const result = await raiseIssuePriceAction(bugId, value);
      setNote({ ok: result.ok, text: result.ok ? result.message : result.error });
      if (result.ok) {
        setAmount("");
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-zk-border bg-zk-chip px-5 py-5" data-testid="issue-price">
      {price !== null ? (
        <p className="m-0 text-sm font-bold text-zk-text" data-testid="price">
          Price · <ZikAmount amount={price} />
          {fromBudget ? <span className="ml-2 text-xs font-semibold text-zk-muted">paid from the project&apos;s budget</span> : null}
        </p>
      ) : (
        <p className="m-0 text-sm font-semibold text-zk-muted" data-testid="price">
          No price yet: {waiting?.have ?? 0} of {waiting?.need ?? 3} estimates are in
        </p>
      )}
      {reserved > 0 ? (
        <p className="m-0 text-xs font-semibold text-zk-ok-fg" data-testid="reserved">
          Reserved · <ZikAmount amount={reserved} />
        </p>
      ) : null}

      {canSetPrice ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            raise();
          }}
        >
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`price-${bugId}`}>A higher price in Ziks</label>
            <input
              id={`price-${bugId}`}
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ""))}
              placeholder={price === null ? "Set a price" : `More than ${price}`}
              className="h-11 w-32 shrink-0 rounded-full border border-zk-border bg-zk-surface px-4 text-sm font-semibold tabular-nums text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue"
            />
            <button
              type="submit"
              disabled={!valid || pending}
              className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-full bg-electric-blue-strong px-4 text-sm font-bold whitespace-nowrap text-white transition hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Saving…" : price === null ? "Set price" : "Raise price"}
            </button>
          </div>
          <p className="m-0 text-xs text-zk-muted">
            {fromBudget
              ? `The budget has ${available.toLocaleString("en-US")} ${available === 1 ? "Zik" : "Ziks"} left. A price can only go up.`
              : "Set a price and you can fund this issue now, without waiting for estimates. A price can only go up."}
          </p>
        </form>
      ) : null}
      <Link href={budgetHref} className="text-xs font-semibold text-zk-accent hover:underline">Open the project budget</Link>
      {note ? <p role="status" className={`m-0 text-sm font-semibold ${note.ok ? "text-zk-ok-fg" : "text-zk-warn-fg"}`}>{note.text}</p> : null}
    </div>
  );
}
