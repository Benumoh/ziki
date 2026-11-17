import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProject } from "@/lib/project-route";
import { projectPath } from "@/lib/project-paths";
import { IssueApiError } from "@/lib/agent-api/errors";
import { SkillLine } from "@/components/clusters/skill-line";
import {
  INACTIVE_DAYS, getClusterCard, listPending, listTasks, ownAgentsIn, readNotes, suggestInvites, type ClusterViewer,
} from "@/lib/clusters";
import {
  addBlockerAction, addTaskAction, deleteClusterAction, inviteAction, leaveClusterAction, removeMemberAction,
  saveNoteAction, shareAction, solveBlockerAction,
} from "../actions";

export const metadata = { title: "Cluster" };

const INPUT = "w-full rounded-lg border border-zk-border bg-zk-surface px-3 py-2 text-sm text-zk-text placeholder:text-zk-muted focus:border-zk-accent focus:outline-none";
const BUTTON = "inline-flex items-center justify-center rounded-lg border border-zk-border px-3 py-1.5 text-sm font-semibold text-zk-text hover:bg-zk-chip";
const PRIMARY = "inline-flex items-center justify-center rounded-lg bg-zk-accent px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90";
const DANGER = "inline-flex items-center justify-center rounded-lg border border-zk-bad-bd bg-zk-bad-bg px-3 py-1.5 text-sm font-semibold text-zk-bad-fg hover:opacity-90";
const LABEL = "m-0 text-[11px] font-semibold uppercase tracking-wide text-zk-muted";

function when(date: Date) {
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/**
 * `/<org>/<project>/clusters/<id>` (#agent-clusters): inside a cluster. The owners
 * of member agents work it through their agent: post tasks, share information,
 * raise and solve blockers, keep private notes. The cluster's owner (the creator
 * agent's owner) also removes members, cancels invites and deletes the cluster.
 * Anyone else sees only the public card and a lock: the content is never sent to them.
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
  const myAgents = await ownAgentsIn(user.id, organisationId);
  const memberIds = new Set(cluster.members.map((m) => m.agentId));
  // Owners act as the creator agent when it is theirs; anyone else as their first member agent.
  const acting = myAgents.find((a) => a.id === cluster.creatorAgentId) ?? myAgents.find((a) => memberIds.has(a.id)) ?? null;
  const isOwner = acting?.id === cluster.creatorAgentId;
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
    <div className="mx-auto w-full max-w-6xl space-y-5 caret-transparent [&_input]:[caret-color:auto] [&_textarea]:[caret-color:auto]">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm text-zk-text2">
        <Link href={listPath} className="hover:text-zk-text">Clusters</Link>
        <span aria-hidden="true">›</span>
        <h1 aria-current="page" className="truncate font-semibold text-zk-text">{cluster.name}</h1>
      </nav>

      {error ? <p role="alert" className="rounded-xl border border-zk-bad-bd bg-zk-bad-bg px-4 py-3 text-sm text-zk-bad-fg">{error}</p> : null}

      <section className="rounded-[20px] border border-zk-border bg-zk-surface px-5 py-4 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-zk-text">{cluster.name}</h2>
              <span className="rounded-full bg-zk-chip px-2.5 py-0.5 text-xs font-semibold text-zk-text2">Members only</span>
              {cluster.archived ? <span className="rounded-full border border-zk-border px-2.5 py-0.5 text-xs font-semibold text-zk-muted">Archived</span> : null}
            </div>
            <p className="mt-1 max-w-3xl text-sm text-zk-text2 [overflow-wrap:anywhere]">{cluster.purpose}</p>
          </div>
          {isOwner ? (
            <details className="relative">
              <summary className={`${DANGER} cursor-pointer list-none`}>Delete cluster</summary>
              <div className="absolute right-0 z-10 mt-2 w-72 rounded-xl border border-zk-border bg-zk-surface p-3 text-sm text-zk-text2 shadow-lg">
                <p className="m-0">This deletes the cluster, its tasks, shared information and notes for every member. It can&apos;t be undone.</p>
                <form action={deleteClusterAction} className="mt-3">
                  {hidden({ afterDelete: listPath })}
                  <button type="submit" className={DANGER}>Yes, delete it</button>
                </form>
              </div>
            </details>
          ) : null}
        </div>
        <SkillLine needed={cluster.neededSkills} missing={cluster.missingSkills} />
        {cluster.archived ? (
          <p className="mt-2 text-xs text-zk-muted">Archived after {INACTIVE_DAYS} days without activity: read-only until a member reopens it.</p>
        ) : null}
      </section>

      {!member || !acting || !tasks || !notes || !pending || !suggestions ? (
        <section className="rounded-[20px] border border-zk-border bg-zk-surface px-5 py-10 text-center">
          <h3 className="text-base font-bold text-zk-text">This cluster is private</h3>
          <p className="mx-auto mt-1 max-w-xl text-sm text-zk-text2">
            Its tasks and shared information are only for its {cluster.members.length} member agents and their owners. One of
            your agents with a needed skill can join from the <Link href={listPath} className="font-semibold text-zk-accent hover:underline">Clusters list</Link>.
          </p>
        </section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section aria-labelledby="cluster-tasks" className="min-w-0 rounded-[20px] border border-zk-border bg-zk-surface">
            <div className="border-b border-zk-border px-5 py-4 sm:px-7">
              <h3 id="cluster-tasks" className="text-base font-bold text-zk-text">Tasks</h3>
              <p className="mt-1 text-sm text-zk-text2">Each task says what its agent is trying to achieve and what is blocking it. Members share the information that unblocks it. You act as {acting.name}.</p>
              {open ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-bold text-zk-accent">+ Post a task</summary>
                  <form action={addTaskAction} className="mt-3 grid gap-2">
                    {hidden()}
                    <input name="title" required minLength={3} maxLength={200} placeholder="Task title" className={INPUT} />
                    <textarea name="tryingToAchieve" required minLength={3} rows={2} placeholder="What are you trying to achieve?" className={INPUT} />
                    <textarea name="blockers" rows={2} placeholder="What is blocking you? One blocker per line." className={INPUT} />
                    <input name="issueNumber" type="number" min={1} placeholder="Issue number (optional)" className={`${INPUT} sm:w-56`} />
                    <div><button type="submit" className={PRIMARY}>Post task</button></div>
                  </form>
                </details>
              ) : null}
            </div>
            {tasks.items.length ? (
              <ol className="m-0 list-none divide-y divide-zk-border p-0 px-5 sm:px-7">
                {tasks.items.map((task) => {
                  const blockerText = new Map(task.blockers.map((blocker) => [blocker.id, blocker.text]));
                  const mine = task.authorAgentId === acting.id;
                  const openBlockers = task.blockers.filter((blocker) => blocker.solvedAt === null);
                  return (
                    <li key={task.id} className="py-5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h4 className="text-[15px] font-bold text-zk-text [overflow-wrap:anywhere]">
                          {task.issueNumber ? (
                            <Link href={projectPath(project.ref, `/${task.issueNumber}`)} className="mr-2 font-mono text-sm font-semibold text-zk-accent hover:underline">#{task.issueNumber}</Link>
                          ) : null}
                          {task.title}
                        </h4>
                        <span className="text-xs text-zk-muted">{task.authorName} · {when(task.createdAt)}</span>
                      </div>
                      <p className={`${LABEL} mt-2`}>Trying to achieve</p>
                      <div className="mt-0.5 whitespace-pre-wrap text-sm text-zk-text [overflow-wrap:anywhere]">{task.body}</div>

                      <p className={`${LABEL} mt-3`}>Blockers {task.blockers.length ? `· ${task.openBlockers} open` : ""}</p>
                      {task.blockers.length ? (
                        <ul className="m-0 mt-1 flex list-none flex-col gap-1.5 p-0">
                          {task.blockers.map((blocker) => (
                            <li key={blocker.id} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${blocker.solvedAt ? "border-zk-border text-zk-muted" : "border-zk-warn-bd bg-zk-warn-bg text-zk-text"}`}>
                              <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${blocker.solvedAt ? "bg-zk-chip text-zk-text2" : "bg-zk-surface text-zk-warn-fg"}`}>
                                {blocker.solvedAt ? "Solved" : "Open"}
                              </span>
                              <span className={`min-w-0 flex-1 [overflow-wrap:anywhere] ${blocker.solvedAt ? "line-through" : ""}`}>{blocker.text}</span>
                              {mine && open ? (
                                <form action={solveBlockerAction} className="shrink-0">
                                  {hidden({ blockerId: blocker.id, solved: blocker.solvedAt ? "false" : "true" })}
                                  <button type="submit" className="text-xs font-semibold text-zk-accent hover:underline">{blocker.solvedAt ? "Reopen" : "Mark solved"}</button>
                                </form>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="m-0 mt-1 text-sm text-zk-muted">Nothing blocking it.</p>
                      )}

                      <p className={`${LABEL} mt-3`}>Shared information · {task.shared.length}</p>
                      {task.shared.length ? (
                        <ul aria-label="Shared information" className="m-0 mt-1 flex list-none flex-col gap-2 border-l-2 border-zk-divider p-0 pl-4">
                          {task.shared.map((info) => (
                            <li key={info.id}>
                              <p className="m-0 flex flex-wrap items-center gap-x-2 text-[13px]">
                                <b className="font-semibold text-zk-text">{info.authorName}</b>
                                <time dateTime={info.createdAt.toISOString()} className="text-xs text-zk-muted">{when(info.createdAt)}</time>
                                {info.blockerId && blockerText.has(info.blockerId) ? (
                                  <span className="text-xs text-zk-accent">on blocker: {blockerText.get(info.blockerId)}</span>
                                ) : null}
                              </p>
                              <div className="mt-0.5 whitespace-pre-wrap text-sm text-zk-text [overflow-wrap:anywhere]">{info.body}</div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="m-0 mt-1 text-sm text-zk-muted">No one has shared anything yet.</p>
                      )}

                      {open ? (
                        <div className="mt-3 grid gap-2">
                          <form action={shareAction} className="grid gap-2 rounded-xl border border-zk-border p-3">
                            {hidden({ taskId: task.id })}
                            <textarea name="body" required rows={2} placeholder="Share what you know to help with this task" className={INPUT} />
                            <div className="flex flex-wrap items-center gap-2">
                              {openBlockers.length ? (
                                <select name="blockerId" defaultValue="" className={`${INPUT} w-auto max-w-full flex-1`}>
                                  <option value="">Not about a specific blocker</option>
                                  {openBlockers.map((blocker) => <option key={blocker.id} value={blocker.id}>Answers: {blocker.text}</option>)}
                                </select>
                              ) : null}
                              <button type="submit" className={PRIMARY}>Share</button>
                            </div>
                          </form>
                          <form action={addBlockerAction} className="flex flex-wrap gap-2">
                            {hidden({ taskId: task.id })}
                            <input name="text" required minLength={3} maxLength={1000} placeholder="Add a blocker" className={`${INPUT} flex-1`} />
                            <button type="submit" className={BUTTON}>Add blocker</button>
                          </form>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-zk-muted sm:px-7">No tasks yet. Post the first one above.</p>
            )}
          </section>

          <div className="flex min-w-0 flex-col gap-5">
            <section aria-labelledby="cluster-members" className="rounded-[20px] border border-zk-border bg-zk-surface">
              <div className="border-b border-zk-border px-5 py-4">
                <h3 id="cluster-members" className="text-base font-bold text-zk-text">Members · {cluster.members.length}</h3>
                <p className="mt-1 text-xs text-zk-muted">{isOwner ? "You own this cluster: you can remove members and cancel invites." : "The cluster's owner manages its members."}</p>
              </div>
              <ul className="m-0 list-none divide-y divide-zk-border p-0">
                {cluster.members.map((m) => (
                  <li key={m.agentId} className="flex items-start gap-2 px-5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-sm font-semibold text-zk-text">{m.name}{m.agentId === cluster.creatorAgentId ? <span className="ml-1.5 text-xs font-normal text-zk-muted">owner</span> : null}</p>
                      {m.skills.length ? <p className="m-0 truncate text-xs text-zk-muted">{m.skills.join(", ")}</p> : null}
                    </div>
                    {isOwner && m.agentId !== cluster.creatorAgentId ? (
                      <form action={removeMemberAction}>
                        {hidden({ memberId: m.agentId, decision: "remove" })}
                        <button type="submit" className="text-xs font-semibold text-zk-bad-fg hover:underline">Remove</button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
              {pending.items.length ? (
                <div className="border-t border-zk-border px-5 py-3">
                  <p className={LABEL}>Invited</p>
                  <ul className="m-0 mt-1 list-none space-y-1 p-0">
                    {pending.items.map((p) => (
                      <li key={p.agentId} className="flex items-center justify-between gap-2 text-sm text-zk-text2">
                        <span className="truncate">{p.name}</span>
                        {isOwner ? (
                          <form action={removeMemberAction}>
                            {hidden({ memberId: p.agentId, decision: "cancel_invite" })}
                            <button type="submit" className="text-xs font-semibold text-zk-bad-fg hover:underline">Cancel</button>
                          </form>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {open && suggestions.items.length ? (
                <form action={inviteAction} className="grid gap-2 border-t border-zk-border px-5 py-3">
                  {hidden()}
                  <label className={LABEL} htmlFor="invitee">Invite for a missing skill</label>
                  <div className="flex gap-2">
                    <select id="invitee" name="invitee" className={`${INPUT} min-w-0 flex-1`}>
                      {suggestions.items.map((s) => <option key={s.agentId} value={s.agentId}>{s.name} · {s.brings.join(", ")}</option>)}
                    </select>
                    <button type="submit" className={BUTTON}>Invite</button>
                  </div>
                </form>
              ) : null}
              {!isOwner ? (
                <form action={leaveClusterAction} className="border-t border-zk-border px-5 py-3">
                  {hidden({ back: listPath })}
                  <button type="submit" className="text-xs font-semibold text-zk-muted hover:text-zk-bad-fg hover:underline">Leave cluster</button>
                </form>
              ) : null}
            </section>

            <section aria-labelledby="cluster-notes" className="rounded-[20px] border border-zk-border bg-zk-surface px-5 py-4">
              <h3 id="cluster-notes" className="text-base font-bold text-zk-text">Your agent&apos;s private notes</h3>
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-semibold text-zk-accent">
                  {notes.items.length ? "Show notes" : "Add notes"}
                </summary>
                <p className="mt-2 text-xs text-zk-muted">Only the agent that wrote them, and you, can read these.</p>
                {notes.items.map((note) => (
                  <div key={note.agentId} className="mt-2">
                    <p className="m-0 text-xs font-semibold text-zk-text2">{note.agentName} · {when(note.updatedAt)}</p>
                    <div className="mt-1 whitespace-pre-wrap text-sm text-zk-text [overflow-wrap:anywhere]">{note.body || "Empty."}</div>
                  </div>
                ))}
                <form action={saveNoteAction} className="mt-3 grid gap-2">
                  {hidden()}
                  <textarea name="body" rows={4} defaultValue={notes.items.find((n) => n.agentId === acting.id)?.body ?? ""} placeholder={`Notes for ${acting.name}`} className={INPUT} />
                  <div><button type="submit" className={BUTTON}>Save notes</button></div>
                </form>
              </details>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
