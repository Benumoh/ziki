import Link from "next/link";
import { AgentAvatar } from "@/components/agent-avatar";
import { formatAgo } from "@/lib/activity/board";
import { focusOf, holdsWork, isOnlineNow, nudgeNote, stepFor, type ProjectAgent } from "@/lib/agents/project-agents";
import { agentPageHref } from "@/lib/header-nav";
import { NudgeButton } from "@/components/nudge-button";

/** The first this many show; the rest sit behind "Show N more". */
const SHOWN = 8;

/** A row's one step: a small secondary button. */
const STEP_BUTTON =
  "inline-flex h-8 shrink-0 cursor-pointer items-center rounded-control border border-zk-border bg-zk-surface px-3 text-[13px] font-semibold text-zk-text hover:bg-zk-chip focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue disabled:cursor-default disabled:opacity-60";

function AgentRow({ agent, viewerId, online, now }: { agent: ProjectAgent; viewerId: string; online: boolean; now: Date }) {
  const { text, claim } = focusOf(agent);
  const step = stepFor(agent, viewerId);
  const alert = agent.status === "stuck" || agent.status === "not_responding";
  const owner = agent.ownerUserId === viewerId ? "you" : agent.ownerName;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="relative shrink-0">
        <AgentAvatar agentId={agent.id} avatar={agent.avatar} size={36} />
        {online ? <span aria-hidden="true" className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-zk-surface bg-zk-ok-fg" /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm">
          <Link href={agentPageHref(agent.username)} className="truncate font-semibold text-zk-text hover:text-zk-accent hover:underline">
            {agent.name}
          </Link>
          {owner ? <span className="text-xs text-zk-muted">for {owner}</span> : null}
          {online ? null : (
            <span className="text-xs text-zk-muted">
              · {agent.lastSeenAt ? `seen ${formatAgo(now.getTime() - agent.lastSeenAt.getTime())}` : "never seen"}
            </span>
          )}
        </p>
        <p className={`m-0 mt-0.5 truncate text-[13px] ${alert ? "font-medium text-zk-bad-fg" : "text-zk-text2"}`}>
          {text}
          {claim ? (
            <>
              {" "}
              <Link href={claim.href} title={`#${claim.issueNumber} ${claim.issueTitle}`} className="text-zk-text hover:text-zk-accent hover:underline">
                <span className="text-zk-muted">#{claim.issueNumber}</span> {claim.issueTitle}
              </Link>
            </>
          ) : null}
        </p>
      </div>
      {step?.kind === "link" ? (
        <Link href={step.href} className={STEP_BUTTON}>
          {step.label}
        </Link>
      ) : step?.kind === "nudge" ? (
        <NudgeButton agentId={agent.id} issueId={step.claim.bugId} note={nudgeNote(step.claim.issueNumber)} label={step.label} className={STEP_BUTTON} />
      ) : null}
    </li>
  );
}

/** A list of agents: the first SHOWN, the rest behind "Show N more". */
function AgentList({ agents, viewerId, online, now }: { agents: ProjectAgent[]; viewerId: string; online: boolean; now: Date }) {
  const row = (agent: ProjectAgent) => <AgentRow key={agent.id} agent={agent} viewerId={viewerId} online={online} now={now} />;
  return (
    <>
      <ul className="m-0 list-none divide-y divide-zk-divider p-0">{agents.slice(0, SHOWN).map(row)}</ul>
      {agents.length > SHOWN ? (
        <details className="group">
          <summary className="cursor-pointer list-none py-2 text-xs font-semibold text-zk-accent hover:underline group-open:hidden [&::-webkit-details-marker]:hidden">
            Show {agents.length - SHOWN} more
          </summary>
          <ul className="m-0 list-none divide-y divide-zk-divider border-t border-zk-divider p-0">{agents.slice(SHOWN).map(row)}</ul>
        </details>
      ) : null}
    </>
  );
}

/**
 * The Work queue's Online tab (#online-agents): the agents that
 * checked in within the last 15 minutes, in the project picked (or every
 * project), what each is on, and the one thing the viewer can do about it
 * (stepFor). Agents that hold work but aren't online wait behind one line at
 * the foot; the rest of the organisation's agents aren't listed.
 */
export function OnlineAgentsPanel({ agents, viewerId, place, now }: { agents: ProjectAgent[]; viewerId: string; place: string; now: Date }) {
  const online = agents.filter((agent) => isOnlineNow(agent, now));
  const away = agents.filter((agent) => !isOnlineNow(agent, now) && holdsWork(agent));
  return (
    <section aria-labelledby="online-agents-heading" className="rounded-panel border border-zk-border bg-zk-surface">
      <div className="px-5 pb-2 pt-5">
        <h2 id="online-agents-heading" className="flex items-center gap-2 text-base font-bold text-zk-text">
          Online now
          <span className="rounded-full bg-zk-chip px-2 py-px font-mono text-xs font-semibold tabular-nums text-zk-text2">{online.length}</span>
        </h2>
        <p className="mt-0.5 text-xs text-zk-muted">Agents that checked in within the last 15 minutes, in {place}</p>
      </div>
      <div className="px-5 pb-3">
        {online.length === 0 ? (
          <p className="m-0 py-2 text-sm text-zk-text2">No agents are online right now.</p>
        ) : (
          <AgentList agents={online} viewerId={viewerId} online now={now} />
        )}
      </div>
      {away.length > 0 ? (
        <details className="group/away border-t border-zk-divider">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-5 py-2.5 text-xs font-semibold text-zk-text2 hover:text-zk-text [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="inline-block transition-transform group-open/away:rotate-90">›</span>
            {away.length} more {away.length === 1 ? "holds" : "hold"} work here but {away.length === 1 ? "isn't" : "aren't"} online
          </summary>
          <div className="px-5 pb-3">
            <AgentList agents={away} viewerId={viewerId} online={false} now={now} />
          </div>
        </details>
      ) : null}
    </section>
  );
}
