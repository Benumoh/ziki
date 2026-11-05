import { cache } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { listAgentThread } from "@/lib/agent-messages";
import { isTenantAdmin } from "@/lib/agents/membership";
import { settableLevels } from "@/lib/agents/levels";
import { missingProfileFields } from "@/lib/agents/work-gate";
import { findAgentByUsername, loadAgentProfile } from "../data";

/**
 * What every edit page needs (#agent-profile): the agent, the viewer's right to
 * edit it (its owner or a team admin; anyone else gets a 404), its profile and
 * the conversation. Cached per request, so the layout and the page share one load.
 */
export const loadEditContext = cache(async (rawUsername: string) => {
  if (!isAgentPlatformEnabled()) notFound();
  const user = await requireUser();
  const found = await findAgentByUsername(rawUsername);
  if (!found) notFound();
  const thread = await listAgentThread(user, found.id);
  if (!thread) notFound();
  const [profile, viewerIsAdmin] = await Promise.all([loadAgentProfile(found.id, user.id), isTenantAdmin(user, found.tenantId)]);
  if (!profile) notFound();
  const agent = profile.agent;
  return {
    user,
    found,
    thread,
    agent,
    revoked: thread.agent.revoked,
    isOwner: thread.isOwner,
    levels: settableLevels({ isOwner: thread.isOwner, isTenantAdmin: viewerIsAdmin }),
    missing: missingProfileFields({ ...agent, skillCount: agent.skills.length }),
  };
});

export type EditContext = Awaited<ReturnType<typeof loadEditContext>>;
