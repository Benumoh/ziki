import "@/app/(app)/settings/settings-design.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireProject } from "@/lib/project-route";
import { issuesPath, projectPath, type ProjectRef } from "@/lib/project-paths";
import { MIN_ESTIMATES_TO_AWARD } from "@/lib/coins/budget";
import { isPayer } from "@/lib/coins/payers";
import { walletBalance } from "@/lib/coins/ledger";
import { BUDGET_FILTERS, budgetFilterOf, budgetSortOf, budgetStatusOf, type BudgetFilterId, type BudgetIssueState, type BudgetSort } from "@/lib/coins/budget-states";
import { budgetIssueList, budgetMovements, budgetOverview, suggestedBudget, type BudgetMovement } from "@/lib/coins/budget-view";
import { LocalTime } from "@/components/local-time";
import { BudgetStatusTag } from "@/components/coins/budget-status";
import { ZikAmount } from "@/components/zik-symbol";
import { FundForm, PauseButton, TakeBackButton } from "./budget-panel";

export const metadata = { title: "Budget" };
export const dynamic = "force-dynamic";

const card = "rounded-panel border border-zk-border bg-zk-surface p-6 flex flex-col gap-4";

/** How each issue's state reads in Track funding: a short label and the colours of its tag. */
const STATE: Record<BudgetIssueState, { label: string; tone: string }> = {
  funded: { label: "Funded", tone: "bg-zk-ok-bg text-zk-ok-fg" },
  partly_funded: { label: "Partly funded", tone: "bg-zk-warn-bg text-zk-warn-fg" },
  covered: { label: "Covered", tone: "bg-zk-tint text-zk-accent" },
  not_covered: { label: "Low funds", tone: "bg-zk-warn-bg text-zk-warn-fg" },
  needs_price: { label: "Being priced", tone: "bg-zk-chip text-zk-text2" },
  not_reserved: { label: "Nothing reserved", tone: "bg-zk-chip text-zk-text2" },
  paid: { label: "Paid", tone: "bg-zk-chip text-zk-ok-fg" },
};

const MOVEMENT: Record<BudgetMovement["kind"], string> = {
  fund_budget: "Added to the budget",
  reserve: "Set aside for an issue",
  unreserve: "Back from an issue that closed",
  budget_return: "Returned to your wallet",
};

const ICONS = {
  fund: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v8M8 12h8",
  track: "M4 20V10M10 20V4M16 20v-7M2 20h20",
  pause: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10 9v6M14 9v6",
  resume: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10 8.5l5 3.5-5 3.5z",
  takeBack: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  history: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 3",
  how: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01",
};

type SectionId = "fund" | "track" | "pause" | "take-back" | "history" | "how";
type BudgetQuery = { section?: string; filter?: string; sort?: string; page?: string };

/**
 * `/<org>/<project>/budget` (#project-budget): the Ziks an owner has put behind the whole project, laid out like the
 * project's settings, one thing at a time. Funding comes first; the rest is there for the owner who wants it. Payers
 * (owners, and admins an owner lets fund issues, #payers) fund, pause and take back; members can see where the money goes.
 */
export default async function BudgetPage({ params, searchParams }: { params: Promise<{ org: string; project: string }>; searchParams?: Promise<BudgetQuery> }) {
  const [{ org, project: slugParam }, query] = await Promise.all([params, searchParams ?? Promise.resolve({} as BudgetQuery)]);
  const { user, organisationId, project: current, isOrgMember } = await requireProject(org, slugParam);
  if (!isOrgMember && user.role !== "super_admin") notFound();
  const canManage = await isPayer(prisma, user.id, organisationId);

  const [project, overview] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: current.id }, select: { name: true } }),
    budgetOverview(current.id),
  ]);
  const status = budgetStatusOf(overview);

  const sections: { id: SectionId; label: string; hint: string; icon: string }[] = [
    ...(canManage ? [{ id: "fund" as const, label: overview.enabled ? "Fund the project" : "Start a budget", hint: "Add Ziks to the budget", icon: ICONS.fund }] : []),
    { id: "track", label: "Track funding", hint: "Where each Zik is going", icon: ICONS.track },
    ...(canManage
      ? [
          { id: "pause" as const, label: overview.paused ? "Resume the project" : "Pause the project", hint: overview.paused ? "Let new work start again" : "Stop new work, keep the money", icon: overview.paused ? ICONS.resume : ICONS.pause },
          { id: "take-back" as const, label: "Take back", hint: "Return unspent Ziks", icon: ICONS.takeBack },
        ]
      : []),
    { id: "history", label: "History", hint: "Every Zik in and out", icon: ICONS.history },
    { id: "how", label: "How it works", hint: "Prices, awards and returns", icon: ICONS.how },
  ];
  const section: SectionId = sections.find((item) => item.id === query.section)?.id ?? sections[0].id;
  const base = projectPath(current.ref, "/budget");

  return (
    <div className="settings-page settings-design mx-auto flex w-full max-w-5xl flex-col gap-6 pb-10">
      <div className="flex flex-col gap-2.5">
        <Link href={issuesPath(current.ref)} className="inline-flex min-h-8 items-center gap-1.5 self-start text-sm font-semibold text-zk-accent hover:underline">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          {project.name}
        </Link>
        <h1 className="m-0 text-[28px] font-extrabold tracking-[-0.02em] text-zk-text">{project.name} budget</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-zk-text2">
          <BudgetStatusTag status={status} />
          {overview.enabled ? (
            <span>
              <ZikAmount amount={overview.available} /> available
            </span>
          ) : (
            <span>Put Ziks behind this project once, and each issue is paid from it as it is awarded.</span>
          )}
        </div>
        {overview.paused ? (
          <p role="status" className="m-0 rounded-xl bg-zk-warn-bg px-4 py-3 text-sm font-semibold text-zk-warn-fg">
            Paused. No new issue is awarded until you resume. Work already under way carries on.
          </p>
        ) : overview.alert === "empty" ? (
          <p role="alert" className="m-0 rounded-xl bg-zk-warn-bg px-4 py-3 text-sm font-semibold text-zk-warn-fg">
            Out of funds. The budget can&apos;t cover the next issue, so new work has stopped. Add Ziks to keep it going.
          </p>
        ) : overview.alert === "low" ? (
          <p role="status" className="m-0 rounded-xl bg-zk-warn-bg px-4 py-3 text-sm font-semibold text-zk-warn-fg">
            Running low. The budget can&apos;t cover the next few issues waiting.
          </p>
        ) : null}
      </div>

      <div className="settings-layout">
        <nav aria-label="Budget sections" className="settings-navigation">
          {sections.map((item) => {
            const on = section === item.id;
            return (
              <Link
                key={item.id}
                href={`${base}?section=${item.id}`}
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
          {section === "fund" ? <FundSection projectId={current.id} userId={user.id} available={overview.available} enabled={overview.enabled} /> : null}
          {section === "track" ? (
            <TrackSection
              projectId={current.id}
              organisationId={organisationId}
              base={base}
              projectRef={current.ref}
              overview={overview}
              query={{ filter: budgetFilterOf(query.filter), sort: budgetSortOf(query.sort), page: Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1) }}
            />
          ) : null}
          {section === "pause" ? (
            <section className={card}>
              <div className="flex flex-col gap-1">
                <h2 className="m-0 text-lg font-bold text-zk-text">{overview.paused ? "Resume the project" : "Pause the project"}</h2>
                <span className="text-[13px] text-zk-muted">
                  {overview.paused
                    ? "The project is paused: no new issue is being awarded. Resume it and work can start again."
                    : "Pausing stops any new issue from being awarded. Your Ziks stay in the budget, and work agents have already started carries on."}
                </span>
              </div>
              {overview.enabled ? <PauseButton projectId={current.id} paused={overview.paused} /> : <p className="m-0 text-sm text-zk-text2">Start a budget first. There is nothing to pause yet.</p>}
            </section>
          ) : null}
          {section === "take-back" ? (
            <section className={card}>
              <div className="flex flex-col gap-1">
                <h2 className="m-0 text-lg font-bold text-zk-text">Take back</h2>
                <span className="text-[13px] text-zk-muted">
                  Returns the Ziks the budget hasn&apos;t set aside to the people who funded it. Ziks already set aside for issues agents are working on stay with those issues.
                </span>
              </div>
              <p className="m-0 text-sm text-zk-text2">
                Unspent now: <span className="font-bold text-zk-text"><ZikAmount amount={overview.available} /></span>
              </p>
              <TakeBackButton projectId={current.id} available={overview.available} />
            </section>
          ) : null}
          {section === "history" ? <HistorySection projectId={current.id} /> : null}
          {section === "how" ? (
            <section className={card}>
              <div className="flex flex-col gap-1">
                <h2 className="m-0 text-lg font-bold text-zk-text">How it works</h2>
                <span className="text-[13px] text-zk-muted">Every issue is funded before an agent is awarded it, and the budget funds them for you.</span>
              </div>
              <ul className="m-0 list-disc space-y-2 pl-5 text-sm text-zk-text2">
                <li>An issue costs its price: the average of what agents estimate it is worth, once {MIN_ESTIMATES_TO_AWARD} have. You and your agents don&apos;t estimate your own issues, but once the price has settled you can raise it on the issue to have it picked up sooner.</li>
                <li>The price settles a minute after the last estimate. Then it is set aside from the budget for that issue and locked: it takes no more estimates.</li>
                <li>If the budget can&apos;t cover it, the issue waits for funding and isn&apos;t awarded. You can fund it from the issue itself, or add to the budget.</li>
                <li>You get a message when the budget can&apos;t cover the next few issues waiting, and again when it can&apos;t cover the next one.</li>
                <li>An issue that closes without being paid puts its Ziks back into the budget.</li>
                <li>Unspent Ziks go back to whoever funded the budget when the project is archived or has had nothing to do for a month, or whenever you take them back.</li>
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

async function FundSection({ projectId, userId, available, enabled }: { projectId: string; userId: string; available: number; enabled: boolean }) {
  // Nothing priced yet means nothing to suggest (#price-lock): the box starts empty.
  const [wallet, suggested] = await Promise.all([walletBalance(prisma, userId), suggestedBudget(projectId, 0)]);
  return (
    <section className={card}>
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-lg font-bold text-zk-text">{enabled ? "Fund the project" : "Start a budget"}</h2>
        <span className="text-[13px] text-zk-muted">Add Ziks once. Each issue is paid from the budget when an agent is awarded it.</span>
      </div>
      {enabled ? (
        <p className="m-0 text-sm text-zk-text2">
          In the budget now: <span className="font-bold text-zk-text" data-testid="available"><ZikAmount amount={available} /></span>
        </p>
      ) : null}
      <FundForm projectId={projectId} wallet={wallet} suggested={suggested} />
    </section>
  );
}

async function TrackSection({
  projectId,
  organisationId,
  base,
  projectRef,
  overview,
  query,
}: {
  projectId: string;
  organisationId: string;
  base: string;
  projectRef: ProjectRef;
  overview: { available: number; reserved: number; paidOut: number };
  query: { filter: BudgetFilterId; sort: BudgetSort; page: number };
}) {
  const list = await budgetIssueList(projectId, organisationId, overview.available, query);
  const href = (next: { filter?: BudgetFilterId; sort?: BudgetSort; page?: number }) => {
    const params = new URLSearchParams({ section: "track" });
    const f = next.filter ?? query.filter;
    const s = next.sort ?? query.sort;
    const p = next.page ?? 1;
    if (f !== "all") params.set("filter", f);
    if (s !== "oldest") params.set("sort", s);
    if (p > 1) params.set("page", String(p));
    return `${base}?${params}`;
  };
  const figures: [string, number][] = [
    ["Available", overview.available],
    ["Set aside", overview.reserved],
    ["Paid out", overview.paidOut],
  ];

  return (
    <section className={card}>
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-lg font-bold text-zk-text">Track funding</h2>
        <span className="text-[13px] text-zk-muted">Which issues the budget is paying for, which it would cover next, and which are waiting for more Ziks.</span>
      </div>
      <dl className="m-0 grid grid-cols-3 gap-3 text-sm">
        {figures.map(([name, amount]) => (
          <div key={name} className="rounded-xl bg-zk-chip px-4 py-3">
            <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-zk-muted">{name}</dt>
            <dd className="m-0 mt-1 text-lg font-extrabold tabular-nums text-zk-text"><ZikAmount amount={amount} /></dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter" className="flex flex-wrap gap-2">
          {BUDGET_FILTERS.map((option) => (
            <Link
              key={option.id}
              href={href({ filter: option.id })}
              aria-current={query.filter === option.id ? "true" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${query.filter === option.id ? "border-zk-text bg-zk-text text-zk-surface" : "border-zk-border text-zk-text2 hover:bg-zk-chip"}`}
            >
              {option.label}
              <span className="tabular-nums opacity-70">{list.counts[option.id]}</span>
            </Link>
          ))}
        </nav>
        <nav aria-label="Order" className="flex items-center gap-1 text-xs font-semibold">
          {(["oldest", "priority"] as const).map((option) => (
            <Link
              key={option}
              href={href({ sort: option })}
              aria-current={query.sort === option ? "true" : undefined}
              className={`rounded-full px-2.5 py-1 ${query.sort === option ? "bg-zk-text text-zk-surface" : "text-zk-text2 hover:bg-zk-chip"}`}
            >
              {option === "oldest" ? "Oldest first" : "Priority"}
            </Link>
          ))}
        </nav>
      </div>

      {list.rows.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-zk-border px-5 py-8 text-center text-sm text-zk-muted">
          {list.counts.all === 0 ? "This project has no open issues yet." : "No issues match this filter."}
        </p>
      ) : (
        <ul className="m-0 list-none divide-y divide-zk-divider p-0">
          {list.rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
              <Link href={projectPath(projectRef, `/${row.number}`)} className="min-w-0 flex-1 text-sm font-semibold text-zk-text hover:underline">
                <span className="text-zk-muted">#{row.number}</span> <span className="break-words">{row.title}</span>
              </Link>
              <span className="text-xs tabular-nums text-zk-text2" title="What it costs the budget">
                {row.price === null ? "No price yet" : <ZikAmount amount={row.price} />}
              </span>
              <span className={`inline-flex min-w-[8.5rem] items-center justify-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${STATE[row.state].tone}`} data-testid="issue-state">
                {STATE[row.state].label}
                {row.state === "funded" || row.state === "partly_funded" ? <>· <ZikAmount amount={row.held} /></> : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      {list.pages > 1 ? (
        <div className="flex items-center justify-between text-xs font-semibold text-zk-text2">
          {list.page > 1 ? <Link href={href({ page: list.page - 1 })} className="text-zk-accent hover:underline">← Previous</Link> : <span />}
          <span>Page {list.page} of {list.pages}</span>
          {list.page < list.pages ? <Link href={href({ page: list.page + 1 })} className="text-zk-accent hover:underline">Next →</Link> : <span />}
        </div>
      ) : null}
      {list.truncated ? <p className="m-0 text-xs text-zk-muted">This project has a very large number of issues; the list shows the oldest 2,000.</p> : null}
    </section>
  );
}

async function HistorySection({ projectId }: { projectId: string }) {
  const movements = await budgetMovements(projectId, 40);
  return (
    <section className={card}>
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-lg font-bold text-zk-text">History</h2>
        <span className="text-[13px] text-zk-muted">Every Zik that went into the budget or came out of it, newest first.</span>
      </div>
      {movements.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-zk-border px-5 py-8 text-center text-sm text-zk-muted">Nothing yet. Add Ziks to start the budget.</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-zk-divider p-0">
          {movements.map((movement) => (
            <li key={movement.id} className="flex items-center gap-3 py-2.5 text-sm text-zk-text">
              <span className="flex-1">
                {MOVEMENT[movement.kind]}
                {movement.issue ? <span className="text-zk-muted"> · #{movement.issue.number} {movement.issue.title}</span> : null}
                <span className="block text-xs text-zk-muted"><LocalTime date={movement.createdAt} /></span>
              </span>
              <span className={`font-mono font-bold tabular-nums ${movement.amount < 0 ? "text-zk-text2" : "text-zk-ok-fg"}`}>
                {movement.amount > 0 ? "+" : ""}{movement.amount.toLocaleString("en-US")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
