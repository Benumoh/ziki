"use client";

import Link from "next/link";
import { Fragment, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AgentLevel } from "@prisma/client";
import { Avatar } from "@/components/avatar";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm, type ConfirmOptions } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import type { OrganisationRole } from "@/lib/organisation-role";
import { TOOL_BUTTON, TOOL_BUTTON_ON } from "@/lib/ui-style";
import {
  deactivateMemberAction,
  forgetDeactivatedMemberAction,
  leaveOrganisationAction,
  reactivateMemberAction,
  removeMemberAction,
  setMemberCanFundAction,
  setMemberRoleAction,
} from "@/app/actions/membership";
import {
  acceptJoinRequestAction,
  rejectJoinRequestAction,
  removeProjectMemberAction,
} from "@/app/actions/project-join-requests";
import { resendInviteAction, revokeInviteAction } from "@/app/(app)/organisations/actions";
import { InviteDialog } from "./invite-dialog";

import { TEAM_VIEWS, type TeamView } from "./team-views";

export type TeamMember = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: OrganisationRole;
  roleLabel: string;
  siteSuperAdmin: boolean;
  joinedAt: string;
  agents: { id: string; name: string; level: AgentLevel }[];
  /** What they said when they joined (#join-questions): owners and admins only. */
  joinedAs: string | null;
  /** Whose email invite they accepted, when they came in by one: owners and admins only. */
  invitedByName: string | null;
  /** Whether they pay for the organisation's issues (#payers): every owner, and admins an owner lets. */
  fundsIssues: boolean;
};

export type TeamInviteRow = {
  id: string;
  email: string;
  state: "pending" | "expired";
  createdAt: string;
  expiresAt: string;
  invitedByName: string;
};

export type TeamRequest = {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  image: string | null;
  message: string | null;
  createdAt: string;
  projectId: string;
  projectName: string;
  projectHref: string;
};

export type TeamCollaborator = {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  image: string | null;
  createdAt: string;
  projectId: string;
  projectName: string;
  projectHref: string;
};

export type TeamDeactivated = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: OrganisationRole;
  roleLabel: string;
  joinedAt: string;
  deactivatedAt: string;
  deactivatedByName: string | null;
};

type Row =
  | { kind: "member"; key: string; sort: string; item: TeamMember }
  | { kind: "invite"; key: string; sort: string; item: TeamInviteRow }
  | { kind: "request"; key: string; sort: string; item: TeamRequest }
  | { kind: "collaborator"; key: string; sort: string; item: TeamCollaborator }
  | { kind: "deactivated"; key: string; sort: string; item: TeamDeactivated };

const VIEW_LABELS: Record<TeamView, string> = {
  all: "All",
  active: "Members",
  invited: "Invited",
  requests: "Requests",
  collaborators: "Collaborators",
  deactivated: "Deactivated",
};

/** The header over each kind of person when everyone is shown, like Linear's "Active 1". */
const GROUP_LABELS: Record<Row["kind"], string> = {
  request: "Requests",
  member: "Members",
  invite: "Invited",
  collaborator: "Collaborators",
  deactivated: "Deactivated",
};

// One line per person, as in Linear's members table: Name (with the email under it), Role, Agents, Joined, then the ⋯ menu.
const TH = "px-3 py-2.5 text-left text-xs font-medium text-zk-muted first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
const TD = "px-3 py-3 align-middle first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
/** Role, Agents and Joined: on phones they fold into the name cell instead. */
const WIDE = "hidden sm:table-cell";
const COLUMNS = 5;

const KIND_OF_VIEW: Record<Exclude<TeamView, "all">, Row["kind"]> = {
  active: "member",
  invited: "invite",
  requests: "request",
  collaborators: "collaborator",
  deactivated: "deactivated",
};

const roleBadgeClass: Record<OrganisationRole, string> = {
  owner: "bg-zk-warn-bg text-zk-warn-fg",
  admin: "bg-zk-tint text-zk-accent",
  member: "bg-zk-chip text-zk-text2",
};

/** The one status chip each row carries. */
function statusOf(row: Row): { label: string; className: string } | null {
  switch (row.kind) {
    case "member":
      return null;
    case "invite":
      return row.item.state === "pending"
        ? { label: "Invited", className: "bg-zk-info-bg text-zk-info-fg" }
        : { label: "Invite expired", className: "bg-zk-warn-bg text-zk-warn-fg" };
    case "request":
      return { label: "Wants to join", className: "bg-zk-warn-bg text-zk-warn-fg" };
    case "collaborator":
      return { label: "Collaborator", className: "bg-zk-chip text-zk-text2" };
    case "deactivated":
      return { label: "Deactivated", className: "bg-zk-bad-bg text-zk-bad-fg" };
  }
}

function roleOf(row: Row): OrganisationRole | null {
  return row.kind === "member" || row.kind === "deactivated" ? row.item.role : null;
}

function projectOf(row: Row): string | null {
  return row.kind === "request" || row.kind === "collaborator" ? row.item.projectId : null;
}

function searchText(row: Row): string {
  const item = row.item;
  const parts: (string | null)[] = [];
  if ("name" in item) parts.push(item.name);
  parts.push(item.email);
  if (row.kind === "member") parts.push(...row.item.agents.map((agent) => agent.name));
  if (row.kind === "request" || row.kind === "collaborator") parts.push(row.item.projectName);
  return parts.filter(Boolean).join(" ").toLocaleLowerCase();
}

function displayName(row: Row): string {
  if (row.kind === "invite") return row.item.email;
  return row.item.name ?? row.item.email ?? "Someone";
}

/** Keeps the address in step with the filters, so a filtered view can be shared or reloaded. */
function writeViewToUrl(view: TeamView) {
  try {
    const url = new URL(window.location.href);
    if (view === "all") url.searchParams.delete("show");
    else url.searchParams.set("show", view);
    url.searchParams.delete("invite");
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // An address that can't be rewritten only loses the shareable filter.
  }
}

type MenuItem = {
  label: string;
  danger?: boolean;
  confirm?: ConfirmOptions;
  run: () => Promise<{ error?: string } | void>;
  success: string;
  href?: string;
};

/**
 * The organisation's one Team list (#team-page): members, invites, join requests, project
 * collaborators and deactivated people, as one filterable table. Each row's actions sit in its
 * ⋯ menu, so the page shows one way to do each thing.
 */
export function TeamManager({
  organisationId,
  organisationName,
  viewerId,
  canManage,
  canChangeRoles,
  ownerCount,
  inviteTtlDays,
  initialView,
  openInvite,
  members,
  invites,
  requests,
  collaborators,
  deactivated,
}: {
  organisationId: string;
  organisationName: string;
  viewerId: string;
  /** Owners, admins and the site super admin. */
  canManage: boolean;
  /** Owners and the site super admin. */
  canChangeRoles: boolean;
  ownerCount: number;
  inviteTtlDays: number;
  initialView: TeamView;
  openInvite: boolean;
  members: TeamMember[];
  invites: TeamInviteRow[];
  requests: TeamRequest[];
  collaborators: TeamCollaborator[];
  deactivated: TeamDeactivated[];
}) {
  const searchId = useId();
  const roleId = useId();
  const projectId = useId();
  const [view, setView] = useState<TeamView>(initialView);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<OrganisationRole | "">("");
  const [project, setProject] = useState("");
  const [inviting, setInviting] = useState<"email" | "link" | null>(openInvite ? "email" : null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();

  const rows = useMemo<Row[]>(
    () => [
      ...requests.map((item) => ({ kind: "request" as const, key: `r:${item.id}`, sort: "0", item })),
      ...members.map((item) => ({ kind: "member" as const, key: `m:${item.id}`, sort: "1", item })),
      ...invites.map((item) => ({ kind: "invite" as const, key: `i:${item.id}`, sort: "2", item })),
      ...collaborators.map((item) => ({ kind: "collaborator" as const, key: `c:${item.id}`, sort: "3", item })),
      ...deactivated.map((item) => ({ kind: "deactivated" as const, key: `d:${item.id}`, sort: "4", item })),
    ],
    [requests, members, invites, collaborators, deactivated],
  );

  const counts = useMemo(() => {
    const result: Record<TeamView, number> = { all: rows.length, active: 0, invited: 0, requests: 0, collaborators: 0, deactivated: 0 };
    for (const view of TEAM_VIEWS) {
      if (view !== "all") result[view] = rows.filter((row) => row.kind === KIND_OF_VIEW[view]).length;
    }
    return result;
  }, [rows]);

  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of [...requests, ...collaborators]) seen.set(row.projectId, row.projectName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [requests, collaborators]);

  const q = query.trim().toLocaleLowerCase();
  const shown = rows.filter(
    (row) =>
      (view === "all" || row.kind === KIND_OF_VIEW[view]) &&
      (!role || roleOf(row) === role) &&
      (!project || projectOf(row) === project) &&
      (!q || searchText(row).includes(q)),
  );
  const filtered = Boolean(q || role || project);

  // Only show the tabs that have someone in them, plus the one picked and "All".
  const tabs = TEAM_VIEWS.filter((item) => item === "all" || item === "active" || item === view || counts[item] > 0);

  function pickView(next: TeamView) {
    setView(next);
    writeViewToUrl(next);
  }

  function clearFilters() {
    setQuery("");
    setRole("");
    setProject("");
  }

  async function run(item: MenuItem) {
    setError(null);
    // Asked before the transition starts: inside it, the dialog's own update would wait for the transition.
    if (item.confirm && !(await confirm(item.confirm))) return;
    startTransition(async () => {
      try {
        const result = await item.run();
        if (result && result.error) {
          setError(result.error);
          toast(result.error, "error");
          return;
        }
        toast(item.success);
        if (item.href) router.push(item.href);
        else router.refresh();
      } catch {
        const message = "Couldn't update the team. Try again.";
        setError(message);
        toast(message, "error");
      }
    });
  }

  function form(values: Record<string, string>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
  }

  function menuFor(row: Row): MenuItem[] {
    const name = displayName(row);
    const items: MenuItem[] = [];
    if (row.kind === "member") {
      const member = row.item;
      const isSelf = member.id === viewerId;
      const lastOwner = member.role === "owner" && ownerCount <= 1;
      const outranks = canChangeRoles || member.role === "member";
      if (canChangeRoles && !member.siteSuperAdmin && member.role === "member") {
        items.push({
          label: "Make admin",
          confirm: {
            title: `Make ${name} an admin of ${organisationName}?`,
            body: `They will be able to invite people and triage and delete issues in ${organisationName}. This does not make them an admin of any other organisation.`,
            confirmLabel: "Make admin",
          },
          run: () => setMemberRoleAction(organisationId, member.id, "admin"),
          success: `${name} is now an admin of ${organisationName}.`,
        });
      }
      if (canChangeRoles && !member.siteSuperAdmin && member.role === "admin") {
        items.push({
          label: "Make member",
          confirm: {
            title: `Remove admin from ${name}?`,
            body: `They stay in ${organisationName} as a member and can no longer invite people or triage its issues.`,
            confirmLabel: "Make member",
            tone: "danger",
          },
          run: () => setMemberRoleAction(organisationId, member.id, "member"),
          success: `${name} is a member of ${organisationName}.`,
        });
      }
      // #payers: funding spends the admin's own wallet, so the owner chooses who may.
      if (canChangeRoles && member.role === "admin") {
        items.push(
          member.fundsIssues
            ? {
                label: "Stop funding issues",
                confirm: {
                  title: `Stop ${name} funding issues?`,
                  body: `They stay an admin of ${organisationName}. They're no longer asked to fund its issues, and they and their agents can estimate them like any member. Ziks they already put in stay where they are.`,
                  confirmLabel: "Stop funding",
                  tone: "danger",
                },
                run: () => setMemberCanFundAction(organisationId, member.id, false),
                success: `${name} no longer funds ${organisationName}'s issues.`,
              }
            : {
                label: "Let them fund issues",
                confirm: {
                  title: `Let ${name} fund ${organisationName}'s issues?`,
                  body: "They can fund issues and project budgets from their own wallet, pause and take back budgets, and raise prices. Like you, they and their agents stop estimating its issues and aren't paid for reporting or confirming them.",
                  confirmLabel: "Let them fund issues",
                },
                run: () => setMemberCanFundAction(organisationId, member.id, true),
                success: `${name} can fund ${organisationName}'s issues.`,
              },
        );
      }
      if (canChangeRoles && !member.siteSuperAdmin && member.role === "owner" && !lastOwner) {
        items.push({
          label: "Make admin instead of owner",
          confirm: {
            title: `Make ${name} an admin instead of an owner?`,
            body: `${organisationName} still has another owner.`,
            confirmLabel: "Make admin",
            tone: "danger",
          },
          run: () => setMemberRoleAction(organisationId, member.id, "admin"),
          success: `${name} is an admin of ${organisationName}.`,
        });
      }
      if (canManage && !isSelf && !lastOwner && outranks) {
        items.push({
          label: "Deactivate",
          danger: true,
          confirm: {
            title: `Deactivate ${name}?`,
            body: `They lose access to ${organisationName} at once and their agents here are switched off. They stay on this page under Deactivated, so you can reactivate them with the same role. An invite link won't let them back in.`,
            confirmLabel: "Deactivate",
            tone: "danger",
          },
          run: () => deactivateMemberAction(organisationId, member.id),
          success: `${name} was deactivated.`,
        });
        items.push({
          label: "Remove from organisation",
          danger: true,
          confirm: {
            title: `Remove ${name} from ${organisationName}?`,
            body: "They keep their account. They lose access to this organisation's issues until someone invites them again.",
            confirmLabel: "Remove",
            tone: "danger",
          },
          run: () => removeMemberAction(organisationId, member.id),
          success: `${name} was removed from ${organisationName}.`,
        });
      }
      if (isSelf && !lastOwner) {
        items.push({
          label: "Leave organisation",
          danger: true,
          confirm: {
            title: `Leave ${organisationName}?`,
            body: "You will lose access to its issues until someone invites you back.",
            confirmLabel: "Leave",
            tone: "danger",
          },
          run: () => leaveOrganisationAction(organisationId),
          success: `You left ${organisationName}.`,
          href: "/organisations",
        });
      }
    } else if (row.kind === "invite" && canManage) {
      const invite = row.item;
      items.push({
        label: invite.state === "pending" ? "Send again" : "Send a new invite",
        run: async () => {
          const result = await resendInviteAction(organisationId, invite.email);
          if (!result.ok) return { error: result.error };
          await copyText(result.link);
        },
        success: `Sent ${invite.email} a new invite and copied its link. The old link no longer works.`,
      });
      if (invite.state === "pending") {
        items.push({
          label: "Revoke invite",
          danger: true,
          confirm: {
            title: `Revoke the invite for ${invite.email}?`,
            body: "Their link stops working at once. You can send a new invite later.",
            confirmLabel: "Revoke invite",
            tone: "danger",
          },
          run: () => revokeInviteAction(form({ inviteId: invite.id })),
          success: `The invite for ${invite.email} was revoked.`,
        });
      }
    } else if (row.kind === "request" && canManage) {
      const request = row.item;
      items.push({
        label: `Accept into ${request.projectName}`,
        run: () => acceptJoinRequestAction(form({ requestId: request.id })),
        success: `${name} can now work on ${request.projectName}.`,
      });
      items.push({
        label: "Reject request",
        danger: true,
        confirm: {
          title: `Reject the request from ${name}?`,
          body: "They will not be added to this project. They can ask again later.",
          confirmLabel: "Reject request",
          tone: "danger",
        },
        run: () => rejectJoinRequestAction(form({ requestId: request.id })),
        success: `The request from ${name} was rejected.`,
      });
    } else if (row.kind === "collaborator" && canManage) {
      const collaborator = row.item;
      items.push({
        label: `Remove from ${collaborator.projectName}`,
        danger: true,
        confirm: {
          title: `Remove ${name} from ${collaborator.projectName}?`,
          body: `${name} will no longer be able to contribute to ${collaborator.projectName}.`,
          confirmLabel: "Remove",
          tone: "danger",
        },
        run: () => removeProjectMemberAction(form({ projectId: collaborator.projectId, userId: collaborator.userId })),
        success: `${name} was removed from ${collaborator.projectName}.`,
      });
    } else if (row.kind === "deactivated" && canManage) {
      const person = row.item;
      if (canChangeRoles || person.role === "member") {
        items.push({
          label: "Reactivate",
          confirm: {
            title: `Reactivate ${name}?`,
            body: `They get back into ${organisationName} as ${person.roleLabel.toLowerCase()}. Their agents stay off until they connect them again.`,
            confirmLabel: "Reactivate",
          },
          run: () => reactivateMemberAction(organisationId, person.id),
          success: `${name} is active again.`,
        });
        items.push({
          label: "Remove for good",
          danger: true,
          confirm: {
            title: `Remove ${name} for good?`,
            body: "They stay out and leave this list. Inviting them again later treats them like anyone new.",
            confirmLabel: "Remove",
            tone: "danger",
          },
          run: () => forgetDeactivatedMemberAction(organisationId, person.id),
          success: `${name} was removed.`,
        });
      }
    }
    return items;
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zk-text2">
            <span className="font-semibold text-zk-text">{counts.active}</span> {counts.active === 1 ? "member" : "members"}
            {counts.invited > 0 ? (
              <>
                {" · "}
                <span className="font-semibold text-zk-text">{counts.invited}</span> invited
              </>
            ) : null}
            {counts.requests > 0 ? (
              <>
                {" · "}
                <span className="font-semibold text-zk-text">{counts.requests}</span>{" "}
                {counts.requests === 1 ? "request" : "requests"}
              </>
            ) : null}
          </p>
          <Button type="button" onClick={() => setInviting("email")} aria-haspopup="dialog">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6" />
            </svg>
            Invite people
          </Button>
        </div>
      ) : null}

      {canManage && inviting ? (
        <InviteDialog
          organisationId={organisationId}
          organisationName={organisationName}
          inviteTtlDays={inviteTtlDays}
          mode={inviting}
          onModeChange={setInviting}
          onClose={() => {
            setInviting(null);
            // Invites sent from the window show in the list straight away.
            router.refresh();
          }}
        />
      ) : null}

      <div className="space-y-3 rounded-panel border border-zk-border bg-zk-surface p-4 sm:p-5">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="group" aria-label="Show">
          {tabs.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={view === item}
              onClick={() => pickView(item)}
              className={`${TOOL_BUTTON} ${view === item ? TOOL_BUTTON_ON : ""}`}
            >
              {VIEW_LABELS[item]}
              <span className="rounded-full bg-zk-chip px-1.5 text-[11px] font-bold text-zk-text2">{counts[item]}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <label htmlFor={searchId} className="sr-only">
            Search the team
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, email, agent or project"
            className="h-9 w-full rounded-control border border-zk-border bg-zk-surface px-3 text-sm text-zk-text placeholder:text-zk-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue sm:w-72"
          />
          <label htmlFor={roleId} className="sr-only">
            Role
          </label>
          <select
            id={roleId}
            value={role}
            onChange={(event) => setRole(event.target.value as OrganisationRole | "")}
            className="h-9 rounded-control border border-zk-border bg-zk-surface px-3 text-sm text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue"
          >
            <option value="">Any role</option>
            <option value="owner">Owners</option>
            <option value="admin">Admins</option>
            <option value="member">Members</option>
          </select>
          {projects.length > 0 ? (
            <>
              <label htmlFor={projectId} className="sr-only">
                Project
              </label>
              <select
                id={projectId}
                value={project}
                onChange={(event) => setProject(event.target.value)}
                className="h-9 rounded-control border border-zk-border bg-zk-surface px-3 text-sm text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue"
              >
                <option value="">Any project</option>
                {projects.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          {filtered ? (
            <Button type="button" variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
          <p className="text-xs text-zk-muted sm:ml-auto" aria-live="polite">
            {shown.length} of {view === "all" ? rows.length : counts[view]}
          </p>
        </div>

        {error ? (
          <p role="alert" className="rounded-control border border-zk-bad-bd bg-zk-bad-bg px-3 py-2 text-sm text-zk-bad-fg">
            {error}
          </p>
        ) : null}

        <div className="-mx-4 overflow-x-auto border-t border-zk-divider sm:-mx-5">
          <table className="w-full border-collapse text-sm" aria-busy={pending}>
            <thead className="border-b border-zk-divider">
              <tr>
                <th scope="col" className={TH}>Name</th>
                <th scope="col" className={`${TH} ${WIDE}`}>Role</th>
                <th scope="col" className={`${TH} ${WIDE}`}>Agents</th>
                <th scope="col" className={`${TH} ${WIDE}`}>Joined</th>
                <th scope="col" className={`${TH} w-12`}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zk-divider">
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS} className="px-4 py-8 text-center text-sm text-zk-muted sm:px-5">
                    {filtered
                      ? "No one matches these filters."
                      : view === "invited"
                        ? "No invites waiting. People you invite show here until they join."
                        : view === "requests"
                          ? "No one is asking to join a project right now."
                          : view === "deactivated"
                            ? "No one is deactivated."
                            : view === "collaborators"
                              ? "No outside collaborators on your projects."
                              : `No one has joined ${organisationName} yet.`}
                  </td>
                </tr>
              ) : (
                shown.map((row, index) => (
                  <Fragment key={row.key}>
                    {view === "all" && shown[index - 1]?.kind !== row.kind ? (
                      <tr className="bg-zk-chip/60">
                        <th scope="rowgroup" colSpan={COLUMNS} className="px-4 py-2 text-left text-xs font-medium text-zk-text2 sm:px-5">
                          {GROUP_LABELS[row.kind]}{" "}
                          <span className="ml-1 font-normal text-zk-muted">{shown.filter((other) => other.kind === row.kind).length}</span>
                        </th>
                      </tr>
                    ) : null}
                    <TeamRow
                      row={row}
                      isSelf={row.kind === "member" && row.item.id === viewerId}
                      menu={menuFor(row)}
                      pending={pending}
                      onPick={run}
                    />
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** A member's agents by name: the first two, then "+N" for the rest (their classes live on the Workers page). */
function AgentNames({ agents }: { agents: TeamMember["agents"] }) {
  if (agents.length === 0) return <span className="text-zk-muted">—</span>;
  const more = agents.length - 2;
  return (
    <span className="flex min-w-0 max-w-[240px] items-center gap-1.5 text-zk-text2" title={agents.map((agent) => agent.name).join(", ")}>
      <span className="truncate">{agents.slice(0, 2).map((agent) => agent.name).join(", ")}</span>
      {more > 0 ? <span className="shrink-0 text-xs text-zk-muted">+{more}</span> : null}
    </span>
  );
}

/** The chips in a row's Role column: its status (when it isn't a member), its role, and its project. */
function RoleChips({ row }: { row: Row }) {
  const status = statusOf(row);
  const role = roleOf(row);
  return (
    <>
      {status ? <Badge className={`rounded-chip ${status.className}`}>{status.label}</Badge> : null}
      {role ? <Badge className={`rounded-chip ${roleBadgeClass[role]}`}>{"roleLabel" in row.item ? row.item.roleLabel : role}</Badge> : null}
      {row.kind === "member" && row.item.fundsIssues ? <Badge className="rounded-chip bg-zk-ok-bg text-zk-ok-fg">Funds issues</Badge> : null}
      {row.kind === "request" || row.kind === "collaborator" ? (
        <Link
          href={row.item.projectHref}
          className="rounded-chip border border-zk-border bg-zk-chip px-1.5 py-0.5 text-[11px] font-medium text-zk-accent hover:border-zk-accent"
        >
          {row.item.projectName}
        </Link>
      ) : null}
    </>
  );
}

/** The second line under the name: the email, or who sent an invite. What else is known is its tooltip. */
function detailOf(row: Row): { text: string | null; note: string | null } {
  switch (row.kind) {
    case "member": {
      const notes = [row.item.joinedAs, row.item.invitedByName ? `Accepted an invite from ${row.item.invitedByName}` : null].filter(Boolean);
      return { text: row.item.email, note: notes.length > 0 ? notes.join(" · ") : null };
    }
    case "invite":
      return { text: `Invited by ${row.item.invitedByName}`, note: null };
    case "request":
      return { text: row.item.email, note: null };
    case "collaborator":
      return { text: row.item.email, note: "Works on this project only" };
    case "deactivated":
      return { text: row.item.email, note: row.item.deactivatedByName ? `Deactivated by ${row.item.deactivatedByName}` : null };
  }
}

/** The Joined column: when they joined, or when an invite expires, a request came in or someone was deactivated. */
function DateCell({ row }: { row: Row }) {
  switch (row.kind) {
    case "member":
    case "collaborator":
      return <LocalTime date={row.kind === "member" ? row.item.joinedAt : row.item.createdAt} />;
    case "invite":
      return (
        <>
          {row.item.state === "pending" ? "Expires" : "Expired"} <LocalTime date={row.item.expiresAt} />
        </>
      );
    case "request":
      return (
        <>
          Asked <LocalTime date={row.item.createdAt} />
        </>
      );
    case "deactivated":
      return (
        <>
          Deactivated <LocalTime date={row.item.deactivatedAt} />
        </>
      );
  }
}

function TeamRow({
  row,
  isSelf,
  menu,
  pending,
  onPick,
}: {
  row: Row;
  isSelf: boolean;
  menu: MenuItem[];
  pending: boolean;
  onPick: (item: MenuItem) => void;
}) {
  const name = displayName(row);
  const image = row.kind === "invite" ? null : row.item.image;
  const detail = detailOf(row);
  const agents = row.kind === "member" ? row.item.agents : [];

  return (
    <tr className="hover:bg-zk-chip/40">
      <td className={TD}>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={row.kind === "invite" ? row.item.email : row.item.name} image={image} size="md" />
          <div className="min-w-0 max-w-[280px]">
            <p className="flex min-w-0 items-center gap-1.5 font-medium text-zk-text">
              <span className="truncate">{name}</span>
              {isSelf ? <span className="shrink-0 text-xs font-normal text-zk-muted">(you)</span> : null}
            </p>
            {detail.text && detail.text !== name ? (
              <p className="truncate text-xs text-zk-muted" title={detail.note ?? undefined}>{detail.text}</p>
            ) : null}
            {row.kind === "request" && row.item.message ? (
              <p className="truncate text-xs text-zk-text2" title={row.item.message}>
                <span className="font-semibold text-zk-text">Note: </span>
                {row.item.message}
              </p>
            ) : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 sm:hidden">
              <RoleChips row={row} />
              {agents.length > 0 ? <AgentNames agents={agents} /> : null}
            </div>
          </div>
        </div>
      </td>
      <td className={`${TD} ${WIDE}`}>
        <div className="flex flex-wrap items-center gap-1">
          <RoleChips row={row} />
        </div>
      </td>
      <td className={`${TD} ${WIDE}`}>{row.kind === "member" ? <AgentNames agents={agents} /> : <span className="text-zk-muted">—</span>}</td>
      <td className={`${TD} ${WIDE} whitespace-nowrap text-zk-text2`}>
        <DateCell row={row} />
      </td>
      <td className={TD}>
        <div className="flex items-center justify-end gap-2">
          {row.kind === "request" && menu.length > 0 ? (
            <Button type="button" variant="secondary" disabled={pending} onClick={() => onPick(menu[0])}>
              Accept
            </Button>
          ) : null}
          {row.kind === "deactivated" && menu.length > 0 ? (
            <Button type="button" variant="secondary" disabled={pending} onClick={() => onPick(menu[0])}>
              Reactivate
            </Button>
          ) : null}
          {menu.length > 0 ? <RowMenu name={name} items={menu} pending={pending} onPick={onPick} /> : null}
        </div>
      </td>
    </tr>
  );
}

/** A row's ⋯ menu: every action on that person, in one place. */
function RowMenu({
  name,
  items,
  pending,
  onPick,
}: {
  name: string;
  items: MenuItem[];
  pending: boolean;
  onPick: (item: MenuItem) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function close(event: MouseEvent | KeyboardEvent) {
      const details = ref.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") {
          details.open = false;
          details.querySelector("summary")?.focus();
        }
        return;
      }
      if (!details.contains(event.target as Node)) details.open = false;
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={ref} className="relative">
      <summary
        aria-label={`Actions for ${name}`}
        className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-control text-zk-muted transition hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue [&::-webkit-details-marker]:hidden"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </summary>
      <ul className="absolute right-0 z-20 mt-1 min-w-52 rounded-panel border border-zk-border bg-zk-surface p-1 shadow-lg">
        {items.map((item) => (
          <li key={item.label}>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (ref.current) ref.current.open = false;
                onPick(item);
              }}
              className={`flex w-full items-center rounded-control px-3 py-2 text-left text-sm font-medium transition hover:bg-zk-chip disabled:opacity-50 ${
                item.danger ? "text-zk-bad-fg" : "text-zk-text"
              }`}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
