"use client";

import { createElement, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rescanCost, rescanSite } from "@/app/actions/security-assistant";
import { borrowZiks } from "@/app/actions/ziks-loan";
import { SadZiks } from "@/components/coins/sad-ziks";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ZIKS_LOAN } from "@/lib/coins/loan";

const LOAN = ZIKS_LOAN.toLocaleString("en-US");

/**
 * Scan again with agents (#security-rescan, 17 Nov), from the scan page's menu or the Assets list: a confirm with
 * what it covers and costs first (agents cost resources, 16 Nov call), then the payment, then the new scan's page.
 * Someone short of Ziks who never bought any is offered the one-time loan, then it carries on.
 */
export function useRescan() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, start] = useTransition();

  /** Pays and starts one rescan; offers the loan once if the wallet can't cover it. The new scan's id, or null. */
  async function payAndStart(checkId: string, offerLoan: boolean): Promise<string | null> {
    const outcome = await rescanSite(checkId);
    if (outcome.ok) return outcome.checkId;
    if (outcome.reason === "insufficient_ziks" && outcome.canBorrow && offerLoan) {
      // A friendlier "oops" with a sad coin (17 Nov, Hamzat: the plain version felt cold).
      const borrow = await confirm({
        art: createElement(SadZiks),
        title: "Oops, not enough Ziks",
        body:
          `This scan costs ${outcome.needed.toLocaleString("en-US")} Ziks and you have ${Math.max(0, outcome.balance).toLocaleString("en-US")}. Would you like to borrow ${LOAN} Ziks for it? ` +
          "It's a one-time loan, and your first top-up pays it back.",
        confirmLabel: `Borrow ${LOAN} Ziks and scan`,
        cancelLabel: "Not now",
      });
      if (!borrow) return null;
      const loan = await borrowZiks();
      if (loan.error) {
        toast(loan.error, "error");
        return null;
      }
      return payAndStart(checkId, false);
    }
    toast(outcome.error, "error");
    return null;
  }

  /** Scan the given scans again: one confirm for all of them, then each is paid for and started. */
  function rescan(checkIds: string[]) {
    start(async () => {
      const quotes = await Promise.all(checkIds.map((id) => rescanCost(id)));
      const failed = quotes.find((quote) => !quote.ok);
      if (failed && !failed.ok) {
        toast(failed.error, "error");
        return;
      }
      const ready = quotes.flatMap((quote) => (quote.ok ? [quote] : []));
      const first = ready[0];
      if (!first) return;
      const earlier = ready.reduce((sum, quote) => sum + quote.earlier, 0);
      const price = ready.reduce((sum, quote) => sum + quote.price, 0);
      const one = ready.length === 1;
      const confirmed = await confirm({
        title: one ? `Scan ${first.site} again?` : `Scan ${ready.length} targets again?`,
        body:
          `The same checks as last time: the ${earlier} ${earlier === 1 ? "problem" : "problems"} found before ${earlier === 1 ? "is" : "are"} rechecked to see what's fixed. ` +
          `It costs ${price.toLocaleString("en-US")} Ziks; you have ${first.balance.toLocaleString("en-US")}.`,
        confirmLabel: `Scan again for ${price.toLocaleString("en-US")} Ziks`,
      });
      if (!confirmed) return;
      const started: string[] = [];
      for (const id of checkIds) {
        const next = await payAndStart(id, true);
        if (next) started.push(next);
        else break;
      }
      if (!started.length) return;
      // No toast (17 Nov, Tolu): the new scan's page shows it working, with the same progress as a first scan.
      if (one) router.push(`/security/checks/${encodeURIComponent(started[0]!)}`);
      else router.refresh();
    });
  }

  return { rescan, pending };
}
