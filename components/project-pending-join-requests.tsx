import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { acceptJoinRequestAction, rejectJoinRequestAction } from "@/app/actions/project-join-requests";
import { issuesPath, orgPath, projectRef, type ProjectRef } from "@/lib/project-paths";

export type PendingJoinRequestItem = {
  id: string;
  message: string | null;
  createdAt: Date | string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image?: string | null;
  };
  project?: {
    id: string;
    name: string;
    slug: string;
    organisation: { slug: string };
  };
};

/**
 * Surfaces pending project join requests directly on project and member views (#join-requests)
 * so maintainers can see who wants to join and accept or decline in one click without hunting
 * through Organisation → Invites.
 */
export function ProjectPendingJoinRequestsBanner({
  requests,
  orgRef,
  projectName,
}: {
  requests: PendingJoinRequestItem[];
  orgRef: ProjectRef;
  projectName?: string;
}) {
  if (requests.length === 0) return null;

  const singleProjectName =
    requests.every((r) => r.project?.id && r.project.id === requests[0].project?.id)
      ? requests[0].project?.name ?? projectName
      : projectName;
  const title =
    requests.length === 1
      ? `1 person wants to join ${singleProjectName ?? "your project"}`
      : `${requests.length} pending requests to join ${singleProjectName ?? "your projects"}`;

  return (
    <section
      aria-labelledby="pending-join-requests-heading"
      className="rounded-2xl border border-amber-500/35 bg-zk-surface p-4 shadow-sm print:hidden sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zk-divider pb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" aria-hidden="true" />
          <h2 id="pending-join-requests-heading" className="text-sm font-bold text-zk-text sm:text-base">
            {title}
          </h2>
          <Badge className="rounded-full border border-amber-500/30 bg-amber-500/10 text-xs font-semibold text-amber-400">
            {requests.length} pending
          </Badge>
        </div>
        <Link
          href={orgPath(orgRef, "invites")}
          className="text-xs font-semibold text-zk-accent hover:underline"
        >
          Manage in Invites →
        </Link>
      </div>

      <ul className="divide-y divide-zk-divider">
        {requests.map((req) => {
          const displayName = req.user.name || req.user.email || "Contributor";
          const targetProject = req.project;
          return (
            <li key={req.id} className="flex flex-col gap-2.5 py-3.5 first:pt-3.5 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={displayName} image={req.user.image ?? null} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-zk-text">{displayName}</span>
                      {req.user.name && req.user.email ? (
                        <span className="truncate text-xs text-zk-muted">({req.user.email})</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-zk-muted">
                      {targetProject ? (
                        <>
                          Asked to join{" "}
                          <Link
                            href={issuesPath(projectRef(targetProject.organisation.slug, targetProject.slug), "your_work")}
                            className="font-medium text-zk-accent hover:underline"
                          >
                            {targetProject.name}
                          </Link>{" "}
                          ·{" "}
                        </>
                      ) : (
                        "Asked to join · "
                      )}
                      <LocalTime date={req.createdAt} />
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <form action={acceptJoinRequestAction}>
                    <input type="hidden" name="requestId" value={req.id} />
                    <button
                      type="submit"
                      className="inline-flex cursor-pointer items-center justify-center rounded-control bg-electric-blue-strong px-4 py-1.5 text-xs font-bold text-white transition hover:bg-zk-ink"
                    >
                      Accept
                    </button>
                  </form>
                  <form action={rejectJoinRequestAction}>
                    <input type="hidden" name="requestId" value={req.id} />
                    <ConfirmSubmitButton
                      aria-label={`Reject request from ${displayName}`}
                      variant="danger-secondary"
                      confirm={{
                        title: `Reject request from ${displayName}?`,
                        body: "They will not be added as a collaborator to this project. They can re-apply later.",
                        confirmLabel: "Reject request",
                      }}
                    >
                      Reject
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </div>

              {req.message ? (
                <div className="rounded-xl border border-zk-border bg-zk-card px-3 py-2 text-xs text-zk-text2">
                  <span className="font-semibold text-zk-text">Note: </span>
                  {req.message}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
