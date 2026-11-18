"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { buyZiksHref } from "@/lib/coins/return-to";
import { ZikAmount } from "@/components/zik-symbol";
import { useDeeperScan, type Checkout } from "@/components/security-checks/use-deeper-scan";

type Cover = { title: string; why: string };

/** What the free quick scan did (docs/security-checks.md, step 2): passive, the home page only, code only. */
const QUICK_SCAN_CHECKED = [
  "HTTPS redirect and the TLS certificate (validity, expiry)",
  "Security response headers: CSP, HSTS, X-Frame-Options, Referrer-Policy and others",
  "Cookie flags on the home page: Secure, HttpOnly, SameSite",
  "Email DNS records: SPF and DMARC",
];

/**
 * The top of a scan's page while its deeper scan waits for payment (#deeper-scan-gate, 18 Nov). Chloe's steps box
 * (scan-steps.tsx) shows the Deeper scan step locked with a Start button; Start sends "zk:start-deeper-scan", which
 * opens this checkout. Her rule: the price shows only once the checkout opens. Back from buying Ziks (`?bought=1`),
 * the checkout opens again by itself, to press Pay. It never pays by itself.
 */
export function DeeperScanStart({ checkId, site, price, quickTotal, covers, backFromBuying = false }: { checkId: string; site: string; price: number; quickTotal: number | null; covers: Cover[]; backFromBuying?: boolean }) {
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
      <DeeperScanCheckout checkId={checkId} site={site} price={price} quickTotal={quickTotal} covers={covers} deeper={deeper} />
    </>
  );
}

type Choice = "quick" | "deeper";

/**
 * The checkout (#deeper-scan-gate, 18 Nov): a large window over the blurred page, like Add asset. Two cards to pick
 * from, like plans: the free quick scan (already done) and the paid deeper scan (picked at first). The panel under
 * them follows the pick: the quick scan's technical detail and a way back to its results, or the price, the wallet
 * and Pay. Paying happens only from here.
 */
function DeeperScanCheckout({ checkId, site, price, quickTotal, covers, deeper }: { checkId: string; site: string; price: number; quickTotal: number | null; covers: Cover[]; deeper: ReturnType<typeof useDeeperScan> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { open, checkout, loading, paying, close, pay } = deeper;
  const [choice, setChoice] = useState<Choice>("deeper");

  // showModal() gives the focus trap, the inert background and Escape. Each opening starts on the deeper scan.
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      setChoice("deeper");
      node.showModal();
    }
    if (!open && node.open) node.close();
  }, [open]);

  /** Close, open the quick scan's section on the page and bring it into view. */
  function viewQuickScan() {
    close();
    // The quick scan's own section, or the list it was merged into (18 Nov).
    const section = document.getElementById("quick-scan-results") ?? document.getElementById("check-results");
    if (section instanceof HTMLDetailsElement) section.open = true;
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const found = quickTotal === null ? "Done" : quickTotal === 0 ? "Nothing found" : `${quickTotal} ${quickTotal === 1 ? "problem" : "problems"} found`;

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
      className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[820px] overflow-y-auto rounded-2xl border border-zk-border bg-zk-surface p-0 text-zk-text shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-sm"
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

          {/* Two cards to pick from, like plans (Pentest-Tools' Light and Deep scans): a radio group, so arrows move between them. */}
          <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-[2fr_3fr]">
            <legend className="sr-only">Scan</legend>
            <ChoiceCard choice="quick" picked={choice} onPick={setChoice} title="Quick scan" badge={<span className="rounded-full bg-zk-ok-bg px-2.5 py-0.5 text-xs font-bold text-zk-ok-fg">Done · Free</span>}>
              <p className="m-0 mt-2 text-sm text-zk-text2">
                {quickTotal === null ? "Looked" : quickTotal === 0 ? "Found nothing wrong" : `Found ${quickTotal} ${quickTotal === 1 ? "problem" : "problems"}`} on the outside: security headers, HTTPS and cookies.
              </p>
            </ChoiceCard>
            <ChoiceCard choice="deeper" picked={choice} onPick={setChoice} title="Deeper scan" badge={<span className="rounded-full bg-zk-tint px-2.5 py-0.5 text-xs font-bold text-zk-accent"><ZikAmount amount={price} /></span>}>
              <p className="m-0 mt-2 text-sm text-zk-text2">Security agents check inside:</p>
              <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                {covers.map((cover) => (
                  <li key={cover.title} className="flex gap-2 text-sm">
                    <span aria-hidden="true" className="font-bold text-zk-ok-fg">✓</span>
                    <span className="font-semibold text-zk-text">{cover.title}</span>
                  </li>
                ))}
              </ul>
            </ChoiceCard>
          </fieldset>

          {/* The panel follows the pick. */}
          <div aria-live="polite">
            {choice === "quick" ? <QuickScanDetail found={found} /> : <Wallet checkout={checkout} loading={loading} price={price} />}
          </div>

          {choice === "deeper" && checkout?.error ? (
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
              {choice === "quick" ? (
                <button type="button" onClick={viewQuickScan} className={PRIMARY}>
                  View quick scan results
                </button>
              ) : (
                <PayButton checkId={checkId} checkout={checkout} loading={loading} paying={paying} price={price} pay={pay} />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

const PRIMARY = "inline-flex min-h-11 items-center justify-center gap-1 whitespace-nowrap rounded-full bg-electric-blue-strong px-5 text-sm font-bold text-white hover:brightness-105 disabled:opacity-60";

/** One pickable card: a real radio button under the whole card, so a click anywhere on it picks it. */
function ChoiceCard({ choice, picked, onPick, title, badge, children }: { choice: Choice; picked: Choice; onPick: (choice: Choice) => void; title: string; badge: React.ReactNode; children: React.ReactNode }) {
  const on = picked === choice;
  return (
    <label
      className={`block cursor-pointer rounded-xl p-4 transition has-focus-visible:ring-2 has-focus-visible:ring-electric-blue has-focus-visible:ring-offset-2 ${
        on ? "border-2 border-electric-blue-strong bg-zk-surface" : "border-2 border-zk-border bg-zk-bg hover:border-zk-muted"
      }`}
    >
      <input type="radio" name="deeper-scan-choice" value={choice} checked={on} onChange={() => onPick(choice)} className="sr-only" />
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          {/* The radio's dot, drawn: filled when picked. */}
          <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-electric-blue-strong" : "border-zk-muted"}`}>
            {on ? <span className="h-2 w-2 rounded-full bg-electric-blue-strong" /> : null}
          </span>
          <span className="text-sm font-bold text-zk-text">{title}</span>
        </span>
        {badge}
      </span>
      {children}
    </label>
  );
}

/** Picked the quick scan: what it was, technically, and that it's already done and free. */
function QuickScanDetail({ found }: { found: string }) {
  return (
    <div className="rounded-xl border border-zk-border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-sm font-bold text-zk-text">Already run, at no cost</p>
        <span className="text-sm font-semibold text-zk-text">{found}</span>
      </div>
      <p className="m-0 mt-2 text-sm text-zk-text2">
        A passive, code-only check of the responses any browser gets from the home page. No AI, no agents. It looked at:
      </p>
      <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-sm text-zk-text">
        {QUICK_SCAN_CHECKED.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p className="m-0 mt-2 text-xs text-zk-muted">
        It sends nothing beyond those requests: no guessed paths, no forms submitted, no login pages, no port scans. That&apos;s what the deeper scan adds.
      </p>
    </div>
  );
}

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
