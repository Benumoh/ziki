import React from "react";
import type { AccessibleOrganisation, ExternalProject } from "@/lib/forum-types";

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
  isPinned?: boolean;
  pinnedAt?: string;
  bookmarkCount?: number;
  bookmarkedByViewer?: boolean;
  bookmarkNote?: string;
  replies: ForumReplyItem[];
}

export type StatusFilter = "all" | "open" | "resolved" | "verified" | "closed";
export type FeedFilter = "all" | "ask" | "report" | "archived";
export type TrackFilter = "all" | "product" | "marketing" | "security";
export type ForumViewMode = "list" | "detail";
export type SortOption = "trending" | "newest" | "helpful" | "replies" | "saved";
export type MyAgentsView = "posts" | "saved" | null;

export interface SelectedScope {
  type: "global" | "org" | "project" | "external";
  orgId?: string;
  projectId?: string;
  name: string;
}

export const FORUM_SCROLLBAR_CLASS =
  "[scrollbar-width:thin] [scrollbar-color:var(--zk-border)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zk-border/70 hover:[&::-webkit-scrollbar-thumb]:bg-zk-muted/50";

export const DEFAULT_ORGANISATIONS: AccessibleOrganisation[] = [
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

export const DEFAULT_EXTERNAL_PROJECTS: ExternalProject[] = [
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

export const POPULAR_TAGS = [
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

export function parseAgeHours(createdAt: string): number {
  const rel = /^(\d+)\s*([smhdw])/i.exec(createdAt.trim());
  if (rel) {
    const value = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    if (unit === "s") return value / 3600;
    if (unit === "m") return value / 60;
    if (unit === "h") return value;
    if (unit === "d") return value * 24;
    if (unit === "w") return value * 168;
  }
  const parsed = Date.parse(createdAt);
  if (!Number.isNaN(parsed)) {
    return Math.max(0, (Date.now() - parsed) / 3_600_000);
  }
  return 24;
}

export function trendingScore(msg: ForumMessage): number {
  const ageHours = parseAgeHours(msg.createdAt);
  return (msg.helpfulCount * 2 + msg.replies.length * 3 + 1) / Math.pow(ageHours + 2, 1.2);
}

/* Ziki design-system stroke SVG icon primitives */
export function ForumIcon({
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

export function UpArrowIcon({
  size = 12,
  filled = false,
  className = "",
}: {
  size?: number;
  filled?: boolean;
  className?: string;
}) {
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

export function DownArrowIcon({
  size = 12,
  filled = false,
  className = "",
}: {
  size?: number;
  filled?: boolean;
  className?: string;
}) {
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

export function ExternalLinkIcon({
  size = 11,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <ForumIcon size={size} className={className}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </ForumIcon>
  );
}

export function ZCoinIcon({ size = 10, className = "" }: { size?: number; className?: string }) {
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
