"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { LocalTime } from "@/components/local-time";
import { issuesPath, projectRef } from "@/lib/project-paths";
import { removeProjectMemberAction } from "@/app/actions/project-join-requests";
import { orgListCard, orgListHeading } from "../org-ui";

export type ProjectCollaboratorItem = {
  projectId: string;
  projectName: string;
  projectSlug: string;
  orgSlug: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  createdAt: Date;
};

export function ProjectCollaboratorsSection({
  collaborators,
  canRemove,
}: {
  collaborators: ProjectCollaboratorItem[];
  canRemove: boolean;
}) {
  return (
    <section aria-labelledby="project-collaborators" className={orgListCard}>
      <div className="flex items-center justify-between px-4 py-3 sm:px-6">
        <div>
          <h3 id="project-collaborators" className={orgListHeading}>
            Project Collaborators
          </h3>
          <p className="mt-0.5 text-xs text-zk-muted">
            Contributors with direct access to individual projects, without full organisation membership.
          </p>
        </div>
        {collaborators.length > 0 ? (
          <Badge className="rounded-full bg-zk-chip text-xs text-zk-text2">
            {collaborators.length}
          </Badge>
        ) : null}
      </div>

      {collaborators.length === 0 ? (
        <p className="px-4 py-4 text-sm text-zk-text2 sm:px-6">
          No external project collaborators yet. When contributors join specific projects, they appear here.
        </p>
      ) : (
        <ul className="divide-y divide-zk-border">
          {collaborators.map((c) => (
            <li
              key={`${c.projectId}-${c.userId}`}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zk-chip text-sm font-semibold text-zk-text">
                  {(c.userName || c.userEmail || "?").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-zk-text">
                      {c.userName || c.userEmail}
                    </span>
                    <Link href={issuesPath(projectRef(c.orgSlug, c.projectSlug), "your_work")}>
                      <Badge className="rounded-full border border-zk-border bg-zk-chip text-[11px] font-medium text-zk-accent hover:border-zk-accent">
                        {c.projectName}
                      </Badge>
                    </Link>
                  </div>
                  <p className="mt-0.5 text-xs text-zk-muted">
                    {c.userEmail ? `${c.userEmail} · ` : ""}Joined{" "}
                    <LocalTime date={c.createdAt} />
                  </p>
                </div>
              </div>

              {canRemove ? (
                <form action={removeProjectMemberAction}>
                  <input type="hidden" name="projectId" value={c.projectId} />
                  <input type="hidden" name="userId" value={c.userId} />
                  <ConfirmSubmitButton
                    aria-label={`Remove ${c.userName || c.userEmail} from ${c.projectName}`}
                    variant="danger-secondary"
                    confirm={{
                      title: `Remove collaborator from ${c.projectName}?`,
                      body: `${c.userName || c.userEmail} will lose access to contribute to ${c.projectName}.`,
                      confirmLabel: "Remove",
                    }}
                  >
                    Remove
                  </ConfirmSubmitButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
