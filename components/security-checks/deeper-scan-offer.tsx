"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { buyZiksHref } from "@/lib/coins/return-to";
import { ZikAmount } from "@/components/zik-symbol";
import { useDeeperScan, type Checkout } from "@/components/security-checks/use-deeper-scan";

type Cover = { title: string; why: string };

/**
 * The top of a scan's page while its deeper scan waits for payment (#deeper-scan-gate, 18 Nov). Chloe's steps box
 * (scan-steps.tsx) shows the Deeper scan step locked with a Start button; Start sends "zk:start-deeper-scan", which
 * opens this checkout. Her rule: the price shows only once the checkout opens. Back from buying Ziks (`?bought=1`),
 * the checkout opens again by itself, to press Pay. It never pays by itself.
 */
export function DeeperScanStart({ checkId, site, price, covers, backFromBuying = false }: { checkId: string; site: string; price: number; covers: Cover[]; backFromBuying?: boolean }) {
  const deeper = useDeeperScan(checkId);
  const router = useRouter();
  const pathname = usePathname();
  // Start in the steps box opens the checkout.
  useEffect(() => {
    const start = () => deeper.openCheckout();
    window.addEventListener("zk:start-deeper-scan", start);
    return () => window.removeEventListener("zk:start-deeper-scan", start);
  }, [deeper]);
  // Back from buying Ziks: open the checkout again, waiting for the Ziks to arrive. The address loses `?bought=1`
  // so a reload doesn't open it again.
  const reopened = useRef(false);
  useEffect(() => {
    if (!backFromBuying || reopened.current) return;
    reopened.current = true;
    deeper.openCheckout({ awaitingZiks: true });
    router.replace(pathname, { scroll: false });
  }, [backFromBuying, deeper, pathname, router]);
  return (
    <>
      {/* In the place and look of "Ziki is checking …" (check-activity.tsx), which shows once it's paid for. */}
      <div className="min-w-0">
        <h1 id="check-headline" className="m-0 wrap-break-word text-2xl font-extrabold tracking-[-0.02em] text-zk-text sm:text-[28px]">
          Quick scan done on {site}
        </h1>
        <p className="m-0 mt-1 text-[15px] font-bold text-zk-accent">Start the deeper scan to have agents check inside.</p>
      </div>
      <DeeperScanCheckout checkId={checkId} site={site} price={price} covers={covers} deeper={deeper} />
    </>
  );
}

/**
 * The checkout (#deeper-scan-gate, 18 Nov): a large window over the blurred page, like Add asset. Only the deeper
 * scan (18 Nov, the team: the quick scan is already done, so it isn't offered again): what agents check, then the
 * price, the wallet and Pay. Paying happens only from here.
 */
function DeeperScanCheckout({ checkId, site, price, covers, deeper }: { checkId: string; site: string; price: number; covers: Cover[]; deeper: ReturnType<typeof useDeeperScan> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { open, checkout, loading, paying, close, pay } = deeper;

  // showModal() gives the focus trap, the inert background and Escape.
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  return (
    // Esc is handled by onCancel; onClick only catches a click on the backdrop, which has no keyboard equivalent to add.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialog}
      aria-labelledby="deeper-checkout-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[760px] overflow-y-auto rounded-2xl border border-zk-border bg-zk-surface p-0 text-zk-text shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-sm"
    >
      {open ? (
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3 border-b border-zk-divider pb-4">
            <div className="min-w-0">
              <h2 id="deeper-checkout-title" className="m-0 text-lg font-bold text-zk-text sm:text-xl">Run the deeper scan</h2>
              <p className="m-0 mt-0.5 truncate text-sm text-zk-text2">{site}</p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={close}
              disabled={paying}
              className="rounded-full p-1.5 text-zk-muted hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue disabled:opacity-40"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>

          {/* The deeper scan: what agents check (the agents' own parts), with its price. */}
          <section aria-labelledby="deeper-checkout-card" className="rounded-xl border-2 border-electric-blue-strong p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 id="deeper-checkout-card" className="m-0 text-sm font-bold text-zk-text">Deeper scan</h3>
              <span className="rounded-full bg-zk-tint px-2.5 py-0.5 text-xs font-bold text-zk-accent"><ZikAmount amount={price} /></span>
            </div>
            <p className="m-0 mt-2 text-sm text-zk-text2">Security agents check inside:</p>
            <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
              {covers.map((cover) => (
                <li key={cover.title} className="flex gap-2 text-sm">
                  <span aria-hidden="true" className="font-bold text-zk-ok-fg">✓</span>
                  <span className="font-semibold text-zk-text">{cover.title}</span>
                </li>
              ))}
            </ul>
          </section>

          <div aria-live="polite">
            <Wallet checkout={checkout} loading={loading} price={price} />
          </div>

          {checkout?.error ? (
            <p role="alert" className="m-0 rounded-xl bg-zk-bad-bg px-4 py-3 text-sm text-zk-bad-fg">{checkout.error}</p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 border-t border-zk-divider pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-xs text-zk-muted">Agents look; they never break in. You pay once, for this scan.</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                onClick={close}
                disabled={paying}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-zk-border bg-zk-surface px-5 text-sm font-semibold text-zk-text hover:bg-zk-chip disabled:opacity-40"
              >
                Cancel
              </button>
              <PayButton checkId={checkId} checkout={checkout} loading={loading} paying={paying} price={price} pay={pay} />
            </div>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

const PRIMARY = "inline-flex min-h-11 items-center justify-center gap-1 whitespace-nowrap rounded-full bg-electric-blue-strong px-5 text-sm font-bold text-white hover:brightness-105 disabled:opacity-60";

/** Picked the deeper scan: the price and the wallet, and the one-time loan when the wallet is short. */
function Wallet({ checkout, loading, price }: { checkout: Checkout | null; loading: boolean; price: number }) {
  if (loading || !checkout) {
    return <p className="m-0 text-sm text-zk-muted">Checking your Ziks…</p>;
  }
  return (
    <div className="rounded-xl border border-zk-border px-4 py-3">
      <dl className="m-0 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
        <dt className="text-zk-text2">Deeper scan</dt>
        <dd className="m-0 font-bold text-zk-text"><ZikAmount amount={price} /></dd>
        <dt className="text-zk-text2">Your Ziks</dt>
        <dd className="m-0 font-semibold text-zk-text"><ZikAmount amount={checkout.balance} /></dd>
      </dl>
      {checkout.arriving ? (
        <p className="m-0 mt-3 border-t border-zk-divider pt-3 text-sm text-zk-text2" role="status">
          Thanks for buying Ziks. They arrive as soon as Stripe confirms the payment, usually within a few seconds.
        </p>
      ) : checkout.short ? (
        <p className="m-0 mt-3 border-t border-zk-divider pt-3 text-sm text-zk-text2">
          {checkout.canBorrow
            ? "You don't have enough Ziks. You can borrow 20 once: your wallet can go down to −20 for security, and your first top-up pays it back."
            : "You don't have enough Ziks for this. Buy Ziks, then come back and run it."}
        </p>
      ) : null}
    </div>
  );
}

function PayButton({ checkId, checkout, loading, paying, price, pay }: { checkId: string; checkout: Checkout | null; loading: boolean; paying: boolean; price: number; pay: (borrow?: boolean) => void }) {
  // Short and nothing left to borrow: the way forward is buying Ziks.
  // Back from buying, the Ziks not in yet: wait rather than send them to buy again.
  if (checkout?.arriving) {
    return <button type="button" disabled className={PRIMARY}>Waiting for your Ziks…</button>;
  }
  if (checkout?.short && !checkout.canBorrow) {
    // To the Ziks page, remembering this scan: after paying, Stripe sends them straight back here (#deeper-scan-gate).
    return <Link href={buyZiksHref(checkId)} className={PRIMARY}>Buy Ziks</Link>;
  }
  const borrow = Boolean(checkout?.short && checkout.canBorrow);
  return (
    <button type="button" onClick={() => pay(borrow)} disabled={loading || paying || !checkout} className={PRIMARY}>
      {paying ? "Starting…" : borrow ? <>Borrow and pay <ZikAmount amount={price} /></> : <>Pay <ZikAmount amount={price} /> and start</>}
    </button>
  );
}
