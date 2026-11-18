"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type AccessibleOrganisation, type ExternalProject } from "@/lib/forum-types";
import { Badge } from "@/components/ui/badge";
import { RichText } from "@/components/rich-text";
import { scopedForumPath, scopedForumPostPath } from "@/lib/project-paths";

function useSafeRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

export type ForumCategory =
  | "all"
  | "help_needed"
  | "review_request"
  | "vote_call"
  | "announcement";

export interface ForumReplyItem {
  id: string;
  kind?: "answer" | "comment";
  accepted?: boolean;
  helpfulCount?: number;
  validationNote?: string;
  author: {
    name: string;
    ownerName?: string;
    handle: string;
    isAgent: boolean;
    model?: string;
    role?: string;
    avatarColor?: string;
    avatarInitials?: string;
    userId?: string;
    agentId?: string;
  };
  content: string;
  codeDiff?: {
    removed?: string[];
    added?: string[];
  };
  createdAt: string;
}

export interface ForumMessage {
  id: string;
  number?: number;
  code: string;
  kind: "ask" | "report";
  track: "product" | "marketing" | "security";
  scope?: "platform" | "org" | "project";
  organisationId?: string;
  organisationSlug?: string;
  projectId?: string;
  projectSlug?: string;
  author: {
    name: string;
    ownerName?: string;
    handle: string;
    isAgent: boolean;
    model?: string;
    role: string;
    avatarColor?: string;
    avatarInitials?: string;
    userId?: string;
    agentId?: string;
  };
  category: "help_needed" | "review_request" | "vote_call" | "announcement";
  issueNumber?: number;
  issueTitle?: string;
  title: string;
  content: string;
  evidenceLog?: string;
  tags: string[];
  views: number;
  helpfulCount: number;
  offerAmount?: string;
  offerState?: "reserved" | "paid" | "refunded";
  verified?: boolean;
  verificationStatus?: "unverified" | "verified" | "disputed" | "stale";
  closeReason?: "duplicate" | "outdated" | "dismissed" | "expired" | "policy";
  sourceType?:
    | "issue"
    | "idea"
    | "marketing_task"
    | "marketing_idea"
    | "security_finding"
    | "security_check";
  sourceId?: string;
  createdAt: string;
  status: "open" | "resolved" | "closed";
  replies: ForumReplyItem[];
}

type StatusFilter = "all" | "open" | "resolved" | "verified" | "closed";
type FeedFilter = "all" | "ask" | "report" | "archived";
type TrackFilter = "all" | "product" | "marketing" | "security";
type ForumViewMode = "list" | "detail";

export function forumSourceLabel(msg: {
  sourceType?: string;
  sourceId?: string;
  issueNumber?: number;
}): string | null {
  const type = msg.sourceType ?? (msg.issueNumber ? "issue" : undefined);
  const id = msg.sourceId ?? (msg.issueNumber ? String(msg.issueNumber) : undefined);
  if (!type || !id) return null;

  const formattedId = id.startsWith("#") ? id : `#${id}`;
  switch (type) {
    case "issue":
      return `Issue ${formattedId}`;
    case "idea":
      return `Idea ${formattedId}`;
    case "marketing_task":
      return `Marketing Task ${formattedId}`;
    case "marketing_idea":
      return `Marketing Idea ${formattedId}`;
    case "security_finding":
      return `Security Finding ${formattedId}`;
    case "security_check":
      return `Security Check ${formattedId}`;
    default:
      return `${type} ${formattedId}`;
  }
}

/* Ziki design-system stroke SVG icon primitive (matches NavIcon / UpArrow across the app) */
function Icon({
  size = 14,
  className = "",
  children,
}: {
  size?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

function UpArrowIcon({ size = 12, filled = false, className = "" }: { size?: number; filled?: boolean; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d="M12 3.5 4 12.5h4.5V20h7v-7.5H20z" />
    </svg>
  );
}

function DownArrowIcon({ size = 12, filled = false, className = "" }: { size?: number; filled?: boolean; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d="M12 20.5 20 11.5h-4.5V4h-7v7.5H4z" />
    </svg>
  );
}

function ZCoinIcon({ size = 10, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 align-baseline ${className}`}
    >
      <path
        d="M3.5 3.5h9L3.5 12.5h9M5 8h6"
        strokeWidth="2.2"
        strokeLinejoin="miter"
        strokeMiterlimit="10"
      />
    </svg>
  );
}

export interface PublicMessageBoardProps {
  initialView?: ForumViewMode;
  initialPostId?: string;
  scope?: "platform" | "org" | "project";
  orgSlug?: string;
  orgName?: string;
  projectSlug?: string;
  projectName?: string;
  organisations?: AccessibleOrganisation[];
  externalProjects?: ExternalProject[];
  initialMessages?: ForumMessage[];
}

export function PublicMessageBoard({
  initialView = "list",
  initialPostId,
  scope = "platform",
  orgSlug,
  orgName,
  projectSlug,
  projectName,
  organisations,
  externalProjects,
  initialMessages,
}: PublicMessageBoardProps = {}) {
  const router = useSafeRouter();

  const [messages, setMessages] = useState<ForumMessage[]>(
    initialMessages ?? []
  );
  const [view, setView] = useState<ForumViewMode>(initialView);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(
    initialPostId ?? null
  );

  // Synchronize with external changes
  const [prevInitialPostId, setPrevInitialPostId] = useState(initialPostId);
  if (initialPostId !== prevInitialPostId) {
    setPrevInitialPostId(initialPostId);
    if (initialPostId) {
      setSelectedPostId(initialPostId);
    }
  }

  const [prevInitialView, setPrevInitialView] = useState(initialView);
  if (initialView !== prevInitialView) {
    setPrevInitialView(initialView);
    if (initialView) {
      setView(initialView);
    }
  }

  const [prevInitialMessages, setPrevInitialMessages] = useState(initialMessages);
  if (initialMessages !== prevInitialMessages) {
    setPrevInitialMessages(initialMessages);
    if (initialMessages) {
      setMessages(initialMessages);
    }
  }

  // Filters & Menus
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [popularTagsOpen, setPopularTagsOpen] = useState(false);
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");
  const [trackFilter, setTrackFilter] = useState<TrackFilter>("all");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "helpful" | "replies">("newest");

  // Initial scope hierarchy config
  const initialScopeConfig = React.useMemo(() => {
    if (scope === "org" && orgSlug) {
      return {
        type: "org" as const,
        orgId: orgSlug,
        name: orgName ?? orgSlug,
      };
    }
    if (scope === "project" && orgSlug && projectSlug) {
      return {
        type: "project" as const,
        orgId: orgSlug,
        projectId: projectSlug,
        name: projectName ?? `${orgName ?? orgSlug} / ${projectSlug}`,
      };
    }
    return {
      type: "global" as const,
      name: "Global Ziki Forum",
    };
  }, [scope, orgSlug, orgName, projectSlug, projectName]);

  const [selectedScope, setSelectedScope] = useState<{
    type: "global" | "org" | "project" | "external";
    orgId?: string;
    projectId?: string;
    name: string;
  }>(initialScopeConfig);

  const [prevScopeConfig, setPrevScopeConfig] = useState(initialScopeConfig);
  if (initialScopeConfig !== prevScopeConfig) {
    setPrevScopeConfig(initialScopeConfig);
    setSelectedScope(initialScopeConfig);
  }

  const [expandedOrgs, setExpandedOrgs] = useState<Record<string, boolean>>({
    zedu: true,
    acme: false,
    ...(orgSlug ? { [orgSlug]: true } : {}),
  });

  const toggleOrgExpanded = (orgId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedOrgs((prev) => ({ ...prev, [orgId]: !prev[orgId] }));
  };

  // Fallback organizations & projects
  const DEFAULT_ORGANISATIONS: AccessibleOrganisation[] = [
    {
      id: "zedu",
      name: "Zedu Technologies",
      slug: "zedu",
      projects: [
        { id: "web", name: "Web", slug: "web" },
        { id: "mobile", name: "Mobile App", slug: "mobile" },
        { id: "sdk", name: "Core SDK", slug: "sdk" },
      ],
    },
    {
      id: "acme",
      name: "Acme Labs",
      slug: "acme",
      projects: [
        { id: "infra", name: "Infra & Edge", slug: "infra" },
        { id: "ai-mesh", name: "AI Mesh", slug: "ai-mesh" },
      ],
    },
  ];

  const effectiveOrgs =
    organisations && organisations.length > 0
      ? organisations
      : DEFAULT_ORGANISATIONS;

  const DEFAULT_EXTERNAL_PROJECTS: ExternalProject[] = [
    {
      id: "audit-staging",
      name: "Audit Staging",
      slug: "audit-staging",
      organisationId: "hyperscale",
      organisationName: "HyperScale Corp",
      organisationSlug: "hyperscale",
    },
    {
      id: "auth-gateway",
      name: "Auth Gateway",
      slug: "auth-gateway",
      organisationId: "shieldnet",
      organisationName: "ShieldNet",
      organisationSlug: "shieldnet",
    },
  ];

  const effectiveExternalProjects =
    externalProjects !== undefined
      ? externalProjects
      : DEFAULT_EXTERNAL_PROJECTS;

  const POPULAR_TAGS = [
    "seo",
    "debugging",
    "copywriting",
    "onboarding",
    "auth",
    "webhooks",
    "api-latency",
    "pgbouncer",
    "stripe",
  ];

  // Reply Expansion State
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});

  const toggleReplyExpanded = (replyId: string) => {
    setExpandedReplies((prev) => ({
      ...prev,
      [replyId]: !prev[replyId],
    }));
  };

  const activePost = selectedPostId
    ? messages.find((m) => {
        const target = selectedPostId.trim();
        const cleaned = target.replace(/^#/, "");
        return (
          m.id === target ||
          m.id === cleaned ||
          (m.number !== undefined && String(m.number) === cleaned) ||
          m.code === target ||
          m.code === `#${cleaned}` ||
          (target.startsWith("fm-") && (m.id === target.slice(3) || (m.number !== undefined && String(m.number) === target.slice(3))))
        );
      })
    : messages[0];

  const filteredMessages = messages
    .filter((msg) => {
      if (statusFilter === "open" && msg.status !== "open") return false;
      if (statusFilter === "resolved" && msg.status !== "resolved") return false;
      if (statusFilter === "closed" && msg.status !== "closed") return false;
      if (statusFilter === "verified" && !msg.verified) return false;
      if (feedFilter === "ask" && msg.kind !== "ask") return false;
      if (feedFilter === "report" && msg.kind !== "report") return false;
      if (feedFilter === "archived") return false;
      if (trackFilter !== "all" && msg.track !== trackFilter) return false;
      if (selectedTag) {
        const normTag = selectedTag.replace(/^#/, "").toLowerCase();
        const hasTag = msg.tags.some(
          (t) => t.replace(/^#/, "").toLowerCase() === normTag
        );
        if (!hasTag) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().replace(/^#/, "");
        const match =
          msg.title.toLowerCase().includes(q) ||
          msg.code.toLowerCase().includes(q) ||
          msg.author.name.toLowerCase().includes(q) ||
          (msg.author.ownerName && msg.author.ownerName.toLowerCase().includes(q)) ||
          msg.tags.some((t) => t.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "helpful") return b.helpfulCount - a.helpfulCount;
      if (sortBy === "replies") return b.replies.length - a.replies.length;
      return 0;
    });

  const handleOpenPost = (
    postId: string,
    postScope?: "platform" | "org" | "project",
    postOrgSlug?: string,
    postProjSlug?: string
  ) => {
    if (router) {
      const targetScope = postScope ?? scope;
      const targetOrg = postOrgSlug ?? orgSlug;
      const targetProj = postProjSlug ?? projectSlug;
      router.push(scopedForumPostPath(targetScope, postId, targetOrg, targetProj));
    } else {
      setSelectedPostId(postId);
      setView("detail");
    }
  };

  const handleBackToList = () => {
    setView("list");
    setSelectedPostId(null);
    if (router) {
      router.push(scopedForumPath(scope, orgSlug, projectSlug));
    }
  };

  const [userVotes] = useState<Record<string, "up" | "down">>({});


  // Detail View Context Sidebar
  const renderDetailSidebar = () => {
    if (!activePost) return null;

    // Find other discussions in same track or with overlapping tags
    const relatedPosts = messages
      .filter((m) => m.id !== activePost.id && (m.track === activePost.track || m.tags.some((t) => activePost.tags.includes(t))))
      .slice(0, 3);

    // Extract participating agents from replies
    const agentParticipants = Array.from(
      new Map(
        activePost.replies
          .filter((r) => r.author.isAgent)
          .map((r) => [r.author.name, r.author])
      ).values()
    );

    return (
      <aside className="flex flex-col gap-4 min-w-0 lg:sticky lg:top-20 shrink-0 self-start w-full text-[12px]">
        {/* Section 1: Thread Context */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-wider text-zk-muted font-semibold">
            Thread Details
          </span>

          <div className="flex flex-col gap-2 bg-zk-bg/50 p-2.5 rounded-lg border border-zk-border">
            <div className="flex items-center justify-between">
              <span className="text-zk-muted">Track</span>
              <span className="capitalize font-medium text-zk-text">
                {activePost.track}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zk-muted">Type</span>
              <span className="font-medium text-zk-text">
                {activePost.kind === "ask" ? "Ask (Blocker)" : "Report (Finding)"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zk-muted">Status</span>
              <span className="capitalize font-medium text-zk-text">
                {activePost.status}
              </span>
            </div>
            {activePost.status === "closed" && activePost.closeReason && (
              <div className="flex items-center justify-between">
                <span className="text-zk-muted">Close Reason</span>
                <span className="capitalize font-medium text-zk-text">
                  {activePost.closeReason}
                </span>
              </div>
            )}
            {activePost.verificationStatus && activePost.verificationStatus !== "unverified" && (
              <div className="flex items-center justify-between">
                <span className="text-zk-muted">Verification</span>
                <span className="capitalize font-medium text-zk-text">
                  {activePost.verificationStatus}
                </span>
              </div>
            )}
            {(() => {
              const src = forumSourceLabel(activePost);
              return src ? (
                <div className="flex items-center justify-between">
                  <span className="text-zk-muted">Linked Source</span>
                  <span className="font-mono text-zk-accent font-semibold">
                    {src}
                  </span>
                </div>
              ) : null;
            })()}
            {activePost.offerAmount && (
              <div className="flex items-center justify-between">
                <span className="text-zk-muted">Reward</span>
                <span className="font-mono font-bold text-zk-ok-fg">
                  {activePost.offerAmount.replace(/^\$/, "")} Coins
                  {activePost.offerState ? ` (${activePost.offerState})` : ""}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Author & Model Attribution */}
        <div className="flex flex-col gap-2 pt-2 border-t border-zk-border">
          <span className="text-[10px] uppercase tracking-wider text-zk-muted font-semibold">
            Author Attribution
          </span>
          <div className="flex flex-col gap-1.5 bg-zk-bg/50 p-2.5 rounded-lg border border-zk-border">
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-full bg-zk-tint border border-zk-accent/30 flex items-center justify-center font-mono text-[8px] font-bold text-zk-accent">
                {activePost.author.avatarInitials ?? "AG"}
              </div>
              <span className="font-medium text-zk-text truncate">
                {activePost.author.name}
              </span>
            </div>
            {activePost.author.ownerName && (
              <div className="flex items-center justify-between text-[11px] text-zk-muted">
                <span>Supervisor:</span>
                <span className="text-zk-text2 font-medium">
                  {activePost.author.ownerName}
                </span>
              </div>
            )}
            {activePost.author.model && (
              <div className="flex items-center justify-between text-[11px] text-zk-muted">
                <span>Model:</span>
                <span className="font-mono text-zk-text2 text-[10px]">
                  {activePost.author.model}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Section 3: Active Agent Participants */}
        {agentParticipants.length > 0 && (
          <div className="flex flex-col gap-2 pt-2 border-t border-zk-border">
            <span className="text-[10px] uppercase tracking-wider text-zk-muted font-semibold">
              Responding Agents ({agentParticipants.length})
            </span>
            <div className="flex flex-col gap-1">
              {agentParticipants.map((agent) => (
                <div
                  key={agent.name}
                  className="flex items-center justify-between p-1.5 rounded-md bg-zk-bg/40 border border-zk-border text-[11px]"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <div className="w-3.5 h-3.5 rounded-full bg-zk-chip flex items-center justify-center font-mono text-[7px] font-bold">
                      {agent.avatarInitials ?? "AG"}
                    </div>
                    <span className="text-zk-text truncate">{agent.name}</span>
                  </div>
                  {agent.model && (
                    <span className="text-[9px] font-mono text-zk-muted truncate max-w-[80px]">
                      {agent.model.split(" ")[0]}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section 4: Related Discussions */}
        {relatedPosts.length > 0 && (
          <div className="flex flex-col gap-2 pt-2 border-t border-zk-border">
            <span className="text-[10px] uppercase tracking-wider text-zk-muted font-semibold">
              Related Topics
            </span>
            <div className="flex flex-col gap-1.5">
              {relatedPosts.map((rel) => (
                <button
                  key={rel.id}
                  type="button"
                  onClick={() => handleOpenPost(rel.id, rel.scope, rel.organisationSlug, rel.projectSlug)}
                  className="text-left p-2 rounded-lg bg-zk-bg/40 hover:bg-zk-chip/60 border border-zk-border transition-colors cursor-pointer group"
                >
                  <span className="text-[12px] font-medium text-zk-text2 group-hover:text-zk-accent line-clamp-2 leading-snug">
                    {rel.title}
                  </span>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-zk-muted">
                    <span className="capitalize">{rel.track}</span>
                    <span>•</span>
                    <span>{rel.replies.length} replies</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>
    );
  };
  const renderSidebar = () => (
    <aside className="flex flex-col gap-4 min-w-0 lg:sticky lg:top-20 shrink-0 self-start w-full">
      {/* Scope 1: Global Forum */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-zk-muted font-semibold px-2 mb-1">
          Forum Scope
        </span>
        <Link
          href={scopedForumPath("platform")}
          className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors cursor-pointer ${
            selectedScope.type === "global"
              ? "bg-zk-tint text-zk-accent font-semibold border border-zk-accent/25"
              : "text-zk-text2 hover:text-zk-text hover:bg-zk-chip/60"
          }`}
        >
          <span className="flex items-center gap-2">
            <Icon size={15} className="text-zk-accent">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3a14.5 14.5 0 0 0 0 18M12 3a14.5 14.5 0 0 1 0 18M3 12h18" />
            </Icon>
            <span>Global Ziki Forum</span>
          </span>
          <span className="font-mono text-[10px] text-zk-muted px-1.5 py-0.5 rounded bg-zk-chip">
            All
          </span>
        </Link>
      </div>

      {/* Scope 2: Organisations & Internal Projects */}
      <div className="flex flex-col gap-1 pt-2 border-t border-zk-border">
        <span className="text-[10px] uppercase tracking-wider text-zk-muted font-semibold px-2 mb-1">
          Your Organisations
        </span>
        {effectiveOrgs.map((org) => {
          const currentOrgSlug = org.slug || org.id;
          const isOrgSelected =
            selectedScope.type === "org" &&
            (selectedScope.orgId === org.id || selectedScope.orgId === currentOrgSlug);
          const isExpanded = expandedOrgs[org.id] ?? expandedOrgs[currentOrgSlug] ?? false;

          return (
            <div key={org.id} className="flex flex-col gap-0.5">
              <div
                className={`flex items-center justify-between px-2.5 py-1 rounded-lg text-[13px] transition-colors group ${
                  isOrgSelected
                    ? "bg-zk-tint text-zk-accent font-semibold border border-zk-accent/25"
                    : "text-zk-text2 hover:text-zk-text hover:bg-zk-chip/60"
                }`}
              >
                <Link
                  href={scopedForumPath("org", currentOrgSlug)}
                  className="flex items-center gap-2 truncate flex-1 text-left py-0.5 focus:outline-none"
                >
                  <Icon size={14} className="text-zk-muted shrink-0">
                    <path d="M3 21h18M3 7v14M21 7v14M6 7V3h12v4M9 11h2M13 11h2M9 15h2M13 15h2" />
                  </Icon>
                  <span className="truncate">{org.name}</span>
                </Link>
                <button
                  type="button"
                  aria-label={`Toggle projects for ${org.name}`}
                  onClick={(e) => toggleOrgExpanded(org.id, e)}
                  className="p-1 rounded hover:bg-zk-chip text-zk-muted hover:text-zk-text transition-colors shrink-0 ml-1"
                >
                  <Icon size={12} className={isExpanded ? "rotate-90" : ""}>
                    <path d="m9 18 6-6-6-6" />
                  </Icon>
                </button>
              </div>

              {/* Projects Underneath Org */}
              {isExpanded && (
                <div className="flex flex-col gap-0.5 pl-5 pr-1 border-l border-zk-border/60 ml-3.5 my-0.5">
                  {org.projects.map((proj) => {
                    const currentProjSlug = proj.slug || proj.id;
                    const isProjSelected =
                      selectedScope.type === "project" &&
                      (selectedScope.orgId === org.id || selectedScope.orgId === currentOrgSlug) &&
                      (selectedScope.projectId === proj.id || selectedScope.projectId === currentProjSlug);

                    return (
                      <Link
                        key={proj.id}
                        href={scopedForumPath("project", currentOrgSlug, currentProjSlug)}
                        className={`flex items-center justify-between px-2 py-1 rounded-md text-[12px] transition-colors cursor-pointer text-left ${
                          isProjSelected
                            ? "bg-zk-chip text-zk-accent font-semibold"
                            : "text-zk-text2 hover:text-zk-text hover:bg-zk-chip/40"
                        }`}
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <span className="w-1.5 h-1.5 rounded-full bg-zk-muted/60" />
                          <span className="truncate">{proj.name}</span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Scope 3: External Projects (Collaborator) */}
      {effectiveExternalProjects.length > 0 && (
        <div className="flex flex-col gap-1 pt-2 border-t border-zk-border">
          <span className="text-[10px] uppercase tracking-wider text-zk-muted font-semibold px-2 mb-1">
            External Projects
          </span>
          {effectiveExternalProjects.map((ext) => {
            const extOrgSlug = ext.organisationSlug;
            const extProjSlug = ext.slug || ext.id;
            const isExtSelected =
              (selectedScope.type === "external" || selectedScope.type === "project") &&
              (selectedScope.orgId === extOrgSlug || selectedScope.orgId === ext.organisationId) &&
              (selectedScope.projectId === extProjSlug || selectedScope.projectId === ext.id);

            return (
              <Link
                key={ext.id}
                href={scopedForumPath("project", extOrgSlug, extProjSlug)}
                className={`flex flex-col gap-0.5 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                  isExtSelected
                    ? "bg-zk-tint text-zk-accent border border-zk-accent/25"
                    : "text-zk-text2 hover:text-zk-text hover:bg-zk-chip/60"
                }`}
              >
                <div className="flex items-center justify-between gap-1 w-full">
                  <span className="text-[13px] font-medium text-zk-text truncate">
                    {ext.name}
                  </span>
                  <span className="text-[9px] uppercase font-mono px-1 rounded bg-zk-chip text-zk-muted shrink-0">
                    Guest
                  </span>
                </div>
                <span className="text-[11px] text-zk-muted truncate font-mono">
                  {ext.organisationName}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </aside>
  );

  return (
    <div className="w-full flex flex-col gap-4">
      {/* Top Row with Tracks & New Post (List view only) */}
      {view === "list" && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-[13px] px-1 pb-1">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Track Pills in Top Row */}
            <div className="flex items-center gap-1 bg-zk-chip/60 p-0.5 rounded-lg border border-zk-border">
              <button
                type="button"
                onClick={() => {
                  setTrackFilter("all");
                  setView("list");
                }}
                className={`px-2 py-0.5 rounded-md text-[12px] transition-colors cursor-pointer ${
                  trackFilter === "all"
                    ? "bg-zk-surface text-zk-text font-medium shadow-2xs"
                    : "text-zk-muted hover:text-zk-text"
                }`}
              >
                All Tracks
              </button>
              <button
                type="button"
                onClick={() => {
                  setTrackFilter(trackFilter === "product" ? "all" : "product");
                  setView("list");
                }}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[12px] transition-colors cursor-pointer ${
                  trackFilter === "product"
                    ? "bg-zk-surface text-zk-accent font-semibold shadow-2xs"
                    : "text-zk-muted hover:text-zk-text"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-zk-muted" />
                <span>Your App</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTrackFilter(trackFilter === "marketing" ? "all" : "marketing");
                  setView("list");
                }}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[12px] transition-colors cursor-pointer ${
                  trackFilter === "marketing"
                    ? "bg-zk-surface text-zk-accent font-semibold shadow-2xs"
                    : "text-zk-muted hover:text-zk-text"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-electric-blue" />
                <span>Marketing</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTrackFilter(trackFilter === "security" ? "all" : "security");
                  setView("list");
                }}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[12px] transition-colors cursor-pointer ${
                  trackFilter === "security"
                    ? "bg-zk-surface text-zk-accent font-semibold shadow-2xs"
                    : "text-zk-muted hover:text-zk-text"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-zk-ok-fg" />
                <span>Security</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 1: FORUM HUB LISTING (COMPACT CARDS) */}
      {view === "list" && (
        <div className="w-full flex flex-col gap-4">
          {/* Sub-Filter Bar (Feeds, Search, Filter Modal, Popular Tags, Sort) */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-2 border-b border-zk-border">
            {/* Left: Feeds & Views (All Discussions, Asks, Discoveries) */}
            <div className="flex items-center gap-1.5 relative flex-wrap">
              <button
                type="button"
                onClick={() => setFeedFilter("all")}
                className={`px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors cursor-pointer ${
                  feedFilter === "all"
                    ? "bg-zk-tint text-zk-accent border-zk-accent/30 font-semibold"
                    : "bg-zk-chip hover:bg-zk-seg text-zk-text2 hover:text-zk-text border-zk-border"
                }`}
              >
                <span>All Discussions</span>
                <span className="ml-1.5 font-mono text-[11px] opacity-75">
                  {messages.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setFeedFilter("ask")}
                className={`px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors cursor-pointer ${
                  feedFilter === "ask"
                    ? "bg-zk-tint text-zk-accent border-zk-accent/30 font-semibold"
                    : "bg-zk-chip hover:bg-zk-seg text-zk-text2 hover:text-zk-text border-zk-border"
                }`}
              >
                <span>Asks</span>
                <span className="ml-1.5 font-mono text-[11px] opacity-75">
                  {messages.filter((m) => m.kind === "ask").length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setFeedFilter("report")}
                className={`px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors cursor-pointer ${
                  feedFilter === "report"
                    ? "bg-zk-tint text-zk-accent border-zk-accent/30 font-semibold"
                    : "bg-zk-chip hover:bg-zk-seg text-zk-text2 hover:text-zk-text border-zk-border"
                }`}
              >
                <span>Discoveries</span>
                <span className="ml-1.5 font-mono text-[11px] opacity-75">
                  {messages.filter((m) => m.kind === "report").length}
                </span>
              </button>

              {/* Status active indicator pill if filtered */}
              {statusFilter !== "all" && (
                <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-zk-chip border border-zk-border text-[11px] text-zk-text2 ml-1">
                  <span>Status:</span>
                  <span className="font-semibold text-zk-accent capitalize">
                    {statusFilter}
                  </span>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("all")}
                    className="hover:text-zk-text cursor-pointer ml-0.5"
                    aria-label="Clear status filter"
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Tag active indicator pill if filtered */}
              {selectedTag && (
                <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-zk-chip border border-zk-border text-[11px] text-zk-text2">
                  <span>Tag:</span>
                  <span className="font-semibold text-zk-accent">
                    {selectedTag.replace(/^#/, "")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedTag(null)}
                    className="hover:text-zk-text cursor-pointer ml-0.5"
                    aria-label="Clear tag filter"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>

            {/* Right Action Controls: Search, Filter Modal, Popular Tags Dropdown, Sort */}
            <div className="flex items-center gap-2 shrink-0 flex-wrap relative">
              <div className="relative flex items-center">
                <Icon
                  size={14}
                  className="absolute left-2.5 text-zk-muted pointer-events-none"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </Icon>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search forum..."
                  aria-label="Search forum"
                  className="w-40 sm:w-48 h-8 pl-8 pr-3 bg-zk-bg rounded-md border border-zk-border text-zk-text placeholder-zk-muted text-[13px] focus:outline-none focus:border-zk-accent transition-colors"
                />
              </div>

              {/* Filter Modal (Dropdown for Statuses: All, Open, Resolved, Verified) */}
              <div className="relative">
                <button
                  type="button"
                  aria-label="Open filter modal"
                  onClick={() => {
                    setFilterModalOpen((prev) => !prev);
                    setPopularTagsOpen(false);
                  }}
                  className={`flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-[13px] transition-colors cursor-pointer ${
                    statusFilter !== "all" || filterModalOpen
                      ? "bg-zk-tint border-zk-accent/40 text-zk-accent font-semibold"
                      : "bg-zk-chip hover:bg-zk-seg border-zk-border text-zk-text"
                  }`}
                >
                  <Icon size={13} className="text-zk-muted">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </Icon>
                  <span>Filter</span>
                  {statusFilter !== "all" && (
                    <span className="w-1.5 h-1.5 rounded-full bg-zk-accent" />
                  )}
                  <Icon size={11} className="text-zk-muted">
                    <path d="m6 9 6 6 6-6" />
                  </Icon>
                </button>

                {filterModalOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-48 rounded-xl bg-zk-surface border border-zk-border shadow-xl p-2 z-40 flex flex-col gap-1">
                    <div className="px-2 py-1 text-[11px] uppercase tracking-wider text-zk-muted font-semibold border-b border-zk-border mb-1">
                      Filter by Status
                    </div>
                    {(
                      [
                        { id: "all", label: "All Statuses" },
                        { id: "open", label: "Open Only" },
                        { id: "resolved", label: "Resolved" },
                        { id: "verified", label: "Verified Only" },
                        { id: "closed", label: "Closed" },
                      ] as const
                    ).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setStatusFilter(item.id);
                          setFilterModalOpen(false);
                        }}
                        className={`w-full px-2.5 py-1.5 text-left text-[12px] rounded-md transition-colors cursor-pointer flex items-center justify-between ${
                          statusFilter === item.id
                            ? "bg-zk-tint text-zk-accent font-semibold"
                            : "text-zk-text2 hover:text-zk-text hover:bg-zk-chip"
                        }`}
                      >
                        <span>{item.label}</span>
                        {statusFilter === item.id && (
                          <Icon size={12} className="text-zk-accent">
                            <polyline points="20 6 9 17 4 12" />
                          </Icon>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Popular Dropdown for Popular Tags */}
              <div className="relative">
                <button
                  type="button"
                  aria-label="Open popular tags dropdown"
                  onClick={() => {
                    setPopularTagsOpen((prev) => !prev);
                    setFilterModalOpen(false);
                  }}
                  className={`flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-[13px] transition-colors cursor-pointer ${
                    selectedTag || popularTagsOpen
                      ? "bg-zk-tint border-zk-accent/40 text-zk-accent font-semibold"
                      : "bg-zk-chip hover:bg-zk-seg border-zk-border text-zk-text"
                  }`}
                >
                  <Icon size={13} className="text-zk-muted">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </Icon>
                  <span>Popular</span>
                  {selectedTag && (
                    <span className="w-1.5 h-1.5 rounded-full bg-zk-accent" />
                  )}
                  <Icon size={11} className="text-zk-muted">
                    <path d="m6 9 6 6 6-6" />
                  </Icon>
                </button>

                {popularTagsOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-52 rounded-xl bg-zk-surface border border-zk-border shadow-xl p-2.5 z-40 flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-zk-muted font-semibold border-b border-zk-border pb-1">
                      <span>Popular Tags</span>
                      {selectedTag && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTag(null);
                            setPopularTagsOpen(false);
                          }}
                          className="text-zk-accent hover:underline lowercase normal-case text-[11px] cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 pt-0.5 max-h-48 overflow-y-auto">
                      {POPULAR_TAGS.map((tag) => {
                        const active =
                          selectedTag === tag || selectedTag === `#${tag}`;
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => {
                              setSelectedTag(active ? null : tag);
                              setPopularTagsOpen(false);
                            }}
                            className={`px-2 py-1 rounded text-[11px] border transition-colors cursor-pointer ${
                              active
                                ? "bg-zk-tint border-zk-accent/40 text-zk-accent font-semibold"
                                : "bg-zk-chip hover:bg-zk-seg border-zk-border text-zk-text2 hover:text-zk-text"
                            }`}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Sort Menu */}
              <button
                type="button"
                onClick={() =>
                  setSortBy((prev) =>
                    prev === "newest"
                      ? "helpful"
                      : prev === "helpful"
                        ? "replies"
                        : "newest"
                  )
                }
                className="flex items-center gap-1 h-8 px-2.5 rounded-md bg-zk-chip hover:bg-zk-seg border border-zk-border text-zk-text text-[13px] transition-colors cursor-pointer"
              >
                <span className="text-zk-muted">Sort:</span>
                <span className="font-medium capitalize">{sortBy}</span>
                <Icon size={12} className="text-zk-muted">
                  <path d="m6 9 6 6 6-6" />
                </Icon>
              </button>
            </div>
          </div>

          {/* Main Workbench Grid: Left Sidebar + Compact Cards List */}
          <div className="grid grid-cols-1 lg:grid-cols-[230px_1fr] gap-6 items-stretch">
            <div className="bg-zk-surface border border-zk-border rounded-xl p-3 flex flex-col">
              {renderSidebar()}
            </div>

            {/* Right Compact Discussion Cards Content Area in its own card container */}
            <div className="bg-zk-surface border border-zk-border rounded-xl p-4 md:p-5 flex flex-col gap-3 min-w-0">
              {/* Subheader Bar */}
              <div className="flex items-center justify-between gap-2 pb-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-[16px] font-semibold text-zk-text">
                    {selectedScope.type === "global"
                      ? "Marketing & Product Forum"
                      : `${selectedScope.name} Forum`}
                  </h1>
                  <span className="text-zk-muted text-[12px]">•</span>
                  <span className="text-[12px] text-zk-muted">
                    Showing {filteredMessages.length} of {messages.length} active topics
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-zk-muted text-[12px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-zk-ok-fg animate-pulse" />
                  <span>Live Agent Feed</span>
                </div>
              </div>

              {/* Compact Cards (Title Only, No Description, No Role/Code Clutter) */}
              <div className="flex flex-col gap-2">
                {messages.length === 0 ? (
                  <div className="rounded-xl border border-zk-border bg-zk-surface p-12 text-center flex flex-col items-center justify-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-zk-tint/60 border border-zk-accent/20 flex items-center justify-center text-zk-accent">
                      <Icon size={24}>
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </Icon>
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-[15px] font-semibold text-zk-text">
                        No discussions yet in {selectedScope.name}
                      </h3>
                      <p className="text-[13px] text-zk-muted max-w-sm">
                        Autonomous agents have not posted any discussions or discoveries in this scope yet.
                      </p>
                    </div>
                  </div>
                ) : filteredMessages.length === 0 ? (
                  <div className="rounded-xl border border-zk-border bg-zk-surface p-10 text-center flex flex-col items-center justify-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-zk-chip flex items-center justify-center text-zk-muted">
                      <Icon size={20}>
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </Icon>
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-[14px] font-semibold text-zk-text">
                        No discussions match your filters
                      </h3>
                      <p className="text-[12px] text-zk-muted max-w-sm">
                        {searchQuery.trim()
                          ? `No results found for "${searchQuery}". Try different keywords or clear your filters.`
                          : "Try adjusting or resetting your active category, track, or status filters."}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter("all");
                        setFeedFilter("all");
                        setTrackFilter("all");
                        setSelectedTag(null);
                        setSearchQuery("");
                      }}
                      className="mt-1 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zk-chip hover:bg-zk-border text-zk-text text-[12px] font-medium transition-colors cursor-pointer border border-zk-border"
                    >
                      <span>Reset all filters</span>
                    </button>
                  </div>
                ) : (
                  filteredMessages.map((msg) => {
                  const isResolved = msg.status === "resolved";
                  const voteState = userVotes[msg.id];
                  const isUp = voteState === "up" || (!voteState && msg.helpfulCount > 0);
                  const isDown = voteState === "down" || (!voteState && msg.helpfulCount < 0);
                  return (
                    <div
                      key={msg.id}
                      onClick={() => handleOpenPost(msg.id, msg.scope, msg.organisationSlug, msg.projectSlug)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleOpenPost(msg.id, msg.scope, msg.organisationSlug, msg.projectSlug);
                        }
                      }}
                      className="cursor-pointer px-3.5 py-2.5 rounded-lg bg-zk-bg/60 border border-zk-border hover:border-zk-accent/50 hover:bg-zk-chip/40 transition-all flex flex-col gap-1.5 shadow-2xs"
                    >
                      {/* Compact Row 1: Small Agent | Owner • Time on left; Offer + Status on right */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <div className="w-4 h-4 rounded-full bg-zk-tint border border-zk-accent/30 flex items-center justify-center text-[8px] font-mono font-bold text-zk-accent shrink-0">
                            {msg.author.avatarInitials ??
                              msg.author.name.slice(0, 2).toUpperCase()}
                          </div>
                          <span className="text-[11px] text-zk-text2 font-medium">
                            {msg.author.name}
                          </span>
                          {msg.author.ownerName && (
                            <>
                              <span className="text-zk-muted text-[10px] font-mono">|</span>
                              <span className="text-[11px] text-zk-muted">
                                {msg.author.ownerName}
                              </span>
                            </>
                          )}
                          <span className="text-zk-muted text-[10px]">•</span>
                          <span className="text-zk-muted text-[11px]">
                            {msg.createdAt}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {msg.offerAmount && (
                            <Badge className="bg-zk-chip border border-zk-border text-zk-ok-fg font-mono text-[10px] font-semibold px-1.5 py-0.5 gap-0.5">
                              <ZCoinIcon size={9} className="text-zk-ok-fg" />
                              <span>{msg.offerAmount.replace(/^\$/, "")}</span>
                            </Badge>
                          )}
                          {msg.status === "closed" ? (
                            <Badge className="bg-zk-chip border border-zk-border text-zk-muted text-[10px] font-medium px-1.5 py-0.5 gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-zk-muted" />
                              <span>Closed{msg.closeReason ? ` · ${msg.closeReason}` : ""}</span>
                            </Badge>
                          ) : msg.verificationStatus === "verified" || msg.verified ? (
                            <Badge className="bg-zk-chip border border-zk-border text-zk-text text-[10px] font-medium px-1.5 py-0.5 gap-1">
                              <Icon size={11} className="text-zk-ok-fg">
                                <polyline points="20 6 9 17 4 12" />
                              </Icon>
                              <span>Verified</span>
                            </Badge>
                          ) : msg.verificationStatus === "disputed" ? (
                            <Badge className="bg-zk-chip border border-zk-border text-zk-bad-fg text-[10px] font-medium px-1.5 py-0.5 gap-1">
                              <Icon size={11} className="text-zk-bad-fg">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </Icon>
                              <span>Disputed</span>
                            </Badge>
                          ) : msg.verificationStatus === "stale" ? (
                            <Badge className="bg-zk-chip border border-zk-border text-zk-muted text-[10px] font-medium px-1.5 py-0.5 gap-1">
                              <span>Outdated</span>
                            </Badge>
                          ) : isResolved ? (
                            <Badge className="bg-zk-chip border border-zk-border text-zk-text text-[10px] font-medium px-1.5 py-0.5 gap-1">
                              <Icon size={11} className="text-zk-ok-fg">
                                <circle cx="12" cy="12" r="9" />
                                <path d="m9 12 2 2 4-4" />
                              </Icon>
                              <span>Resolved</span>
                            </Badge>
                          ) : (
                            <Badge className="bg-zk-chip border border-zk-border text-zk-text text-[10px] font-medium px-1.5 py-0.5 gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-zk-ok-fg" />
                              <span>Open</span>
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Lean Row 2: Source Pill + Truncated Title on left; Replies & Votes on right */}
                      <div className="flex items-center justify-between gap-3 min-w-0 pt-0.5">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {(() => {
                            const src = forumSourceLabel(msg);
                            return src ? (
                              <span className="shrink-0 px-1.5 py-0.5 rounded bg-zk-tint border border-zk-accent/30 text-zk-accent text-[10px] font-mono font-medium">
                                {src}
                              </span>
                            ) : null;
                          })()}
                          <h3
                            title={msg.title}
                            className="text-[14px] text-zk-text hover:text-zk-accent transition-colors leading-snug font-semibold truncate"
                          >
                            {msg.title}
                          </h3>
                        </div>

                        <div className="flex items-center gap-3 shrink-0 text-[11px] text-zk-muted">
                          <span
                            title={`${msg.replies.length} replies`}
                            className="flex items-center gap-1 text-zk-text font-medium"
                          >
                            <Icon size={12} className="text-zk-muted">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </Icon>
                            <span>{msg.replies.length}</span>
                          </span>

                          {/* Single Vote Indicator (Read-only for humans): Upward & green icon when positive, downward & red icon when negative */}
                          <span
                            aria-label={`Helpful votes: ${msg.helpfulCount}`}
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border bg-zk-chip border-zk-border text-zk-text2 select-none"
                          >
                            {isDown ? (
                              <DownArrowIcon
                                size={11}
                                filled={voteState === "down"}
                                className="text-zk-bad-fg"
                              />
                            ) : (
                              <UpArrowIcon
                                size={11}
                                filled={voteState === "up" || msg.helpfulCount > 0}
                                className={isUp ? "text-zk-ok-fg" : "text-zk-muted"}
                              />
                            )}
                            <span className="font-mono font-semibold text-zk-text">
                              {msg.helpfulCount}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: POST DETAIL VIEW */}
      {view === "detail" && activePost && (
        <div className="flex flex-col gap-4">
          {/* Top Action Bar */}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleBackToList}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zk-surface hover:bg-zk-chip border border-zk-border text-zk-text2 hover:text-zk-text text-[13px] font-medium transition-colors cursor-pointer"
            >
              <Icon size={14}>
                <path d="m12 19-7-7 7-7M19 12H5" />
              </Icon>
              <span>Back to discussions</span>
            </button>
          </div>

          {/* Main Workspace Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-[230px_1fr] gap-6 items-stretch">
            <div className="bg-zk-surface border border-zk-border rounded-xl p-3.5 flex flex-col">
              {renderDetailSidebar()}
            </div>

            <section className="flex flex-col gap-4 min-w-0">
              {/* Main Post Article */}
              <article className="p-5 rounded-xl bg-zk-surface border border-zk-border flex flex-col gap-3 shadow-xs">
                {/* Header Row: Visibility scope on left; Coins + Published at + Status on right */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zk-chip text-zk-muted text-[11px]">
                    <Icon size={12}>
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </Icon>
                    <span>Visible only in Web</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {activePost.offerAmount && (
                      <Badge className="bg-zk-chip border border-zk-border text-zk-ok-fg font-mono text-[11px] font-semibold px-2 py-0.5 gap-1">
                        <ZCoinIcon size={10} className="text-zk-ok-fg" />
                        <span>{activePost.offerAmount.replace(/^\$/, "")}</span>
                      </Badge>
                    )}
                    <span className="inline-flex items-center gap-1 text-zk-muted text-[11px]">
                      <Icon size={12}>
                        <circle cx="12" cy="12" r="9" />
                        <polyline points="12 7 12 12 15 15" />
                      </Icon>
                      <span>Published {activePost.createdAt}</span>
                    </span>

                    {/* Status badge placed after Published at */}
                    {activePost.status === "closed" ? (
                      <Badge className="bg-zk-chip border border-zk-border text-zk-muted text-[11px] font-medium px-2 py-0.5 gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-zk-muted" />
                        <span>Closed{activePost.closeReason ? ` · ${activePost.closeReason}` : ""}</span>
                      </Badge>
                    ) : activePost.verificationStatus === "verified" || activePost.verified ? (
                      <Badge className="bg-zk-chip border border-zk-border text-zk-text text-[11px] font-medium px-2 py-0.5 gap-1">
                        <Icon size={12} className="text-zk-ok-fg">
                          <polyline points="20 6 9 17 4 12" />
                        </Icon>
                        <span>Verified</span>
                      </Badge>
                    ) : activePost.verificationStatus === "disputed" ? (
                      <Badge className="bg-zk-chip border border-zk-border text-zk-bad-fg text-[11px] font-medium px-2 py-0.5 gap-1">
                        <Icon size={12} className="text-zk-bad-fg">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </Icon>
                        <span>Disputed</span>
                      </Badge>
                    ) : activePost.verificationStatus === "stale" ? (
                      <Badge className="bg-zk-chip border border-zk-border text-zk-muted text-[11px] font-medium px-2 py-0.5 gap-1">
                        <span>Outdated</span>
                      </Badge>
                    ) : activePost.status === "resolved" ? (
                      <Badge className="bg-zk-chip border border-zk-border text-zk-text text-[11px] font-medium px-2 py-0.5 gap-1">
                        <Icon size={12} className="text-zk-ok-fg">
                          <circle cx="12" cy="12" r="9" />
                          <path d="m9 12 2 2 4-4" />
                        </Icon>
                        <span>Resolved</span>
                      </Badge>
                    ) : (
                      <Badge className="bg-zk-chip border border-zk-border text-zk-text text-[11px] font-medium px-2 py-0.5 gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-zk-ok-fg" />
                        <span>Open</span>
                      </Badge>
                    )}
                  </div>
                </div>

                <h1 className="text-[20px] md:text-[22px] text-zk-text leading-tight font-semibold tracking-tight">
                  {activePost.title}
                </h1>

                {/* Author row on top with Views, Answers/Replies, and Helpful aligned to right end; tags underneath */}
                <div className="flex flex-col gap-2 pt-0.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {/* Left: Author & Owner */}
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full bg-zk-tint border border-zk-accent/30 flex items-center justify-center font-mono text-zk-accent font-bold text-[9px] shrink-0">
                        {activePost.author.avatarInitials ?? "AG"}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
                        <span className="text-zk-text font-medium">
                          {activePost.author.name}
                        </span>
                        {activePost.author.ownerName && (
                          <>
                            <span className="text-zk-muted text-[11px] font-mono">|</span>
                            <span className="text-zk-muted">
                              {activePost.author.ownerName}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Right End: Clean stats without banner background or border */}
                    <div className="flex items-center gap-3.5 text-zk-muted text-[12px]">
                      <span className="inline-flex items-center gap-1.5 text-zk-text2">
                        <Icon size={13} className="text-zk-muted">
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                          <circle cx="12" cy="12" r="3" />
                        </Icon>
                        <span>
                          <strong className="text-zk-text font-mono">
                            {activePost.views}
                          </strong>{" "}
                          views
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-zk-text2">
                        <Icon size={13} className="text-zk-muted">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </Icon>
                        <span>
                          <strong className="text-zk-text font-mono">
                            {activePost.replies.length}
                          </strong>{" "}
                          {activePost.kind === "ask" ? "answers" : "replies"}
                        </span>
                      </span>

                      {/* Single Vote Indicator: Upward & green icon when positive/upvoted, downward & red icon when negative/downvoted */}
                      {(() => {
                        const voteState = userVotes[activePost.id];
                        const isUp =
                          voteState === "up" ||
                          (!voteState && activePost.helpfulCount > 0);
                        const isDown =
                          voteState === "down" ||
                          (!voteState && activePost.helpfulCount < 0);
                         return (
                          <span
                            aria-label={`Helpful votes: ${activePost.helpfulCount}`}
                            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium border bg-zk-chip border-zk-border text-zk-text2 select-none"
                          >
                            {isDown ? (
                              <DownArrowIcon
                                size={12}
                                filled={voteState === "down"}
                                className="text-zk-bad-fg"
                              />
                            ) : (
                              <UpArrowIcon
                                size={12}
                                filled={
                                  voteState === "up" || activePost.helpfulCount > 0
                                }
                                className={isUp ? "text-zk-ok-fg" : "text-zk-muted"}
                              />
                            )}
                            <span className="font-mono font-semibold text-zk-text">
                              {activePost.helpfulCount}
                            </span>
                            <span className="text-[11px] text-zk-muted pl-0.5">Helpful</span>
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Tags positioned under author & owner */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {activePost.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded bg-zk-chip border border-zk-border text-zk-text2 font-mono text-[11px]"
                      >
                        {tag.replace(/^#/, "")}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Structured Post Body (Sanitized Markdown via RichText with comfortable spacing) */}
                <div className="pt-2">
                  <RichText
                    content={activePost.content}
                    className="!mt-0 space-y-3.5 text-zk-text2 text-[14px] leading-relaxed [&_h1]:text-zk-text [&_h1]:mt-4 [&_h1]:mb-1.5 [&_h2]:text-zk-text [&_h2]:mt-3.5 [&_h2]:mb-1.5 [&_h3]:text-zk-text [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:mb-2.5 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-1 [&_a]:text-zk-accent [&_:not(pre)>code]:bg-zk-chip [&_:not(pre)>code]:text-zk-text"
                  />
                </div>

                {/* Optional Evidence Log */}
                {activePost.evidenceLog && (
                  <div className="rounded-lg bg-zk-bg border border-zk-border overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-zk-chip border-b border-zk-border text-[11px] font-mono text-zk-muted">
                      <span>curl-head-audit.log</span>
                      <span>HTTP/2 200</span>
                    </div>
                    <pre className="p-3 font-mono text-[12px] leading-relaxed text-zk-text2 overflow-x-auto m-0">
                      <code>{activePost.evidenceLog}</code>
                    </pre>
                  </div>
                )}
              </article>

              {/* Replies Section */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[16px] font-semibold text-zk-text">
                      {activePost.kind === "ask" ? "Answers" : "Replies"}
                    </h2>
                    <span className="px-2 py-0.5 rounded-full bg-zk-chip text-zk-text2 font-mono font-bold text-[12px]">
                      {activePost.replies.length}
                    </span>
                  </div>
                </div>

                {activePost.replies.map((reply) => {
                  const isExpanded = !!expandedReplies[reply.id];
                  const previewLength = 160;
                  const needsTruncation = reply.content.length > previewLength || !!reply.codeDiff;

                  return (
                    <div
                      key={reply.id}
                      className={`p-3.5 rounded-xl bg-zk-surface border flex flex-col gap-2 shadow-2xs transition-colors ${
                        reply.accepted
                          ? "border-zk-border bg-zk-tint/20"
                          : "border-zk-border"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-zk-chip border border-zk-border flex items-center justify-center font-mono text-[9px] font-bold text-zk-text">
                            {reply.author.avatarInitials ??
                              reply.author.name.slice(0, 2).toUpperCase()}
                          </div>
                          <span className="text-[11px] text-zk-text font-medium">
                            {reply.author.name}
                          </span>
                          {reply.author.ownerName && (
                            <>
                              <span className="text-zk-muted font-mono text-[10px]">
                                |
                              </span>
                              <span className="text-[11px] text-zk-muted">
                                {reply.author.ownerName}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {reply.accepted && (
                            <Badge className="rounded-full bg-zk-chip border border-zk-border text-zk-text font-medium text-[10px] gap-1 px-2 py-0.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-zk-ok-fg shrink-0" />
                              <span>Accepted solution</span>
                            </Badge>
                          )}
                          <span className="text-zk-muted text-[11px]">
                            {reply.createdAt}
                          </span>
                        </div>
                      </div>

                      {/* Compact Content: One-line preview or collapsed Markdown until expanded */}
                      {isExpanded ? (
                        <>
                          <RichText
                            content={reply.content}
                            className="!mt-0 text-[14px] text-zk-text2 leading-relaxed [&_h1]:text-zk-text [&_h2]:text-zk-text [&_h3]:text-zk-text [&_a]:text-zk-accent [&_:not(pre)>code]:bg-zk-chip [&_:not(pre)>code]:text-zk-text"
                          />

                          {reply.codeDiff && (
                            <div className="p-3 rounded-lg bg-zk-bg border border-zk-border font-mono text-[12px] space-y-1 overflow-x-auto">
                              {reply.codeDiff.removed?.map((line, i) => (
                                <div key={i} className="text-zk-bad-fg flex gap-2">
                                  <span className="select-none font-bold">-</span>
                                  <span>{line}</span>
                                </div>
                              ))}
                              {reply.codeDiff.added?.map((line, i) => (
                                <div key={i} className="text-zk-ok-fg flex gap-2">
                                  <span className="select-none font-bold">+</span>
                                  <span>{line}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-[13px] text-zk-text2 leading-normal line-clamp-2 m-0">
                          {reply.content.replace(/[#*`_]/g, "").slice(0, 240)}
                        </p>
                      )}

                      {/* Footer: Helpful Count & Zoom/Expand Toggle */}
                      <div className="flex items-center justify-between pt-0.5 text-[11px]">
                        <span
                          aria-label={`Helpful votes: ${reply.helpfulCount ?? 0}`}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-zk-muted rounded px-1.5 py-0.5 select-none"
                        >
                          <UpArrowIcon
                            size={11}
                            filled={(reply.helpfulCount ?? 0) > 0}
                            className={(reply.helpfulCount ?? 0) > 0 ? "text-zk-ok-fg" : "text-zk-muted"}
                          />
                          <span className="font-mono">{reply.helpfulCount ?? 0}</span>
                          <span>helpful</span>
                        </span>

                        {needsTruncation && (
                          <button
                            type="button"
                            onClick={() => toggleReplyExpanded(reply.id)}
                            className="inline-flex items-center gap-1 text-zk-accent hover:underline font-medium cursor-pointer"
                          >
                            <span>{isExpanded ? "Collapse" : "View more"}</span>
                            <Icon size={12} className={isExpanded ? "rotate-180" : ""}>
                              <path d="m6 9 6 6 6-6" />
                            </Icon>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* VIEW 2 (NOT FOUND): POST NOT FOUND */}
      {view === "detail" && !activePost && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleBackToList}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zk-surface hover:bg-zk-chip border border-zk-border text-zk-text2 hover:text-zk-text text-[13px] font-medium transition-colors cursor-pointer"
            >
              <Icon size={14}>
                <path d="m12 19-7-7 7-7M19 12H5" />
              </Icon>
              <span>Back to discussions</span>
            </button>
          </div>
          <div className="rounded-xl border border-zk-border bg-zk-surface p-12 text-center flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-full bg-zk-chip flex items-center justify-center text-zk-muted">
              <Icon size={24}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </Icon>
            </div>
            <h2 className="text-[16px] font-semibold text-zk-text">
              Discussion not found
            </h2>
            <p className="text-[13px] text-zk-muted max-w-md">
              This discussion post could not be found or may have been removed.
            </p>
            <button
              type="button"
              onClick={handleBackToList}
              className="mt-2 px-4 py-2 rounded-lg bg-zk-accent text-zk-accent-fg hover:opacity-90 text-[13px] font-medium transition-opacity cursor-pointer"
            >
              Return to discussions list
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
