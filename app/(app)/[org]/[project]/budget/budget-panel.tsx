"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fundBudgetAction, setBudgetPausedAction, takeBackBudgetAction } from "@/app/actions/coins";

type Result = { ok: true; message: string } | { ok: false; error: string };

const primary =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full bg-electric-blue-strong px-6 text-sm font-bold whitespace-nowrap text-white transition hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

/** Runs one budget action and shows what it said; refreshes the page when it worked. */
function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (action: () => Promise<Result>, after?: () => void) => {
    setNote(null);
    startTransition(async () => {
      const result = await action();
      setNote({ ok: result.ok, text: result.ok ? result.message : result.error });
      if (result.ok) {
        after?.();
        router.refresh();
      }
    });
  };
  const message = note ? <p role="status" className={`m-0 text-sm font-semibold ${note.ok ? "text-zk-ok-fg" : "text-zk-warn-fg"}`}>{note.text}</p> : null;
  return { pending, run, message };
}

/**
 * Fund the project (#project-budget): Ziks from the owner's wallet into the budget. The request id is made when the form
 * first draws, so a double click or a retry funds once.
 */
/** `suggested` (#price-lock) is what the project's priced issues call for; the box starts with it, and it can be changed. */
export function FundForm({ projectId, wallet, suggested = 0 }: { projectId: string; wallet: number; suggested?: number }) {
  const { pending, run, message } = useAction();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState(suggested > 0 ? String(suggested) : "");
  const value = Number(amount);
  const valid = amount !== "" && Number.isInteger(value) && value > 0 && value <= wallet;
  const shortBy = Math.max(0, value - wallet);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        run(() => fundBudgetAction(projectId, value, requestId), () => {
          setAmount("");
          setRequestId(crypto.randomUUID());
        });
      }}
    >
      <label className="text-sm font-bold text-zk-text" htmlFor="budget-amount">How many Ziks?</label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="budget-amount"
          inputMode="numeric"
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ""))}
          placeholder="e.g. 100000"
          className="h-11 w-full rounded-full border border-zk-border bg-zk-surface px-4 text-sm font-semibold tabular-nums text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue sm:max-w-xs"
        />
        <button type="submit" disabled={!valid || pending} className={primary}>
          {pending ? "Adding…" : valid ? `Add ${value.toLocaleString("en-US")} ${value === 1 ? "Zik" : "Ziks"}` : "Add to budget"}
        </button>
      </div>
      {suggested > 0 ? (
        <p className="m-0 text-xs text-zk-muted">
          Suggested: {suggested.toLocaleString("en-US")} Ziks, for the priced issues waiting and room for the next few at your project&apos;s average price.
        </p>
      ) : null}
      <p className="m-0 text-xs text-zk-muted">
        You have {wallet.toLocaleString("en-US")} {wallet === 1 ? "Zik" : "Ziks"}.{" "}
        <Link href="/coins" className="font-semibold text-zk-accent hover:underline">
          {shortBy > 0 ? `Buy ${shortBy.toLocaleString("en-US")} more Ziks` : "Buy Ziks"}
        </Link>
      </p>
      {message}
    </form>
  );
}

/** Take back what the budget hasn't reserved, to the people who funded it. */
export function TakeBackButton({ projectId, available }: { projectId: string; available: number }) {
  const { pending, run, message } = useAction();
  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={() => run(() => takeBackBudgetAction(projectId))} disabled={pending || available <= 0} className={`${primary} self-start`}>
        {pending ? "Taking back…" : available > 0 ? `Take back ${available.toLocaleString("en-US")} ${available === 1 ? "Zik" : "Ziks"}` : "Nothing to take back"}
      </button>
      {message}
    </div>
  );
}

/** Pause or resume the project's budget. */
export function PauseButton({ projectId, paused }: { projectId: string; paused: boolean }) {
  const { pending, run, message } = useAction();
  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={() => run(() => setBudgetPausedAction(projectId, !paused))} disabled={pending} className={`${primary} self-start`}>
        {pending ? "Saving…" : paused ? "Resume the project" : "Pause the project"}
      </button>
      {message}
    </div>
  );
}
