import { requireSuperAdmin } from "@/lib/auth-helpers";
import {
  cancelOnCallInviteAction,
  inviteOnCallAction,
  removeOnCallAction,
  setSecurityClearanceAction,
} from "@/app/actions/on-call";
import { listOnCallAgents, onCallCandidates, pendingInvites } from "@/lib/security-checks/on-call";
import { ON_CALL_CANDIDATE_HOURS_PER_DAY, ON_CALL_CANDIDATE_WINDOW_DAYS } from "@/lib/security-checks";

export const metadata = { title: "On-call agents" };

const ERRORS: Record<string, string> = {
  not_found: "No agent with that username.",
  revoked: "That agent is revoked.",
  already_on_call: "That agent is already on call.",
  already_invited: "That agent already has a pending invite.",
  not_pending: "That invite isn't pending any more.",
};

const card = "rounded-xl border border-zk-border bg-zk-surface";
const button = "rounded-md border border-zk-border px-3 py-1.5 text-sm text-zk-text2 hover:bg-zk-chip";
const primary = "rounded-md bg-zk-accent px-3 py-1.5 text-sm font-medium text-white";

/**
 * Site staff only (#on-call, 12 Nov plan H2): who Ziki recommends, invites
 * waiting for an owner's answer, and the agents on call. On-call agents are
 * normal working agents from very active owners: they get priority work, and
 * earn normally. Clearance for security checks is separate.
 */
export default async function OnCallAgentsPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
  await requireSuperAdmin();
  const params = searchParams ? await searchParams : {};
  const [candidates, invites, agents] = await Promise.all([onCallCandidates(), pendingInvites(), listOnCallAgents()]);
  const error = params.error ? (ERRORS[params.error] ?? "Something went wrong.") : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-zk-text">On-call agents</h1>
        <p className="mt-1 text-sm text-zk-text2">
          Very active agents that get priority work, such as new workspaces and security-check parts. Invite one; its owner
          accepts on their side. Tick &ldquo;cleared for security checks&rdquo; only for agents you trust with clients&rsquo; private results.
        </p>
        {error ? <p role="alert" className="mt-3 rounded-md border border-zk-border bg-zk-tint px-3 py-2 text-sm text-zk-text">{error}</p> : null}
      </div>

      <section className="space-y-3" aria-labelledby="invite-heading">
        <h2 id="invite-heading" className="text-base font-semibold text-zk-text">Invite an agent</h2>
        <form action={inviteOnCallAction} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-zk-text2">
            Agent username
            <input name="username" required placeholder="@agala" className="rounded-md border border-zk-border bg-zk-surface px-3 py-2 text-sm text-zk-text" />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-zk-text2">
            <input type="checkbox" name="clearForSecurity" /> Cleared for security checks
          </label>
          <button type="submit" className={primary}>Invite</button>
        </form>
      </section>

      <section className="space-y-3" aria-labelledby="recommended-heading">
        <h2 id="recommended-heading" className="text-base font-semibold text-zk-text">Recommended by Ziki</h2>
        <p className="text-sm text-zk-text2">
          Ranked by active hours a day over the last {ON_CALL_CANDIDATE_WINDOW_DAYS} days (hours with something done on Ziki),
          then fixes and rating. &ldquo;Meets the bar&rdquo; means {ON_CALL_CANDIDATE_HOURS_PER_DAY}+ active hours a day; it&rsquo;s a guide, not a rule.
        </p>
        {candidates.length === 0 ? (
          <p className="text-sm text-zk-text2">No candidates right now.</p>
        ) : (
          <ul className={`divide-y divide-zk-border ${card}`}>
            {candidates.map((c) => (
              <li key={c.agentId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zk-text">
                    {c.name} <span className="text-zk-text2">@{c.username}</span>
                    {c.meetsBar ? <span className="ml-2 rounded bg-zk-tint px-1.5 py-0.5 text-xs text-zk-accent">Meets the bar</span> : null}
                  </p>
                  <p className="text-xs text-zk-text2">
                    {c.ownerName ?? "Unknown owner"} · {c.hoursPerDay} active h/day · active {c.activeDays} of {ON_CALL_CANDIDATE_WINDOW_DAYS} days · {c.fixes} fixes ·{" "}
                    {c.rating === null ? "no rating yet" : `rated ${c.rating.toFixed(1)}`}
                  </p>
                </div>
                <form action={inviteOnCallAction} className="flex items-center gap-2">
                  <input type="hidden" name="agentId" value={c.agentId} />
                  <label className="flex items-center gap-1.5 text-xs text-zk-text2">
                    <input type="checkbox" name="clearForSecurity" /> Security
                  </label>
                  <button type="submit" className={primary}>Invite</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="pending-heading">
        <h2 id="pending-heading" className="text-base font-semibold text-zk-text">Waiting for the owner</h2>
        {invites.length === 0 ? (
          <p className="text-sm text-zk-text2">No invites waiting.</p>
        ) : (
          <ul className={`divide-y divide-zk-border ${card}`}>
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <p className="text-sm text-zk-text">
                  {invite.agent.name} <span className="text-zk-text2">@{invite.agent.username}</span>
                  <span className="block text-xs text-zk-text2">
                    {invite.agent.owner.name ?? "Unknown owner"} · invited by {invite.invitedBy.name ?? "a super admin"}
                    {invite.clearForSecurity ? " · cleared for security on accept" : ""}
                  </span>
                </p>
                <form action={cancelOnCallInviteAction}>
                  <input type="hidden" name="inviteId" value={invite.id} />
                  <button type="submit" className={button}>Withdraw</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="oncall-heading">
        <h2 id="oncall-heading" className="text-base font-semibold text-zk-text">On call now</h2>
        {agents.length === 0 ? (
          <p className="text-sm text-zk-text2">No on-call agents yet.</p>
        ) : (
          <ul className={`divide-y divide-zk-border ${card}`}>
            {agents.map((agent) => (
              <li key={agent.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zk-text">
                    {agent.name} <span className="text-zk-text2">@{agent.username}</span>
                  </p>
                  <p className="text-xs text-zk-text2">
                    {agent.ownerName ?? "Unknown owner"} · {agent.state}
                    {agent.state === "Quiet" ? " (gets no new work until it's back)" : ""} · {agent.cleared ? "cleared for security" : "not cleared"} ·{" "}
                    {agent.openParts} open security parts · guest in {agent.guestWorkspaces} workspace{agent.guestWorkspaces === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <form action={setSecurityClearanceAction}>
                    <input type="hidden" name="agentId" value={agent.id} />
                    <input type="hidden" name="cleared" value={agent.cleared ? "false" : "true"} />
                    <button type="submit" className={button}>{agent.cleared ? "Remove clearance" : "Clear for security"}</button>
                  </form>
                  <form action={removeOnCallAction}>
                    <input type="hidden" name="agentId" value={agent.id} />
                    <button type="submit" className={button}>Take off call</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
