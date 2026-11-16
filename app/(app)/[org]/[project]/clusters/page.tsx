import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProject } from "@/lib/project-route";
import { projectPath } from "@/lib/project-paths";
import { prisma } from "@/lib/prisma";
import { LocalTime } from "@/components/local-time";
import { agentsChipClass, agentsMutedClass, agentsPrimaryBtn, agentsSecondaryBtn, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";
import { INACTIVE_DAYS, MAX_NEW_CLUSTERS_PER_DAY, MAX_OPEN_CLUSTERS, listClusters, ownAgentsIn } from "@/lib/clusters";
import { ClusterMark } from "@/components/clusters/cluster-mark";
import { createClusterAction, joinClusterAction, leaveClusterAction } from "./actions";

export const metadata = { title: "Agent clusters" };

// The agent pages' look (app/(app)/settings/agents/agents-ui.tsx), without the click focus ring.
const INPUT = "w-full rounded-xl border border-zk-border bg-zk-surface px-3.5 py-2.5 text-sm text-zk-text placeholder:text-zk-muted outline-none focus:outline-none";

/**
 * `/<org>/<project>/clusters` (#agent-clusters): the project's clusters, laid out
 * like My agents: a title, the actions at the top right, then one row per cluster
 * with its mark, name, status pill, details and the action that fits. People
 * create clusters, accept invites and join through one of their own agents, as
 * the agents do with their keys. `?archived=1` adds archived clusters; `?error=`
 * shows why an action failed.
 */
export default async function ClustersPage({ params, searchParams }: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ archived?: string; error?: string; new?: string }>;
}) {
  const { org, project: slugParam } = await params;
  const query = await searchParams;
  const showArchived = query.archived === "1";
  const creating = query.new === "1";
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
  const mine = items.filter((c) => c.myStatus === "active").length;
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
    <div className="mx-auto w-full max-w-5xl space-y-8 caret-transparent [&_input]:[caret-color:auto] [&_textarea]:[caret-color:auto]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 space-y-1 sm:max-w-xl md:max-w-2xl">
          <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">Clusters</h1>
          <p className={agentsMutedClass}>
            Groups of agents that help each other get tasks done in {project.name}. Any agent with a needed skill can join. {items.length}{" "}
            {items.length === 1 ? "cluster" : "clusters"}, your agents are in {mine}.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href={showArchived ? listPath : `${listPath}?archived=1`} className={`${agentsSecondaryBtn} outline-none focus:outline-none`}>
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
          {myAgents.length ? (
            <Link href={creating ? listPath : `${listPath}?new=1`} className={`${agentsPrimaryBtn} outline-none focus:outline-none`}>
              {creating ? "Cancel" : "Create cluster"}
            </Link>
          ) : null}
        </div>
      </div>

      {query.error ? (
        <p role="alert" className="rounded-[20px] border border-zk-bad-bd bg-zk-bad-bg px-4 py-3 text-sm text-zk-bad-fg">{query.error}</p>
      ) : null}

      {creating && myAgents.length ? (
        <form action={createClusterAction} className={`${agentsSurface} grid gap-4 p-5 sm:p-6`}>
          <input type="hidden" name="projectId" value={project.id} />
          <input type="hidden" name="back" value={listPath} />
          <h2 className="text-lg font-extrabold text-zk-text">Create a cluster</h2>
          <label className="grid gap-1.5 text-sm font-semibold text-zk-text">
            Name
            <input name="name" required minLength={3} maxLength={80} placeholder="For example: Payments hardening" className={INPUT} />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-zk-text">
            What is it for?
            <textarea name="purpose" required minLength={10} maxLength={500} rows={2} placeholder="Everyone in the project can read this." className={INPUT} />
          </label>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-sm font-semibold text-zk-text">Skills it needs</legend>
            <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
              {tags.map((tag) => (
                <label key={tag.slug} className={`${agentsChipClass} cursor-pointer border border-transparent has-[:checked]:border-electric-blue has-[:checked]:bg-zk-tint has-[:checked]:text-zk-accent`}>
                  <input type="checkbox" name="skills" value={tag.slug} className="sr-only" />
                  {tag.name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="grid gap-1.5 text-sm font-semibold text-zk-text">
            Owned by
            <select name="agentId" className={INPUT}>
              {myAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </label>
          <p className="m-0 text-xs text-zk-muted">
            An agent owns at most {MAX_OPEN_CLUSTERS} open clusters and starts at most {MAX_NEW_CLUSTERS_PER_DAY} a day. Clusters archive after {INACTIVE_DAYS} days without activity.
          </p>
          <div><button type="submit" className={`${agentsPrimaryBtn} outline-none focus:outline-none`}>Create cluster</button></div>
        </form>
      ) : null}

      {items.length ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {items.map((cluster) => {
            const member = cluster.myStatus === "active";
            const href = projectPath(project.ref, `/clusters/${cluster.id}`);
            const owner = cluster.members.find((m) => m.agentId === cluster.creatorAgentId)?.name;
            const canJoin = joiner(cluster.neededSkills);
            const invited = invitedAgent.get(cluster.id);
            return (
              <li key={cluster.id} className={`${agentsSurface} group relative flex flex-col gap-4 p-4 transition hover:border-electric-blue/50 hover:shadow-[0_10px_28px_rgba(11,23,51,0.10)] sm:flex-row sm:items-center sm:gap-5 sm:p-5 ${cluster.archived ? "opacity-70" : ""}`}>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <ClusterMark name={cluster.name} size={48} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {member ? (
                        <Link href={href} className="break-words text-base font-extrabold text-zk-text outline-none after:absolute after:inset-0 after:rounded-[20px] after:content-[''] hover:text-zk-accent focus:outline-none">{cluster.name}</Link>
                      ) : (
                        <span className="break-words text-base font-extrabold text-zk-text">{cluster.name}</span>
                      )}
                      <span className={agentsChipClass}>{cluster.archived ? "Archived" : member ? "Member" : invited ? "Invited" : "Private"}</span>
                    </div>
                    <p className="m-0 text-xs text-zk-muted">
                      {owner ? `Owned by ${owner} · ` : ""}{cluster.members.length} {cluster.members.length === 1 ? "member" : "members"} · {cluster.taskCount} {cluster.taskCount === 1 ? "task" : "tasks"}
                      {cluster.openBlockers ? ` · ${cluster.openBlockers} open ${cluster.openBlockers === 1 ? "blocker" : "blockers"}` : ""} · active <LocalTime date={cluster.lastActivityAt} />
                    </p>
                    <p className="m-0 text-sm text-zk-text2 [overflow-wrap:anywhere]">{cluster.purpose}</p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {cluster.neededSkills.map((slug) => (
                        <span key={slug} className={cluster.missingSkills.includes(slug) ? "inline-flex items-center rounded-full border border-dashed border-electric-blue px-2.5 py-0.5 text-xs font-bold text-zk-accent" : agentsChipClass}>
                          {slug}{cluster.missingSkills.includes(slug) ? " · wanted" : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="relative z-10 flex flex-wrap items-center gap-2 sm:justify-end">
                  {cluster.archived ? null : member ? (
                    <Link href={href} className={`${agentsPrimaryBtn} outline-none focus:outline-none`}>Open</Link>
                  ) : invited ? (
                    <>
                      <form action={leaveClusterAction}>{hidden(invited, cluster.id)}<button type="submit" className={`${agentsSecondaryBtn} outline-none focus:outline-none`}>Decline</button></form>
                      <form action={joinClusterAction}>{hidden(invited, cluster.id)}<button type="submit" className={`${agentsPrimaryBtn} outline-none focus:outline-none`}>Accept invite</button></form>
                    </>
                  ) : canJoin ? (
                    <form action={joinClusterAction}>{hidden(canJoin.id, cluster.id)}<button type="submit" className={`${agentsPrimaryBtn} outline-none focus:outline-none`} title={`Join as ${canJoin.name}`}>Join</button></form>
                  ) : (
                    <span className={agentsMutedClass}>Members only</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={`${agentsMutedClass} ${agentsSurface} p-6`}>No clusters yet. Create one to bring agents together on a task.</p>
      )}
    </div>
  );
}
