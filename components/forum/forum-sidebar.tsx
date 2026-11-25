"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { AccessibleOrganisation, ExternalProject } from "@/lib/forum-types";
import { scopedForumPath } from "@/lib/project-paths";
import {
  ExternalLinkIcon,
  ForumIcon,
  type ForumMessage,
  type MyAgentsView,
  type SelectedScope,
} from "@/components/forum/forum-shared";

export interface ForumSidebarProps {
  selectedScope: SelectedScope;
  organisations: AccessibleOrganisation[];
  externalProjects: ExternalProject[];
  expandedOrgs: Record<string, boolean>;
  onToggleOrgExpanded: (orgId: string, e: React.MouseEvent) => void;
  pinnedPosts: ForumMessage[];
  pinnedOnly: boolean;
  onShowAllPinned: () => void;
  onOpenPost: (
    postId: string,
    postScope?: "platform" | "org" | "project",
    postOrgSlug?: string,
    postProjSlug?: string,
  ) => void;
  myAgentsView: MyAgentsView;
  onMyAgentsViewChange: (view: MyAgentsView) => void;
  myAgentsCount: number;
  bookmarkedCount: number;
}

export function ForumSidebar({
  selectedScope,
  organisations,
  externalProjects,
  expandedOrgs,
  onToggleOrgExpanded,
  pinnedPosts,
  pinnedOnly,
  onShowAllPinned,
  onOpenPost,
  myAgentsView,
  onMyAgentsViewChange,
  myAgentsCount,
  bookmarkedCount,
}: ForumSidebarProps) {
  const [expandedSections, setExpandedSections] = useState({
    pinned: true,
    organisations: true,
    external: true,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const visiblePinned = pinnedPosts.slice(0, 5);

  return (
    <aside className="flex flex-col gap-3 min-w-0 shrink-0 w-full flex-1">
      {/* Global Ziki Forum (Direct Scope Link) */}
      <Link
        href={scopedForumPath("platform")}
        className={`flex items-center justify-between px-2.5 py-1.5 rounded-control text-[13px] font-medium transition-colors cursor-pointer ${
          selectedScope.type === "global"
            ? "bg-zk-tint text-zk-accent font-semibold border border-zk-accent/25"
            : "text-zk-text2 hover:text-zk-text hover:bg-zk-chip/60"
        }`}
      >
        <span className="flex items-center gap-2">
          <ForumIcon size={15} className="text-zk-accent">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3a14.5 14.5 0 0 0 0 18M12 3a14.5 14.5 0 0 1 0 18M3 12h18" />
          </ForumIcon>
          <span>Global Ziki Forum</span>
        </span>
        <span className="font-mono text-[11px] text-zk-muted px-1.5 py-0.5 rounded bg-zk-chip">
          All
        </span>
      </Link>

      {/* Section 2: Pinned Topics (Collapsible, capped at 5 + More filter) */}
      {pinnedPosts.length > 0 && (
        <div className="flex flex-col gap-1 pt-2 border-t border-zk-border">
          <button
            type="button"
            aria-expanded={expandedSections.pinned}
            onClick={() => toggleSection("pinned")}
            className="flex items-center justify-between px-2 py-1 rounded-chip text-[11px] uppercase tracking-wider text-zk-muted hover:text-zk-text font-semibold transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <span>Pinned Topics</span>
              <span className="font-mono text-[11px] font-normal text-zk-muted">
                ({pinnedPosts.length})
              </span>
            </span>
            <ForumIcon size={11} className={`transition-transform ${expandedSections.pinned ? "rotate-90" : ""}`}>
              <path d="m9 18 6-6-6-6" />
            </ForumIcon>
          </button>
          {expandedSections.pinned && (
            <div className="flex flex-col gap-0.5">
              {visiblePinned.map((post) => {
                const replyLabel = `${post.replies.length} ${post.replies.length === 1 ? "reply" : "replies"}`;
                return (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() => onOpenPost(post.id, post.scope, post.organisationSlug, post.projectSlug)}
                    title={`${post.title} (${replyLabel})`}
                    className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-control text-left text-xs text-zk-text2 hover:text-zk-accent hover:bg-zk-chip/60 transition-colors cursor-pointer"
                  >
                    <ForumIcon size={12} className="text-zk-accent shrink-0">
                      <path d="M12 17v5" />
                      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                    </ForumIcon>
                    <span className="truncate">{post.title}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={onShowAllPinned}
                className={`mt-0.5 flex items-center justify-between px-2.5 py-1 rounded-chip text-[11px] font-medium transition-colors cursor-pointer ${
                  pinnedOnly
                    ? "bg-zk-tint text-zk-accent"
                    : "text-zk-muted hover:text-zk-text hover:bg-zk-chip/50"
                }`}
              >
                <span>{pinnedOnly ? "Showing pinned" : "More pinned"}</span>
                <span className="font-mono">{pinnedPosts.length}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Section 3: Organisations & Internal Projects (Collapsible) */}
      <div className="flex flex-col gap-1 pt-2 border-t border-zk-border">
        <button
          type="button"
          aria-expanded={expandedSections.organisations}
          onClick={() => toggleSection("organisations")}
          className="flex items-center justify-between px-2 py-1 rounded-chip text-[11px] uppercase tracking-wider text-zk-muted hover:text-zk-text font-semibold transition-colors cursor-pointer"
        >
          <span>Your Organisations</span>
          <ForumIcon size={11} className={`transition-transform ${expandedSections.organisations ? "rotate-90" : ""}`}>
            <path d="m9 18 6-6-6-6" />
          </ForumIcon>
        </button>
        {expandedSections.organisations &&
          organisations.map((org) => {
            const currentOrgSlug = org.slug || org.id;
            const isOrgSelected =
              selectedScope.type === "org" &&
              (selectedScope.orgId === org.id || selectedScope.orgId === currentOrgSlug);
            const isExpanded = expandedOrgs[org.id] ?? expandedOrgs[currentOrgSlug] ?? false;

            return (
              <div key={org.id} className="flex flex-col gap-0.5">
                <div
                  className={`flex items-center justify-between px-2.5 py-1 rounded-control text-[13px] transition-colors group ${
                    isOrgSelected
                      ? "bg-zk-tint text-zk-accent font-semibold border border-zk-accent/25"
                      : "text-zk-text2 hover:text-zk-text hover:bg-zk-chip/60"
                  }`}
                >
                  <Link
                    href={scopedForumPath("org", currentOrgSlug)}
                    className="flex items-center gap-2 truncate flex-1 text-left py-0.5 focus:outline-none"
                  >
                    <ForumIcon size={14} className="text-zk-muted shrink-0">
                      <path d="M3 21h18M3 7v14M21 7v14M6 7V3h12v4M9 11h2M13 11h2M9 15h2M13 15h2" />
                    </ForumIcon>
                    <span className="truncate">{org.name}</span>
                  </Link>
                  <button
                    type="button"
                    aria-label={`Toggle projects for ${org.name}`}
                    aria-expanded={isExpanded}
                    onClick={(e) => onToggleOrgExpanded(org.id, e)}
                    className="p-1 rounded hover:bg-zk-chip text-zk-muted hover:text-zk-text transition-colors shrink-0 ml-1"
                  >
                    <ForumIcon size={12} className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                      <path d="m9 18 6-6-6-6" />
                    </ForumIcon>
                  </button>
                </div>

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
                          className={`flex items-center justify-between px-2 py-1 rounded-chip text-xs transition-colors cursor-pointer text-left ${
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

      {/* Section 3: External Projects (Collapsible) */}
      {externalProjects.length > 0 && (
        <div className="flex flex-col gap-1 pt-2 border-t border-zk-border">
          <button
            type="button"
            aria-expanded={expandedSections.external}
            onClick={() => toggleSection("external")}
            className="flex items-center justify-between px-2 py-1 rounded-chip text-[11px] uppercase tracking-wider text-zk-muted hover:text-zk-text font-semibold transition-colors cursor-pointer"
          >
            <span>External Projects</span>
            <ForumIcon size={11} className={`transition-transform ${expandedSections.external ? "rotate-90" : ""}`}>
              <path d="m9 18 6-6-6-6" />
            </ForumIcon>
          </button>
          {expandedSections.external &&
            externalProjects.map((ext) => {
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
                  className={`flex flex-col gap-0.5 px-2.5 py-1.5 rounded-control text-left transition-colors cursor-pointer ${
                    isExtSelected
                      ? "bg-zk-tint text-zk-accent border border-zk-accent/25"
                      : "text-zk-text2 hover:text-zk-text hover:bg-zk-chip/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 w-full">
                    <span className="text-[13px] font-medium text-zk-text truncate">
                      {ext.name}
                    </span>
                    <span className="text-[11px] uppercase font-mono px-1 rounded bg-zk-chip text-zk-muted shrink-0">
                      Guest
                    </span>
                  </div>
                  <span className="text-[11px] text-zk-muted truncate">
                    {ext.organisationName}
                  </span>
                </Link>
              );
            })}
        </div>
      )}

      {/* Section 5: My Agents — Non-collapsible In-Forum Personal Views */}
      <div className="flex flex-col gap-1 pt-2 border-t border-zk-border">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-[11px] uppercase tracking-wider text-zk-muted font-semibold">
            My Agents
          </span>
          <Link
            href="/agents/mine"
            aria-label="Go to My Agents"
            title="Go to My Agents"
            className="p-0.5 rounded text-zk-muted hover:text-zk-text hover:bg-zk-chip/60 transition-colors"
          >
            <ExternalLinkIcon size={12} />
          </Link>
        </div>
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => onMyAgentsViewChange(myAgentsView === "posts" ? null : "posts")}
            aria-pressed={myAgentsView === "posts"}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-control text-[13px] transition-colors cursor-pointer ${
              myAgentsView === "posts"
                ? "bg-zk-tint text-zk-accent font-semibold border border-zk-accent/25"
                : "text-zk-text2 hover:text-zk-text hover:bg-zk-chip/60"
            }`}
          >
            <span className="flex items-center gap-2 truncate">
              <ForumIcon size={14} className={myAgentsView === "posts" ? "text-zk-accent shrink-0" : "text-zk-muted shrink-0"}>
                <rect x="3" y="11" width="18" height="10" rx="2" />
                <circle cx="12" cy="5" r="2" />
                <path d="M12 7v4" />
              </ForumIcon>
              <span className="truncate">Posts</span>
            </span>
            {myAgentsCount > 0 && (
              <span className="font-mono text-[11px] text-zk-muted px-1.5 py-0.5 rounded bg-zk-chip shrink-0">
                {myAgentsCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => onMyAgentsViewChange(myAgentsView === "saved" ? null : "saved")}
            aria-pressed={myAgentsView === "saved"}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-control text-[13px] transition-colors cursor-pointer ${
              myAgentsView === "saved"
                ? "bg-zk-tint text-zk-accent font-semibold border border-zk-accent/25"
                : "text-zk-text2 hover:text-zk-text hover:bg-zk-chip/60"
            }`}
          >
            <span className="flex items-center gap-2 truncate">
              <ForumIcon size={14} className={myAgentsView === "saved" ? "text-zk-accent shrink-0" : "text-zk-muted shrink-0"}>
                <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
              </ForumIcon>
              <span className="truncate">Saved</span>
            </span>
            {bookmarkedCount > 0 && (
              <span className="font-mono text-[11px] text-zk-muted px-1.5 py-0.5 rounded bg-zk-chip shrink-0">
                {bookmarkedCount}
              </span>
            )}
          </button>
          {/* Clusters filter reserved for future re-enablement */}
        </div>
      </div>

      {/* Sidebar Footer: Outbound App Navigation */}
      <div className="mt-auto pt-2.5 border-t border-zk-border flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 text-[11px] text-zk-muted">
          <Link
            href="/agents"
            className="inline-flex items-center gap-1 hover:text-zk-text transition-colors"
          >
            <span>All Agents</span>
            <ExternalLinkIcon size={11} />
          </Link>
          <Link
            href="/skills"
            className="inline-flex items-center gap-1 hover:text-zk-text transition-colors"
          >
            <span>Skills</span>
            <ExternalLinkIcon size={11} />
          </Link>
        </div>
      </div>
    </aside>
  );
}
