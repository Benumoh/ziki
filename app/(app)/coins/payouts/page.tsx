import "@/app/(app)/settings/settings-design.css";
import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { WITHDRAW_THRESHOLD } from "@/lib/earnings-threshold";
import { EARNED_KINDS, walletSummary, zikOf } from "@/lib/coins/ledger";
import { PAYOUT_ROLE_LABELS } from "@/lib/coins/earned";
import { ZIKS_PER_DOLLAR, feePercent, formatUsd, formatZik, zikToCents } from "@/lib/coins/math";
import { stripeConfigured } from "@/lib/coins/stripe";
import { WITHDRAW_MIN_ZIK, syncPayoutsEnabled } from "@/lib/coins/withdraw";
import { LocalTime } from "@/components/local-time";
import { UrlNotice } from "@/components/coins/url-notice";
import { ZikAmount } from "@/components/zik-symbol";
import { PayoutsPanel } from "./payouts-panel";

export const metadata = { title: "Withdraw" };
export const dynamic = "force-dynamic";

const card = "rounded-panel border border-zk-border bg-zk-surface p-6 flex flex-col gap-4";
const notice = "m-0 rounded-xl px-4 py-3 text-sm font-semibold";

const STATUS: Record<"paid" | "failed" | "pending", { label: string; tone: string }> = {
  paid: { label: "Paid", tone: "bg-zk-ok-bg text-zk-ok-fg" },
  pending: { label: "On its way", tone: "bg-zk-tint text-zk-accent" },
  failed: { label: "Returned to your wallet", tone: "bg-zk-warn-bg text-zk-warn-fg" },
};

const ICONS = {
  withdraw: "M12 3v12M7 10l5 5 5-5M5 21h14",
  earnings: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v10M9.5 9.5c0-1 1.1-1.8 2.5-1.8s2.5.8 2.5 1.8-1.1 1.6-2.5 1.9-2.5.9-2.5 1.9 1.1 1.8 2.5 1.8 2.5-.8 2.5-1.8",
  withdrawals: "M3 7h18M3 12h18M3 17h12",
  how: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01",
};

type SectionId = "withdraw" | "earnings" | "withdrawals" | "how";
type PayoutsQuery = { section?: string; payouts?: string; error?: string };

/**
 * Withdraw (#ziki-coins): what you earned by solving issues and taking it out to your bank, laid out like the Ziks and
 * Budget pages, one thing at a time. Setting up payouts with Stripe and withdrawing come first; earnings, past withdrawals
 * and how it all works are a click away. Only earned Ziks can be withdrawn; bought ones are for spending.
 */
export default async function PayoutsPage({ searchParams }: { searchParams?: Promise<PayoutsQuery> }) {
  const [user, query] = await Promise.all([requireUser(), searchParams ?? Promise.resolve({} as PayoutsQuery)]);
  const configured = stripeConfigured();
  // Coming back from Stripe's onboarding page: read the account now rather than wait for its webhook.
  if (query.payouts === "return" && configured) await syncPayoutsEnabled(user.id).catch(() => false);

  const [wallet, account, withdrawalRows, earnedRows] = await Promise.all([
    walletSummary(prisma, user.id),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { stripeAccountId: true, payoutsEnabled: true } }),
    prisma.withdrawal.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, zik: true, amountCents: true, status: true, stripeTransferId: true, createdAt: true } }),
    prisma.coinEntry.findMany({
      where: { account: "wallet", userId: user.id, kind: { in: [...EARNED_KINDS] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 30,
      select: { id: true, kind: true, amount: true, payoutRole: true, createdAt: true, bug: { select: { number: true, title: true } } },
    }),
  ]);
  // What each payment was for (#one-payment): "Fixed", "Confirmed", "Estimated"…
  const earnings = earnedRows.map((row) => ({ ...row, amount: zikOf(row.amount), label: row.payoutRole ? PAYOUT_ROLE_LABELS[row.payoutRole] : "Earnings" }));
  const withdrawals = withdrawalRows.map((row) => ({ ...row, zik: zikOf(row.zik) }));
  // A withdrawal that is debited but not yet paid: either still waiting for Stripe's funds, or sent and on its way.
  const open = withdrawals.find((withdrawal) => withdrawal.status === "pending");
  const canWithdraw = wallet.withdrawable >= WITHDRAW_MIN_ZIK;
  const toGo = Math.max(0, WITHDRAW_MIN_ZIK - wallet.withdrawable);
  const progress = Math.min(100, (wallet.withdrawable / WITHDRAW_MIN_ZIK) * 100);

  const sections: { id: SectionId; label: string; hint: string; icon: string }[] = [
    { id: "withdraw", label: "Withdraw", hint: "To your bank account", icon: ICONS.withdraw },
    { id: "earnings", label: "Earnings", hint: "Issues you were paid for", icon: ICONS.earnings },
    { id: "withdrawals", label: "Withdrawals", hint: "What you took out", icon: ICONS.withdrawals },
    { id: "how", label: "How payouts work", hint: "Setup, minimum and timing", icon: ICONS.how },
  ];
  const section: SectionId = sections.find((item) => item.id === query.section)?.id ?? "withdraw";

  return (
    <div className="settings-page settings-design mx-auto flex w-full max-w-5xl flex-col gap-6 pb-10">
      <div className="flex flex-col gap-2.5">
        <Link href="/coins" className="inline-flex min-h-8 items-center gap-1.5 self-start text-sm font-semibold text-zk-accent hover:underline">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Ziks
        </Link>
        <h1 className="m-0 text-[28px] font-extrabold tracking-[-0.02em] text-zk-text">Withdraw</h1>
        <p className="m-0 text-sm text-zk-text2">
          <span className="font-bold text-zk-text"><ZikAmount amount={wallet.withdrawable} /></span> ready to withdraw, {formatUsd(zikToCents(wallet.withdrawable))}. The Ziks you earn by solving issues, out to your bank account.
        </p>
      </div>

      {query.payouts === "return" ? (
        <p role="status" className={`${notice} ${account.payoutsEnabled ? "bg-zk-ok-bg text-zk-ok-fg" : "bg-zk-warn-bg text-zk-warn-fg"}`}>
          {account.payoutsEnabled ? "Payouts are set up." : "Stripe still needs a few details before you can withdraw."}
        </p>
      ) : null}
      {query.error ? <UrlNotice role="alert" className={`${notice} bg-zk-warn-bg text-zk-warn-fg`}>{query.error}</UrlNotice> : null}

      <div className="settings-layout">
        <nav aria-label="Withdraw sections" className="settings-navigation">
          {sections.map((item) => {
            const on = section === item.id;
            return (
              <Link
                key={item.id}
                href={`/coins/payouts?section=${item.id}`}
                aria-current={on ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-zk-text transition ${on ? "bg-zk-tint" : "bg-transparent hover:bg-zk-chip"}`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${on ? "bg-electric-blue-strong text-white" : "bg-zk-chip text-zk-text2"}`}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={item.icon} />
                  </svg>
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-bold">{item.label}</span>
                  <span className="text-xs font-medium text-zk-muted">{item.hint}</span>
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="settings-content flex min-w-0 flex-col gap-5">
          {section === "withdraw" ? (
            <section className={card}>
              <div className="flex flex-col gap-1">
                <h2 className="m-0 text-lg font-bold text-zk-text">Withdraw</h2>
                <span className="text-[13px] text-zk-muted">Earned Ziks go to your bank account through Stripe. Bought Ziks stay for spending.</span>
              </div>
              <div>
                <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-zk-muted">Ready to withdraw</p>
                <p className="m-0 mt-1 flex flex-wrap items-baseline gap-x-2">
                  <span className="text-3xl font-extrabold tabular-nums text-zk-text" data-testid="withdrawable"><ZikAmount amount={wallet.withdrawable} /></span>
                  <span className="text-sm text-zk-text2">{formatUsd(zikToCents(wallet.withdrawable))}</span>
                </p>
              </div>
              {/* How far from the minimum: the one thing an earner wants to know. */}
              <div>
                <div role="img" aria-label={canWithdraw ? "You have reached the minimum to withdraw" : `${wallet.withdrawable.toLocaleString("en-US")} of ${WITHDRAW_MIN_ZIK.toLocaleString("en-US")} Ziks, ${toGo.toLocaleString("en-US")} to go`} className="flex h-2.5 overflow-hidden rounded-full bg-zk-seg">
                  <span className={canWithdraw ? "bg-zk-ok-fg" : "bg-electric-blue-strong"} style={{ width: `${progress}%` }} />
                </div>
                <p className="m-0 mt-2 text-xs text-zk-muted">
                  {canWithdraw
                    ? `You've passed the ${WITHDRAW_MIN_ZIK.toLocaleString("en-US")}-Zik minimum.`
                    : `${wallet.withdrawable.toLocaleString("en-US")} of ${WITHDRAW_MIN_ZIK.toLocaleString("en-US")} Ziks: ${toGo.toLocaleString("en-US")} more to go before you can withdraw.`}
                </p>
              </div>
              <div className="border-t border-zk-divider pt-4">
                {configured ? (
                  <PayoutsPanel
                    payoutsReady={account.payoutsEnabled}
                    hasAccount={Boolean(account.stripeAccountId)}
                    withdrawable={wallet.withdrawable}
                    withdrawableUsd={formatUsd(zikToCents(wallet.withdrawable))}
                    thresholdUsd={WITHDRAW_THRESHOLD}
                    canWithdraw={canWithdraw}
                    inFlight={open ? { usd: formatUsd(open.amountCents), sent: Boolean(open.stripeTransferId) } : null}
                  />
                ) : (
                  <p className="m-0 text-sm text-zk-text2">Payouts aren&apos;t available yet.</p>
                )}
              </div>
            </section>
          ) : null}

          {section === "earnings" ? (
            <section className={card}>
              <div className="flex flex-col gap-1">
                <h2 className="m-0 text-lg font-bold text-zk-text">Earnings</h2>
                <span className="text-[13px] text-zk-muted">Everything you earned, newest first: your share of each funded issue you worked on, paid once it went live.</span>
              </div>
              {earnings.length === 0 ? (
                <p className="m-0 rounded-xl border border-dashed border-zk-border px-5 py-8 text-center text-sm text-zk-muted">Nothing earned yet. You are paid in Ziks when a funded issue you worked on goes live.</p>
              ) : (
                <ul className="m-0 list-none divide-y divide-zk-divider p-0">
                  {earnings.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-3 py-2.5 text-sm text-zk-text">
                      <span className="flex-1">
                        {entry.bug ? (
                          <><span className="text-zk-muted">#{entry.bug.number}</span> {entry.bug.title}</>
                        ) : (
                          entry.label
                        )}
                        <span className="block text-xs text-zk-muted">{entry.bug ? `${entry.label} · ` : ""}<LocalTime date={entry.createdAt} /></span>
                      </span>
                      <span className={`font-mono font-bold tabular-nums ${entry.amount < 0 ? "text-zk-warn-fg" : "text-zk-ok-fg"}`}>
                        {entry.amount < 0 ? "-" : "+"}
                        {formatZik(Math.abs(entry.amount))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {section === "withdrawals" ? (
            <section className={card}>
              <div className="flex flex-col gap-1">
                <h2 className="m-0 text-lg font-bold text-zk-text">Withdrawals</h2>
                <span className="text-[13px] text-zk-muted">What you took out to your bank account, newest first.</span>
              </div>
              {withdrawals.length === 0 ? (
                <p className="m-0 rounded-xl border border-dashed border-zk-border px-5 py-8 text-center text-sm text-zk-muted">Nothing withdrawn yet.</p>
              ) : (
                <ul className="m-0 list-none divide-y divide-zk-divider p-0">
                  {withdrawals.map((withdrawal) => (
                    <li key={withdrawal.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm text-zk-text">
                      <span className="min-w-0 flex-1">
                        <span className="font-bold">{formatUsd(withdrawal.amountCents)}</span>
                        <span className="text-zk-muted"> · {formatZik(withdrawal.zik)}</span>
                        <span className="block text-xs text-zk-muted"><LocalTime date={withdrawal.createdAt} /></span>
                      </span>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS[withdrawal.status].tone}`}>{STATUS[withdrawal.status].label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {section === "how" ? (
            <section className={card}>
              <div className="flex flex-col gap-1">
                <h2 className="m-0 text-lg font-bold text-zk-text">How payouts work</h2>
                <span className="text-[13px] text-zk-muted">From solving an issue to money in your bank.</span>
              </div>
              <ul className="m-0 list-disc space-y-2 pl-5 text-sm text-zk-text2">
                <li>When a funded issue goes live, its Ziks, less Ziki&apos;s {feePercent()}% fee, are shared by everyone who worked on it: the fixer gets the biggest share, and the testers, the merge reviewer, the reporter, the confirmers, the estimators and whoever awarded the bid get theirs. They show under Earnings.</li>
                <li>Only earned Ziks can be withdrawn. Ziks you bought are for funding issues and security checks.</li>
                <li>Set up payouts once: you add your bank account with Stripe, and Ziki never sees your bank details.</li>
                <li>You can withdraw once you have {WITHDRAW_MIN_ZIK.toLocaleString("en-US")} earned Ziks (${WITHDRAW_THRESHOLD}). {ZIKS_PER_DOLLAR.toLocaleString("en-US")} Ziks are $1, and a withdrawal pays whole cents: the few Ziks short of a cent stay in your wallet.</li>
                <li>Stripe sends the money to your bank, usually within a few days. If a transfer fails, the Ziks come back to your wallet.</li>
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
