import Link from "next/link";
import { endSubscriptionAction, keepSubscriptionAction, subscribeAction } from "@/app/actions/coins";
import { formatUsd } from "@/lib/coins/math";
import { ZIK_PLANS, findPlan, planBreakEvenCents } from "@/lib/coins/plans";

const card = "rounded-panel border border-zk-border bg-zk-surface p-5 sm:p-6";
const label = "text-[11px] font-bold uppercase tracking-[0.08em] text-zk-muted";
const BUTTON =
  "inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-full border border-zk-border bg-zk-surface px-4 text-sm font-bold text-zk-text transition hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue disabled:cursor-not-allowed disabled:opacity-60";

/** Filled, like the Buy buttons on the packs: the one action on each plan card. */
const FILLED =
  "inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-full bg-electric-blue-strong px-4 text-sm font-bold text-white transition hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

/** The plan the Pricing page marks as most popular; the same one stands out here. */
const POPULAR_PLAN = "pro";

export type PlanView = {
  planId: string;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  payUrl: string | null;
};

const date = (value: Date) => value.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * Ziki plans on the Ziks page (#ziki-coins): an owner who doesn't have one picks one and pays its monthly fee through
 * Stripe; one who does sees what it takes off the Ziks packs, when it renews, and can end it at the end of the month
 * (or take that back). What a plan costs and takes off is lib/coins/plans.ts; the discount itself is applied at
 * checkout (lib/coins/purchase.ts).
 */
export function ZikiPlans({ subscription, configured }: { subscription: PlanView | null; configured: boolean }) {
  const current = subscription ? findPlan(subscription.planId) : null;

  if (subscription && current) {
    const late = subscription.status === "past_due";
    return (
      <section aria-labelledby="plan" className={card}>
        <h2 id="plan" className={label}>Your plan</h2>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div>
            <p className="m-0 text-2xl font-extrabold text-zk-text">
              {current.label}
              <span className={`ml-3 align-middle text-xs font-bold ${late ? "text-zk-warn-fg" : "text-zk-ok-fg"}`}>{late ? "Payment failed" : "Active"}</span>
            </p>
            <p className="m-0 mt-1 text-sm text-zk-text2">
              {late
                ? `Your ${current.discountPercent}% off Ziks packs is paused until the payment goes through.`
                : `You pay ${current.discountPercent}% less on every Ziks pack. The plan is ${formatUsd(current.monthlyCents)} a month.`}
            </p>
            <p className="m-0 mt-3 text-sm font-semibold text-zk-text">
              {subscription.cancelAtPeriodEnd
                ? `Ends on ${subscription.currentPeriodEnd ? date(subscription.currentPeriodEnd) : "the end of this month"}. Your discount stays until then.`
                : `Renews on ${subscription.currentPeriodEnd ? date(subscription.currentPeriodEnd) : "its next date"}.`}
            </p>
          </div>
          <form action={subscription.cancelAtPeriodEnd ? keepSubscriptionAction : endSubscriptionAction} className="w-full sm:w-auto">
            <button type="submit" className={`${BUTTON} sm:min-w-44`}>{subscription.cancelAtPeriodEnd ? "Keep my plan" : "End plan"}</button>
          </form>
        </div>
        {late ? (
          <p role="alert" className="mb-0 mt-4 rounded-2xl bg-zk-warn-bg px-4 py-3 text-sm font-semibold text-zk-warn-fg">
            Your last payment didn&apos;t go through. Stripe will try again.{" "}
            {subscription.payUrl ? (
              <a href={subscription.payUrl} target="_blank" rel="noreferrer" className="underline">Pay it now</a>
            ) : null}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="plans" className={card}>
      <h2 id="plans" className={label}>Ziki plans</h2>
      <p className="m-0 mt-2 text-sm text-zk-text2">
        Subscribe to pay less every time you buy Ziks. End it any time; the plan runs to the end of the month you paid for.{" "}
        <Link href="/pricing" className="font-semibold text-zk-accent hover:underline">See the pricing page</Link>
      </p>
      <ul className="m-0 mt-4 grid list-none gap-3 p-0 pt-3 sm:grid-cols-3">
        {ZIK_PLANS.map((plan) => (
          <li
            key={plan.id}
            className={`relative flex flex-col rounded-2xl border p-4 ${plan.id === POPULAR_PLAN ? "border-zk-accent bg-zk-tint/40 shadow-[0_0_0_1px_var(--color-zk-accent)]" : "border-zk-border"}`}
          >
            {plan.id === POPULAR_PLAN ? (
              <span className="absolute -top-3 left-4 rounded-full bg-electric-blue-strong px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-white">Most popular</span>
            ) : null}
            <p className="m-0 text-sm font-bold text-zk-text">{plan.label}</p>
            <p className="m-0 mt-2 text-2xl font-extrabold tabular-nums text-zk-text">{plan.discountPercent}% off</p>
            <p className="m-0 text-xs text-zk-muted">every Ziks pack you buy</p>
            <p className="m-0 mt-3 text-sm font-semibold text-zk-text">{formatUsd(plan.monthlyCents)} a month</p>
            <p className="m-0 mt-0.5 text-xs text-zk-muted">Pays for itself from {formatUsd(planBreakEvenCents(plan))} of Ziks a month</p>
            <form action={subscribeAction} className="mt-auto pt-4">
              <input type="hidden" name="planId" value={plan.id} />
              <button type="submit" disabled={!configured} className={FILLED}>Subscribe</button>
            </form>
          </li>
        ))}
      </ul>
      {!configured ? <p className="mb-0 mt-3 text-sm text-zk-text2">Plans aren&apos;t available yet.</p> : null}
    </section>
  );
}
