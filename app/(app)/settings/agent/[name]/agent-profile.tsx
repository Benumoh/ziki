import Link from "next/link";
import type { AgentLevel } from "@prisma/client";
import { AGENT_LEVEL_LABELS } from "@/lib/agents/levels";
import { agentActionLabel } from "@/lib/agent-audit/labels";
import { LocalTime } from "@/components/local-time";
import { issueHref } from "@/lib/issue-ref";
import { RelativeTime } from "@/components/relative-time";
import { AgentAvatar } from "@/components/agent-avatar";
import { AgentPicture } from "@/components/agent-picture";
import { AboutText } from "./about-text";
import {
  agentsLink,
  agentsMutedClass,
  agentsPrimaryBtn,
  agentsSecondaryBtn,
  agentsSurface,
  levelBadgeClass,
} from "@/app/(app)/settings/agents/agents-ui";

export type AgentProfileData = {
  id: string;
  name: string;
  model: string | null;
  /** The owner's avatar pick; null wears the automatic one. */
  avatar: string | null;
  level: AgentLevel;
  revokedAt: Date | null;
  createdAt: Date;
  /** Null when the viewer owns it. */
  ownerName: string | null;
  lastActiveAt: Date | null;
  /** Its key was used in the last few minutes, worked out when the page loads. */
  activeNow: boolean;
  projects: string[];
  counts: { filed: number; claims: number; comments: number; delivered: number };
  /** Global reputation (#agent-reputation): down for penalties on its confirmations, up for upvotes on its comments. */
  reputation: number;
  /** #agent-profile: its handle, one-liner, About me, rating out of 5, picture and skills. */
  username: string | null;
  tagline: string | null;
  about: string | null;
  rating: number | null;
  pictureUrl: string | null;
  skills: Array<{ tag: string; slug: string; summary: string; description: string }>;
};

export type AgentActivityItem = {
  id: string;
  createdAt: Date;
  action: string;
  bug: { id: string; number: number; title: string; project: { slug: string } } | null;
  target: string | null;
  undone: boolean;
};

const sectionHeading = "text-base font-extrabold text-zk-text";

/**
 * Who the agent is, like a freelancer's profile: the picture, name, level,
 * how its work is reviewed, what it is, then its brief, projects and record.
 */
export function AgentProfileHeader({
  agent,
  avatarControl = null,
  reviewCount,
  instructions,
}: {
  agent: AgentProfileData;
  /** Stands in for the avatar when the viewer may change it and the agent has no picture: the avatar, opening a picker. */
  avatarControl?: React.ReactNode;
  reviewCount: number;
  /** The standing brief, shown to its owner; null hides the section. */
  instructions: string | null;
}) {
  return (
    <section aria-label="Profile" className={`${agentsSurface} space-y-8 p-5 sm:p-8`}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        {agent.pictureUrl ? (
          <AgentPicture agentId={agent.id} avatar={agent.avatar} pictureUrl={agent.pictureUrl} name={agent.name} size={120} />
        ) : (
          (avatarControl ?? <AgentAvatar agentId={agent.id} avatar={agent.avatar} size={120} />)
        )}
        <div className="min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="break-words text-3xl font-extrabold tracking-tight text-zk-text">{agent.name}</h1>
            {agent.username ? <span className="text-lg text-zk-muted">@{agent.username}</span> : null}
            <span className={levelBadgeClass(agent.level)}>{AGENT_LEVEL_LABELS[agent.level]}</span>
            {agent.revokedAt ? (
              <span className="inline-flex items-center rounded-full bg-zk-bad-bg px-2.5 py-0.5 text-xs font-bold text-zk-bad-fg">
                Revoked
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <a href="#reviews" className="inline-flex items-center gap-1.5 text-zk-text hover:underline">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="m12 2.5 2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6L2.5 9.3l6.6-.8Z" />
              </svg>
              <span className="font-bold tabular-nums">{agent.rating === null ? "No rating yet" : agent.rating.toFixed(1)}</span>
              {reviewCount ? (
                <span className="text-zk-muted underline">
                  ({reviewCount.toLocaleString()} {reviewCount === 1 ? "review" : "reviews"})
                </span>
              ) : null}
            </a>
            <span className="h-4 w-px bg-zk-divider" aria-hidden="true" />
            <span className="text-zk-text2">
              Reputation <span className="font-bold tabular-nums text-zk-text">{agent.reputation}</span>
            </span>
          </div>

          {agent.tagline ? <p className="text-base text-zk-text">{agent.tagline}</p> : null}
          {agent.model ? <p className="text-sm text-zk-text2">{agent.model}</p> : null}

          <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-zk-muted">
            <span className="inline-flex items-center gap-1.5">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21a8 8 0 0 1 16 0" />
              </svg>
              Works for {agent.ownerName ?? "you"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M3 10h18M8 3v4M16 3v4" />
              </svg>
              Added <LocalTime date={agent.createdAt} />
            </span>
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className={sectionHeading}>About me</h2>
        {agent.about ? (
          <AboutText text={agent.about} />
        ) : (
          <p className={agentsMutedClass}>{agent.name} hasn&apos;t written about itself yet.</p>
        )}
      </div>

      <div className="space-y-3">
        <h2 className={sectionHeading}>Skills</h2>
        {agent.skills.length ? (
          <ul className="grid gap-2">
            {agent.skills.map((skill) => (
              <li key={skill.slug}>
                <details className="group rounded-2xl border border-zk-border px-4 py-3 open:bg-zk-chip/40">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 [&::-webkit-details-marker]:hidden">
                    <span className="rounded-full bg-zk-chip px-3 py-1 text-sm font-semibold text-zk-text">{skill.tag}</span>
                    <span className="min-w-0 flex-1 text-sm text-zk-text2">{skill.summary}</span>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="shrink-0 text-zk-muted transition group-open:rotate-180"
                      aria-hidden="true"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-zk-text2">{skill.description}</p>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className={agentsMutedClass}>No skills listed yet.</p>
        )}
      </div>

      {instructions !== null ? (
        <div className="space-y-2">
          <h2 className={sectionHeading}>Standing instructions</h2>
          {instructions ? (
            <p className="line-clamp-4 whitespace-pre-wrap break-words text-base text-zk-text2">{instructions}</p>
          ) : (
            <p className={agentsMutedClass}>None yet. Add a brief under More about me.</p>
          )}
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className={sectionHeading}>Works on</h2>
        {agent.projects.length ? (
          <ul className="flex flex-wrap gap-2">
            {agent.projects.map((project) => (
              <li key={project} className="rounded-full border border-zk-border px-3.5 py-1.5 text-sm text-zk-text">
                {project}
              </li>
            ))}
          </ul>
        ) : (
          <p className={agentsMutedClass}>No project yet.</p>
        )}
      </div>
    </section>
  );
}

/** What the agent has done so far, as tiles: issues filed, claims, deliveries and comments. */
export function AgentStats({ counts }: { counts: AgentProfileData["counts"] }) {
  const stats = [
    { label: "Issues filed", value: counts.filed },
    { label: "Claims", value: counts.claims },
    { label: "Delivered", value: counts.delivered },
    { label: "Comments", value: counts.comments },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="flex flex-col-reverse rounded-2xl bg-zk-chip/60 px-3 py-3 text-center">
          <dt className="text-xs font-semibold text-zk-muted">{stat.label}</dt>
          <dd className="text-2xl font-extrabold tabular-nums text-zk-text">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The card beside the profile: who it is at a glance, whether it is about, and how to reach it. */
export function AgentSideCard({
  agent,
  editControl = null,
  canMessage,
}: {
  agent: AgentProfileData;
  /** "More about me", for those who may change it. */
  editControl?: React.ReactNode;
  canMessage: boolean;
}) {
  const activeNow = agent.activeNow;
  return (
    // First on a phone, so its buttons aren't below every review; beside the profile from lg up.
    <aside aria-label={`${agent.name} at a glance`} className="order-first space-y-4 lg:sticky lg:top-24 lg:order-none">
      {editControl ? <div className="grid">{editControl}</div> : null}
      <div className={`${agentsSurface} space-y-5 p-5 sm:p-6`}>
        <div className="flex items-center gap-3">
          <AgentPicture agentId={agent.id} avatar={agent.avatar} pictureUrl={agent.pictureUrl} name={agent.name} size={56} />
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold text-zk-text">{agent.name}</p>
            <p className="text-sm font-semibold text-zk-text2">
              {AGENT_LEVEL_LABELS[agent.level]}
              {agent.rating !== null ? <span className="ml-2 font-bold text-zk-text">★ {agent.rating.toFixed(1)}</span> : null}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-zk-muted">
              <span className={`h-2 w-2 rounded-full ${activeNow ? "bg-zk-ok-fg" : "bg-zk-muted/50"}`} aria-hidden="true" />
              {agent.revokedAt ? (
                "Revoked"
              ) : activeNow ? (
                "Active now"
              ) : agent.lastActiveAt ? (
                <span>
                  Last active <RelativeTime date={agent.lastActiveAt} />
                </span>
              ) : (
                "Never active"
              )}
            </p>
          </div>
        </div>
        <div className="grid gap-2.5">
          {canMessage ? (
            <a href="#conversation" className={agentsPrimaryBtn}>
              Message {agent.name}
            </a>
          ) : null}
          <a href="#activity" className={agentsSecondaryBtn}>
            See its activity
          </a>
        </div>
      </div>
    </aside>
  );
}

/** The agent's latest actions, newest first, each linked to its issue when it has one. */
export function AgentActivity({ items }: { items: AgentActivityItem[] }) {
  return (
    <section id="activity" className={`${agentsSurface} scroll-mt-24 p-4 sm:p-6`} aria-labelledby="activity-heading">
      <h2 id="activity-heading" className="text-sm font-bold uppercase tracking-[0.06em] text-zk-muted">
        Activity
      </h2>
      {items.length === 0 ? (
        <p className={`mt-3 ${agentsMutedClass}`}>No activity yet.</p>
      ) : (
        <ol className="mt-2 divide-y divide-zk-divider">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3 text-sm">
              <span className="min-w-0 text-zk-text">
                <span className="font-semibold">{agentActionLabel(item.action)}</span>
                {item.bug ? (
                  <>
                    {" "}
                    <Link href={issueHref(item.bug)} className={agentsLink}>
                      #{item.bug.number} {item.bug.title}
                    </Link>
                  </>
                ) : null}
                {item.undone ? (
                  <span className="ml-2 rounded-full bg-zk-chip px-2 py-0.5 text-xs font-bold text-zk-muted">Undone</span>
                ) : null}
              </span>
              <LocalTime date={item.createdAt} className="shrink-0 text-xs text-zk-muted" />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
