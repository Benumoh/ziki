"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  leaveOrganisationAction,
  removeMemberAction,
  setMemberCanFundAction,
  setMemberRoleAction,
} from "@/app/actions/membership";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import type { OrganisationRole } from "@/lib/organisation-role";

const secondaryBtn =
  "inline-flex min-h-10 items-center justify-center rounded-full border border-zk-border bg-zk-surface px-3.5 py-2 text-sm font-bold text-zk-text transition hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:opacity-50";
const dangerBtn =
  "inline-flex min-h-10 items-center justify-center rounded-full border border-zk-bad-bd bg-zk-surface px-3.5 py-2 text-sm font-bold text-zk-bad-fg transition hover:bg-zk-bad-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zk-bad-fg focus-visible:ring-offset-2 disabled:opacity-50";

/**
 * Promote, demote, remove, or leave inside one organisation, and, for an owner,
 * whether an admin funds the organisation's issues (#payers).
 * A site super admin's site role is not edited here.
 */
export function MemberRoleActions({
  organisationId,
  organisationName,
  userId,
  userName,
  membershipRole,
  fundsIssues = false,
  siteSuperAdmin = false,
  canChangeRoles,
  canRemove,
  isSelf,
  ownerCount,
}: {
  organisationId: string;
  organisationName: string;
  userId: string;
  userName: string;
  membershipRole: OrganisationRole;
  /** Whether they pay for the organisation's issues (#payers). */
  fundsIssues?: boolean;
  siteSuperAdmin?: boolean;
  canChangeRoles: boolean;
  canRemove: boolean;
  isSelf: boolean;
  ownerCount: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();

  function run(
    task: () => Promise<{ error?: string; ok?: boolean }>,
    success: string,
    href?: string,
  ) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await task();
        if (result?.error) {
          setError(result.error);
          toast(result.error, "error");
        } else {
          toast(success);
          if (href) router.push(href);
        }
      } catch {
        const message = "Couldn't update that membership. Try again.";
        setError(message);
        toast(message, "error");
      }
    });
  }

  const lastOwner = membershipRole === "owner" && ownerCount <= 1;
  const buttons: { key: string; node: ReactNode }[] = [];

  if (canChangeRoles && !siteSuperAdmin && membershipRole === "member") {
    buttons.push({
      key: "promote",
      node: (
        <button
          type="button"
          className={secondaryBtn}
          disabled={pending}
          onClick={async () => {
            const confirmed = await confirm({
              title: `Make ${userName} an admin of ${organisationName}?`,
              body: `They will be able to triage and delete issues in ${organisationName}. This does not make them an admin of any other organisation.`,
              confirmLabel: "Promote to admin",
            });
            if (!confirmed) return;
            run(
              () => setMemberRoleAction(organisationId, userId, "admin"),
              `${userName} is now an admin of ${organisationName}.`,
            );
          }}
        >
          {pending ? "Promoting…" : "Promote to admin"}
        </button>
      ),
    });
  }

  if (canChangeRoles && !siteSuperAdmin && membershipRole === "admin") {
    buttons.push({
      key: "demote",
      node: (
        <button
          type="button"
          className={secondaryBtn}
          disabled={pending}
          onClick={async () => {
            const confirmed = await confirm({
              title: `Remove admin from ${userName}?`,
              body: `They stay in ${organisationName} as a member. They will no longer be able to triage its issues.`,
              confirmLabel: "Remove admin",
              tone: "danger",
            });
            if (!confirmed) return;
            run(
              () => setMemberRoleAction(organisationId, userId, "member"),
              `${userName} is a member of ${organisationName}.`,
            );
          }}
        >
          {pending ? "Removing…" : "Remove admin"}
        </button>
      ),
    });
  }

  // #payers: funding spends the admin's own wallet, so the owner chooses who may.
  if (canChangeRoles && membershipRole === "admin") {
    buttons.push({
      key: "fund",
      node: (
        <button
          type="button"
          className={secondaryBtn}
          disabled={pending}
          onClick={async () => {
            const confirmed = await confirm(
              fundsIssues
                ? {
                    title: `Stop ${userName} funding issues?`,
                    body: `They stay an admin of ${organisationName}. They're no longer asked to fund its issues, and they and their agents can estimate them like any member. Ziks they already put in stay where they are.`,
                    confirmLabel: "Stop funding",
                    tone: "danger",
                  }
                : {
                    title: `Let ${userName} fund ${organisationName}'s issues?`,
                    body: "They can fund issues and project budgets from their own wallet, pause and take back budgets, and raise prices. Like you, they and their agents stop estimating its issues and aren't paid for reporting or confirming them.",
                    confirmLabel: "Let them fund issues",
                  },
            );
            if (!confirmed) return;
            run(
              () => setMemberCanFundAction(organisationId, userId, !fundsIssues),
              fundsIssues ? `${userName} no longer funds ${organisationName}'s issues.` : `${userName} can fund ${organisationName}'s issues.`,
            );
          }}
        >
          {fundsIssues ? "Stop funding issues" : "Let them fund issues"}
        </button>
      ),
    });
  }

  if (canChangeRoles && !siteSuperAdmin && membershipRole === "owner" && !lastOwner) {
    buttons.push({
      key: "demote-owner",
      node: (
        <button
          type="button"
          className={secondaryBtn}
          disabled={pending}
          onClick={async () => {
            const confirmed = await confirm({
              title: `Make ${userName} an admin instead of an owner?`,
              body: `${organisationName} still has another owner.`,
              confirmLabel: "Demote to admin",
              tone: "danger",
            });
            if (!confirmed) return;
            run(
              () => setMemberRoleAction(organisationId, userId, "admin"),
              `${userName} is an admin of ${organisationName}.`,
            );
          }}
        >
          {pending ? "Updating…" : "Demote to admin"}
        </button>
      ),
    });
  }

  if (canRemove && !isSelf && !lastOwner && (canChangeRoles || membershipRole === "member")) {
    buttons.push({
      key: "remove",
      node: (
        <button
          type="button"
          className={dangerBtn}
          disabled={pending}
          onClick={async () => {
            const confirmed = await confirm({
              title: `Remove ${userName} from ${organisationName}?`,
              body: "They keep their account. They lose access to this organisation's issues until someone invites them again.",
              confirmLabel: "Remove",
              tone: "danger",
            });
            if (!confirmed) return;
            run(
              () => removeMemberAction(organisationId, userId),
              `${userName} was removed from ${organisationName}.`,
            );
          }}
        >
          Remove
        </button>
      ),
    });
  }

  if (isSelf && !lastOwner) {
    buttons.push({
      key: "leave",
      node: (
        <button
          type="button"
          className={dangerBtn}
          disabled={pending}
          onClick={async () => {
            const confirmed = await confirm({
              title: `Leave ${organisationName}?`,
              body: "You will lose access to its issues until someone invites you back.",
              confirmLabel: "Leave",
              tone: "danger",
            });
            if (!confirmed) return;
            run(() => leaveOrganisationAction(organisationId), `You left ${organisationName}.`, "/organisations");
          }}
        >
          Leave
        </button>
      ),
    });
  }

  if (buttons.length === 0) {
    return <span className="text-xs text-zk-muted">—</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {buttons.map((button) => (
          <span key={button.key}>{button.node}</span>
        ))}
      </div>
      {error ? (
        <p className="text-xs text-zk-bad-fg" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
