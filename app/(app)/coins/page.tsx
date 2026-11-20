import "@/app/(app)/settings/settings-design.css";
import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { buyZiksAction } from "@/app/actions/coins";
import { walletSummary } from "@/lib/coins/ledger";
import { owedOf } from "@/lib/coins/loan";
import { ZIK_PACKS, formatUsd, formatZik, zikToCents } from "@/lib/coins/math";
import { stripeConfigured } from "@/lib/coins/stripe";
import { paymentsAvailable } from "@/lib/coins/test-mode";
import { LocalTime } from "@/components/local-time";
import { ZikiPlans } from "@/components/coins/ziki-plans";
import { ZIK_PLANS, discountedCents, findPlan } from "@/lib/coins/plans";
import { discountPercentFor, liveSubscriptionOf, syncUserSubscriptions } from "@/lib/coins/subscription";
import { UrlNotice } from "@/components/coins/url-notice";
import { BudgetStatusTag } from "@/components/coins/budget-status";
import { ownedProjectBudgets } from "@/lib/coins/budget-view";
import { ZikAmount } from "@/components/zik-symbol";
import { safeReturnTo } from "@/lib/coins/return-to";

export const metadata = { title: "Ziks" };
export const dynamic = "force-dynamic";

const card = "rounded-[20px] border border-zk-border bg-zk-surface p-6 flex flex-col gap-4";
const notice = "m-0 rounded-xl px-4 py-3 text-sm font-semibold";
const quick =
  "inline-flex min-h-10 items-center justify-center rounded-full border border-zk-border bg-zk-surface px-4 text-sm font-bold text-zk-text transition hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue";

/** What a ledger row says happened, for the activity list. */
const KIND_LABEL = {
  purchase: "Bought Ziks",
  fund_issue: "Funded an issue",
  release: "Earned from an issue",
  fee: "Fee",
  refund: "Refunded from an issue",
  withdrawal: "Withdrawal",
  withdrawal_reversal: "Withdrawal returned",
  check_payment: "Unlocked security fixes",
  fund_budget: "Funded a project's budget",
  reserve: "Reserved for an issue",
  unreserve: "Returned to a budget",
  budget_return: "Budget returned",
} as const;

/** Scan admission and finding unlocks share an accounting kind, but not an Activity description. */
function activityLabel(entry: { kind: keyof typeof KIND_LABEL; sourceKey: string }): string {
  if (entry.kind === "check_payment") {
    if (entry.sourceKey.startsWith("deeper-scan:")) return "Deeper scan";
    if (entry.sourceKey.startsWith("rescan:")) return "Scan again";
  }
  return KIND_LABEL[entry.kind];
}

/** Whether the Stripe webhook has already credited what was just paid for (a purchase in the last few minutes). */
function hasRecentPurchase(entries: { kind: string; createdAt: Date }[]): boolean {
  return entries.some((entry) => entry.kind === "purchase" && Date.now() - entry.createdAt.getTime() < 10 * 60 * 1000);
}

const ICONS = {
  buy: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v8M8 12h8",
  budgets: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 11v5M9.5 13.5h5",
  plan: "M12 2l3 6.5 7 1-5 4.8 1.2 7L12 18l-6.2 3.3L7 14.3 2 9.5l7-1z",
  activity: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 3",
};

type SectionId = "buy" | "budgets" | "plan" | "activity";
type CoinsQuery = { section?: string; bought?: string; subscribed?: string; error?: string; returnTo?: string };

/**
 * Ziks (#ziki-coins), laid out like the project's settings and its Budget page: one thing at a time, with buying first.
 * Above it, a slim strip with what you hold and the three things people come here to do. Buying is Stripe Checkout (or
 * instant in test mode); the wallet is only credited when the payment is confirmed. Earning and withdrawing are on the
 * Withdraw page (/coins/payouts).
 */
export default async function CoinsPage({ searchParams }: { searchParams?: Promise<CoinsQuery> }) {
  const [user, query] = await Promise.all([requireUser(), searchParams ?? Promise.resolve({} as CoinsQuery)]);
  // Coming back from subscribing: show the plan now rather than when the webhook gets there.
  if (query.subscribed === "1" && stripeConfigured()) await syncUserSubscriptions(user.id).catch(() => undefined);
  const [subscription, discountPercent] = await Promise.all([liveSubscriptionOf(user.id), discountPercentFor(user.id)]);

  const [wallet, entries, budgets] = await Promise.all([
    walletSummary(prisma, user.id),
    prisma.coinEntry.findMany({
      // Buying and spending only; what was earned and withdrawn is on the Withdraw page.
      where: { account: "wallet", userId: user.id, kind: { in: ["purchase", "fund_issue", "refund", "check_payment", "fund_budget", "budget_return"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      select: { id: true, kind: true, sourceKey: true, amount: true, createdAt: true, bug: { select: { number: true, title: true } } },
    }),
    // The projects this person can fund; a failed read just leaves them out.
    ownedProjectBudgets(user.id).catch(() => ({ projects: [], more: 0 })),
  ]);
  const configured = paymentsAvailable();
  const justCredited = hasRecentPurchase(entries);
  // Came from a deeper scan's checkout (#deeper-scan-gate): after paying, Stripe sends them back to that scan.
  const returnTo = safeReturnTo(query.returnTo);
  const owed = owedOf(wallet.balance);
  const plan = subscription ? findPlan(subscription.planId) : null;
  const bestDiscount = Math.max(...ZIK_PLANS.map((option) => option.discountPercent));
  const ownsProjects = budgets.projects.length > 0;

  const sections: { id: SectionId; label: string; hint: string; icon: string }[] = [
    { id: "buy", label: "Buy Ziks", hint: "Packs for your wallet", icon: ICONS.buy },
    ...(ownsProjects ? [{ id: "budgets" as const, label: "Project budgets", hint: "Fund whole projects", icon: ICONS.budgets }] : []),
    { id: "plan", label: "Your plan", hint: plan ? `${plan.label}, ${plan.discountPercent}% off packs` : "Cheaper packs every month", icon: ICONS.plan },
    { id: "activity", label: "Activity", hint: "What you bought and spent", icon: ICONS.activity },
  ];
  // Back from subscribing, the plan is what they came to see.
  const wanted = query.section ?? (query.subscribed === "1" ? "plan" : undefined);
  const section: SectionId = sections.find((item) => item.id === wanted)?.id ?? "buy";

  return (
    <div className="settings-page settings-design mx-auto flex w-full max-w-5xl flex-col gap-6 pb-10">
      <div className="flex flex-col gap-2.5">
        <Link href="/home" className="inline-flex min-h-8 items-center gap-1.5 self-start text-sm font-semibold text-zk-accent hover:underline">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </Link>
        <h1 className="m-0 text-[28px] font-extrabold tracking-[-0.02em] text-zk-text">Ziks</h1>
        <p className="m-0 text-sm text-zk-text2">Ziks fund issues and unlock security fixes. One Zik is {zikToCents(1)}¢.</p>
      </div>

      {/* One-time notices: shown on arrival, then the query is dropped from the address (UrlNotice) so a refresh does not bring them back. */}
      {query.bought === "1" ? (
        <UrlNotice role="status" className={`${notice} bg-zk-ok-bg text-zk-ok-fg`}>
          {justCredited ? "Thanks. Your payment went through and your Ziks are in your wallet." : "Thanks. Your Ziks arrive as soon as Stripe confirms the payment, usually within a few seconds."}
        </UrlNotice>
      ) : null}
      {query.subscribed === "1" ? (
        <UrlNotice role="status" className={`${notice} bg-zk-ok-bg text-zk-ok-fg`}>
          {subscription ? `Thanks. Your plan is on, and every pack is now ${discountPercent}% cheaper.` : "Thanks. Your plan shows here as soon as Stripe confirms the payment, usually within a few seconds."}
        </UrlNotice>
      ) : null}
      {query.error ? <UrlNotice role="alert" className={`${notice} bg-zk-warn-bg text-zk-warn-fg`}>{query.error}</UrlNotice> : null}

      {/* What you hold, and the three things people come here to do. */}
      <section aria-label="Your Ziks" className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-zk-border bg-zk-surface px-6 py-4">
        <div className="min-w-0">
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-zk-muted">Your Ziks</p>
          <p className="m-0 mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="text-2xl font-extrabold tabular-nums text-zk-text" data-testid="wallet-balance"><ZikAmount amount={wallet.balance} /></span>
            <span className="text-sm text-zk-text2">{formatUsd(zikToCents(Math.max(0, wallet.balance)))} in value</span>
          </p>
          {/* A borrowed overdraft (lib/coins/loan.ts): the part below zero is paid back first by the next top-up. */}
          {owed > 0 ? <p className="m-0 mt-1 text-xs font-semibold text-zk-text">You owe {owed.toLocaleString("en-US")} Ziks you borrowed. Your next top-up pays it back first.</p> : null}
        </div>
        <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
          <Link href="/coins?section=buy" className={quick}>Buy</Link>
          {ownsProjects ? <Link href="/coins?section=budgets" className={quick}>Fund a project</Link> : null}
          {/* Only for people who have earned Ziks: someone who just posts issues never withdraws. */}
          {wallet.earned > 0 ? <Link href="/coins/payouts" className={quick}>Withdraw</Link> : null}
        </nav>
      </section>

      <div className="settings-layout">
        <nav aria-label="Ziks sections" className="settings-navigation">
          {sections.map((item) => {
            const on = section === item.id;
            return (
              <Link
                key={item.id}
                href={`/coins?section=${item.id}${returnTo && item.id === "buy" ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`}
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
          {section === "buy" ? (
            <section className={card}>
              <div className="flex flex-col gap-1">
                <h2 className="m-0 text-lg font-bold text-zk-text">Buy Ziks</h2>
                <span className="text-[13px] text-zk-muted">
                  {discountPercent > 0 ? `Your ${plan?.label ?? ""} plan takes ${discountPercent}% off every pack.` : "Every pack is its Ziks at 10¢ each. They go straight into your wallet."}
                </span>
              </div>
              <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
                {ZIK_PACKS.map((pack) => {
                  const full = zikToCents(pack.zik);
                  const price = discountedCents(full, discountPercent);
                  return (
                    <li key={pack.id} className="flex flex-col gap-3 rounded-2xl border border-zk-border p-5">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="m-0 text-sm font-bold text-zk-text">{pack.label}</p>
                        {discountPercent > 0 ? <span className="rounded-full bg-zk-ok-bg px-2 py-0.5 text-[11px] font-bold text-zk-ok-fg">Save {formatUsd(full - price)}</span> : null}
                      </div>
                      <p className="m-0 flex items-baseline gap-1.5">
                        <span className="text-3xl font-extrabold tabular-nums text-zk-text">{pack.zik.toLocaleString("en-US")}</span>
                        <span className="text-sm text-zk-muted">Ziks</span>
                      </p>
                      <form action={buyZiksAction}>
                        <input type="hidden" name="packId" value={pack.id} />
                        {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
                        <button
                          type="submit"
                          disabled={!configured}
                          className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center whitespace-nowrap rounded-full bg-electric-blue-strong px-4 text-sm font-bold text-white transition hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Buy for {formatUsd(price)}
                          {discountPercent > 0 ? <s className="ml-1.5 font-medium opacity-70">{formatUsd(full)}</s> : null}
                        </button>
                      </form>
                    </li>
                  );
                })}
              </ul>
              {!configured ? <p className="m-0 text-sm text-zk-text2">Buying Ziks isn&apos;t available yet.</p> : null}
              {configured && discountPercent === 0 ? (
                <p className="m-0 text-xs text-zk-muted">
                  A plan takes up to {bestDiscount}% off every pack.{" "}
                  <Link href="/coins?section=plan" className="font-semibold text-zk-accent hover:underline">See plans</Link>
                </p>
              ) : null}
            </section>
          ) : null}

          {section === "budgets" ? (
            <section className={card}>
              <div className="flex flex-col gap-1">
                <h2 className="m-0 text-lg font-bold text-zk-text">Project budgets</h2>
                <span className="text-[13px] text-zk-muted">Put Ziks behind a whole project once, and each issue is paid from it as it is awarded.</span>
              </div>
              <ul className="m-0 list-none divide-y divide-zk-divider p-0">
                {budgets.projects.map((project) => (
                  <li key={project.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                    <span className="min-w-0 flex-1 text-sm font-semibold text-zk-text">
                      {project.name}
                      <span className="block text-xs font-normal text-zk-muted">{project.organisationName}</span>
                    </span>
                    <BudgetStatusTag status={project.status} />
                    {project.status !== "none" ? <span className="text-sm font-bold tabular-nums text-zk-text"><ZikAmount amount={project.available} /></span> : null}
                    <Link href={project.href} className="text-sm font-semibold text-zk-accent hover:underline">
                      {project.status === "none" ? "Start a budget" : "Open"}
                    </Link>
                  </li>
                ))}
              </ul>
              {budgets.more > 0 ? <p className="m-0 text-xs text-zk-muted">And {budgets.more} more projects. Open one from its page.</p> : null}
            </section>
          ) : null}

          {section === "plan" ? <ZikiPlans subscription={subscription} configured={configured} /> : null}

          {section === "activity" ? (
            <section className={card}>
              <div className="flex flex-col gap-1">
                <h2 className="m-0 text-lg font-bold text-zk-text">Activity</h2>
                <span className="text-[13px] text-zk-muted">What you bought and spent, newest first. What you earned and withdrew is on the Withdraw page.</span>
              </div>
              {entries.length === 0 ? (
                <p className="m-0 rounded-xl border border-dashed border-zk-border px-5 py-8 text-center text-sm text-zk-muted">Nothing yet. Buy Ziks to fund an issue or unlock security fixes.</p>
              ) : (
                <ul className="m-0 list-none divide-y divide-zk-divider p-0">
                  {entries.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-3 py-2.5 text-sm text-zk-text">
                      <span className="flex-1">
                        {activityLabel(entry)}
                        {entry.bug ? <span className="text-zk-muted"> · #{entry.bug.number} {entry.bug.title}</span> : null}
                        <span className="block text-xs text-zk-muted"><LocalTime date={entry.createdAt} /></span>
                      </span>
                      <span className={`font-mono font-bold tabular-nums ${entry.amount < 0 ? "text-zk-text2" : "text-zk-ok-fg"}`}>
                        {entry.amount > 0 ? "+" : ""}{formatZik(entry.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
