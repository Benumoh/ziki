"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fundBudgetAction, fundIssueAction, raiseIssuePriceAction } from "@/app/actions/coins";
import { ZikAmount } from "@/components/zik-symbol";

export type FundingCardProps = {
  bugId: string;
  projectId: string;
  /** Where the price stands (lib/coins/budget.ts priceStage). */
  stage: "estimating" | "settling" | "settled" | "locked";
  /** In Ziks, once three agents have estimated it. */
  price: number | null;
  /** Estimates in, and how many give it a price. */
  estimates: { have: number; need: number };
  /** While settling: how long until the price settles, so the card can redraw then. */
  settlesInMs: number | null;
  /** Ziks held for this issue (its escrow). */
  held: number;
  /** May fund this issue: its reporter, or a payer (#payers). */
  canFund: boolean;
  /** May fund the project's budget and raise prices: a payer (#payers), an owner or an admin an owner lets pay. */
  canFundProject: boolean;
  /** The viewer's wallet. */
  balance: number;
  /** What the project's budget holds, not yet reserved. */
  available: number;
  /** What to suggest for the project's budget (lib/coins/budget-view.ts suggestBudget). */
  suggested: number;
  /** Ziki's share of what is paid out, in percent. */
  feePercent: number;
  /** The project's Budget page. */
  budgetHref: string;
};

const PRIMARY =
  "inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-control bg-electric-blue-strong px-4 text-sm font-bold text-white transition hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY =
  "inline-flex min-h-10 w-full cursor-pointer items-center justify-center rounded-control border border-zk-border bg-zk-surface px-4 text-sm font-semibold text-zk-text transition hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue disabled:cursor-not-allowed disabled:opacity-60";

const zik = (amount: number) => `${amount.toLocaleString("en-US")} ${amount === 1 ? "Zik" : "Ziks"}`;

/**
 * The Ziks behind an issue (#price-lock), inside the Reward panel. Everyone sees where its price stands: agents
 * estimating it, the price settling, waiting for funding, or locked and held for the fixer. When it is priced and not yet
 * funded, the person who pays for it is asked here, in the flow, with what it costs and how the money works: fund the
 * whole project once (the suggested amount), or just this issue.
 */
export function IssueFundingCard(props: FundingCardProps) {
  const { bugId, projectId, stage, price, estimates, settlesInMs, held, canFund, canFundProject, balance, available, suggested, feePercent, budgetHref } = props;
  const router = useRouter();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Settling: redraw once the quiet minute is over, so the price shows as ready without a reload.
  useEffect(() => {
    if (stage !== "settling" || settlesInMs === null) return;
    const timer = window.setTimeout(() => router.refresh(), Math.max(0, settlesInMs) + 1500);
    return () => window.clearTimeout(timer);
  }, [stage, settlesInMs, router]);

  const [target, setTarget] = useState<"project" | "issue" | null>(null);
  const fund = (to: "project" | "issue", amount: number) => {
    setNote(null);
    setTarget(to);
    startTransition(async () => {
      const result = to === "project" ? await fundBudgetAction(projectId, amount, requestId) : await fundIssueAction(bugId, amount, requestId);
      setNote({ ok: result.ok, text: result.ok ? result.message : result.error });
      if (result.ok) {
        setRequestId(crypto.randomUUID());
        router.refresh();
      }
    });
  };

  const box = "flex flex-col gap-3 rounded-2xl border border-zk-border bg-zk-chip px-4 py-4";

  // The Reward panel's own header already says how many estimates are in; the person who pays is told what comes next.
  if (stage === "estimating") {
    if (!canFund) return null;
    return (
      <div className={box} data-testid="issue-funding" data-stage="estimating">
        <p className="m-0 text-xs text-zk-text2">
          Other people&apos;s agents estimate what this issue is worth. When {estimates.need} have, the average becomes its price,
          and you fund it so an agent can start. If fewer have after a day, Ziki estimates it too, so it never waits for a
          price. Nothing is charged until you fund it.
        </p>
      </div>
    );
  }

  if (stage === "settling" || price === null) {
    return (
      <div className={box} data-testid="issue-funding" data-stage="settling">
        <p className="m-0 text-sm font-semibold text-zk-text">
          Priced at about {price !== null ? <ZikAmount amount={price} /> : null} · settling
        </p>
        <p className="m-0 text-xs text-zk-muted">The price settles a minute after the last estimate, in case more agents estimate it.</p>
      </div>
    );
  }

  const need = Math.max(0, price - held);

  // Held in full: locked (or locking at the next sweep), so nothing more is asked.
  if (need === 0) {
    return (
      <div className={box} data-testid="issue-funding" data-stage="funded">
        <p className="m-0 text-sm font-bold text-zk-ok-fg">
          {stage === "locked" ? "Price locked" : "Funded"} · <ZikAmount amount={price} />
        </p>
        <p className="m-0 text-xs text-zk-muted">Held until the work is live, then paid to everyone who worked on it: the fixer gets the most.</p>
        {canFundProject ? <RaisePrice bugId={bugId} price={price} /> : null}
      </div>
    );
  }

  if (!canFund) {
    return (
      <div className={box} data-testid="issue-funding" data-stage="waiting">
        <p className="m-0 text-sm font-semibold text-zk-text">
          Waiting for funding · <ZikAmount amount={price} />
        </p>
        <p className="m-0 text-xs text-zk-muted">Agents can bid now. It is awarded once its owner funds it.</p>
      </div>
    );
  }

  const projectAmount = Math.max(suggested, need);
  // Ziks are bought whole, so a shortfall of a tenth still needs one more.
  const shortForProject = Math.max(0, Math.ceil(projectAmount - balance));
  const shortForIssue = Math.max(0, Math.ceil(need - balance));

  return (
    <div className={box} data-testid="issue-funding" data-stage="fund">
      <div className="flex flex-col gap-1">
        <p className="m-0 text-sm font-bold text-zk-text">
          Ready to start · <ZikAmount amount={price} />
        </p>
        <p className="m-0 text-xs text-zk-text2">
          Agents priced this issue at {zik(price)}. Fund it so an agent can start{held > 0 ? ` (${zik(held)} are already held for it)` : ""}.
        </p>
      </div>

      {canFundProject ? (
        <div className="flex flex-col gap-1.5">
          <button type="button" className={PRIMARY} disabled={pending || shortForProject > 0} onClick={() => fund("project", projectAmount)}>
            {pending && target === "project" ? "Funding…" : `Fund the project · ${zik(projectAmount)}`}
          </button>
          <p className="m-0 text-xs text-zk-muted">
            Suggested: what your priced issues need now, plus room for the next few
            {available > 0 ? `, less the ${zik(available)} already in the budget` : ""}. Every issue is paid from it, this one first.{" "}
            <Link href={budgetHref} className="font-semibold text-zk-accent hover:underline">Choose another amount</Link>
          </p>
        </div>
      ) : null}
      <button type="button" className={canFundProject ? SECONDARY : PRIMARY} disabled={pending || shortForIssue > 0} onClick={() => fund("issue", need)}>
        {pending && target === "issue" ? "Funding…" : `Just this issue · ${zik(need)}`}
      </button>

      {available > 0 && available < need ? (
        <p className="m-0 text-xs text-zk-muted">
          The project&apos;s budget has {zik(available)} left, {zik(Math.ceil(need - available))} short of this issue, so it can&apos;t start from the budget yet.
        </p>
      ) : null}
      <p className="m-0 text-xs text-zk-muted">
        Your wallet has {zik(balance)}
        {shortForIssue > 0
          ? `, not enough for this issue.`
          : canFundProject && shortForProject > 0
            ? `: enough for this issue, not for the suggested ${zik(projectAmount)}.`
            : "."}{" "}
        <Link href="/coins" className="font-semibold text-zk-accent hover:underline">
          {shortForIssue > 0 ? `Buy ${zik(shortForIssue)} more` : canFundProject && shortForProject > 0 ? `Buy ${zik(shortForProject)} more` : "Buy Ziks"}
        </Link>
      </p>

      <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-xs text-zk-text2">
        <li>Your Ziks are held, not spent: once the work is live they pay everyone who worked on it (the fixer 70%), and Ziki keeps {feePercent}%.</li>
        <li>What isn&apos;t used comes back to you: take it back any time, and a project&apos;s budget returns on its own after 30 idle days.</li>
        <li>We&apos;ll tell you when the budget runs low.</li>
      </ul>

      {note ? <p role="status" className={`m-0 text-sm font-semibold ${note.ok ? "text-zk-ok-fg" : "text-zk-warn-fg"}`}>{note.text}</p> : null}
      {canFundProject ? <RaisePrice bugId={bugId} price={price} /> : null}
    </div>
  );
}

/**
 * Raise the price (#price-lock): a payer (#payers) offers more than the agents' price, so the issue is picked up
 * sooner. It only goes up; the difference is funded like the rest.
 */
function RaisePrice({ bugId, price }: { bugId: string; price: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const value = Number(amount);
  const valid = amount !== "" && Number.isInteger(value) && value > price;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start cursor-pointer text-xs font-semibold text-zk-accent hover:underline">
        Want it picked up sooner? Raise the price
      </button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 border-t border-zk-border pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        setNote(null);
        startTransition(async () => {
          const result = await raiseIssuePriceAction(bugId, value);
          setNote({ ok: result.ok, text: result.ok ? result.message : result.error });
          if (result.ok) {
            setAmount("");
            router.refresh();
          }
        });
      }}
    >
      <label className="text-xs font-bold text-zk-text" htmlFor={`raise-${bugId}`}>A higher price in Ziks</label>
      <div className="flex items-center gap-2">
        <input
          id={`raise-${bugId}`}
          inputMode="numeric"
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ""))}
          placeholder={`More than ${price}`}
          className="h-10 w-32 shrink-0 rounded-full border border-zk-border bg-zk-surface px-4 text-sm font-semibold tabular-nums text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue"
        />
        <button type="submit" disabled={!valid || pending} className={SECONDARY}>
          {pending ? "Saving…" : "Raise price"}
        </button>
      </div>
      <p className="m-0 text-xs text-zk-muted">A higher price draws agents to it sooner. It can only go up, and you fund the difference.</p>
      {note ? <p role="status" className={`m-0 text-sm font-semibold ${note.ok ? "text-zk-ok-fg" : "text-zk-warn-fg"}`}>{note.text}</p> : null}
    </form>
  );
}
