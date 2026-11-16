import Link from "next/link";
import { requireProject } from "@/lib/project-route";
import { prisma } from "@/lib/prisma";
import { isListedOnPage, loadProjectAgents, type ProjectAgent, type ProjectAgentClaim, type ProjectAgentStatus } from "@/lib/agents/project-agents";
import { AGENT_LEVEL_LABELS } from "@/lib/agents/levels";
import { WORK_MODE_HINTS, WORK_MODE_LABELS } from "@/lib/agents/work-mode";
import { isStale } from "@/lib/agents/last-seen";
import { formatAgo } from "@/lib/activity/board";
import { remainingLabel } from "@/lib/claim-deadline";
import { agentPageHref } from "@/lib/header-nav";
import { issuePath } from "@/lib/issue-ref";
import { projectPath, type ProjectRef } from "@/lib/project-paths";
import { AgentAvatar } from "@/components/agent-avatar";
import { LiveRefresh } from "@/components/live-refresh";
import { PipelineSteps } from "@/components/pipeline-steps";
import { ActiveAgentsToggleButton } from "@/components/active-agents-visibility";

export const metadata = { title: "Active agents" };

const STATUS: Record<ProjectAgentStatus, { label: string; chip: string }> = {
  stuck: { label: "Stuck", chip: "bg-zk-bad-bg text-zk-bad-fg" },
  not_responding: { label: "Not responding", chip: "bg-zk-bad-bg text-zk-bad-fg" },
  waiting: { label: "Needs its owner", chip: "bg-zk-warn-bg text-zk-warn-fg" },
  paused: { label: "Paused", chip: "bg-zk-warn-bg text-zk-warn-fg" },
  working: { label: "Working", chip: "bg-zk-ok-bg text-zk-ok-fg" },
  planning: { label: "Planning", chip: "bg-zk-tint text-zk-accent" },
  offered: { label: "Offer waiting", chip: "bg-zk-tint text-zk-accent" },
  delivered: { label: "Delivered", chip: "bg-zk-ok-bg text-zk-ok-fg" },
  bidding: { label: "Bidding", chip: "bg-zk-tint text-zk-accent" },
  idle: { label: "Idle", chip: "bg-zk-chip text-zk-text2" },
  away: { label: "Away", chip: "bg-zk-chip text-zk-muted" },
  offline: { label: "Offline", chip: "bg-zk-chip text-zk-muted" },
};

/** Online: checked in within the last 15 minutes (agents poll their work feed about every 30 seconds). */
const isOnline = (agent: ProjectAgent, now: Date) => agent.status !== "paused" && !isStale(agent.lastSeenAt, now);

/** Offers it has had and not answered yet: accepting one makes it a claim. */
const unansweredOffers = (agent: ProjectAgent) => agent.claims.filter((claim) => claim.status === "offered");

/** The tabs across the top (the Issues page's stage tabs), each a filter on the list below. */
const FILTERS = [
  { key: "all", label: "All", test: () => true },
  { key: "online", label: "Online", test: (agent: ProjectAgent, now: Date) => isOnline(agent, now) },
  // Work in its hands now. A delivered agent waits on testers and reviewers: it isn't working.
  { key: "working", label: "Working", test: (agent: ProjectAgent) => ["working", "planning"].includes(agent.status) },
  { key: "stuck", label: "Stuck", test: (agent: ProjectAgent) => agent.status === "stuck" },
  // Not responding agents are here too: theirs is an offer left unanswered while they stayed away.
  { key: "unanswered", label: "Unanswered", test: (agent: ProjectAgent) => unansweredOffers(agent).length > 0 },
  { key: "bidding", label: "Bidding", test: (agent: ProjectAgent) => agent.bids.length > 0 },
  { key: "offered", label: "Awarded", test: (agent: ProjectAgent) => agent.claims.length > 0 },
] as const satisfies readonly { key: string; label: string; test: (agent: ProjectAgent, now: Date) => boolean }[];
type FilterKey = (typeof FILTERS)[number]["key"];

function filterOf(value: string | string[] | undefined): FilterKey {
  const key = Array.isArray(value) ? value[0] : value;
  return FILTERS.some((filter) => filter.key === key) ? (key as FilterKey) : "all";
}

/** A claim's one line: its stage chip, then a short note at the right (its clock, or what's wrong). */
function claimLine(claim: ProjectAgentClaim, now: Date): { stage: string; meta: string; alert: boolean } {
  if (claim.status === "offered") {
    const left = claim.offerExpiresAt ? claim.offerExpiresAt.getTime() - now.getTime() : null;
    return {
      stage: "Offered",
      meta: claim.unanswered ? "No reply" : left !== null && left > 0 ? `Lapses in ${Math.ceil(left / 60_000)}m` : "Lapsing",
      alert: claim.unanswered,
    };
  }
  if (claim.status === "planning") return { stage: "Planning", meta: "Plan in review", alert: false };
  const heartbeat = claim.lastHeartbeatAt ?? claim.claimedAt;
  if (claim.stuck) {
    // Stuck is past its deadline, or quiet too long.
    const overdue = claim.deliverBy !== null && claim.deliverBy.getTime() <= now.getTime();
    const quiet = heartbeat ? `Quiet ${formatAgo(now.getTime() - heartbeat.getTime()).replace(/ ago$/, "")}` : "No check-in";
    return { stage: "Awarded", meta: overdue ? "Overdue" : quiet, alert: true };
  }
  return { stage: "Awarded", meta: claim.pullRequestUrl ? "PR open" : remainingLabel(claim.deliverBy, now) ?? "", alert: false };
}

/** Each list shows this many lines, then "Show N more". */
const SHOWN = 3;

/** One issue on one line: an optional chip, the issue (cut to fit), and a short note at the right. */
function IssueLine({
  number,
  title,
  projectRef,
  chip,
  meta,
  alert = false,
}: {
  number: number;
  title: string;
  projectRef: ProjectRef;
  chip?: string;
  meta: string;
  alert?: boolean;
}) {
  return (
    <li className="flex min-w-0 items-center gap-2 py-1 text-[13px]">
      {chip ? (
        <span className={`shrink-0 rounded-md px-1.5 py-px text-[11px] font-semibold ${alert ? "bg-zk-bad-bg text-zk-bad-fg" : "bg-zk-chip text-zk-text2"}`}>{chip}</span>
      ) : null}
      <Link href={issuePath(projectRef, number)} title={`#${number} ${title}`} className="min-w-0 flex-1 truncate text-zk-text hover:text-zk-accent hover:underline">
        <span className="text-zk-muted">#{number}</span> {title}
      </Link>
      {meta ? <span className={`shrink-0 text-[12px] ${alert ? "font-medium text-zk-bad-fg" : "text-zk-muted"}`}>{meta}</span> : null}
    </li>
  );
}

/** The first SHOWN lines, the rest behind "Show N more". */
function ShortList({ items, empty }: { items: React.ReactNode[]; empty: string }) {
  if (items.length === 0) return <p className="m-0 mt-1 text-[13px] text-zk-muted">{empty}</p>;
  return (
    <>
      <ul className="m-0 mt-1 list-none p-0">{items.slice(0, SHOWN)}</ul>
      {items.length > SHOWN ? (
        <details className="group">
          <summary className="cursor-pointer list-none py-1 text-[12px] font-semibold text-zk-accent hover:underline group-open:hidden [&::-webkit-details-marker]:hidden">
            Show {items.length - SHOWN} more
          </summary>
          <ul className="m-0 list-none p-0">{items.slice(SHOWN)}</ul>
        </details>
      ) : null}
    </>
  );
}

/** Claims in the order they need attention: stuck or unanswered first, then live work, plans and offers. */
function claimOrder(claim: ProjectAgentClaim): number {
  if (claim.stuck || claim.unanswered) return 0;
  if (claim.status === "active") return 1;
  if (claim.status === "planning") return 2;
  return 3;
}

/** Delivered work only waits for review: one quiet line for all of it, the issues behind it. */
function DeliveredLine({ claims, projectRef }: { claims: ProjectAgentClaim[]; projectRef: ProjectRef }) {
  if (claims.length === 0) return null;
  return (
    <details className="group/delivered mt-1">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-[12px] text-zk-muted hover:text-zk-text2 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block transition-transform group-open/delivered:rotate-90">›</span>
        {claims.length} delivered, waiting for review
      </summary>
      <ul className="m-0 list-none p-0 pl-3">
        {claims.map((claim) => (
          <IssueLine key={claim.id} number={claim.issueNumber} title={claim.issueTitle} projectRef={projectRef} meta="" />
        ))}
      </ul>
    </details>
  );
}

function AgentCard({ agent, projectRef, now }: { agent: ProjectAgent; projectRef: ProjectRef; now: Date }) {
  const status = STATUS[agent.status];
  // Delivered work (an active claim on an issue past In progress) only waits for review: it is folded into one line.
  const isDelivered = (claim: ProjectAgentClaim) => claim.status === "active" && claim.issueStatus !== "in_progress";
  const working = agent.claims.filter((claim) => !isDelivered(claim)).sort((a, b) => claimOrder(a) - claimOrder(b));
  const delivered = agent.claims.filter(isDelivered);
  const alert = agent.status === "stuck" || agent.status === "not_responding";
  const online = isOnline(agent, now);
  const offers = unansweredOffers(agent).length;
  return (
    <li className={`overflow-hidden rounded-[20px] border bg-zk-surface ${alert ? "border-zk-bad-fg/40" : "border-zk-border"}`}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <span className="relative shrink-0">
          <AgentAvatar agentId={agent.id} avatar={agent.avatar} size={40} />
          {/* Online: checked in within the last 15 minutes. */}
          <span
            aria-hidden
            className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-zk-surface ${online ? "bg-emerald-500" : "bg-slate-400"}`}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <Link href={agentPageHref(agent.username)} className="text-sm font-bold text-zk-text hover:text-zk-accent hover:underline">
              {agent.name}
            </Link>
            <span className="rounded-full bg-zk-chip px-2 py-0.5 text-[11px] font-semibold text-zk-text2">{AGENT_LEVEL_LABELS[agent.level]}</span>
            {/* #agent-work-mode: its owner's setting. */}
            <span
              title={agent.workMode ? WORK_MODE_HINTS[agent.workMode] : "Its owner hasn't chosen how it works yet: it accepts its own offers."}
              className="rounded-full bg-zk-chip px-2 py-0.5 text-[11px] font-semibold text-zk-text2"
            >
              {agent.workMode ? WORK_MODE_LABELS[agent.workMode] : "Mode not set"}
            </span>
            {agent.ownerName ? <span className="text-xs text-zk-muted">for {agent.ownerName}</span> : null}
          </div>
          <p className={`m-0 mt-0.5 text-[13px] ${alert ? "font-medium text-zk-bad-fg" : "text-zk-text2"}`}>{agent.detail}</p>
          {offers > 0 ? (
            <p className="m-0 mt-0.5 text-[12px] font-semibold text-zk-warn-fg">
              {offers} {offers === 1 ? "offer" : "offers"} not answered yet
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${status.chip}`}>{status.label}</span>
          <span className="text-[11px] text-zk-muted">
            {online ? "Online · " : ""}
            {agent.lastSeenAt ? `Checked in ${formatAgo(now.getTime() - agent.lastSeenAt.getTime())}` : "Never checked in"}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] border-t border-zk-border sm:grid-cols-2 sm:divide-x sm:divide-zk-border max-sm:divide-y max-sm:divide-zk-border">
        <section aria-label={`${agent.name}: awarded or offered`} className="px-5 py-3.5">
          <h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-zk-muted">
            Awarded or offered <span className="ml-1 font-mono font-normal">{agent.claims.length}</span>
          </h3>
          <ShortList
            empty={delivered.length ? "Nothing in progress" : "Nothing awarded or offered here"}
            items={working.map((claim) => {
              const line = claimLine(claim, now);
              return (
                <IssueLine key={claim.id} number={claim.issueNumber} title={claim.issueTitle} projectRef={projectRef} chip={line.stage} meta={line.meta} alert={line.alert} />
              );
            })}
          />
          <DeliveredLine claims={delivered} projectRef={projectRef} />
        </section>
        <section aria-label={`${agent.name}: open bids`} className="px-5 py-3.5">
          <h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-zk-muted">
            Open bids <span className="ml-1 font-mono font-normal">{agent.bids.length}</span>
          </h3>
          <ShortList
            empty="No open bids here"
            items={agent.bids.map((bid) => (
              <IssueLine key={bid.id} number={bid.issueNumber} title={bid.issueTitle} projectRef={projectRef} meta={formatAgo(now.getTime() - bid.placedAt.getTime())} />
            ))}
          />
        </section>
      </div>
    </li>
  );
}

/**
 * `/<org>/<project>/agents` (#active-agents): the agents at work in this
 * project right now. For each, what it has bid on, what it has been awarded
 * or offered, and whether it is stuck or not responding. It only reads, and
 * re-reads itself every 20 seconds while it is showing. Anyone who can open
 * the project may open it, and anyone may hide it for themselves: then it
 * reads no agents and offers only to show it again (Settings → Agents too).
 */
export default async function ActiveAgentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const { org, project: slugParam } = await params;
  const { user, organisationId, project } = await requireProject(org, slugParam);
  // A failed read shows the page, the default.
  const prefs = await prisma.user.findUnique({ where: { id: user.id }, select: { showActiveAgents: true } }).catch(() => null);
  if (prefs?.showActiveAgents === false) {
    return (
      <div className="mx-auto w-full max-w-[920px] space-y-3 rounded-[20px] border border-zk-border bg-zk-surface px-5 py-10 text-center">
        <h1 className="text-xl font-extrabold tracking-tight text-zk-text">Active agents is hidden</h1>
        <p className="mx-auto max-w-md text-sm text-zk-text2">
          You hid this page, so it and its link in the Agents panel are gone for you. Nobody else is affected.
        </p>
        <ActiveAgentsToggleButton show className="text-sm font-bold text-zk-accent hover:underline" />
      </div>
    );
  }
  const show = filterOf((await searchParams).show);
  const now = new Date();
  const loaded = await loadProjectAgents({ projectId: project.id, organisationId, now });
  const { hidden } = loaded;
  // Delivered and not online: left off every tab (isListedOnPage).
  const agents = loaded.agents.filter((agent) => isListedOnPage(agent, now));
  const filter = FILTERS.find((entry) => entry.key === show)!;
  const listed = agents.filter((agent) => filter.test(agent, now));
  const base = projectPath(project.ref, "/agents");

  return (
    <div className="mx-auto w-full max-w-[920px] space-y-5">
      <LiveRefresh />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">Active agents</h1>
          <p className="mt-1 max-w-2xl text-sm text-zk-text2">
            The agents at work in {project.name} right now: who is online and when each last checked in, its mode, what it is working on, the offers it hasn&apos;t answered, what it has bid on, and whether it is stuck or not responding.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ActiveAgentsToggleButton show={false} className="text-sm font-semibold text-zk-muted hover:text-zk-text hover:underline" />
          <Link href={projectPath(project.ref, "/workstream")} className="text-sm font-semibold text-zk-accent hover:underline">Workstream →</Link>
        </div>
      </div>

      {/* Seven tabs don't fit a phone side by side: there the row scrolls sideways instead of squeezing the labels. */}
      <div className="flex justify-center max-sm:-mx-4 max-sm:block max-sm:overflow-x-auto max-sm:px-4">
        <div className="w-full max-sm:min-w-[600px]">
        <PipelineSteps
          label="Filter agents"
          stages={FILTERS.map((entry) => ({
            label: entry.label,
            count: agents.filter((agent) => entry.test(agent, now)).length,
            href: entry.key === "all" ? base : `${base}?show=${entry.key}`,
            selected: entry.key === show,
          }))}
        />
        </div>
      </div>

      {listed.length === 0 ? (
        <p className="rounded-[20px] border border-zk-border bg-zk-surface px-5 py-10 text-center text-sm text-zk-text2">
          {show === "all"
            ? "No agents are at work in this project right now. Agents show up here once they bid, are offered work, or check in."
            : show === "stuck"
              ? "None right now. Every agent with work in hand is checking in."
              : show === "unanswered"
                ? "No offers are waiting for an answer right now."
              : "No agents here right now."}
        </p>
      ) : (
        <ul className="m-0 list-none space-y-3 p-0">
          {listed.map((agent) => (
            <AgentCard key={agent.id} agent={agent} projectRef={project.ref} now={now} />
          ))}
        </ul>
      )}

      {hidden > 0 ? (
        <p className="text-center text-xs text-zk-muted">
          {hidden} other {hidden === 1 ? "agent" : "agents"} in this organisation {hidden === 1 ? "has" : "have"} nothing here and {hidden === 1 ? "hasn't" : "haven't"} been seen in the last day.
        </p>
      ) : null}
    </div>
  );
}
