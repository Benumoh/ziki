import Link from "next/link";
import { notFound } from "next/navigation";
import { optionalUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { isAdminOfOrganisation } from "@/lib/agents/membership";
import { missingProfileFields } from "@/lib/agents/work-gate";
import { agentEditHref, AGENTS_DIRECTORY_HREF, MANAGE_AGENTS_HREF } from "@/lib/header-nav";
import { agentsLink, agentsMutedClass, agentsPrimaryBtn, agentsSecondaryBtn, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";
import { AgentActivity, AgentProfileHeader, AgentSideCard, AgentStats } from "./agent-profile";
import { AgentReviews } from "./agent-reviews";
import { AgentTabs } from "./agent-tabs";
import { findAgentByUsername, loadAgentProfile, loadAgentStuckContext, loadOwnAgents, loadReviews } from "./data";
import { agentProfileJsonLd, agentProfileMetadata } from "@/lib/seo/agents";
import { JsonLd } from "@/components/json-ld";
import { AgentKeyPanel } from "./agent-key-panel";
import { loadOwnerKey } from "./owner-key";
import { AgentActivationButton } from "@/app/(app)/settings/agents/agent-activation-button";
import { LiveRefresh } from "@/components/live-refresh";
import { workModeSettingsPath } from "@/lib/agents/work-mode";
import { GetStartedCard } from "./get-started-card";
import { loadGetStarted, setupWaiting } from "./get-started-data";

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return agentProfileMetadata(username);
}

/**
 * An agent's public profile (#agent-profile), at /agent/{username}: anyone may
 * open it, signed in or not. Everyone sees the profile itself: picture, name,
 * rating, tagline, About me, What I can do for you and skills. What belongs to
 * its organisation stays there: who it works for, its projects and the reviews
 * and its activity (they name the organisation's issues) show to members, its
 * activity collapsed until opened. Only they see the link to edit it, at /agent/{username}/edit.
 */
export default async function AgentProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ connect?: string | string[] }>;
}) {
  if (!isAgentPlatformEnabled()) notFound();
  const { username } = await params;
  const viewer = await optionalUser();
  const found = await findAgentByUsername(username, viewer?.id ?? null);
  if (!found) notFound();
  const organisationId = found.organisationId;

  const isOwner = viewer?.id === found.ownerUserId;
  // #user-agents: members of the organisation the page shows it in see what it did there.
  const [isAdmin, membership] = viewer && organisationId
    ? await Promise.all([
        isAdminOfOrganisation(viewer, organisationId),
        prisma.membership.findUnique({ where: { organisationId_userId: { organisationId, userId: viewer.id } }, select: { userId: true } }),
      ])
    : [false, null];
  const isMember = Boolean(membership) || isAdmin;
  const canEdit = isOwner || isAdmin;

  const profile = await loadAgentProfile(found.id, viewer?.id ?? null, organisationId);
  if (!profile) notFound();
  const [reviews, ownAgents, stuckContext] = await Promise.all([
    isMember ? loadReviews(found.id, profile.deliveredBugIds) : Promise.resolve([]),
    viewer ? loadOwnAgents(viewer.id, found.id) : Promise.resolve([]),
    isMember && viewer && organisationId
      ? loadAgentStuckContext({ agentId: found.id, organisationId, viewer })
      : Promise.resolve(null),
  ]);
  const reviewCount = isMember ? reviews.length : 0;
  // #seo-agents: structured data for a public (set-up, not revoked) profile only.
  const jsonLd = await agentProfileJsonLd(username);
  // Its key is its owner's alone: not even a team admin is shown it. It is the key for the organisation you are in.
  const viewerOrganisation = found.viewerOrganisation;
  const ownerKey =
    isOwner && !profile.agent.revokedAt && viewerOrganisation && found.activeForViewer ? await loadOwnerKey(found.id, viewerOrganisation.id) : null;
  // #agent-get-started: its owner guides it from here too, in the organisation they are in.
  const getStarted =
    isOwner && !profile.agent.revokedAt && viewerOrganisation && found.activeForViewer
      ? await loadGetStarted({ id: found.id, name: profile.agent.name }, viewerOrganisation.id)
      : null;
  const missing = missingProfileFields({ ...profile.agent, skillCount: profile.agent.skills.length });
  const blocked = !profile.agent.revokedAt && missing.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
      {/* The way back on the left and your agents' tabs centred on one line; stacked on a phone. */}
      <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
        {/* Back to your own agents from one of them; to every agent from anyone else's. */}
        <Link href={isOwner ? MANAGE_AGENTS_HREF : AGENTS_DIRECTORY_HREF} className={`justify-self-start text-sm ${agentsLink}`}>
          {isOwner ? "← My agents" : "← All agents"}
        </Link>
        <div className="min-w-0 md:justify-self-center">
          <AgentTabs agents={ownAgents} currentId={found.id} />
        </div>
      </div>

      {/* What its owner can do now comes first, above the profile and on a phone above the side card too. */}
      {getStarted ? <GetStartedCard state={getStarted} settingsHref={workModeSettingsPath(found.username)} /> : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-10">
          <AgentProfileHeader agent={profile.agent} reviewCount={reviewCount} showOrganisation={isMember} />

          {isMember ? (
            <AgentReviews agentName={profile.agent.name} reviews={reviews} stats={<AgentStats counts={profile.agent.counts} />} />
          ) : (
            <section className="space-y-4" aria-labelledby="record-heading">
              <h2 id="record-heading" className="text-xl font-extrabold text-zk-text">
                Reviews and Activity
              </h2>
              <AgentStats counts={profile.agent.counts} />
              <p className={agentsMutedClass}>Its reviews name its organisation&apos;s issues, so only that organisation&apos;s members see them.</p>
            </section>
          )}

          {/* Activity names its organisation's issues: members of that organisation only, never a guest. */}
          {isMember ? <AgentActivity items={profile.activity} /> : null}
        </div>

        <AgentSideCard
          agent={profile.agent}
          stuckContext={stuckContext}
          blocked={canEdit && blocked}
          showActivity={isMember}
          keyPanel={
            ownerKey && viewerOrganisation ? (
              <AgentKeyPanel
                agentId={found.id}
                agentName={profile.agent.name}
                liveKey={ownerKey.liveKey}
                startOpen={(await searchParams).connect === "1"}
                organisationName={viewerOrganisation.name}
              />
            ) : isOwner && !profile.agent.revokedAt && viewerOrganisation ? (
              <section className={`${agentsSurface} space-y-3 p-5 sm:p-6`} aria-label={`Bring ${profile.agent.name} into ${viewerOrganisation.name}`}>
                <p className={agentsMutedClass}>
                  {profile.agent.name} doesn&apos;t work in {viewerOrganisation.name}. Bring it in to work in every project here.
                </p>
                <AgentActivationButton
                  agentId={found.id}
                  agentName={profile.agent.name}
                  organisationId={viewerOrganisation.id}
                  organisationName={viewerOrganisation.name}
                  active={false}
                />
              </section>
            ) : null
          }
          editControl={
            canEdit && !profile.agent.revokedAt ? (
              <Link href={agentEditHref(found.username)} className={blocked ? agentsPrimaryBtn : agentsSecondaryBtn}>
                {blocked ? "Setup Profile" : "Edit Profile"}
              </Link>
            ) : null
          }
        />
      </div>
      {/* Keeps the card current as the agent answers in its terminal and its work arrives: every few
          seconds while a question is open in both places, so an answer there moves this page on too. */}
      {stuckContext || getStarted ? <LiveRefresh everyMs={getStarted && setupWaiting(getStarted) ? 3_000 : undefined} /> : null}

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
