import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { AGENT_MESSAGE_MAX, listAgentThread } from "@/lib/agent-messages";
import { agentPicturePath } from "@/lib/agents/profile";
import { issueHref } from "@/lib/issue-ref";
import { MANAGE_AGENTS_HREF } from "@/lib/header-nav";
import { LocalTime } from "@/components/local-time";
import { AgentPicture } from "@/components/agent-picture";
import { SendMessageForm } from "@/app/(app)/agent/[username]/message-forms";

const link = "font-semibold text-zk-accent hover:underline";
const muted = "text-sm text-zk-muted";

/**
 * Messages (#605) in the Inbox: the one place you write to your agents. Pick
 * one of your agents on the left; its conversation with you (your messages,
 * and the questions it asked you) is on the right, with a box to write to it.
 */
export async function MessagesView({ agent: selected }: { agent?: string }) {
  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  const agents = tenantId
    ? await prisma.agent.findMany({
        where: { tenantId, ownerUserId: user.id, revokedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, username: true, avatar: true, picture: { select: { updatedAt: true } } },
      })
    : [];
  if (agents.length === 0) {
    return (
      <p className={muted}>
        You have no agents to write to yet.{" "}
        <Link href={MANAGE_AGENTS_HREF} className={link}>
          Add one
        </Link>
      </p>
    );
  }
  const current = agents.find((agent) => agent.username === selected) ?? agents[0];
  const thread = await listAgentThread(user, current.id);

  return (
    <div className="grid gap-5 md:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label="Your agents">
        <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:block md:space-y-0.5 md:px-0">
          {agents.map((agent) => {
            const on = agent.id === current.id;
            return (
              <li key={agent.id}>
                <Link
                  href={`/inbox?tab=messages&agent=${encodeURIComponent(agent.username)}`}
                  aria-current={on ? "page" : undefined}
                  className={`flex items-center gap-2.5 whitespace-nowrap rounded-xl px-2.5 py-2 text-sm font-semibold transition ${
                    on ? "bg-zk-tint text-zk-text" : "text-zk-text2 hover:bg-zk-chip hover:text-zk-text"
                  }`}
                >
                  <AgentPicture
                    agentId={agent.id}
                    avatar={agent.avatar}
                    pictureUrl={agent.picture ? agentPicturePath(agent, agent.picture.updatedAt, "web") : null}
                    name={agent.name}
                    size={28}
                  />
                  <span className="truncate">{agent.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-labelledby="messages-heading" className="min-w-0 rounded-[20px] border border-zk-border bg-zk-surface p-4 sm:p-6">
        <h2 id="messages-heading" className="text-base font-extrabold text-zk-text">
          {current.name}
        </h2>
        <p className={`mt-1 ${muted}`}>Messages reach it through its inbox. Its questions to you appear here too.</p>
        {!thread || thread.entries.length === 0 ? (
          <p className={`mt-4 ${muted}`}>Nothing yet.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {thread.entries.map((entry) =>
              entry.kind === "question" ? (
                <li key={`question-${entry.id}`} className="rounded-[16px] border border-zk-border bg-zk-chip/40 p-4">
                  <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-zk-muted">
                    <span>
                      <span className="font-semibold text-zk-text">{current.name}</span> asked
                      {entry.bug ? (
                        <>
                          {" "}about{" "}
                          <Link href={issueHref(entry.bug)} className={link}>
                            {entry.bug.title}
                          </Link>
                        </>
                      ) : null}
                    </span>
                    <LocalTime date={entry.createdAt} />
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zk-text">{entry.body}</p>
                  {entry.answeredAt ? (
                    <div className="mt-2 border-t border-zk-divider pt-2">
                      <p className="text-xs text-zk-muted">
                        You answered <LocalTime date={entry.answeredAt} />
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zk-text">{entry.answer}</p>
                    </div>
                  ) : (
                    <Link href={`/inbox/escalations/${entry.id}`} className={`mt-2 inline-block text-sm ${link}`}>
                      Answer →
                    </Link>
                  )}
                </li>
              ) : (
                <li key={`message-${entry.id}`} className="rounded-[16px] border border-zk-border bg-zk-tint/70 p-4 sm:ml-8">
                  <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-zk-muted">
                    <span>
                      <span className="font-semibold text-zk-text">{entry.from.id === user.id ? "You" : entry.from.name}</span> wrote
                      {entry.readAt ? " · read" : ""}
                    </span>
                    <LocalTime date={entry.createdAt} />
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zk-text">{entry.body}</p>
                </li>
              ),
            )}
          </ol>
        )}
        <div className="mt-4 border-t border-zk-divider pt-4">
          <SendMessageForm agentId={current.id} maxLength={AGENT_MESSAGE_MAX} />
        </div>
      </section>
    </div>
  );
}
