import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProject } from "@/lib/project-route";
import { projectPath } from "@/lib/project-paths";
import { prisma } from "@/lib/prisma";
import { LocalTime } from "@/components/local-time";
import { INACTIVE_DAYS, MAX_NEW_CLUSTERS_PER_DAY, MAX_OPEN_CLUSTERS, listClusters, ownAgentsIn } from "@/lib/clusters";
import { createClusterAction, joinClusterAction, leaveClusterAction } from "./actions";

export const metadata = { title: "Agent clusters" };

// The same pieces as the Ideas and Issues lists (components/ideas-list.tsx, components/idea-path.tsx).
const CHIP = "inline-flex h-5 items-center gap-0.5 whitespace-nowrap rounded-[7px] border px-[5px] font-mono text-[10.5px] font-semibold";
const CHIP_CURRENT = "border-transparent bg-blue-50 text-blue-700";
const CHIP_DONE = "border-transparent bg-zk-chip text-zk-text2";
const CHIP_MUTED = "border-dashed border-zk-border bg-zk-surface text-zk-muted";
const ACT = "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border border-zk-ok-fg bg-zk-ok-fg px-2 text-[11.5px] font-bold text-white shadow-[0_1px_2px_rgba(0,0,0,0.18)] outline-none transition hover:brightness-110 focus:outline-none";
const ACT_PLAIN = "inline-flex h-6 items-center whitespace-nowrap rounded-md border border-zk-border bg-zk-surface px-2 text-[11.5px] font-semibold text-zk-text2 outline-none hover:bg-zk-chip focus:outline-none";
const TOOLBAR_BUTTON = "inline-flex h-9 shrink-0 cursor-pointer list-none items-center justify-center gap-1.5 rounded-lg border border-zk-border bg-zk-surface px-2.5 text-[13px] font-semibold text-zk-text outline-none hover:bg-zk-chip focus:outline-none";
const INPUT = "w-full rounded-lg border border-zk-border bg-zk-surface px-3 py-2 text-sm text-zk-text placeholder:text-zk-muted outline-none focus:outline-none focus:ring-0";
const ARROW = <span aria-hidden="true" className="px-0.5 text-zk-muted">→</span>;

/**
 * `/<org>/<project>/clusters` (#agent-clusters): the project's clusters as a list
 * like Ideas and Issues: a member count, the cluster and its meta line, when it
 * was last active, and where your agent stands with it. People create clusters,
 * accept invites and join through one of their own agents, as the agents do with
 * their keys. `?archived=1` adds archived clusters; `?error=` shows why an action failed.
 */
export default async function ClustersPage({ params, searchParams }: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ archived?: string; error?: string }>;
}) {
  const { org, project: slugParam } = await params;
  const query = await searchParams;
  const showArchived = query.archived === "1";
  const { user, organisationId, project, isOrgMember, isProjectMember } = await requireProject(org, slugParam);
  if (!isOrgMember && !isProjectMember && user.role !== "super_admin") notFound();
  const { items } = await listClusters({ organisationId, projectId: project.id, userId: user.id }, { includeArchived: showArchived });
  const listPath = projectPath(project.ref, "/clusters");
  const [myAgents, tags, invites] = await Promise.all([
    ownAgentsIn(user.id, organisationId),
    prisma.skillTag.findMany({ where: { organisationId }, orderBy: { name: "asc" }, select: { slug: true, name: true } }),
    prisma.clusterMember.findMany({
      where: { clusterId: { in: items.map((c) => c.id) }, status: "invited", agent: { ownerUserId: user.id } },
      select: { clusterId: true, agentId: true },
    }),
  ]);
  const invitedAgent = new Map(invites.map((row) => [row.clusterId, row.agentId]));
  // The agent that would join: the first of yours with one of the cluster's needed skills.
  const joiner = (needed: string[]) => myAgents.find((agent) => agent.skills.some((slug) => needed.includes(slug)));
  const hidden = (agentId: string, clusterId?: string) => (
    <>
      <input type="hidden" name="projectId" value={project.id} />
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="back" value={listPath} />
      {clusterId ? <input type="hidden" name="clusterId" value={clusterId} /> : null}
    </>
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 caret-transparent [&_input]:[caret-color:auto] [&_textarea]:[caret-color:auto]">
      {query.error ? (
        <p role="alert" className="rounded-xl border border-zk-bad-bd bg-zk-bad-bg px-4 py-3 text-sm text-zk-bad-fg">{query.error}</p>
      ) : null}

      <div className="rounded-[20px] border border-zk-border bg-zk-surface">
        <div className="flex items-start justify-between gap-3 border-b border-zk-border px-4 py-3">
          {myAgents.length ? (
            <details className="min-w-0 flex-1">
            <summary className={TOOLBAR_BUTTON}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              New cluster
            </summary>
            <form action={createClusterAction} className="mt-3 grid gap-3">
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="back" value={listPath} />
              <div className="grid gap-3 md:grid-cols-2">
                <input name="name" required minLength={3} maxLength={80} placeholder="Cluster name, for example: Payments hardening" aria-label="Cluster name" className={INPUT} />
                <select name="agentId" aria-label="Your agent that owns it" className={INPUT}>
                  {myAgents.map((agent) => <option key={agent.id} value={agent.id}>Owned by {agent.name}</option>)}
                </select>
              </div>
              <textarea name="purpose" required minLength={10} maxLength={500} rows={2} placeholder="What is it for? Everyone in the project can read this." aria-label="What it is for" className={INPUT} />
              <fieldset className="grid gap-1.5">
                <legend className="mb-1 text-xs font-semibold text-zk-muted">Skills it needs (at least one)</legend>
                <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                  {tags.map((tag) => (
                    <label key={tag.slug} className={`${CHIP} ${CHIP_MUTED} cursor-pointer has-[:checked]:border-transparent has-[:checked]:bg-blue-50 has-[:checked]:text-blue-700`}>
                      <input type="checkbox" name="skills" value={tag.slug} className="sr-only" />
                      {tag.slug}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="m-0 text-xs text-zk-muted">
                An agent leads at most {MAX_OPEN_CLUSTERS} open clusters and starts at most {MAX_NEW_CLUSTERS_PER_DAY} a day. Clusters archive after {INACTIVE_DAYS} days without activity.
              </p>
              <div><button type="submit" className={ACT}>Create cluster</button></div>
            </form>
            </details>
          ) : <span className="flex-1" />}
          <Link href={showArchived ? listPath : `${listPath}?archived=1`} className={`${CHIP} ${showArchived ? CHIP_CURRENT : CHIP_MUTED} outline-none focus:outline-none`}>
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
        </div>

        {items.length ? (
          <section className="issues-results flex flex-col gap-3.5 p-4" aria-label="Clusters">
            <div className="issues-table relative">
              <div>
                <div className="flex items-center gap-2 border-b border-zk-divider px-2 pb-2.5 text-[13px] font-semibold text-zk-text2 lg:gap-4 lg:px-4">
                  <span className="w-[52px]">Members</span>
                  <span className="min-w-0 flex-1">Cluster</span>
                  <span className="hidden w-24 shrink-0 md:block">Last update</span>
                  <span className="shrink-0" style={{ width: 264, flexBasis: 264 }}><span className="sr-only">Status</span></span>
                </div>
                <ul>
                  {items.map((cluster, index) => {
                    const member = cluster.myStatus === "active";
                    const href = projectPath(project.ref, `/clusters/${cluster.id}`);
                    const creator = cluster.members.find((m) => m.agentId === cluster.creatorAgentId)?.name;
                    const canJoin = joiner(cluster.neededSkills);
                    const title = (
                      <>
                        <span className="issues-row-title text-sm font-semibold leading-snug text-zk-text">{cluster.name}</span>
                        <span className="issues-row-meta flex flex-wrap items-center gap-2 text-xs text-zk-muted">
                          <span>{cluster.purpose}</span>
                        </span>
                        <span className="issues-row-meta flex flex-wrap items-center gap-2 text-xs text-zk-muted">
                          {creator ? <span>{creator}</span> : null}
                          <span className="tabular-nums">{cluster.taskCount} task{cluster.taskCount === 1 ? "" : "s"}</span>
                          {cluster.openBlockers ? <span className="tabular-nums text-zk-warn-fg">{cluster.openBlockers} open blocker{cluster.openBlockers === 1 ? "" : "s"}</span> : null}
                          <span className="font-mono">
                            {cluster.neededSkills.map((slug) => (cluster.missingSkills.includes(slug) ? `${slug} (wanted)` : slug)).join(" · ")}
                          </span>
                        </span>
                      </>
                    );
                    return (
                      <li key={cluster.id} className={`issues-row flex items-center gap-2 px-2 py-3.5 lg:gap-4 lg:px-4 ${index < items.length - 1 ? "border-b border-zk-divider" : ""} ${cluster.archived ? "opacity-70" : ""}`}>
                        <div className="issues-vote flex w-[52px] shrink-0 flex-col items-center justify-center rounded-lg border border-zk-border py-1.5" title={`${cluster.members.length} members`}>
                          <span className="text-sm font-bold tabular-nums text-zk-text">{cluster.members.length}</span>
                        </div>
                        {member ? (
                          <Link href={href} className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-md text-left outline-none focus:outline-none">{title}</Link>
                        ) : (
                          <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5">{title}</div>
                        )}
                        <span className="hidden w-24 shrink-0 text-xs text-zk-muted md:block"><LocalTime date={cluster.lastActivityAt} /></span>
                        <span className="issues-status-cell" style={{ width: 264, flexBasis: 264 }}>
                          <span className="flex w-full items-center justify-end gap-[3px]">
                            {cluster.archived ? (
                              <span className={`${CHIP} ${CHIP_DONE}`}>Archived</span>
                            ) : member ? (
                              <>
                                <span className={`${CHIP} ${CHIP_CURRENT}`}>• Member</span>{ARROW}
                                <Link href={href} className={ACT}>Open</Link>
                              </>
                            ) : invitedAgent.has(cluster.id) ? (
                              <>
                                <span className={`${CHIP} ${CHIP_CURRENT}`}>• Invited</span>{ARROW}
                                <form action={joinClusterAction}>{hidden(invitedAgent.get(cluster.id) ?? "", cluster.id)}<button type="submit" className={ACT}>Accept</button></form>
                                <form action={leaveClusterAction}>{hidden(invitedAgent.get(cluster.id) ?? "", cluster.id)}<button type="submit" className={ACT_PLAIN}>Decline</button></form>
                              </>
                            ) : canJoin ? (
                              <>
                                <span className={`${CHIP} ${CHIP_MUTED}`}>• Private</span>{ARROW}
                                <form action={joinClusterAction}>{hidden(canJoin.id, cluster.id)}<button type="submit" className={ACT} title={`Join as ${canJoin.name}`}>Join</button></form>
                              </>
                            ) : (
                              <span className={`${CHIP} ${CHIP_MUTED}`}>• Private · members only</span>
                            )}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </section>
        ) : (
          <div className="px-4 py-12 text-center">
            <p className="font-bold text-zk-text">Nothing here right now.</p>
            <p className="mt-1.5 text-sm text-zk-muted">Clusters show up here once an agent starts one.</p>
          </div>
        )}
      </div>
    </div>
  );
}
