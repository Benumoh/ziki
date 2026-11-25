import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { formatZik } from "@/lib/coins/math";
import { LocalTime } from "@/components/local-time";
import { earningsByWorkspace, earningsSummary, weeklyGoalState } from "@/lib/earnings";
import { ChangeGoal } from "./goal-form";

export const metadata = { title: "Your earnings" };
export const dynamic = "force-dynamic";

const card = "rounded-panel border border-zk-border bg-zk-surface p-5 sm:p-6";
const label = "text-[11px] font-bold uppercase tracking-[0.08em] text-zk-muted";
/** Where-it-came-from colours, in the bar's order: blue for the work, then quieter tones for the small things. */
const SOURCE_DOT = ["bg-[#2f6fe4]", "bg-[#6f9bf0]", "bg-[#a9c4f7]", "bg-zk-ok-fg", "bg-[#5f6577]"];
/** The goal bar keeps Earn's colours: green for what is paid, yellow stripes for what is being checked. */
const PAID = "bg-zk-ok-fg";
const CHECKING = "bg-[repeating-linear-gradient(45deg,#f2c14e_0,#f2c14e_6px,#f7d98a_6px,#f7d98a_12px)]";

/**
 * Your earnings (#earnings): what you and your agents earned on every project you work on, your own goal for the
 * week, and the quickest way to it. The header's $ opens it from any page. Everything comes off the ledger;
 * "being checked" is money won on live work, paid once enough people report it deployed. Taking money out is its
 * own page, Withdraw.
 */
export default async function EarningsPage() {
  const user = await requireUser();
  // Everything, in every workspace and project you're in (Chloe's call); Withdraw shows one workspace.
  const [{ checking, earnedThisWeek, weeklyGoal, solvedCount, sources, tasks, tasksAreYours, activity, total }, workspaces] = await Promise.all([
    earningsSummary(prisma, user.id),
    earningsByWorkspace(prisma, user.id),
  ]);
  const week = Math.max(0, earnedThisWeek);
  const goal = weeklyGoalState(week, weeklyGoal);
  const pct = (value: number) => `${Math.min(100, (Math.max(0, value) / weeklyGoal) * 100)}%`;
  const sourcesTotal = sources.reduce((sum, source) => sum + source.amount, 0);
  const status = goal.reached
    ? { text: "Goal reached", tone: "bg-zk-ok-bg text-zk-ok-fg" }
    : goal.onPace
      ? { text: `On pace · ${goal.daysLeft} ${goal.daysLeft === 1 ? "day" : "days"} left`, tone: "bg-zk-ok-bg text-zk-ok-fg" }
      : { text: `Behind pace · ${goal.daysLeft} ${goal.daysLeft === 1 ? "day" : "days"} left`, tone: "bg-zk-warn-bg text-zk-warn-fg" };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <Link href="/home" className="self-start text-sm font-semibold text-zk-accent hover:underline">← Back</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">Your earnings</h1>
        </div>
        <Link href="/leaderboard" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-zk-border bg-zk-surface px-5 text-sm font-bold text-zk-text hover:bg-zk-chip">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" /></svg>
          Ranking
        </Link>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {/* Your own goal for the week: always there, from $0 until you earn. */}
        <section aria-labelledby="goal" className={`${card} bg-[linear-gradient(160deg,var(--color-zk-surface)_60%,var(--color-zk-tint))]`}>
          <div className="flex items-start justify-between gap-3">
            <h2 id="goal" className={label}>Your goal this week</h2>
            <ChangeGoal goal={weeklyGoal} />
          </div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <p className="text-4xl font-extrabold tracking-tight tabular-nums text-zk-text sm:text-[44px]">
              {formatZik(week)} <span className="text-base font-medium text-zk-muted">of {formatZik(weeklyGoal)}</span>
            </p>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.tone}`}>{status.text}</span>
          </div>
          <div className="relative mt-4">
            <div
              role="img"
              aria-label={`${formatZik(week)} paid and ${formatZik(checking)} being checked, of ${formatZik(weeklyGoal)} this week`}
              className="flex h-2.5 overflow-hidden rounded-full bg-zk-seg"
            >
              <span className={`h-full ${PAID}`} style={{ width: pct(week) }} />
              <span className={`h-full ${CHECKING}`} style={{ width: pct(Math.min(checking, goal.left)) }} />
            </div>
            {/* Where you should be by today. */}
            <span aria-hidden="true" className="absolute -top-1 h-[18px] w-0.5 rounded-full bg-zk-text" style={{ left: pct(goal.shouldBe) }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zk-text2">
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`h-2 w-2 rounded-full ${PAID}`} />Paid</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#f2c14e]" />Being checked</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-0.5 rounded-full bg-zk-text" />Where you should be today</span>
          </div>
          <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-zk-divider pt-4">
            <div><dt className="text-xs text-zk-muted">Still to earn</dt><dd className="mt-0.5 font-mono text-base font-bold tabular-nums text-zk-text">{formatZik(goal.left)}</dd></div>
            <div><dt className="text-xs text-zk-muted">Needed per day</dt><dd className="mt-0.5 font-mono text-base font-bold tabular-nums text-zk-text">{formatZik(goal.perDay)}</dd></div>
            <div><dt className="text-xs text-zk-muted">Being checked</dt><dd className="mt-0.5 font-mono text-base font-bold tabular-nums text-zk-warn-fg">+{formatZik(checking)}</dd></div>
          </dl>
        </section>

        {/* Where it came from. */}
        <section aria-labelledby="sources" className={card}>
          <h2 id="sources" className={label}>Where it came from</h2>
          {sources.length === 0 ? (
            <p className="mt-4 text-sm text-zk-text2">Nothing yet. Your agent&apos;s accepted work shows here.</p>
          ) : (
            <>
              <div aria-hidden="true" className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-zk-seg">
                {sources.map((source, index) => (
                  <span key={source.key} className={`h-full ${SOURCE_DOT[index % SOURCE_DOT.length]}`} style={{ width: `${(source.amount / sourcesTotal) * 100}%` }} />
                ))}
              </div>
              <ul className="m-0 mt-4 list-none space-y-2.5 p-0">
                {sources.map((source, index) => (
                  <li key={source.key} className="flex items-center gap-2.5 text-sm text-zk-text">
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${SOURCE_DOT[index % SOURCE_DOT.length]}`} />
                    <span className="flex-1">{source.label}</span>
                    <span className="font-mono font-bold tabular-nums">{formatZik(source.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-5 border-t border-zk-divider pt-4 text-sm text-zk-text2">
            {solvedCount === 0 ? "0 issues fixed yet. Fixing pays the most: the biggest share of what the issue is funded with." : `${solvedCount} ${solvedCount === 1 ? "issue" : "issues"} fixed. Fixing pays the most: the biggest share of what the issue is funded with.`}
          </p>
        </section>
      </div>

      {/* One total, and what each workspace holds: the header $ and Withdraw are for the workspace you are in (#862). */}
      {workspaces.length > 0 ? (
        <section aria-labelledby="workspaces" className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="workspaces" className={label}>All workspaces</h2>
            <p className="font-mono text-lg font-extrabold tabular-nums text-zk-text">{formatZik(total)}</p>
          </div>
          <ul className="m-0 mt-3 list-none space-y-2 p-0">
            {workspaces.map((workspace) => (
              <li key={workspace.organisationId} className="flex items-center justify-between gap-3 text-sm text-zk-text">
                <span className="min-w-0 truncate">{workspace.name}</span>
                <span className="font-mono font-bold tabular-nums">{formatZik(workspace.total)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-zk-muted">The Ziks at the top of the page are everything you earned. Here is how it adds up, workspace by workspace.</p>
        </section>
      ) : null}

      {/* The fastest way there: the open tasks that pay the most wherever you work, else in projects open to join. */}
      <section aria-labelledby="fastest" className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="fastest" className="text-lg font-extrabold text-zk-text">Fastest way to your goal</h2>
          <p className="text-sm text-zk-text2">{tasksAreYours ? "Open tasks in projects you're in, highest reward first" : "The best-paying tasks in projects open to join"}</p>
        </div>
        {tasks.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-zk-chip px-4 py-3 text-sm text-zk-text2">
            No open tasks right now. <Link href="/discover?open=true" className="font-semibold text-zk-accent hover:underline">Find a project to earn on</Link>.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-zk-border">
            <div className="grid grid-cols-[88px_1fr_auto] gap-3 bg-zk-tint px-4 py-3 text-[11px] font-bold uppercase tracking-[0.08em] text-zk-info-fg">
              <span>Reward</span><span>Task</span><span>Next step</span>
            </div>
            <ul className="m-0 list-none divide-y divide-zk-divider p-0">
              {tasks.map((task, index) => (
                <li key={task.id} className="grid grid-cols-[88px_1fr_auto] items-center gap-3 px-4 py-3.5">
                  <span className="justify-self-start rounded-lg border border-zk-border px-2.5 py-1.5 font-mono text-sm font-bold tabular-nums text-zk-ok-fg">+{formatZik(task.reward)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-zk-text">{task.title}</span>
                    <span className="block truncate text-xs text-zk-muted">{task.where}</span>
                  </span>
                  <Link
                    href={task.href}
                    className={`inline-flex min-h-10 items-center rounded-full px-4 text-sm font-bold ${index === 0 ? "bg-electric-blue-strong text-white hover:bg-[#2552af]" : "border border-zk-border bg-zk-surface text-zk-text hover:bg-zk-chip"}`}
                  >
                    {tasksAreYours ? "Place bid" : "See task"}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-3 text-sm text-zk-text2">
          Earn on more projects in <Link href="/discover?open=true" className="font-semibold text-zk-accent hover:underline">Discover</Link>.
        </p>
      </section>

      {/* Activity: the latest payments. */}
      <section aria-labelledby="activity" className={card}>
        <h2 id="activity" className={label}>Activity ({activity.length})</h2>
        {activity.length === 0 ? (
          <p className="mt-3 text-sm text-zk-text2">Your payments show here as work is accepted.</p>
        ) : (
          <ul className="m-0 mt-3 list-none space-y-3 p-0">
            {activity.map((entry) => (
              <li key={entry.id} className="flex items-baseline gap-3 text-sm">
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 translate-y-[-2px] rounded-full ${entry.amount < 0 ? "bg-zk-bad-fg" : "bg-[#2f6fe4]"}`} />
                <span className="min-w-0 flex-1 text-zk-text">
                  <b>{entry.who}</b>{entry.did ? ` ${entry.did}` : ""}{entry.ref ? ` ${entry.ref}` : ""}
                  <span className="text-zk-muted"> · <LocalTime date={entry.at} /></span>
                </span>
                <span className={`font-mono font-bold tabular-nums ${entry.amount < 0 ? "text-zk-bad-fg" : "text-zk-ok-fg"}`}>{entry.amount < 0 ? "" : "+"}{formatZik(entry.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
