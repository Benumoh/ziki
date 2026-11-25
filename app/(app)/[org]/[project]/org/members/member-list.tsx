"use client";

import { useId, useState } from "react";
import type { AgentLevel } from "@prisma/client";
import { Avatar } from "@/components/avatar";
import { LocalTime } from "@/components/local-time";
import { MemberRoleActions } from "@/components/member-role-actions";
import { TeamAgentLevelControl } from "@/components/team-agent-level";
import { Badge } from "@/components/ui/badge";
import { AGENT_LEVEL_LABELS } from "@/lib/agents/levels";
import type { OrganisationRole } from "@/lib/organisation-role";

export type OrgMember = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: OrganisationRole;
  /** The role's display label, from MEMBERSHIP_ROLE_LABELS. */
  roleLabel: string;
  siteSuperAdmin: boolean;
  joinedAt: string;
  agents: { id: string; name: string; level: AgentLevel }[];
  /** What they said when they joined (#join-questions): owners and admins only, null when unanswered or hidden. */
  joinedAs: string | null;
  /** Whether they pay for the organisation's issues (#payers): every owner, and admins an owner lets. */
  fundsIssues: boolean;
};

/** Past this many people, the list gets a search box. */
const SEARCH_FROM = 20;

const roleBadgeClass: Record<OrganisationRole, string> = {
  owner: "bg-zk-warn-bg text-zk-warn-fg",
  admin: "bg-zk-tint text-zk-accent",
  member: "bg-zk-chip text-zk-text2",
};

function matches(member: OrgMember, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  return [member.name, member.email, ...member.agents.map((agent) => agent.name)].some((value) =>
    (value ?? "").toLocaleLowerCase().includes(q),
  );
}

/**
 * The organisation's one members list: role, when they joined, their agents,
 * and, for owners and admins, the role and remove controls. Everyone gets
 * "Leave" on their own row.
 */
export function MemberList({
  organisationId,
  organisationName,
  viewerId,
  members,
  ownerCount,
  canChangeRoles,
  canRemove,
  agentLevels,
}: {
  organisationId: string;
  organisationName: string;
  viewerId: string;
  members: OrgMember[];
  ownerCount: number;
  canChangeRoles: boolean;
  canRemove: boolean;
  /** The agent classes the viewer may set; empty means they only see them. */
  agentLevels: AgentLevel[];
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const searchable = members.length > SEARCH_FROM;
  const shown = searchable ? members.filter((member) => matches(member, query)) : members;

  return (
    <div className="space-y-3">
      {searchable ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={searchId} className="sr-only">
            Search members
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, email or agent"
            className="w-full rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-sm text-zk-text sm:w-72"
          />
          <p className="text-xs text-zk-muted" aria-live="polite">
            {shown.length} of {members.length}
          </p>
        </div>
      ) : null}

      <ul className="divide-y divide-zk-border overflow-hidden rounded-panel border border-zk-border bg-zk-surface">
        {shown.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-zk-muted sm:px-6">
            {members.length === 0
              ? `No one has joined ${organisationName} yet. Invite someone from the Invites tab.`
              : `No one matches “${query.trim()}”.`}
          </li>
        ) : (
          shown.map((member) => {
            const name = member.name ?? member.email ?? "Member";
            const isSelf = member.id === viewerId;
            return (
              <li key={member.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:px-6">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Avatar name={member.name} image={member.image} size="md" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zk-text">
                      <span className="truncate">{name}</span>
                      {isSelf ? <span className="text-xs font-normal text-zk-muted">(you)</span> : null}
                      <Badge className={`rounded-full ${roleBadgeClass[member.role]}`}>{member.roleLabel}</Badge>
                      {member.fundsIssues ? <Badge className="rounded-full bg-zk-ok-bg text-zk-ok-fg">Funds issues</Badge> : null}
                    </p>
                    {member.email ? <p className="truncate text-xs text-zk-muted">{member.email}</p> : null}
                    <p className="text-xs text-zk-muted">
                      Joined <LocalTime date={member.joinedAt} />
                    </p>
                    {member.joinedAs ? <p className="text-xs text-zk-text2">{member.joinedAs}</p> : null}
                    {member.agents.length > 0 ? (
                      <ul className="mt-2 space-y-1.5" aria-label={`${name}'s agents`}>
                        {member.agents.map((agent) => (
                          <li key={agent.id} className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-zk-text2">{agent.name}</span>
                            {agentLevels.length > 0 ? (
                              <TeamAgentLevelControl
                                agentId={agent.id}
                                agentName={agent.name}
                                level={agent.level}
                                levels={agentLevels}
                              />
                            ) : (
                              <span className="rounded-full bg-zk-info-bg px-2 py-0.5 text-[11px] font-bold text-zk-info-fg">
                                {AGENT_LEVEL_LABELS[agent.level]}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
                <div className="sm:shrink-0">
                  <MemberRoleActions
                    organisationId={organisationId}
                    organisationName={organisationName}
                    userId={member.id}
                    userName={name}
                    membershipRole={member.role}
                    fundsIssues={member.fundsIssues}
                    siteSuperAdmin={member.siteSuperAdmin}
                    canChangeRoles={canChangeRoles}
                    canRemove={canRemove}
                    isSelf={isSelf}
                    ownerCount={ownerCount}
                  />
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
