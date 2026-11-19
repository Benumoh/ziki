import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { WITHDRAW_THRESHOLD } from "@/lib/earnings-threshold";
import { walletSummary } from "@/lib/coins/ledger";
import { formatUsd, formatZik, zikToCents } from "@/lib/coins/math";
import { stripeConfigured } from "@/lib/coins/stripe";
import { WITHDRAW_MIN_ZIK, syncPayoutsEnabled } from "@/lib/coins/withdraw";
import { LocalTime } from "@/components/local-time";
import { UrlNotice } from "@/components/coins/url-notice";
import { PayoutsPanel } from "./payouts-panel";

export const metadata = { title: "Withdraw" };
export const dynamic = "force-dynamic";

const card = "rounded-[22px] border border-zk-border bg-zk-surface p-5 sm:p-6";
const label = "text-[11px] font-bold uppercase tracking-[0.08em] text-zk-muted";

const STATUS_LABEL = { paid: "Paid", failed: "Returned to your wallet", pending: "On its way" } as const;

/**
 * Withdraw (#ziki-coins): what you earned, and where it leaves Ziki. Setting up payouts with Stripe and withdrawing live here,
 * apart from buying Ziks (/coins), because they are different jobs for different people.
 */
type PayoutsQuery = { payouts?: string; error?: string };

export default async function PayoutsPage({ searchParams }: { searchParams?: Promise<PayoutsQuery> }) {
  const [user, query] = await Promise.all([requireUser(), searchParams ?? Promise.resolve({} as PayoutsQuery)]);
  const configured = stripeConfigured();
  // Coming back from Stripe's onboarding page: read the account now rather than wait for its webhook.
  if (query.payouts === "return" && configured) await syncPayoutsEnabled(user.id).catch(() => false);

  const [wallet, account, withdrawals, earnings] = await Promise.all([
    walletSummary(prisma, user.id),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { stripeAccountId: true, payoutsEnabled: true } }),
    prisma.withdrawal.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, zik: true, amountCents: true, status: true, stripeTransferId: true, createdAt: true } }),
    prisma.coinEntry.findMany({
      where: { account: "wallet", userId: user.id, kind: "release" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
      select: { id: true, amount: true, createdAt: true, bug: { select: { number: true, title: true } } },
    }),
  ]);
  // A withdrawal that is debited but not yet paid: either still waiting for Stripe's funds, or sent and on its way.
  const open = withdrawals.find((withdrawal) => withdrawal.status === "pending");
  const canWithdraw = wallet.withdrawable >= WITHDRAW_MIN_ZIK;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Link href="/coins" className="self-start text-sm font-semibold text-zk-accent hover:underline">← Back to Ziks</Link>
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">Withdraw</h1>
        <p className="mt-1 text-sm text-zk-text2">The Ziks you earn by solving issues, and how to take them out to your bank account.</p>
      </div>

      {query.payouts === "return" ? (
        <p role="status" className={`m-0 rounded-2xl px-4 py-3 text-sm font-semibold ${account.payoutsEnabled ? "bg-zk-ok-bg text-zk-ok-fg" : "bg-zk-warn-bg text-zk-warn-fg"}`}>
          {account.payoutsEnabled ? "Payouts are set up." : "Stripe still needs a few details before you can withdraw."}
        </p>
      ) : null}
      {query.error ? <UrlNotice role="alert" className="m-0 rounded-2xl bg-zk-warn-bg px-4 py-3 text-sm font-semibold text-zk-warn-fg">{query.error}</UrlNotice> : null}

      <section aria-labelledby="earned" className={card}>
        <h2 id="earned" className={label}>Ready to withdraw</h2>
        <p className="mt-3 text-4xl font-extrabold tracking-tight tabular-nums text-zk-text sm:text-[44px]">{wallet.withdrawable.toLocaleString("en-US")}</p>
        <p className="mt-1 text-sm text-zk-text2">{formatUsd(zikToCents(wallet.withdrawable))} in earned Ziks</p>
        <div className="mt-5 border-t border-zk-divider pt-4">
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

      <section aria-labelledby="earned-list" className={card}>
        <h2 id="earned-list" className={label}>Earned</h2>
        {earnings.length === 0 ? (
          <p className="mt-4 text-sm text-zk-text2">Nothing earned yet. You are paid in Ziks when an issue you solved goes live.</p>
        ) : (
          <ul className="m-0 mt-4 list-none divide-y divide-zk-divider p-0">
            {earnings.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 py-2.5 text-sm text-zk-text">
                <span className="flex-1">
                  {entry.bug ? `#${entry.bug.number} ${entry.bug.title}` : "Earned from an issue"}
                  <span className="block text-xs text-zk-muted"><LocalTime date={entry.createdAt} /></span>
                </span>
                <span className="font-mono font-bold tabular-nums text-zk-ok-fg">+{formatZik(entry.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="history" className={card}>
        <h2 id="history" className={label}>Withdrawals</h2>
        {withdrawals.length === 0 ? (
          <p className="mt-4 text-sm text-zk-text2">Nothing withdrawn yet.</p>
        ) : (
          <ul className="m-0 mt-4 list-none divide-y divide-zk-divider p-0">
            {withdrawals.map((withdrawal) => (
              <li key={withdrawal.id} className="flex items-center gap-3 py-2.5 text-sm text-zk-text">
                <span className="flex-1">
                  {formatUsd(withdrawal.amountCents)}
                  <span className="block text-xs text-zk-muted"><LocalTime date={withdrawal.createdAt} /></span>
                </span>
                <span className="text-xs font-semibold text-zk-text2">{formatZik(withdrawal.zik)} · {STATUS_LABEL[withdrawal.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
