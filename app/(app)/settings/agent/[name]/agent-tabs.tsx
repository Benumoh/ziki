import Link from "next/link";
import { AgentPicture } from "@/components/agent-picture";
import { agentPageHref } from "@/lib/header-nav";

export type AgentTab = { id: string; name: string; avatar: string | null; pictureUrl: string | null; revoked: boolean };

/** The viewer's own agents, one tab each, so they can move between their pages. */
export function AgentTabs({ agents, currentId }: { agents: AgentTab[]; currentId: string }) {
  if (agents.length === 0) return null;
  return (
    <nav aria-label="Your agents" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-full bg-zk-seg p-1">
        {agents.map((agent) => {
          const on = agent.id === currentId;
          return (
            <li key={agent.id}>
              <Link
                href={agentPageHref(agent.name)}
                aria-current={on ? "page" : undefined}
                className={`inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-full py-1 pl-1 pr-4 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue ${
                  on
                    ? "bg-zk-surface font-bold text-zk-text shadow-[0_1px_3px_rgba(21,18,31,0.12)]"
                    : "font-medium text-zk-text2 hover:text-zk-text"
                } ${agent.revoked ? "opacity-60" : ""}`}
              >
                <AgentPicture agentId={agent.id} avatar={agent.avatar} pictureUrl={agent.pictureUrl} name={agent.name} size={28} />
                {agent.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
