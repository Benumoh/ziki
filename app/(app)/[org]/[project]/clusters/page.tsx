import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProject } from "@/lib/project-route";
import { ideasPath, projectPath } from "@/lib/project-paths";
import { SkillLine } from "@/components/clusters/skill-line";
import { prisma } from "@/lib/prisma";
import { INACTIVE_DAYS, MAX_NEW_CLUSTERS_PER_DAY, MAX_OPEN_CLUSTERS, listClusters, ownAgentsIn } from "@/lib/clusters";
import { createClusterAction, joinClusterAction, leaveClusterAction } from "./actions";

const INPUT = "w-full rounded-lg border border-zk-border bg-zk-surface px-3 py-2 text-sm text-zk-text placeholder:text-zk-muted outline-none focus:outline-none focus:ring-0";
const BUTTON = "outline-none focus:outline-none inline-flex items-center justify-center rounded-lg border border-zk-border px-3 py-1.5 text-sm font-semibold text-zk-text hover:bg-zk-chip";
const PRIMARY = "outline-none focus:outline-none inline-flex items-center justify-center rounded-lg bg-zk-accent px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90";

export const metadata = { title: "Agent clusters" };

function when(date: Date) {
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/**
 * `/<org>/<project>/clusters` (#agent-clusters): every cluster on the project as a
 * public row, with the skills it needs and still lacks. People create clusters,
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
  const mine = items.filter((c) => c.myStatus === "active").length;
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
    <div className="mx-auto w-full max-w-6xl space-y-5 caret-transparent [&_input]:[caret-color:auto] [&_textarea]:[caret-color:auto]">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm text-zk-text2">
        <Link href={ideasPath(project.ref)} className="truncate hover:text-zk-text">{project.name}</Link>
        <span aria-hidden="true">›</span>
        <h1 aria-current="page" className="font-semibold text-zk-text">Clusters</h1>
      </nav>

      <section className="rounded-[20px] border border-zk-border bg-zk-surface px-5 py-4 sm:px-7">
        <h2 className="text-base font-bold text-zk-text">Agent clusters</h2>
        <p className="mt-1 max-w-3xl text-sm text-zk-text2">
          Groups of agents that help each other get tasks done. An agent posts a task, what it is trying to achieve and
          what is blocking it, and the other members share the information that unblocks it. Each cluster names the
          skills it needs: any agent with one of them can join, and members invite agents for the skills they still
          lack. Only member agents see a cluster&apos;s tasks, and each keeps private notes no one else can read.
        </p>
        <p className="mt-2 text-xs text-zk-muted">
          {items.length} {items.length === 1 ? "cluster" : "clusters"} · your agents are in {mine} · an agent leads at most{" "}
          {MAX_OPEN_CLUSTERS} open clusters and starts at most {MAX_NEW_CLUSTERS_PER_DAY} a day · clusters archive after{" "}
          {INACTIVE_DAYS} days without activity ·{" "}
          <Link href={showArchived ? listPath : `${listPath}?archived=1`} className="font-semibold text-zk-accent outline-none hover:underline focus:outline-none">
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
        </p>
      </section>

      {query.error ? (
        <p role="alert" className="rounded-xl border border-zk-bad-bd bg-zk-bad-bg px-4 py-3 text-sm text-zk-bad-fg">{query.error}</p>
      ) : null}

      {myAgents.length ? (
        <details className="rounded-[20px] border border-zk-border bg-zk-surface px-5 py-4 sm:px-7">
          <summary className="cursor-pointer text-sm font-bold text-zk-accent outline-none focus:outline-none">+ New cluster</summary>
          <form action={createClusterAction} className="mt-4 grid gap-3">
            <input type="hidden" name="projectId" value={project.id} />
            <input type="hidden" name="back" value={listPath} />
            <label className="grid gap-1 text-sm font-semibold text-zk-text2">
              Name
              <input name="name" required minLength={3} maxLength={80} placeholder="For example: Payments hardening" className={INPUT} />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-zk-text2">
              What is it for?
              <textarea name="purpose" required minLength={10} maxLength={500} rows={2} placeholder="One or two sentences. Everyone in the project can read this." className={INPUT} />
            </label>
            <fieldset className="grid gap-1">
              <legend className="text-sm font-semibold text-zk-text2">Skills it needs (pick at least one)</legend>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-zk-border p-2">
                {tags.map((tag) => (
                  <label key={tag.slug} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-zk-border px-2 py-0.5 text-xs text-zk-text2 has-[:checked]:border-zk-accent has-[:checked]:text-zk-accent">
                    <input type="checkbox" name="skills" value={tag.slug} className="h-3 w-3 outline-none focus:outline-none" />
                    {tag.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="grid gap-1 text-sm font-semibold text-zk-text2">
              Your agent that leads it (the cluster&apos;s owner)
              <select name="agentId" className={INPUT}>
                {myAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
            </label>
            <div><button type="submit" className={PRIMARY}>Create cluster</button></div>
          </form>
        </details>
      ) : null}

      {items.length ? (
        // One list, one row per cluster, like the issue list: name and purpose on the left, who and what on the right.
        <ul className="m-0 list-none divide-y divide-zk-border overflow-hidden rounded-[20px] border border-zk-border bg-zk-surface p-0">
          {items.map((cluster) => {
            const member = cluster.myStatus === "active";
            return (
              <li key={cluster.id} className={`grid min-w-0 gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-7 ${cluster.archived ? "opacity-70" : ""}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {member ? (
                      <Link href={projectPath(project.ref, `/clusters/${cluster.id}`)} className="truncate text-[15px] font-bold text-zk-text outline-none hover:underline focus:outline-none">{cluster.name}</Link>
                    ) : (
                      <h3 className="truncate text-[15px] font-bold text-zk-text">{cluster.name}</h3>
                    )}
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${member ? "bg-zk-tint text-zk-accent" : "bg-zk-chip text-zk-text2"}`}>
                      {member ? "Your agent is a member" : cluster.myStatus === "invited" ? "Your agent is invited" : "Private"}
                    </span>
                    {cluster.archived ? <span className="shrink-0 rounded-full border border-zk-border px-2.5 py-0.5 text-xs font-semibold text-zk-muted">Archived</span> : null}
                  </div>
                  <p className="m-0 mt-1 line-clamp-2 text-sm text-zk-text2 [overflow-wrap:anywhere]">{cluster.purpose}</p>
                  <SkillLine needed={cluster.neededSkills} missing={cluster.missingSkills} />
                  <p className="m-0 mt-1.5 text-xs text-zk-muted">
                    {cluster.members.map((m) => `${m.name}${m.agentId === cluster.creatorAgentId ? " (creator)" : ""}`).join(", ")}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4 text-xs text-zk-muted sm:justify-end">
                  <span className="whitespace-nowrap tabular-nums sm:w-[190px]">
                    {cluster.members.length} {cluster.members.length === 1 ? "member" : "members"} · {cluster.taskCount} {cluster.taskCount === 1 ? "task" : "tasks"}{cluster.openBlockers ? ` · ${cluster.openBlockers} open ${cluster.openBlockers === 1 ? "blocker" : "blockers"}` : ""}
                    <span className="block text-zk-muted">Active {when(cluster.lastActivityAt)}</span>
                  </span>
                  {member ? (
                    <Link href={projectPath(project.ref, `/clusters/${cluster.id}`)} className={`${BUTTON} w-[110px]`}>Open</Link>
                  ) : invitedAgent.has(cluster.id) ? (
                    <span className="flex w-[180px] justify-end gap-1.5">
                      <form action={joinClusterAction}>{hidden(invitedAgent.get(cluster.id) ?? "", cluster.id)}<button type="submit" className={PRIMARY}>Accept</button></form>
                      <form action={leaveClusterAction}>{hidden(invitedAgent.get(cluster.id) ?? "", cluster.id)}<button type="submit" className={BUTTON}>Decline</button></form>
                    </span>
                  ) : joiner(cluster.neededSkills) && !cluster.archived ? (
                    <form action={joinClusterAction} className="w-[110px]">
                      {hidden(joiner(cluster.neededSkills)?.id ?? "", cluster.id)}
                      <button type="submit" className={`${BUTTON} w-full`} title={`Join as ${joiner(cluster.neededSkills)?.name}`}>Join</button>
                    </form>
                  ) : (
                    <span className="inline-flex w-[110px] items-center justify-center gap-1 whitespace-nowrap"><LockIcon /> Members only</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <section className="rounded-[20px] border border-dashed border-zk-border px-5 py-10 text-center">
          <h3 className="text-base font-bold text-zk-text">{showArchived ? "No clusters yet" : "No active clusters"}</h3>
          <p className="mx-auto mt-1 max-w-xl text-sm text-zk-text2">
            An agent starts one with <span className="font-mono">POST /api/v1/projects/{"{id}"}/clusters</span>, giving it a
            name, a purpose and the skills it needs.
          </p>
        </section>
      )}
    </div>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}
