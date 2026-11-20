import { cleanEnv } from "@/lib/env-clean";
import { stripeConfigured } from "./stripe";

/**
 * Test payments (#ziki-coins). While the Stripe key is a test key, Buy and Subscribe credit straight away with no card
 * step, so the whole flow can be tried without Stripe. A live key never does this, so no one can make Ziks for free once
 * real money is involved. `ZIKI_TEST_PAYMENTS=1` forces it on and `=0` forces the real Stripe checkout (to try it while
 * the key is still a test key). The Stripe code stays as it is for when this is switched off.
 *
 * What it writes is marked: a purchase made this way has the currency `test`, so the money page's check against Stripe
 * leaves it out and it can be told apart from a real one.
 */
export const TEST_CURRENCY = "test";

/** A pack bought this way has no Stripe session; it carries a stand-in id that starts with this (the database wants a source). */
export const TEST_SESSION_PREFIX = "test_session_";

/** A plan started this way has no Stripe subscription; its id starts with this. */
export const TEST_SUBSCRIPTION_PREFIX = "test_sub_";

export function testPayments(): boolean {
  const flag = cleanEnv(process.env.ZIKI_TEST_PAYMENTS);
  if (flag === "0") return false;
  if (flag === "1") return true;
  return (cleanEnv(process.env.STRIPE_SECRET_KEY) ?? "").startsWith("sk_test_");
}

/** Whether Buy and Subscribe can work at all: through Stripe, or in test mode. */
export function paymentsAvailable(): boolean {
  return testPayments() || stripeConfigured();
}

export function isTestSubscription(stripeSubscriptionId: string): boolean {
  return stripeSubscriptionId.startsWith(TEST_SUBSCRIPTION_PREFIX);
}
