import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { issueHref } from "@/lib/issue-ref";
import { LocalTime } from "@/components/local-time";
import {
  getUserEligibleAgents,
  supportThreadVisibilityWhere,
} from "@/lib/support-threads";
import {
  TakeRequestControls,
  AgentReplyComposer,
  RequesterFollowUpComposer,
  ReleaseRequestButton,
  ResolveRequestButton,
} from "./requests-actions";

const link = "font-semibold text-zk-accent hover:underline";
const muted = "text-sm text-zk-muted";

export async function RequestsView({ thread: selectedId }: { thread?: string }) {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) {
    return <p className={muted}>Join a workspace to view requests.</p>;
  }

  const [eligibleAgents, visibilityWhere] = await Promise.all([
    getUserEligibleAgents(user.id, organisationId),
    supportThreadVisibilityWhere(user.id, organisationId),
  ]);

  const rawThreads = await prisma.supportThread.findMany({
    where: visibilityWhere,
    orderBy: { lastMessageAt: "desc" },
    take: 50,
    include: {
      requester: { select: { id: true, name: true } },
      assigneeAgent: { select: { id: true, name: true, username: true, ownerUserId: true } },
      bug: {
        select: {
          id: true,
          number: true,
          title: true,
          project: { select: { slug: true, organisation: { select: { slug: true } } } },
        },
      },
    },
  });

  if (rawThreads.length === 0) {
    return <p className={muted}>No requests yet.</p>;
  }

  // Order: open first, then by lastMessageAt desc
  const threads = [...rawThreads].sort((a, b) => {
    if (a.status === "open" && b.status !== "open") return -1;
    if (a.status !== "open" && b.status === "open") return 1;
    return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
  });

  // A link to a thread that isn't listed here (older than the 50 shown, in another
  // organisation, or no longer visible) opens the newest one instead of a 404.
  const current = (selectedId ? threads.find((t) => t.id === selectedId) : undefined) ?? threads[0];

  const messages = await prisma.threadMessage.findMany({
    where: { threadId: current.id },
    orderBy: { createdAt: "asc" },
    include: {
      authorUser: { select: { id: true, name: true } },
      authorAgent: { select: { id: true, name: true } },
    },
  });

  const isRequester = current.requesterUserId === user.id;
  const isAssigneeOwner = current.assigneeAgent?.ownerUserId === user.id;

  return (
    <div className="grid gap-5 md:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label="Requests">
        <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:block md:space-y-0.5 md:px-0">
          {threads.map((thread) => {
            const on = thread.id === current.id;
            const tagStyle =
              thread.status === "open"
                ? "bg-zk-warn-bg text-zk-warn-fg"
                : thread.status === "taken"
                  ? "bg-zk-info-bg text-zk-info-fg"
                  : "bg-zk-ok-bg text-zk-ok-fg";
            const tagLabel =
              thread.status === "open" ? "Waiting" : thread.status === "taken" ? "Taken" : "Resolved";

            return (
              <li key={thread.id}>
                <Link
                  href={`/inbox?tab=requests&thread=${encodeURIComponent(thread.id)}`}
                  aria-current={on ? "page" : undefined}
                  className={`block rounded-xl px-2.5 py-2 text-sm transition ${
                    on ? "bg-zk-tint text-zk-text" : "text-zk-text2 hover:bg-zk-chip hover:text-zk-text"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate font-semibold">
                      #{thread.bug.number} · {thread.requester.name}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${tagStyle}`}>
                      {tagLabel}
                    </span>
                  </div>
                  <p className="truncate text-xs text-zk-muted">{thread.bug.title}</p>
                  {thread.assigneeAgent ? (
                    <p className="truncate text-[11px] font-medium text-zk-muted">
                      Assigned: {thread.assigneeAgent.name}
                    </p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <section
        aria-labelledby="request-heading"
        className="min-w-0 rounded-panel border border-zk-border bg-zk-surface p-4 sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zk-divider pb-3">
          <span
            role="status"
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              current.status === "open"
                ? "bg-zk-warn-bg text-zk-warn-fg"
                : current.status === "taken"
                  ? "bg-zk-info-bg text-zk-info-fg"
                  : "bg-zk-ok-bg text-zk-ok-fg"
            }`}
          >
            {current.status === "open"
              ? "Waiting for a manager agent"
              : current.status === "taken"
                ? `Assigned: ${current.assigneeAgent?.name}`
                : "Resolved"}
          </span>

          <div className="flex items-center gap-2">
            {current.status === "taken" && isAssigneeOwner ? (
              <ReleaseRequestButton threadId={current.id} />
            ) : null}
            {current.status !== "resolved" && (isRequester || isAssigneeOwner) ? (
              <ResolveRequestButton threadId={current.id} />
            ) : null}
          </div>
        </div>

        <div className="mt-3">
          <h2 id="request-heading" className="text-base font-extrabold text-zk-text">
            <Link href={issueHref(current.bug)} className={link}>
              #{current.bug.number} {current.bug.title}
            </Link>
          </h2>
          <p className={`mt-0.5 text-xs text-zk-muted`}>
            Requested by {isRequester ? "You" : current.requester.name} ·{" "}
            <LocalTime date={current.createdAt} />
            {current.resolvedReason ? ` · Resolved (${current.resolvedReason})` : ""}
          </p>
        </div>

        <ol className="mt-4 space-y-3">
          {messages.map((msg) => {
            const isResponder = Boolean(msg.authorAgentId);
            const authorDisplayName = msg.authorAgent
              ? msg.authorAgent.name
              : msg.authorUserId === user.id
                ? "You"
                : msg.authorUser.name;

            return (
              <li
                key={msg.id}
                className={`rounded-panel border border-zk-border p-4 ${
                  isResponder ? "bg-zk-tint/70 sm:ml-8" : "bg-zk-chip/40"
                }`}
              >
                <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-zk-muted">
                  <span className="font-semibold text-zk-text">{authorDisplayName}</span>
                  <LocalTime date={msg.createdAt} />
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zk-text">{msg.body}</p>
              </li>
            );
          })}
        </ol>

        {/* Action / Composer Area */}
        <div className="mt-5 border-t border-zk-divider pt-4">
          {current.status === "open" ? (
            !isRequester ? (
              <TakeRequestControls threadId={current.id} eligibleAgents={eligibleAgents} />
            ) : (
              <div className="space-y-4">
                <p className={muted}>
                  Your request is waiting for a manager or merger agent to take it. You can add more details below.
                </p>
                <RequesterFollowUpComposer threadId={current.id} />
              </div>
            )
          ) : current.status === "taken" ? (
            isAssigneeOwner ? (
              <AgentReplyComposer threadId={current.id} agentName={current.assigneeAgent!.name} />
            ) : isRequester ? (
              <RequesterFollowUpComposer threadId={current.id} />
            ) : (
              <p className={muted}>This request is being handled by {current.assigneeAgent?.name}.</p>
            )
          ) : (
            <p className={muted}>This request has been resolved.</p>
          )}
        </div>
      </section>
    </div>
  );
}

