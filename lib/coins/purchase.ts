import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/site-url";
import { CoinError, appendRows, lockUser } from "./ledger";
import { findPack, zikToCents } from "./math";
import { discountedCents, isKnownDiscount } from "./plans";
import { getStripe } from "./stripe";
import { discountPercentFor } from "./subscription";
import { safeReturnTo } from "./return-to";
import { TEST_CURRENCY, TEST_SESSION_PREFIX } from "./test-mode";

/**
 * Buying Ziks (#ziki-coins). Checkout takes the money; the webhook
 * (`checkout.session.completed`) is the only thing that credits the wallet, so
 * a closed tab never loses a payment and a replayed event never doubles it.
 * An owner with a paid-up plan pays the plan's discount less for the same Ziks.
 */

/**
 * `returnTo`: a scan's page the buyer came from (#deeper-scan-gate). Stripe then sends them straight back there to
 * press Pay, instead of to the Ziks page. Anything that isn't one of our scan pages is ignored.
 */
export async function createPackCheckout(userId: string, email: string | undefined, packId: string, returnTo?: unknown): Promise<string> {
  const back = safeReturnTo(returnTo);
  const pack = findPack(packId);
  if (!pack) throw new CoinError("invalid_amount", "Choose one of the packs.");
  const discountPercent = await discountPercentFor(userId);
  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    customer_email: email,
    client_reference_id: userId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: discountedCents(zikToCents(pack.zik), discountPercent),
          product_data: {
            name: `${pack.zik.toLocaleString("en-US")} Ziks`,
            description: discountPercent > 0 ? `Ziki Coins ${pack.label} pack, ${discountPercent}% off with your plan` : `Ziki Coins ${pack.label} pack`,
          },
        },
      },
    ],
    metadata: { userId, packId: pack.id, zik: String(pack.zik), discountPercent: String(discountPercent) },
    success_url: absoluteUrl(back ? `${back}?bought=1` : "/coins?bought=1"),
    cancel_url: absoluteUrl(back ? `/coins?returnTo=${encodeURIComponent(back)}` : "/coins"),
  });
  if (!session.url) throw new CoinError("not_configured", "Stripe didn't return a checkout page.");
  return session.url;
}

/**
 * Test mode (./test-mode.ts): buys the pack at once with no payment, and gives back the page to land on. The purchase
 * is marked with the `test` currency so it never counts toward what Stripe should hold. A buyer's plan discount still
 * shows in the amount, so the flow reads as it will with real payments.
 */
export async function createTestPurchase(userId: string, packId: string, returnTo?: unknown): Promise<string> {
  const back = safeReturnTo(returnTo);
  const pack = findPack(packId);
  if (!pack) throw new CoinError("invalid_amount", "Choose one of the packs.");
  const discountPercent = await discountPercentFor(userId);
  await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    // The database requires every purchase to come from a Checkout session or an invoice (CoinPurchase_source_check), so a
    // test purchase carries a stand-in session id of its own. It never matches a real Stripe session.
    const purchase = await tx.coinPurchase.create({
      data: {
        userId,
        stripeSessionId: `${TEST_SESSION_PREFIX}${randomUUID()}`,
        packId: pack.id,
        zik: pack.zik,
        amountCents: discountedCents(zikToCents(pack.zik), discountPercent),
        currency: TEST_CURRENCY,
      },
    });
    await appendRows(tx, [{ account: "wallet", userId, kind: "purchase", amount: pack.zik, sourceKey: `purchase:test:${purchase.id}`, purchaseId: purchase.id }]);
  });
  return back ? `${back}?bought=1` : "/coins?bought=1";
}

/** Stripe's processing fee on a payment, in cents, when it can be read. */
async function stripeFeeFor(paymentIntentId: string | null): Promise<number | null> {
  if (!paymentIntentId) return null;
  try {
    const intent = await getStripe().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge.balance_transaction"] });
    const charge = intent.latest_charge;
    if (charge && typeof charge !== "string" && charge.balance_transaction && typeof charge.balance_transaction !== "string") {
      return charge.balance_transaction.fee;
    }
  } catch {
    // The fee is only for the money page's reconciliation; the purchase doesn't wait on it.
  }
  return null;
}

/**
 * Records one paid Checkout session: the purchase row and the wallet credit,
 * together, once. The same event delivered again (Stripe retries) changes
 * nothing. The amounts come from our own pack list and Stripe's amount, never
 * from metadata alone.
 */
export async function recordPurchase(session: Stripe.Checkout.Session): Promise<"recorded" | "duplicate" | "ignored"> {
  if (session.mode !== "payment" || session.payment_status !== "paid") return "ignored";
  const userId = session.metadata?.userId ?? session.client_reference_id;
  const pack = findPack(session.metadata?.packId);
  if (!userId || !pack) return "ignored";
  // Never credit more than was paid: the charge must be the pack's price at full, or at one of the discounts a plan gives.
  const discountPercent = Number(session.metadata?.discountPercent ?? 0);
  if (!isKnownDiscount(discountPercent)) return "ignored";
  if (session.amount_total !== discountedCents(zikToCents(pack.zik), discountPercent)) return "ignored";
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  const feeCents = await stripeFeeFor(paymentIntentId);

  return prisma.$transaction(async (tx) => {
    if (!(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))) return "ignored";
    await lockUser(tx, userId);
    const existing = await tx.coinPurchase.findUnique({ where: { stripeSessionId: session.id }, select: { id: true } });
    if (existing) return "duplicate";
    const purchase = await tx.coinPurchase.create({
      data: {
        userId,
        stripeSessionId: session.id,
        stripePaymentIntentId: paymentIntentId,
        packId: pack.id,
        zik: pack.zik,
        amountCents: session.amount_total ?? discountedCents(zikToCents(pack.zik), discountPercent),
        stripeFeeCents: feeCents,
        currency: session.currency ?? "usd",
      },
    });
    await appendRows(tx, [{ account: "wallet", userId, kind: "purchase", amount: pack.zik, sourceKey: `purchase:${session.id}`, purchaseId: purchase.id }]);
    return "recorded";
  });
}
