import Link from "next/link";
import { agentEditHref, agentPageHref } from "@/lib/header-nav";
import { agentsLink } from "@/app/(app)/settings/agents/agents-ui";
import { AgentPicture } from "@/components/agent-picture";
import { EditNav, type EditNavGroup } from "./edit-nav";
import { loadEditContext } from "./context";

/**
 * The edit pages' frame (#agent-profile): the agent, a way back to its public
 * profile, and a sidebar with one page per part, the most used first. What
 * people see comes first (profile, skills, picture), then its private
 * settings (instructions, level, look). Messages to it live in the Inbox.
 */
export default async function AgentEditLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const { found, agent, missing, revoked, isOwner } = await loadEditContext(username);
  const base = agentEditHref(found.username);
  const needsProfile = missing.some((field) => field !== "skills");
  const needsSkills = missing.includes("skills");

  const groups: EditNavGroup[] = [
    {
      group: "Public profile",
      items: [
        { href: base, label: "Profile", hint: needsProfile ? "Needed" : undefined },
        { href: `${base}/skills`, label: "Skills", hint: needsSkills ? "Needed" : undefined },
        { href: `${base}/picture`, label: "Picture" },
      ],
    },
    {
      group: "Settings",
      items: [
        ...(isOwner ? [{ href: `${base}/instructions`, label: "Instructions" }] : []),
        { href: `${base}/level`, label: "Level" },
        { href: `${base}/look`, label: "Look" },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link href={agentPageHref(found.username)} className="group flex min-w-0 items-center gap-3">
          <AgentPicture agentId={found.id} avatar={agent.avatar} pictureUrl={agent.pictureUrl} name={agent.name} size={48} />
          <span className="min-w-0">
            <span className="block truncate text-xl font-extrabold tracking-tight text-zk-text">{agent.name}</span>
            <span className={`block text-sm ${agentsLink}`}>View public profile →</span>
          </span>
        </Link>
      </div>

      {revoked ? (
        <p role="status" className="rounded-2xl bg-zk-bad-soft p-4 text-sm font-semibold text-zk-bad-fg">
          This agent is revoked. Its profile and settings can&apos;t be changed.
        </p>
      ) : missing.length ? (
        <p role="status" className="rounded-2xl border border-zk-bad-bd bg-zk-bad-soft p-4 text-sm text-zk-text2">
          <span className="font-extrabold text-zk-bad-fg">{agent.name} is blocked.</span> It can&apos;t do any work until its profile is
          set up.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-8">
        <EditNav groups={groups} />
        <div className="min-w-0 rounded-[20px] border border-zk-border bg-zk-surface p-5 sm:p-8">{children}</div>
      </div>
    </div>
  );
}
