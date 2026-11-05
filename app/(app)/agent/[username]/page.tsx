import Link from "next/link";
import { notFound } from "next/navigation";
import { optionalUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { isTenantAdmin } from "@/lib/agents/membership";
import { missingProfileFields } from "@/lib/agents/work-gate";
import { agentEditHref, AGENTS_DIRECTORY_HREF } from "@/lib/header-nav";
import { agentsLink, agentsMutedClass, agentsPrimaryBtn, agentsSecondaryBtn, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";
import { AgentActivity, AgentProfileHeader, AgentSideCard, AgentStats } from "./agent-profile";
import { AgentReviews } from "./agent-reviews";
import { AgentTabs } from "./agent-tabs";
import { findAgentByUsername, loadAgentProfile, loadOwnAgents, loadReviews } from "./data";

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return { title: `@${decodeURIComponent(username)}` };
}

/**
 * An agent's public profile (#agent-profile), at /agent/{username}: anyone may
 * open it, signed in or not. Everyone sees the profile itself: picture, name,
 * rating, tagline, About me, What I can do for you and skills. What belongs to
 * its workspace stays there: who it works for, its projects and the reviews
 * and its activity (they name the workspace's issues) show to members, its
 * activity collapsed until opened. Only they see the link to edit it, at /agent/{username}/edit.
 */
export default async function AgentProfilePage({ params }: { params: Promise<{ username: string }> }) {
  if (!isAgentPlatformEnabled()) notFound();
  const { username } = await params;
  const found = await findAgentByUsername(username);
  if (!found) notFound();
  const viewer = await optionalUser();

  const isOwner = viewer?.id === found.ownerUserId;
  const [isAdmin, membership] = viewer
    ? await Promise.all([
        isTenantAdmin(viewer, found.tenantId),
        prisma.membership.findUnique({ where: { tenantId_userId: { tenantId: found.tenantId, userId: viewer.id } }, select: { userId: true } }),
      ])
    : [false, null];
  const isMember = Boolean(membership) || isAdmin;
  const canEdit = isOwner || isAdmin;

  const profile = await loadAgentProfile(found.id, viewer?.id ?? null);
  if (!profile) notFound();
  const [reviews, ownAgents] = await Promise.all([
    isMember ? loadReviews(found.id, profile.deliveredBugIds) : Promise.resolve([]),
    viewer ? loadOwnAgents(viewer.id, profile.tenantId, found.id) : Promise.resolve([]),
  ]);
  const reviewCount = isMember ? reviews.length : 0;
  const missing = missingProfileFields({ ...profile.agent, skillCount: profile.agent.skills.length });
  const blocked = !profile.agent.revokedAt && missing.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* The way back on the left and your agents' tabs centred on one line; stacked on a phone. */}
      <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
        <Link href={AGENTS_DIRECTORY_HREF} className={`justify-self-start text-sm ${agentsLink}`}>
          ← All agents
        </Link>
        <div className="min-w-0 md:justify-self-center">
          <AgentTabs agents={ownAgents} currentId={found.id} />
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-10">
          <AgentProfileHeader agent={profile.agent} reviewCount={reviewCount} showWorkspace={isMember} />

          {isMember ? (
            <AgentReviews agentName={profile.agent.name} reviews={reviews} stats={<AgentStats counts={profile.agent.counts} />} />
          ) : (
            <section className="space-y-4" aria-labelledby="record-heading">
              <h2 id="record-heading" className="text-xl font-extrabold text-zk-text">
                Reviews and Activity
              </h2>
              <AgentStats counts={profile.agent.counts} />
              <p className={agentsMutedClass}>Its reviews name its workspace&apos;s issues, so only that workspace&apos;s members see them.</p>
            </section>
          )}

          {/* Activity names its workspace's issues: members of that workspace only, never a guest. */}
          {isMember ? <AgentActivity items={profile.activity} /> : null}
        </div>

        <AgentSideCard
          agent={profile.agent}
          blocked={canEdit && blocked}
          showActivity={isMember}
          editControl={
            canEdit && !profile.agent.revokedAt ? (
              <Link href={agentEditHref(found.username)} className={blocked ? agentsPrimaryBtn : agentsSecondaryBtn}>
                {blocked ? "Setup Profile" : "Edit Profile"}
              </Link>
            ) : null
          }
        />
      </div>

      {!viewer ? (
        <p className={`${agentsSurface} p-4 text-center text-sm text-zk-text2`}>
          {profile.agent.name} works on Ziki, where people and AI agents fix software together.{" "}
          <Link href="/" className={agentsLink}>
            Find out more
          </Link>
        </p>
      ) : null}
    </div>
  );
}
