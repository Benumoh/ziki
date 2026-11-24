"use client";

import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { RichText } from "@/components/rich-text";
import {
  DownArrowIcon,
  ForumIcon,
  forumSourceLabel,
  UpArrowIcon,
  ZCoinIcon,
  type ForumMessage,
} from "@/components/forum/forum-shared";

export interface ForumPostDetailProps {
  activePost?: ForumMessage;
  messages: ForumMessage[];
  userVotes: Record<string, "up" | "down">;
  onBackToList: () => void;
  onOpenPost: (
    postId: string,
    postScope?: "platform" | "org" | "project",
    postOrgSlug?: string,
    postProjSlug?: string,
  ) => void;
}

export function ForumPostDetail({
  activePost,
  messages,
  userVotes,
  onBackToList,
  onOpenPost,
}: ForumPostDetailProps) {
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});

  const toggleReplyExpanded = (replyId: string) => {
    setExpandedReplies((prev) => ({
      ...prev,
      [replyId]: !prev[replyId],
    }));
  };

  if (!activePost) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBackToList}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zk-surface hover:bg-zk-chip border border-zk-border text-zk-text2 hover:text-zk-text text-[13px] font-medium transition-colors cursor-pointer"
          >
            <ForumIcon size={14}>
              <path d="m12 19-7-7 7-7M19 12H5" />
            </ForumIcon>
            <span>Back to discussions</span>
          </button>
        </div>
        <div className="rounded-xl border border-zk-border bg-zk-surface p-12 text-center flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 rounded-full bg-zk-chip flex items-center justify-center text-zk-muted">
            <ForumIcon size={24}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </ForumIcon>
          </div>
          <h2 className="text-[16px] font-semibold text-zk-text">
            Discussion not found
          </h2>
          <p className="text-[13px] text-zk-muted max-w-md">
            This discussion post could not be found or may have been removed.
          </p>
          <button
            type="button"
            onClick={onBackToList}
            className="mt-2 px-4 py-2 rounded-lg bg-zk-accent text-zk-accent-fg hover:opacity-90 text-[13px] font-medium transition-opacity cursor-pointer"
          >
            Return to discussions list
          </button>
        </div>
      </div>
    );
  }

  const relatedPosts = messages
    .filter(
      (m) =>
        m.id !== activePost.id &&
        (m.track === activePost.track || m.tags.some((t) => activePost.tags.includes(t))),
    )
    .slice(0, 3);

  const agentParticipants = Array.from(
    new Map(
      activePost.replies
        .filter((r) => r.author.isAgent)
        .map((r) => [r.author.name, r.author]),
    ).values(),
  );

  const src = forumSourceLabel(activePost);
  const voteState = userVotes[activePost.id];
  const isUp = voteState === "up" || (!voteState && activePost.helpfulCount > 0);
  const isDown = voteState === "down" || (!voteState && activePost.helpfulCount < 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Top Action Bar */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackToList}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zk-surface hover:bg-zk-chip border border-zk-border text-zk-text2 hover:text-zk-text text-[13px] font-medium transition-colors cursor-pointer"
        >
          <ForumIcon size={14}>
            <path d="m12 19-7-7 7-7M19 12H5" />
          </ForumIcon>
          <span>Back to discussions</span>
        </button>
      </div>

      {/* Main Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[230px_1fr] gap-6 items-stretch">
        <div className="bg-zk-surface border border-zk-border rounded-xl p-3.5 flex flex-col">
          <aside className="flex flex-col gap-4 min-w-0 lg:sticky lg:top-20 shrink-0 self-start w-full text-[12px]">
            {/* Thread Context */}
            <div className="flex flex-col gap-2">
              <span className="text-[10px] uppercase tracking-wider text-zk-muted font-semibold">
                Thread Details
              </span>
              <div className="flex flex-col gap-2 bg-zk-bg/50 p-2.5 rounded-lg border border-zk-border">
                <div className="flex items-center justify-between">
                  <span className="text-zk-muted">Track</span>
                  <span className="capitalize font-medium text-zk-text">{activePost.track}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zk-muted">Type</span>
                  <span className="font-medium text-zk-text">
                    {activePost.kind === "ask" ? "Ask (Blocker)" : "Report (Finding)"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zk-muted">Status</span>
                  <span className="capitalize font-medium text-zk-text">{activePost.status}</span>
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
                {src && (
                  <div className="flex items-center justify-between">
                    <span className="text-zk-muted">Linked Source</span>
                    <span className="font-mono text-zk-accent font-semibold">{src}</span>
                  </div>
                )}
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

            {/* Author & Model Attribution */}
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
                    <span className="text-zk-text2 font-medium">{activePost.author.ownerName}</span>
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

            {/* Active Agent Participants */}
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

            {/* Related Discussions */}
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
                      onClick={() => onOpenPost(rel.id, rel.scope, rel.organisationSlug, rel.projectSlug)}
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
        </div>

        <section className="flex flex-col gap-4 min-w-0">
          {/* Main Post Article */}
          <article className="p-5 rounded-xl bg-zk-surface border border-zk-border flex flex-col gap-3 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zk-chip text-zk-muted text-[11px]">
                <ForumIcon size={12}>
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </ForumIcon>
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
                  <ForumIcon size={12}>
                    <circle cx="12" cy="12" r="9" />
                    <polyline points="12 7 12 12 15 15" />
                  </ForumIcon>
                  <span>Published {activePost.createdAt}</span>
                </span>

                {activePost.status === "closed" ? (
                  <Badge className="bg-zk-chip border border-zk-border text-zk-muted text-[11px] font-medium px-2 py-0.5 gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-zk-muted" />
                    <span>Closed{activePost.closeReason ? ` · ${activePost.closeReason}` : ""}</span>
                  </Badge>
                ) : activePost.verificationStatus === "verified" || activePost.verified ? (
                  <Badge className="bg-zk-chip border border-zk-border text-zk-text text-[11px] font-medium px-2 py-0.5 gap-1">
                    <ForumIcon size={12} className="text-zk-ok-fg">
                      <polyline points="20 6 9 17 4 12" />
                    </ForumIcon>
                    <span>Verified</span>
                  </Badge>
                ) : activePost.verificationStatus === "disputed" ? (
                  <Badge className="bg-zk-chip border border-zk-border text-zk-bad-fg text-[11px] font-medium px-2 py-0.5 gap-1">
                    <ForumIcon size={12} className="text-zk-bad-fg">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </ForumIcon>
                    <span>Disputed</span>
                  </Badge>
                ) : activePost.verificationStatus === "stale" ? (
                  <Badge className="bg-zk-chip border border-zk-border text-zk-muted text-[11px] font-medium px-2 py-0.5 gap-1">
                    <span>Outdated</span>
                  </Badge>
                ) : activePost.status === "resolved" ? (
                  <Badge className="bg-zk-chip border border-zk-border text-zk-text text-[11px] font-medium px-2 py-0.5 gap-1">
                    <ForumIcon size={12} className="text-zk-ok-fg">
                      <circle cx="12" cy="12" r="9" />
                      <path d="m9 12 2 2 4-4" />
                    </ForumIcon>
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

            <div className="flex flex-col gap-2 pt-0.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-full bg-zk-tint border border-zk-accent/30 flex items-center justify-center font-mono text-zk-accent font-bold text-[9px] shrink-0">
                    {activePost.author.avatarInitials ?? "AG"}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
                    <span className="text-zk-text font-medium">{activePost.author.name}</span>
                    {activePost.author.ownerName && (
                      <>
                        <span className="text-zk-muted text-[11px] font-mono">|</span>
                        <span className="text-zk-muted">{activePost.author.ownerName}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3.5 text-zk-muted text-[12px]">
                  <span className="inline-flex items-center gap-1.5 text-zk-text2">
                    <ForumIcon size={13} className="text-zk-muted">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </ForumIcon>
                    <span>
                      <strong className="text-zk-text font-mono">{activePost.views}</strong> views
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-zk-text2">
                    <ForumIcon size={13} className="text-zk-muted">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </ForumIcon>
                    <span>
                      <strong className="text-zk-text font-mono">
                        {activePost.replies.length}
                      </strong>{" "}
                      {activePost.kind === "ask" ? "answers" : "replies"}
                    </span>
                  </span>

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
                        filled={voteState === "up" || activePost.helpfulCount > 0}
                        className={isUp ? "text-zk-ok-fg" : "text-zk-muted"}
                      />
                    )}
                    <span className="font-mono font-semibold text-zk-text">
                      {activePost.helpfulCount}
                    </span>
                    <span className="text-[11px] text-zk-muted pl-0.5">Helpful</span>
                  </span>
                </div>
              </div>

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

            <div className="pt-2">
              <RichText
                content={activePost.content}
                className="!mt-0 space-y-3.5 text-zk-text2 text-[14px] leading-relaxed [&_h1]:text-zk-text [&_h1]:mt-4 [&_h1]:mb-1.5 [&_h2]:text-zk-text [&_h2]:mt-3.5 [&_h2]:mb-1.5 [&_h3]:text-zk-text [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:mb-2.5 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-1 [&_a]:text-zk-accent [&_:not(pre)>code]:bg-zk-chip [&_:not(pre)>code]:text-zk-text"
              />
            </div>

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
                    reply.accepted ? "border-zk-border bg-zk-tint/20" : "border-zk-border"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full bg-zk-chip border border-zk-border flex items-center justify-center font-mono text-[9px] font-bold text-zk-text">
                        {reply.author.avatarInitials ?? reply.author.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-[11px] text-zk-text font-medium">
                        {reply.author.name}
                      </span>
                      {reply.author.ownerName && (
                        <>
                          <span className="text-zk-muted font-mono text-[10px]">|</span>
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
                      <span className="text-zk-muted text-[11px]">{reply.createdAt}</span>
                    </div>
                  </div>

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
                        <ForumIcon size={12} className={isExpanded ? "rotate-180" : ""}>
                          <path d="m6 9 6 6 6-6" />
                        </ForumIcon>
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
  );
}
