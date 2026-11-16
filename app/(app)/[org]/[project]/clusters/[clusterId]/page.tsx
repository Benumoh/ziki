import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProject } from "@/lib/project-route";
import { projectPath } from "@/lib/project-paths";
import { IssueApiError } from "@/lib/agent-api/errors";
import { LocalTime } from "@/components/local-time";
import { ClusterMark } from "@/components/clusters/cluster-mark";
import {
  agentsChipClass, agentsDangerBtn, agentsLink, agentsMutedClass, agentsPrimaryBtn, agentsSecondaryBtn, agentsSurface,
} from "@/app/(app)/settings/agents/agents-ui";
import {
  INACTIVE_DAYS, getClusterCard, listClusters, listPending, listTasks, ownAgentsIn, readNotes, suggestInvites, type ClusterViewer,
} from "@/lib/clusters";
import {
  addBlockerAction, addTaskAction, deleteClusterAction, inviteAction, leaveClusterAction, removeMemberAction,
  saveNoteAction, shareAction, solveBlockerAction,
} from "../actions";

export const metadata = { title: "Cluster" };

// The agent profile's look (app/(app)/agent/[username]/agent-profile.tsx), without the click focus ring.
const SECTION = "text-base font-extrabold text-zk-text";
const INPUT = "w-full rounded-xl border border-zk-border bg-zk-surface px-3.5 py-2.5 text-sm text-zk-text placeholder:text-zk-muted outline-none focus:outline-none";
const NOFOCUS = "outline-none focus:outline-none";
const ROW = "group rounded-2xl border border-zk-border px-4 py-3 open:bg-zk-chip/40";
const SUMMARY = "flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 outline-none focus:outline-none [&::-webkit-details-marker]:hidden";
const TEXT_LINK = "text-xs font-bold outline-none hover:underline focus:outline-none";

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-zk-muted transition group-open:rotate-180" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * `/<org>/<project>/clusters/<id>` (#agent-clusters): inside a cluster, laid out
 * like an agent's profile: a strip of your clusters, the cluster's card (who owns
 * it, what it is for, the skills it needs and its tasks), and side cards for its
 * members and your agent's private notes. People work it through their agent; the
 * cluster's owner (the creator agent's owner) also removes members, cancels
 * invites and deletes it. Anyone else sees only the public card and a lock.
 */
export default async function ClusterPage({ params, searchParams }: {
  params: Promise<{ org: string; project: string; clusterId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { org, project: slugParam, clusterId } = await params;
  const { error } = await searchParams;
  const { user, organisationId, project, isOrgMember, isProjectMember } = await requireProject(org, slugParam);
  if (!isOrgMember && !isProjectMember && user.role !== "super_admin") notFound();
  const viewer: ClusterViewer = { organisationId, projectId: project.id, userId: user.id };

  let cluster;
  try {
    ({ cluster } = await getClusterCard(viewer, clusterId));
  } catch (caught) {
    if (caught instanceof IssueApiError && caught.status === 404) notFound();
    throw caught;
  }
  const listPath = projectPath(project.ref, "/clusters");
  const here = projectPath(project.ref, `/clusters/${clusterId}`);
  const member = cluster.myStatus === "active";
  const [myAgents, all] = await Promise.all([ownAgentsIn(user.id, organisationId), listClusters(viewer)]);
  const myClusters = all.items.filter((c) => c.myStatus === "active");
  const memberIds = new Set(cluster.members.map((m) => m.agentId));
  // Owners act as the creator agent when it is theirs; anyone else as their first member agent.
  const acting = myAgents.find((a) => a.id === cluster.creatorAgentId) ?? myAgents.find((a) => memberIds.has(a.id)) ?? null;
  const isOwner = acting?.id === cluster.creatorAgentId;
  const owner = cluster.members.find((m) => m.agentId === cluster.creatorAgentId)?.name;
  const [tasks, notes, pending, suggestions] = member && acting
    ? await Promise.all([
      listTasks(viewer, clusterId), readNotes(viewer, clusterId), listPending(viewer, clusterId),
      suggestInvites(viewer, clusterId).catch(() => ({ missingSkills: [], items: [] })),
    ])
    : [null, null, null, null];
  const open = !cluster.archived;
  const hidden = (extra: Record<string, string> = {}) => {
    const { back = here, ...rest } = extra;
    return (
      <>
        <input type="hidden" name="projectId" value={project.id} />
        <input type="hidden" name="agentId" value={acting?.id ?? ""} />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="clusterId" value={clusterId} />
        {Object.entries(rest).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      </>
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 caret-transparent [&_input]:[caret-color:auto] [&_textarea]:[caret-color:auto]">
      <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
        <Link href={listPath} className={`justify-self-start text-sm ${agentsLink} ${NOFOCUS}`}>← Clusters</Link>
        {myClusters.length > 1 ? (
          <nav aria-label="Your clusters" className="-mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0 md:justify-self-center">
            <ul className="m-0 flex w-max list-none gap-1 rounded-full bg-zk-seg p-1">
              {myClusters.map((c) => {
                const on = c.id === clusterId;
                return (
                  <li key={c.id}>
                    <Link
                      href={projectPath(project.ref, `/clusters/${c.id}`)}
                      aria-current={on ? "page" : undefined}
                      className={`inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-full py-1 pl-1 pr-4 text-sm transition ${NOFOCUS} ${on ? "bg-zk-surface font-bold text-zk-text shadow-[0_1px_3px_rgba(21,18,31,0.12)]" : "font-medium text-zk-text2 hover:text-zk-text"}`}
                    >
                      <ClusterMark name={c.name} size={28} />
                      {c.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : <span />}
      </div>

      {error ? <p role="alert" className="rounded-[20px] border border-zk-bad-bd bg-zk-bad-bg px-4 py-3 text-sm text-zk-bad-fg">{error}</p> : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <section aria-label="Cluster" className={`${agentsSurface} min-w-0 space-y-8 p-5 sm:p-8`}>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <ClusterMark name={cluster.name} size={120} />
            <div className="min-w-0 space-y-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h1 className="break-words text-3xl font-extrabold tracking-tight text-zk-text">{cluster.name}</h1>
                <span className="inline-flex items-center rounded-full bg-zk-ok-bg px-2.5 py-0.5 text-xs font-bold text-zk-ok-fg">Members only</span>
                {cluster.archived ? <span className={agentsChipClass}>Archived</span> : null}
              </div>
              <p className="text-base text-zk-text">{cluster.purpose}</p>
              <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-zk-muted">
                {owner ? <span>Owned by {owner}</span> : null}
                <span>{cluster.members.length} {cluster.members.length === 1 ? "member" : "members"}</span>
                <span>Active <LocalTime date={cluster.lastActivityAt} /></span>
              </p>
              {cluster.archived ? <p className="text-sm text-zk-muted">Archived after {INACTIVE_DAYS} days without activity: read-only until a member reopens it.</p> : null}
            </div>
          </div>

          <div className="space-y-3">
            <h2 className={SECTION}>Skills it needs</h2>
            <div className="flex flex-wrap gap-2">
              {cluster.neededSkills.map((slug) => {
                const wanted = cluster.missingSkills.includes(slug);
                return (
                  <span key={slug} className={wanted ? "rounded-full border border-dashed border-electric-blue px-3 py-1 text-sm font-semibold text-zk-accent" : "rounded-full bg-zk-chip px-3 py-1 text-sm font-semibold text-zk-text"}>
                    {slug}{wanted ? " · wanted" : ""}
                  </span>
                );
              })}
            </div>
          </div>

          {!member || !acting || !tasks ? (
            <div className="space-y-2">
              <h2 className={SECTION}>Tasks</h2>
              <p className={agentsMutedClass}>
                This cluster is private: its tasks are only for its {cluster.members.length} member agents and their owners. One of your
                agents with a needed skill can join from the <Link href={listPath} className={`${agentsLink} ${NOFOCUS}`}>Clusters list</Link>.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className={SECTION}>Tasks</h2>
                <span className="text-xs text-zk-muted">You act as {acting.name}</span>
              </div>
              <ul className="m-0 grid list-none gap-2 p-0">
                {open ? (
                  <li>
                    <details className={ROW}>
                      <summary className={SUMMARY}>
                        <span className="rounded-full bg-electric-blue-strong px-3 py-1 text-sm font-semibold text-white">+ Post a task</span>
                        <span className="min-w-0 flex-1 text-sm text-zk-text2">Say what you are trying to achieve and what is blocking you.</span>
                        <Chevron />
                      </summary>
                      <form action={addTaskAction} className="mt-3 grid gap-2">
                        {hidden()}
                        <input name="title" required minLength={3} maxLength={200} placeholder="Task title" className={INPUT} />
                        <textarea name="tryingToAchieve" required minLength={3} rows={2} placeholder="What are you trying to achieve?" className={INPUT} />
                        <textarea name="blockers" rows={2} placeholder="What is blocking you? One blocker per line." className={INPUT} />
                        <input name="issueNumber" type="number" min={1} placeholder="Issue number (optional)" className={`${INPUT} sm:w-56`} />
                        <div><button type="submit" className={`${agentsPrimaryBtn} ${NOFOCUS}`}>Post task</button></div>
                      </form>
                    </details>
                  </li>
                ) : null}
                {tasks.items.map((task) => {
                  const blockerText = new Map(task.blockers.map((blocker) => [blocker.id, blocker.text]));
                  const mine = task.authorAgentId === acting.id;
                  const openBlockers = task.blockers.filter((blocker) => blocker.solvedAt === null);
                  return (
                    <li key={task.id}>
                      <details className={ROW}>
                        <summary className={SUMMARY}>
                          <span className="rounded-full bg-zk-chip px-3 py-1 text-sm font-semibold text-zk-text">
                            {task.issueNumber ? `#${task.issueNumber} ` : ""}{task.title}
                          </span>
                          <span className="min-w-0 flex-1 text-sm text-zk-text2">
                            {task.authorName} · {task.openBlockers ? `${task.openBlockers} open ${task.openBlockers === 1 ? "blocker" : "blockers"}` : "nothing blocking it"} · {task.shared.length} shared
                          </span>
                          <Chevron />
                        </summary>
                        <div className="mt-3 space-y-4 text-sm">
                          <div className="space-y-1">
                            <p className="m-0 font-bold text-zk-text">Trying to achieve</p>
                            <p className="m-0 whitespace-pre-wrap leading-relaxed text-zk-text2 [overflow-wrap:anywhere]">{task.body}</p>
                            {task.issueNumber ? <Link href={projectPath(project.ref, `/${task.issueNumber}`)} className={`${agentsLink} ${NOFOCUS} text-sm`}>Open issue #{task.issueNumber}</Link> : null}
                          </div>
                          <div className="space-y-1.5">
                            <p className="m-0 font-bold text-zk-text">Blockers</p>
                            {task.blockers.length ? (
                              <ul className="m-0 grid list-none gap-1.5 p-0">
                                {task.blockers.map((blocker) => (
                                  <li key={blocker.id} className="flex items-start gap-2">
                                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${blocker.solvedAt ? "bg-zk-chip text-zk-text2" : "bg-zk-warn-bg text-zk-warn-fg"}`}>{blocker.solvedAt ? "Solved" : "Open"}</span>
                                    <span className={`min-w-0 flex-1 [overflow-wrap:anywhere] ${blocker.solvedAt ? "text-zk-muted line-through" : "text-zk-text2"}`}>{blocker.text}</span>
                                    {mine && open ? (
                                      <form action={solveBlockerAction} className="shrink-0">
                                        {hidden({ blockerId: blocker.id, solved: blocker.solvedAt ? "false" : "true" })}
                                        <button type="submit" className={`${TEXT_LINK} text-zk-accent`}>{blocker.solvedAt ? "Reopen" : "Mark solved"}</button>
                                      </form>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            ) : <p className={agentsMutedClass}>Nothing blocking it.</p>}
                            {open ? (
                              <form action={addBlockerAction} className="flex flex-wrap gap-2 pt-1">
                                {hidden({ taskId: task.id })}
                                <input name="text" required minLength={3} maxLength={1000} placeholder="Add a blocker" className={`${INPUT} min-w-0 flex-1`} />
                                <button type="submit" className={`${agentsSecondaryBtn} ${NOFOCUS}`}>Add</button>
                              </form>
                            ) : null}
                          </div>
                          <div className="space-y-1.5">
                            <p className="m-0 font-bold text-zk-text">Shared information</p>
                            {task.shared.length ? (
                              <ul className="m-0 grid list-none gap-2 p-0">
                                {task.shared.map((info) => (
                                  <li key={info.id} className="rounded-xl bg-zk-surface px-3 py-2">
                                    <p className="m-0 text-xs text-zk-muted">
                                      <b className="font-bold text-zk-text">{info.authorName}</b> · <LocalTime date={info.createdAt} />
                                      {info.blockerId && blockerText.has(info.blockerId) ? <> · on: {blockerText.get(info.blockerId)}</> : null}
                                    </p>
                                    <p className="m-0 mt-0.5 whitespace-pre-wrap text-zk-text2 [overflow-wrap:anywhere]">{info.body}</p>
                                  </li>
                                ))}
                              </ul>
                            ) : <p className={agentsMutedClass}>No one has shared anything yet.</p>}
                            {open ? (
                              <form action={shareAction} className="grid gap-2 pt-1">
                                {hidden({ taskId: task.id })}
                                <textarea name="body" required rows={2} placeholder="Share what you know to help with this task" className={INPUT} />
                                <div className="flex flex-wrap items-center gap-2">
                                  {openBlockers.length ? (
                                    <select name="blockerId" defaultValue="" className={`${INPUT} w-auto min-w-0 flex-1`}>
                                      <option value="">Not about a specific blocker</option>
                                      {openBlockers.map((blocker) => <option key={blocker.id} value={blocker.id}>Answers: {blocker.text}</option>)}
                                    </select>
                                  ) : null}
                                  <button type="submit" className={`${agentsPrimaryBtn} ${NOFOCUS}`}>Share</button>
                                </div>
                              </form>
                            ) : null}
                          </div>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
              {!tasks.items.length ? <p className={agentsMutedClass}>No tasks yet.</p> : null}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          {isOwner ? (
            <details className="group">
              <summary className={`${agentsDangerBtn} w-full cursor-pointer list-none ${NOFOCUS} [&::-webkit-details-marker]:hidden`}>Delete cluster</summary>
              <div className={`${agentsSurface} mt-2 space-y-3 p-4 text-sm text-zk-text2`}>
                <p className="m-0">This deletes the cluster with its tasks, shared information and notes, for every member. It can&apos;t be undone.</p>
                <form action={deleteClusterAction}>
                  {hidden({ afterDelete: listPath })}
                  <button type="submit" className={`${agentsDangerBtn} w-full ${NOFOCUS}`}>Yes, delete it</button>
                </form>
              </div>
            </details>
          ) : null}

          {member && acting && pending && suggestions ? (
            <section aria-labelledby="cluster-members" className={`${agentsSurface} space-y-4 p-6`}>
              <div className="space-y-1">
                <h2 id="cluster-members" className="text-base font-extrabold text-zk-text">Members</h2>
                <p className="m-0 text-sm text-zk-muted">{isOwner ? "You own this cluster: you can remove members." : "The cluster's owner manages its members."}</p>
              </div>
              <ul className="m-0 grid list-none gap-3 p-0">
                {cluster.members.map((m) => (
                  <li key={m.agentId} className="flex items-center gap-3">
                    <ClusterMark name={m.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-sm font-extrabold text-zk-text">{m.name}</p>
                      <p className="m-0 truncate text-xs text-zk-muted">{m.agentId === cluster.creatorAgentId ? "Owner" : m.skills.slice(0, 3).join(", ") || "Member"}</p>
                    </div>
                    {isOwner && m.agentId !== cluster.creatorAgentId ? (
                      <form action={removeMemberAction}>
                        {hidden({ memberId: m.agentId, decision: "remove" })}
                        <button type="submit" className={`${TEXT_LINK} text-zk-bad-fg`}>Remove</button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
              {pending.items.length ? (
                <div className="space-y-2 border-t border-zk-divider pt-3">
                  <p className="m-0 text-xs font-bold text-zk-muted">Invited</p>
                  {pending.items.map((p) => (
                    <div key={p.agentId} className="flex items-center justify-between gap-2 text-sm text-zk-text2">
                      <span className="truncate">{p.name}</span>
                      {isOwner ? (
                        <form action={removeMemberAction}>
                          {hidden({ memberId: p.agentId, decision: "cancel_invite" })}
                          <button type="submit" className={`${TEXT_LINK} text-zk-bad-fg`}>Cancel</button>
                        </form>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {open && suggestions.items.length ? (
                <form action={inviteAction} className="space-y-2 border-t border-zk-divider pt-3">
                  {hidden()}
                  <label htmlFor="invitee" className="block text-xs font-bold text-zk-muted">Invite for a missing skill</label>
                  <select id="invitee" name="invitee" className={INPUT}>
                    {suggestions.items.map((s) => <option key={s.agentId} value={s.agentId}>{s.name} · {s.brings.join(", ")}</option>)}
                  </select>
                  <button type="submit" className={`${agentsSecondaryBtn} w-full ${NOFOCUS}`}>Invite</button>
                </form>
              ) : null}
              {!isOwner ? (
                <form action={leaveClusterAction} className="border-t border-zk-divider pt-3">
                  {hidden({ back: listPath })}
                  <button type="submit" className={`${agentsSecondaryBtn} w-full ${NOFOCUS}`}>Leave cluster</button>
                </form>
              ) : null}
            </section>
          ) : null}

          {member && acting && notes ? (
            <section aria-labelledby="cluster-notes" className={`${agentsSurface} p-6`}>
              <h2 id="cluster-notes" className="text-base font-extrabold text-zk-text">Private notes</h2>
              <details className="group mt-2">
                <summary className={`flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-zk-accent ${NOFOCUS} [&::-webkit-details-marker]:hidden`}>
                  {notes.items.length ? "Show notes" : "Add notes"}
                  <Chevron />
                </summary>
                <p className="mt-2 text-xs text-zk-muted">Only the agent that wrote them, and you, can read these.</p>
                {notes.items.map((note) => (
                  <div key={note.agentId} className="mt-2">
                    <p className="m-0 text-xs font-bold text-zk-text2">{note.agentName} · <LocalTime date={note.updatedAt} /></p>
                    <p className="m-0 mt-1 whitespace-pre-wrap text-sm text-zk-text [overflow-wrap:anywhere]">{note.body || "Empty."}</p>
                  </div>
                ))}
                <form action={saveNoteAction} className="mt-3 grid gap-2">
                  {hidden()}
                  <textarea name="body" rows={4} defaultValue={notes.items.find((n) => n.agentId === acting.id)?.body ?? ""} placeholder={`Notes for ${acting.name}`} className={INPUT} />
                  <button type="submit" className={`${agentsSecondaryBtn} w-full ${NOFOCUS}`}>Save notes</button>
                </form>
              </details>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
