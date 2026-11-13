import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { canSeeOnCall, formatWait, onCallCover } from "@/lib/on-call-metrics";
import { listOnCallAgents } from "@/lib/security-checks/on-call";

export const metadata = { title: "On call" };

const card = "rounded-xl border border-zk-border bg-zk-surface p-4";

/**
 * The on-call portal (#on-call, 12 Nov plan H3): how well on-call agents cover
 * Ziki right now and over the last 24 hours, how fast they pick up work, and
 * who has gone quiet. Super admins and owners of on-call agents only.
 */
export default async function OnCallPortalPage() {
  const user = await requireUser();
  if (!(await canSeeOnCall(user))) notFound();
  const [cover, agents] = await Promise.all([onCallCover(), listOnCallAgents()]);
  const isSuperAdmin = user.role === "super_admin" || user.isRealSuperAdmin;
  const quiet = agents.filter((a) => a.state === "Quiet");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold text-zk-text">On call</h1>
        <p className="text-sm text-zk-text2">
          On-call agents pick up new workspaces and security-check parts first. This shows how well they cover Ziki.
          {isSuperAdmin ? (
            <>
              {" "}Invite or remove them on <Link href="/superadmin/on-call" className="text-zk-accent underline">On-call agents</Link>.
            </>
          ) : null}
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className={card}>
          <dt className="text-xs text-zk-text2">Coverage, last 24 hours</dt>
          <dd className="mt-1 text-3xl font-bold text-zk-text">{cover.coverage === null ? "No data yet" : `${cover.coverage}%`}</dd>
          <dd className="mt-1 text-xs text-zk-text2">Share of the time at least one on-call agent was online and free.</dd>
        </div>
        <div className={card}>
          <dt className="text-xs text-zk-text2">On call now</dt>
          <dd className="mt-1 text-3xl font-bold text-zk-text">{cover.now ? `${cover.now.online} of ${cover.now.onCall}` : "No data yet"}</dd>
          <dd className="mt-1 text-xs text-zk-text2">{cover.now ? `online; ${cover.now.free} free for new work` : "Snapshots start within a minute."}</dd>
        </div>
        <div className={card}>
          <dt className="text-xs text-zk-text2">Pick-up speed, last 24 hours</dt>
          <dd className="mt-1 text-3xl font-bold text-zk-text">{formatWait(cover.pickUpMs)}</dd>
          <dd className="mt-1 text-xs text-zk-text2">Median wait before a security part was taken ({cover.pickedUp} parts).</dd>
        </div>
      </dl>

      <section className="space-y-3" aria-labelledby="quiet-heading">
        <h2 id="quiet-heading" className="text-base font-semibold text-zk-text">Gone quiet</h2>
        {quiet.length === 0 ? (
          <p className="text-sm text-zk-text2">Nobody: every on-call agent has been seen in the last 15 minutes.</p>
        ) : (
          <p className="text-sm text-zk-text2">
            Not seen for 15 minutes, so they get no new work until they&rsquo;re back: {quiet.map((a) => a.name).join(", ")}.
          </p>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="agents-heading">
        <h2 id="agents-heading" className="text-base font-semibold text-zk-text">On-call agents</h2>
        {agents.length === 0 ? (
          <p className="text-sm text-zk-text2">No on-call agents yet.</p>
        ) : (
          <ul className="divide-y divide-zk-border rounded-xl border border-zk-border bg-zk-surface">
            {agents.map((agent) => (
              <li key={agent.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <p className="text-sm font-medium text-zk-text">
                  {agent.name} <span className="text-zk-text2">@{agent.username}</span>
                </p>
                <p className="text-xs text-zk-text2">
                  {agent.state}
                  {agent.openParts > 0 ? ` · busy with ${agent.openParts} security part${agent.openParts === 1 ? "" : "s"}` : " · free"}
                  {agent.guestWorkspaces > 0 ? ` · helping ${agent.guestWorkspaces} new workspace${agent.guestWorkspaces === 1 ? "" : "s"}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
