"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deeperScanCost, startPaidDeeperScan } from "@/app/actions/security-deeper-scan";
import { borrowZiks } from "@/app/actions/ziks-loan";

/** What the checkout shows: the quote from the server, and what went wrong if anything did. */
export type Checkout = {
  site: string;
  price: number;
  balance: number;
  canBorrow: boolean;
  /** Plain words for the person, shown inside the checkout. */
  error: string | null;
  /** The wallet can't cover the price (after any loan the person could take). */
  short: boolean;
  /** Back from buying Ziks and they haven't arrived yet: the checkout waits and reads the wallet again. */
  arriving?: boolean;
};

/** Back from buying: read the wallet again this often, this many times (Stripe's confirmation takes a few seconds). */
const ARRIVAL_POLL_MS = 3000;
const ARRIVAL_POLLS = 10;

type Failure = { ok: false; reason: string; error: string; signInUrl?: string; canBorrow?: boolean; balance?: number; needed?: number };

/**
 * Run the deeper scan (#deeper-scan-gate, 18 Nov): the checkout on top of Sanmi's payment gate
 * (app/actions/security-deeper-scan.ts). Opening it only reads the price and the wallet; the payment happens only
 * when the person presses Pay (or Borrow and pay) in the checkout. Nothing is ever paid on page load, sign-in or
 * top-up. Errors stay inside the checkout, in plain words.
 */
export function useDeeperScan(checkId: string) {
  const router = useRouter();
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, startLoading] = useTransition();
  const [paying, startPaying] = useTransition();
  /** How many times the wallet was read again while waiting for bought Ziks. */
  const polls = useRef(0);

  /** A refusal from the server, as the checkout shows it. */
  function refused(failure: Failure, current: Checkout | null): Checkout | null {
    // Signed out in another tab: sign in, then come back to this scan's page (it never pays by itself).
    if (failure.reason === "sign_in_required" && failure.signInUrl) {
      router.push(failure.signInUrl);
      return null;
    }
    const base = current ?? { site: "", price: failure.needed ?? 0, balance: failure.balance ?? 0, canBorrow: false, short: false };
    if (failure.reason === "insufficient_ziks") {
      return { ...base, balance: failure.balance ?? base.balance, canBorrow: Boolean(failure.canBorrow), short: true, error: null };
    }
    return { ...base, error: failure.error };
  }

  /**
   * Open the checkout: read the price and the wallet. Charges nothing. `awaitingZiks`: back from buying Ziks, so
   * while the wallet is still short the checkout says they're on their way and reads it again.
   */
  function openCheckout({ awaitingZiks = false }: { awaitingZiks?: boolean } = {}) {
    setOpen(true);
    if (!awaitingZiks) polls.current = 0;
    startLoading(async () => {
      const quote = await deeperScanCost(checkId).catch(() => null);
      if (!quote) {
        setCheckout({ site: "", price: 0, balance: 0, canBorrow: false, short: false, error: "Ziki couldn't load the price just now. Try again." });
        return;
      }
      if (!quote.ok) {
        const next = refused(quote as Failure, null);
        if (!next) setOpen(false);
        setCheckout(next);
        return;
      }
      // Already paid for (another tab, or a retry): just show it, never ask to pay again.
      if (quote.state === "started") {
        setOpen(false);
        router.refresh();
        return;
      }
      // Short only when it's certain: never borrowed (so no overdraft yet) and the wallet is below the price. Anyone
      // else just presses Pay, and the server says if it's not enough (a borrowed overdraft may still cover it).
      const arriving = awaitingZiks && quote.balance < quote.price && polls.current < ARRIVAL_POLLS;
      setCheckout({ site: quote.site, price: quote.price, balance: quote.balance, canBorrow: quote.canBorrow, short: !arriving && quote.canBorrow && quote.balance < quote.price, arriving, error: null });
    });
  }

  // Waiting for bought Ziks: read the wallet again every few seconds, a few times, while the checkout is open.
  // After that it shows what's there; the person can still buy more or close it.
  useEffect(() => {
    if (!open || !checkout?.arriving) return;
    const timer = setTimeout(() => {
      polls.current += 1;
      openCheckout({ awaitingZiks: true });
    }, ARRIVAL_POLL_MS);
    return () => clearTimeout(timer);
    // openCheckout is recreated each render; the wallet is read again only when this checkout changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, checkout]);

  function close() {
    if (paying) return;
    setOpen(false);
  }

  /** Pay, after the person pressed Pay. With `borrow`, take the one-time loan first. */
  function pay(borrow = false) {
    startPaying(async () => {
      if (borrow) {
        const loan = await borrowZiks();
        if (loan.error) {
          setCheckout((current) => (current ? { ...current, error: loan.error ?? "Ziki couldn't lend Ziks just now." } : current));
          return;
        }
      }
      let outcome;
      try {
        outcome = await startPaidDeeperScan(checkId);
      } catch {
        // The payment may have gone through before the connection dropped: read the scan again instead of retrying.
        setOpen(false);
        router.refresh();
        return;
      }
      if (outcome.ok) {
        setOpen(false);
        router.refresh();
        return;
      }
      const next = refused(outcome as Failure, checkout);
      if (!next) setOpen(false);
      setCheckout(next);
    });
  }

  return { open, checkout, loading, paying, openCheckout, close, pay };
}
