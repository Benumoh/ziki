/**
 * The Ziki plans (#ziki-coins): the one place the plans, their monthly fee and their discount are set. Subscribing to a
 * plan is a membership: the owner pays the monthly fee through Stripe, and while the plan is paid up every Ziks pack
 * they buy costs less by the plan's discount. They still get the pack's full Ziks. Change a number here and the Ziks
 * page, the checkouts and the amounts the webhook accepts all follow.
 */
export const ZIK_PLANS = [
  { id: "plus", label: "Plus", monthlyCents: 500, discountPercent: 10 },
  { id: "pro", label: "Pro", monthlyCents: 1500, discountPercent: 15 },
  { id: "team", label: "Team", monthlyCents: 4000, discountPercent: 20 },
] as const;

export type ZikPlan = (typeof ZIK_PLANS)[number];
export type ZikPlanId = ZikPlan["id"];

export function findPlan(id: unknown): ZikPlan | null {
  return ZIK_PLANS.find((plan) => plan.id === id) ?? null;
}

/** A price in cents with a discount taken off, to the cent. 0 means full price. */
export function discountedCents(fullCents: number, discountPercent: number): number {
  return Math.round((fullCents * (100 - discountPercent)) / 100);
}

/** Whether a discount is one a plan gives (or none): the only ones the webhook accepts on a pack's price. */
export function isKnownDiscount(discountPercent: number): boolean {
  return discountPercent === 0 || ZIK_PLANS.some((plan) => plan.discountPercent === discountPercent);
}

/** How many dollars of Ziks a month the plan pays for itself at: its fee equals the discount on that much. */
export function planBreakEvenCents(plan: Pick<ZikPlan, "monthlyCents" | "discountPercent">): number {
  return Math.round((plan.monthlyCents * 100) / plan.discountPercent);
}

/** A subscription that is still in force: paid up, or late and being retried. Another plan can't be added to it. */
export const LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"] as const;

export function isLiveSubscription(status: string): boolean {
  return (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

/** A subscription that gives its discount: paid up. A late one doesn't until it is paid. */
export const DISCOUNT_SUBSCRIPTION_STATUSES = ["active", "trialing"] as const;
