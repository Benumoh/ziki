"use client";

import { useState } from "react";
import Link from "next/link";
import type { AgentLevel } from "@prisma/client";
import { AGENT_LEVEL_LABELS } from "@/lib/agents/levels";
import { agentPageHref } from "@/lib/header-nav";
import { AgentPortrait } from "@/components/agent-portrait";
import { colorFor, faceColorKeyFor, lookFor, useDockPrefs } from "@/components/agents-dock-prefs";
import { LocalTime } from "@/components/local-time";
import { RelativeTime } from "@/components/relative-time";
import { AgentControls } from "./agent-controls";
import { AgentRowKey } from "./agent-row-key";
import type { AgentProjectChoice } from "./create-agent-form";
import {
  agentsMutedClass,
  agentsSurface,
  levelBadgeClass,
} from "./agents-ui";

export type ManageAgentItem = {
  id: string;
  name: string;
  /** Its slug: the address of its page. */
  username: string;
  model: string | null;
  level: AgentLevel;
  createdAt: string;
  revokedAt: string | null;
  personal: boolean;
  /** The owner's avatar pick; null wears the automatic robot. */
  avatar: string | null;
  currentProjectId: string | null;
  recent: boolean;
  apiKeys: {
    id: string;
    prefix: string;
    apiKey: string | null;
    projectId: string | null;
    projectName: string | null;
    lastUsedAt: string | null;
  }[];
};

export function ManageAgentsList({
  agents,
  activeCount,
  maxActive,
  levels,
  projects,
}: {
  agents: ManageAgentItem[];
  activeCount: number;
  maxActive: number;
  levels: AgentLevel[];
  projects: AgentProjectChoice[];
}) {
  const [query, setQuery] = useState("");
  const dockPrefs = useDockPrefs();

  const visible = agents.filter((agent) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      agent.name.toLowerCase().includes(q) ||
      (agent.model?.toLowerCase().includes(q) ?? false) ||
      AGENT_LEVEL_LABELS[agent.level].toLowerCase().includes(q)
    );
  });

  const legacyCount = agents.reduce(
    (count, agent) => count + agent.apiKeys.filter((key) => !key.apiKey).length,
    0,
  );

  return (
    <div className="space-y-4">
      {legacyCount > 0 ? (
        <div className="rounded-[20px] border border-zk-warn-bd bg-zk-warn-bg/50 px-4 py-3 text-sm text-zk-warn-fg">
          <p className="font-bold">
            {legacyCount} {legacyCount === 1 ? "key" : "keys"} can&apos;t be copied
          </p>
          <p className="mt-0.5 text-xs">
            They were issued before keys could be copied again. Choose More, then Get a new key, for one you can copy;
            the new key stays on the same row.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:max-w-xs">
          <span className="sr-only">Search agents</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents"
            className="h-11 w-full rounded-full border border-zk-border bg-zk-surface px-4 text-sm text-zk-text placeholder:text-zk-muted focus:border-electric-blue focus:outline-none focus:ring-2 focus:ring-electric-blue/20"
          />
        </label>
        <p data-active-agents className="text-sm text-zk-text2">
          Active agents: <span className="font-bold text-zk-text tabular-nums">{activeCount}</span> of {maxActive} allowed
        </p>
      </div>

      {visible.length === 0 ? (
        <p className={`${agentsMutedClass} ${agentsSurface} p-6`}>
          {agents.length === 0 ? "No agents yet." : "No agents match your search."}
        </p>
      ) : (
        // One agent per row, top to bottom: the agent on the left, its key and controls on the right.
        <ul className="flex flex-col gap-3">
          {visible.map((agent) => {
            const lastUsed = agent.apiKeys.find((key) => key.lastUsedAt)?.lastUsedAt ?? null;
            return (
              // The name's link is stretched over the row, so a click anywhere opens the
              // agent's page; the key and controls sit above it and keep their own clicks.
              <li
                key={agent.id}
                className={`${agentsSurface} group relative flex flex-col gap-4 p-4 transition hover:border-electric-blue/50 hover:shadow-[0_10px_28px_rgba(11,23,51,0.10)] sm:flex-row sm:items-center sm:gap-5 sm:p-5`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="relative shrink-0">
                    {/* In the look picked for the agents dock; the agent's own page changes it. */}
                    <AgentPortrait
                      look={lookFor(dockPrefs, agent.id)}
                      agentId={agent.id}
                      agentName={agent.name}
                      avatar={agent.avatar}
                      color={colorFor(dockPrefs, agent.id)}
                      faceKey={faceColorKeyFor(dockPrefs, agent.id)}
                      size={48}
                    />
                    {!agent.revokedAt ? (
                      <span
                        className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-zk-surface ${
                          agent.recent ? "bg-emerald-500" : "bg-slate-400"
                        }`}
                        aria-hidden
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={agentPageHref(agent.username)}
                        className="break-words text-base font-extrabold text-zk-text after:absolute after:inset-0 after:rounded-[20px] after:content-[''] hover:text-zk-accent focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-electric-blue"
                      >
                        {agent.name}
                        {agent.personal ? <span className="font-normal text-zk-muted"> · personal</span> : null}
                      </Link>
                      <span className={levelBadgeClass(agent.level)}>{AGENT_LEVEL_LABELS[agent.level]}</span>
                      {agent.revokedAt ? (
                        <span className="inline-flex items-center rounded-full bg-zk-bad-bg px-2.5 py-0.5 text-xs font-bold text-zk-bad-fg">
                          Revoked
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-zk-muted">
                      {agent.model ? <>{agent.model} · </> : null}
                      {agent.revokedAt ? (
                        <>
                          Revoked <LocalTime date={agent.revokedAt} />
                        </>
                      ) : agent.apiKeys.length === 0 ? (
                        <>
                          No key yet · Added <LocalTime date={agent.createdAt} />
                        </>
                      ) : (
                        <>
                          {lastUsed ? (
                            <>
                              Last used <RelativeTime date={lastUsed} />
                            </>
                          ) : (
                            <>Never used</>
                          )}
                          {" · "}
                          Added <LocalTime date={agent.createdAt} />
                        </>
                      )}
                    </p>
                  </div>
                </div>
                {/* Above the stretched link; with its More menu open, above the rows below too, so the menu is never under them. */}
                <div className="relative z-10 flex flex-wrap items-center gap-2 has-[[role=menu]]:z-40 sm:justify-end">
                  {!agent.revokedAt
                    ? agent.apiKeys.map((key) => (
                        <AgentRowKey
                          key={key.id}
                          apiKey={key.apiKey}
                          prefix={key.prefix}
                          projectId={key.projectId}
                          projectName={key.projectName}
                        />
                      ))
                    : null}
                  {agent.revokedAt ? (
                    <AgentControls
                      revoked
                      personal={agent.personal}
                      agentId={agent.id}
                      agentName={agent.name}
                      level={agent.level}
                      levels={levels}
                      projects={projects}
                    />
                  ) : (
                    <AgentControls
                      personal={agent.personal}
                      agentId={agent.id}
                      agentName={agent.name}
                      level={agent.level}
                      levels={levels}
                      projects={projects}
                      currentProjectId={agent.currentProjectId}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
