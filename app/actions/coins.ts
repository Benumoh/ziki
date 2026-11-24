"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { CoinError } from "@/lib/coins/ledger";
import { fundIssue } from "@/lib/coins/fund";
import { budgetBalance, fundBudget, raiseIssuePrice, setBudgetPaused, takeBackBudget } from "@/lib/coins/budget";
import { lockSettledPrices, refreshBudgetAlert } from "@/lib/coins/budget-sweeps";
import { createPackCheckout, createTestPurchase } from "@/lib/coins/purchase";
import { createSubscriptionCheckout, setSubscriptionEnding, startTestSubscription, subscribeFrom } from "@/lib/coins/subscription";
import { testPayments } from "@/lib/coins/test-mode";
import { startPayoutOnboarding, syncPayoutsEnabled, withdrawEarned } from "@/lib/coins/withdraw";

/**
 * Ziki Coins actions (#ziki-coins). Each one acts for the signed-in person
 * only; the amounts and who may do what are decided in lib/coins, not here.
 */

export type CoinActionResult = { ok: true; message: string } | { ok: false; error: string };

function failure(error: unknown): CoinActionResult {
  if (error instanceof CoinError) return { ok: false, error: error.message };
  console.error("[coins]", error);
  // Stripe says what it refused (for example, that Connect isn't switched on); that is safe to show and useful to read.
  // Authentication errors are left out: their text can quote part of a key.
  if (error && typeof error === "object" && (error as { type?: string }).type === "StripeInvalidRequestError") {
    const message = (error as { message?: string }).message;
    if (message) return { ok: false, error: message };
  }
  return { ok: false, error: "Something went wrong. Try again in a moment." };
}

/** Sends the buyer to Stripe Checkout for a pack. The wallet is credited by the webhook, not by this. */
export async function buyZiksAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  let url: string;
  try {
    // From a scan's checkout (#deeper-scan-gate): Stripe sends them back to that scan. Checked again in createPackCheckout.
    const packId = String(formData.get("packId") ?? "");
    url = testPayments()
      ? await createTestPurchase(user.id, packId, formData.get("returnTo"))
      : await createPackCheckout(user.id, user.email ?? undefined, packId, formData.get("returnTo"));
  } catch (error) {
    const message = failure(error);
    redirect(`/coins?error=${encodeURIComponent(message.ok ? "" : message.error)}`);
  }
  redirect(url);
}

/** Sends the person to Stripe Checkout to start a monthly Ziks plan. The Ziks come from the webhook, month by month. */
export async function subscribeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const from = subscribeFrom(formData.get("from"));
  let url: string;
  try {
    const planId = String(formData.get("planId") ?? "");
    if (testPayments()) {
      await startTestSubscription(user.id, planId);
      url = "/coins?subscribed=1";
    } else {
      url = await createSubscriptionCheckout(user.id, user.email ?? undefined, planId, from);
    }
  } catch (error) {
    const message = failure(error);
    // The Ziks page opens on its plan section, where the person was.
    redirect(`${from === "coins" ? "/coins?section=plan&" : `/${from}?`}error=${encodeURIComponent(message.ok ? "" : message.error)}`);
  }
  redirect(url);
}

/** Ends the person's plan at the end of the month they have paid for, or takes that back. */
async function setEnding(ending: boolean): Promise<void> {
  const user = await requireUser();
  try {
    await setSubscriptionEnding(user.id, ending);
  } catch (error) {
    const message = failure(error);
    redirect(`/coins?section=plan&error=${encodeURIComponent(message.ok ? "" : message.error)}`);
  }
  revalidatePath("/coins");
  redirect("/coins?section=plan");
}

export async function endSubscriptionAction(): Promise<void> {
  await setEnding(true);
}

export async function keepSubscriptionAction(): Promise<void> {
  await setEnding(false);
}

/** Puts Ziks behind an issue. `requestId` is made when the form is drawn, so a double submit funds once. */
export async function fundIssueAction(bugId: string, amount: number, requestId: string): Promise<CoinActionResult> {
  const user = await requireUser();
  try {
    const result = await fundIssue(user.id, bugId, Math.trunc(Number(amount)), requestId);
    revalidatePath("/", "layout");
    return { ok: true, message: result.funded ? `Funded. ${result.escrow.toLocaleString("en-US")} Ziks are held for this issue and its price is locked.` : "Already funded." };
  } catch (error) {
    return failure(error);
  }
}

/** Puts Ziks behind a whole project (#project-budget). `requestId` is made when the form is drawn, so a double submit funds once. */
export async function fundBudgetAction(projectId: string, amount: number, requestId: string): Promise<CoinActionResult> {
  const user = await requireUser();
  try {
    const result = await fundBudget(user.id, projectId, Math.trunc(Number(amount)), requestId);
    // The issues waiting for funding that the new money covers are locked now, not at the next sweep (#price-lock).
    const locked = await lockSettledPrices({ projectId }).catch(() => 0);
    const balance = locked > 0 ? await budgetBalance(prisma, projectId) : result.balance;
    revalidatePath("/", "layout");
    await refreshBudgetAlert(projectId).catch(() => null);
    const started = locked > 0 ? ` ${locked} ${locked === 1 ? "issue is" : "issues are"} funded from it and can start.` : "";
    return { ok: true, message: result.funded ? `Funded. The project's budget is now ${balance.toLocaleString("en-US")} Ziks.${started}` : "Already funded." };
  } catch (error) {
    return failure(error);
  }
}

/** Takes back what the project's budget hasn't reserved for an issue. */
export async function takeBackBudgetAction(projectId: string): Promise<CoinActionResult> {
  const user = await requireUser();
  try {
    const returned = await takeBackBudget(user.id, projectId);
    revalidatePath("/", "layout");
    await refreshBudgetAlert(projectId).catch(() => null);
    return { ok: true, message: `${returned.toLocaleString("en-US")} Ziks are back with the people who funded the budget.` };
  } catch (error) {
    return failure(error);
  }
}

/** Pauses or resumes a project's budget: no new issue is awarded while it is paused (#project-budget). */
export async function setBudgetPausedAction(projectId: string, paused: boolean): Promise<CoinActionResult> {
  const user = await requireUser();
  try {
    await setBudgetPaused(user.id, projectId, paused);
    // Resumed: what the budget can cover now is locked at once (#price-lock).
    if (!paused) await lockSettledPrices({ projectId }).catch(() => 0);
    revalidatePath("/", "layout");
    return { ok: true, message: paused ? "Paused. No new issue will be awarded until you resume." : "Resumed. Issues can be awarded again." };
  } catch (error) {
    return failure(error);
  }
}

/** Raises an issue's settled price, to have it picked up sooner (#price-lock). */
export async function raiseIssuePriceAction(bugId: string, zik: number): Promise<CoinActionResult> {
  const user = await requireUser();
  try {
    const price = await raiseIssuePrice(user.id, bugId, Math.trunc(Number(zik)));
    revalidatePath("/", "layout");
    return { ok: true, message: `The price is now ${price.toLocaleString("en-US")} Ziks.` };
  } catch (error) {
    return failure(error);
  }
}

/** Opens Stripe's hosted onboarding for payouts. */
export async function setUpPayoutsAction(): Promise<void> {
  const user = await requireUser();
  let url: string;
  try {
    url = await startPayoutOnboarding(user.id, user.email ?? undefined);
  } catch (error) {
    const message = failure(error);
    redirect(`/coins/payouts?error=${encodeURIComponent(message.ok ? "" : message.error)}`);
  }
  redirect(url);
}

/** Re-reads the person's Stripe account, for when they come back from onboarding. */
export async function refreshPayoutsAction(): Promise<boolean> {
  const user = await requireUser();
  try {
    const enabled = await syncPayoutsEnabled(user.id);
    revalidatePath("/coins/payouts");
    return enabled;
  } catch {
    return (await prisma.user.findUnique({ where: { id: user.id }, select: { payoutsEnabled: true } }))?.payoutsEnabled ?? false;
  }
}

/** Withdraws the person's earned Ziks as a Stripe Transfer. */
export async function withdrawZiksAction(): Promise<CoinActionResult> {
  const user = await requireUser();
  try {
    const outcome = await withdrawEarned(user.id);
    revalidatePath("/coins");
    revalidatePath("/coins/payouts");
    if (outcome.status === "failed") return { ok: false, error: "Stripe couldn't send the money. Your Ziks are back in your wallet." };
    const amount = `$${(outcome.amountCents / 100).toFixed(2)}`;
    if (outcome.waiting) {
      return { ok: true, message: `Withdrawal pending: ${amount}. We'll send it to your bank account automatically, usually within a few days.` };
    }
    return { ok: true, message: `Sending ${amount} to your bank account.` };
  } catch (error) {
    return failure(error);
  }
}
