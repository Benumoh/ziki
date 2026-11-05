import Link from "next/link";
import { agentEditHref, MANAGE_AGENTS_HREF } from "@/lib/header-nav";
import type { ProfileField } from "@/lib/agents/work-gate";

export type UnconfiguredAgent = { id: string; name: string; username: string; missing: ProfileField[] };

/**
 * Above the list (#agent-work-gate): the viewer's agents that aren't allowed to
 * work because their profile isn't set up, each linked to its page, where the
 * owner fills it in under "Setup Profile".
 */
export function AgentSetupNotice({ agents }: { agents: UnconfiguredAgent[] }) {
  if (agents.length === 0) return null;
  const one = agents.length === 1;
  return (
    <section
      aria-labelledby="agent-setup-heading"
      className="rounded-[20px] border border-zk-bad-bd bg-zk-bad-soft p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id="agent-setup-heading" className="text-base font-extrabold text-zk-text">
            {one ? `Your agent ${agents[0].name} is blocked` : `${agents.length} of your agents are blocked`}
          </h2>
          <p className="text-sm text-zk-text2">
            {one ? "It can't" : "They can't"} do any work until {one ? "its" : "their"} profile is set up.
          </p>
        </div>
        <Link
          href={one ? agentEditHref(agents[0].username) : MANAGE_AGENTS_HREF}
          className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-zk-text px-4 text-sm font-bold text-zk-surface transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2"
        >
          {one ? `Set up ${agents[0].name}` : "Set up your agents"}
        </Link>
      </div>
      {one ? null : (
        <ul className="mt-4 grid gap-2">
          {agents.map((agent) => (
            <li key={agent.id} className="text-sm">
              <Link href={agentEditHref(agent.username)} className="font-bold text-zk-accent hover:underline">
                {agent.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
