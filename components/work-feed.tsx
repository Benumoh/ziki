"use client";

import Link from "next/link";
import type React from "react";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveDeliveredWorkAction, confirmLiveWorkAction } from "@/app/actions/human-steps";
import { CelebrationStyles, DancingAgent, Fireworks, Hearts } from "@/components/celebrate";
import { LocalTime } from "@/components/local-time";
import { IDEA_ADDED_EVENT } from "@/lib/just-added";
import { RichText } from "@/components/rich-text";
import { BASE_PATH } from "@/lib/base-path";
import { formatIssueNumber } from "@/lib/issue-number";
import { cleanTitle } from "@/lib/issue-title";
import type { Substatus } from "@prisma/client";
import { PILL_TONES, TILE_TONES, toneForName, type PillTone } from "@/lib/pill-tones";
import { STATUS_BADGE } from "@/lib/status-badge";

/** What a section of the feed holds, and what it asks of you (#work-feed). */
export type WorkFeedKind = "design" | "delivered" | "live" | "working" | "waiting";

export type WorkFeedItem = {
  id: string;
  kind: WorkFeedKind;
  number: number;
  title: string;
  href: string;
  at: Date;
  projectName: string | null;
  /** Who is on it, or who it is for. */
  who: string | null;
  /** Opened: who reported it, its summary and description (trimmed), its files, and the decision it asks of you. */
  reporter: string | null;
  summary: string | null;
  body: string;
  files: { id: string; name: string; type: string; size: number }[];
  decision: { label: string; href: string };
  /** Delivered work: where it can be seen running (its preview, else the delivery's link), or null. */
  liveUrl: string | null;
  /** Its pull request, kept apart from where it runs. */
  pullRequestUrl: string | null;
  /** Delivered work: the delivery's screenshots (links) of how it looks now, shown as a preview when the card is opened. */
  screenshots: string[];
  /** And of how it looked when the work started (#delivery-screenshots). */
  beforeScreenshots: string[];
  canApprove: boolean;
  /** Already judged good to merge: Approve shows as done. */
  approved: boolean;
  /** Live work nobody has confirmed yet: "Looks fine" moves it to Delivered (#live-confirmed). */
  canConfirm: boolean;
  /** Live work someone confirmed (Live · Confirmed). */
  confirmed: boolean;
  /** Where it is: its step (substatus), shown as one word with its colour and icon (lib/status-badge.ts). */
  substatus: Substatus;
  /** Work under way: how far along it is (0 to 1), or null for no bar. */
  progress: number | null;
  /** What `progress` measures: the agent's time to delivery, or how far along its step is when it has no due time. */
  progressBy: "time" | "step";
  /** When the work was last delivered, or null when it has not been. */
  deliveredAt: Date | null;
  /** When the issue was added (converted from its idea). */
  addedAt: Date;
  /** When an agent first took it, or null when none has. */
  startedAt: Date | null;
  /** In the Stalled section: since when it hasn't moved; null elsewhere. */
  stalledSince: Date | null;
  /** Who delivered it: the person the delivering agent works for, or null. */
  deliveredBy: string | null;
  /** The newest delivery, at the top of Needs your OK: celebrated with a dancing agent and fireworks (#just-delivered). */
  justDelivered: boolean;
  /** Whether an agent holds it now (an active claim). */
  held: boolean;
  /** In the Stalled section: why it is stalled, in a sentence; null elsewhere. */
  stallReason: string | null;
  /** Why it isn't merged yet, from the latest pull request report, or null when nothing is in the way. */
  mergeHold: string | null;
};

/** Each kind's section name, colour, icon and the line its rows say. */
const KIND: Record<WorkFeedKind, { label: string; tone: PillTone; icon: string; line: string }> = {
  design: { label: "Designs to review", tone: "purple", icon: "M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.586 7.586M11 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", line: "An agent proposed a design. Pick the one you want." },
  delivered: { label: "Delivered", tone: "green", icon: "M20 6 9 17l-5-5", line: "The work is done. Take a look before it goes live." },
  live: { label: "Live", tone: "cyan", icon: "M22 12h-4l-3 9L9 3l-3 9H2", line: "This is out. Check it works for you." },
  working: { label: "In progress", tone: "blue", icon: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83", line: "An agent is working on it." },
  waiting: { label: "Waiting", tone: "yellow", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2", line: "Waiting for an agent to take it on." },
};

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue";

function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "PDF", "PNG": the short kind of a file, from its name or type. */
function fileKind(type: string, name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()! : type.split("/").pop() ?? "";
  return ext.slice(0, 4).toUpperCase();
}

/**
 * A card's action button (Approve, Looks fine), styled as the ideas list's original Approve (#idea-path): solid green,
 * raised, small bold text after a thumbs-up, with a hover and a press, unlike the flat pills that only say where
 * something is.
 */
export const RAISED =
  "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border border-[#1f9d55] bg-[#22a85b] px-2 text-[11.5px] font-bold text-white shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition hover:brightness-110 active:translate-y-px active:shadow-none disabled:cursor-default disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue";

/** The thumbs-up on a raised action button. */
function ThumbsUp() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 10v11M15 5.9 14 10h5.8a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 18.4 21H7V10l4-8a3.1 3.1 0 0 1 4 3.9zM3 10h4v11H3z" /></svg>
  );
}

/** The pill on a card's right: soft tint, strong text. */
export const PILL = "inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[12.5px] font-semibold";

/** A card's status (#work-feed): one word for where it is, in its colour, with an icon beside it. */
export function StatusBadge({ substatus, className = "" }: { substatus: Substatus; className?: string }) {
  const badge = STATUS_BADGE[substatus];
  return (
    <span className={`${PILL} ${className}`} style={PILL_TONES[badge.tone]}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
        <path d={badge.icon} />
      </svg>
      {badge.label}
    </span>
  );
}

/**
 * The Overview's list (#work-feed): its title with the tabs and the Status filter on top, then a white card per piece
 * of work, newest first (the Work Feed mixes its statuses): who is on it, its title, its number, project and when it
 * last moved, and a pill on the right with its status, or Approve on delivered work. Clicking a card unfolds
 * it downwards, in place, as an opened email; clicking its head folds it.
 */
export function WorkFeed({ items, groups, title, toolbar, empty, footer, justAdded = [] }: {
  items: WorkFeedItem[];
  /** Ideas filed in the last day (#just-added), newest first, shown above the sections; the one just filed flashes. */
  justAdded?: JustAddedIdea[];
  /**
   * The Work Feed's sections (#work-feed-sections), top to bottom: each its title, a line on what it holds, how many,
   * a few cards, and a link to all of it. Given instead of `items`.
   */
  groups?: { key: string; title: string; count: number; items: WorkFeedItem[]; moreHref: string | null }[];
  title: string;
  /** The tabs and the Status filter, at the top right. */
  toolbar?: React.ReactNode;
  /** What it says while it has no work. */
  empty?: React.ReactNode;
  /** Under the cards: the pages. */
  footer?: React.ReactNode;
}) {
  // The opened card, or null for none.
  const [openId, setOpenId] = useState<string | null>(null);
  // The idea the chat just filed (#just-added): it flashes as it appears, for a few seconds.
  const [flash, setFlash] = useState<number | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAdded = (event: Event) => {
      const number = (event as CustomEvent<{ number: number }>).detail?.number;
      if (!number) return;
      setFlash(number);
      clearTimeout(timer);
      timer = setTimeout(() => setFlash(null), 6000);
    };
    window.addEventListener(IDEA_ADDED_EVENT, onAdded);
    return () => {
      window.removeEventListener(IDEA_ADDED_EVENT, onAdded);
      clearTimeout(timer);
    };
  }, []);

  // A list of cards on the gray inset, as Marketing's are.
  const cards = (list: WorkFeedItem[], label: string) => (
        <ul className="m-0 flex list-none flex-col gap-3 rounded-xl bg-zk-bg p-4" aria-label={label}>
          {list.map((item) => {
            const who = item.who ?? "Nobody yet";
            return (
              <li key={item.id}>
                {openId === item.id ? (
                  // Opened, the card unfolds into the whole of it, as an opened email.
                  <FeedCard item={item} id={`work-feed-detail-${item.id}`} onClose={() => setOpenId(null)} />
                ) : (
                  <div className={item.justDelivered ? "relative overflow-hidden rounded-2xl border border-[#efd9a6] bg-white shadow-[0_2px_10px_rgba(0,0,0,0.05)]" : ""}>
                  {/* The newest delivery (#just-delivered): who delivered it, with a dancing agent and fireworks. */}
                  {item.justDelivered ? <JustDelivered by={item.deliveredBy} /> : null}
                  <div className={`flex items-center gap-4 bg-white px-5 py-4 transition hover:bg-zk-bg ${item.justDelivered ? "" : "rounded-2xl border border-zk-border"}`}>
                    <button
                      type="button"
                      aria-expanded={false}
                      onClick={() => setOpenId(item.id)}
                      className={`flex min-w-0 flex-1 cursor-pointer items-center gap-4 text-left ${focus}`}
                    >
                      <IssueThumb item={item} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-zk-text">{cleanTitle(item.title)}</span>
                        <span className="mt-0.5 block truncate text-[13px] text-zk-muted">
                          <span className="tabular-nums">{formatIssueNumber(item.number)}</span>
                          {item.projectName ? ` · ${item.projectName}` : ""} · {who} · <LocalTime date={item.at} />
                        </span>
                      </span>
                    </button>
                    {/* On the right, one thing: the progress bar on work being worked on (accepted and merging work
                        included, though it was delivered), else Approve on delivered work, Approve on live work, else
                        its status. */}
                    {item.stalledSince ? (
                      <StalledLabel item={item} className="max-sm:hidden" />
                    ) : item.progress !== null ? (
                      <ProgressBar value={item.progress} by={item.progressBy} substatus={item.substatus} className="max-sm:hidden" />
                    ) : item.kind === "delivered" ? (
                      <DeliveredActions item={item} className="max-sm:hidden" />
                    ) : item.canConfirm || item.confirmed ? (
                      <ConfirmLive item={item} className="max-sm:hidden" />
                    ) : (
                      <StatusBadge substatus={item.substatus} className="max-sm:hidden" />
                    )}
                  </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
  );

  return (
    <section aria-label={title}>
      {/* No title: the tabs on the left say which list this is, the Status filter is on the right. */}
      {toolbar ? <div className="mb-4 flex flex-wrap items-center justify-between gap-2">{toolbar}</div> : null}
      {justAdded.length > 0 ? <JustAdded ideas={justAdded} flash={flash} /> : null}
      {groups ? (
        // The Work Feed's sections, each with its few newest cards and a link to all of them.
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`work-feed-${group.key}`}>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
                <div className="min-w-0">
                  <h2 id={`work-feed-${group.key}`} className="m-0 inline text-[15px] font-semibold text-zk-text">
                    {group.title} <span className="ml-1 text-[13px] font-medium tabular-nums text-zk-muted">{group.count}</span>
                  </h2>
                </div>
                {group.moreHref ? (
                  <Link href={group.moreHref} className={`shrink-0 text-[13px] font-medium text-zk-accent hover:underline ${focus}`}>
                    Show all {group.count} →
                  </Link>
                ) : null}
              </div>
              {group.items.length > 0 ? cards(group.items, group.title) : (
                <p className="m-0 rounded-xl bg-zk-bg px-4 py-4 text-[13px] text-zk-muted">Nothing here right now.</p>
              )}
            </section>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-zk-border bg-white p-5">{empty}</div>
      ) : (
        cards(items, "Work")
      )}
      {footer ? <div className="mt-3">{footer}</div> : null}
    </section>
  );
}

/** The kind of issue a title's tag names ("[UI/UX] …"), each with a colour and an icon that stands for it. */
const ISSUE_KINDS: Array<{ match: RegExp; tone: PillTone; icon: string }> = [
  // A window with a header: something on screen.
  { match: /^\[(ui|ux|ui\/ux|design)\]/i, tone: "purple", icon: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18M9 21V9" },
  // Brackets: the API.
  { match: /^\[api\]/i, tone: "blue", icon: "m16 18 6-6-6-6M8 6l-6 6 6 6" },
  // A bug.
  { match: /^\[bug\]/i, tone: "red", icon: "M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 1 1 6 0v1.1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6zM12 20v-9M6.5 13H3M21 13h-3.5M6 9 3.5 7M18 9l2.5-2M6 17l-3 2M18 17l3 2" },
  // A sparkle: something new.
  { match: /^\[feature\]/i, tone: "orange", icon: "M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" },
  // A page: the docs.
  { match: /^\[docs?\]/i, tone: "teal", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5" },
  // A gauge: speed.
  { match: /^\[perf(ormance)?\]/i, tone: "yellow", icon: "M12 14l4-4M3.3 19a10 10 0 1 1 17.4 0" },
  // A shield: security.
  { match: /^\[security\]/i, tone: "green", icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" },
];

/**
 * The picture at a card's left (#work-feed): the delivery's screenshot of how it looks now, when it was delivered
 * (#delivery-screenshots); else a small screenshot of the issue, its first image; otherwise a tile in the colour of the
 * kind of issue its title's tag names, with an icon that stands for it.
 */
export function IssueThumb({ item }: { item: Pick<WorkFeedItem, "title" | "files"> & { screenshots?: string[] } }) {
  const image = item.files.find((file) => file.type.startsWith("image/"));
  const src = item.screenshots?.[0] ?? (image ? `${BASE_PATH}/api/attachments/${image.id}` : null);
  if (src) {
    return (
      <span aria-hidden="true" className="relative h-11 w-14 shrink-0 overflow-hidden rounded-[10px] border border-zk-border bg-zk-bg">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small screenshot, from an attachment or the agent's link */}
        <img src={src} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
      </span>
    );
  }
  const kind = ISSUE_KINDS.find((entry) => entry.match.test(item.title.trim()));
  const tone = kind?.tone ?? toneForName(item.title);
  return (
    <span aria-hidden="true" className="flex h-11 w-14 shrink-0 items-center justify-center rounded-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]" style={TILE_TONES[tone]}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={kind?.icon ?? "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"} />
      </svg>
    </span>
  );
}

/** Work under way: a small rounded bar, filled as far as the agent is through its time to delivery. */
/** How many segments the bar has. */
const SEGMENTS = 20;

/**
 * Whether work under way is fine (#work-feed-sections): blue while there is time, orange once three quarters of the
 * agent's time has gone, red when it is nearly or already due. Work with no due time is measured by its step, and is fine.
 */
function progressTone(percent: number, by: "time" | "step"): { on: string; label: string } {
  if (by === "time" && percent >= 90) return { on: "#e5484d", label: "nearly due" };
  if (by === "time" && percent >= 75) return { on: "#f08a24", label: "running short" };
  return { on: "#2f8cf0", label: "fine" };
}

/** What work under way is waiting for, by its step. */
const WAITING_FOR: Partial<Record<Substatus, string>> = {
  plan_review: "Waiting for its plan to be approved",
  in_progress: "Waiting for the agent to deliver",
  accepted: "Waiting for a manager's review",
  ready_to_merge: "Waiting to be merged",
};

/**
 * Work under way (#work-feed-sections): how far along it is in small text, a segmented bar in the colour that says
 * whether it is fine, and under it what it is waiting for.
 */
function ProgressBar({ value, by, substatus, className = "" }: { value: number; by: "time" | "step"; substatus: Substatus; className?: string }) {
  const percent = Math.round(value * 100);
  const filled = Math.round(value * SEGMENTS);
  const tone = progressTone(percent, by);
  const waiting = WAITING_FOR[substatus];
  return (
    <span className={`flex w-[150px] shrink-0 flex-col gap-1 ${className}`}>
      <span className="text-[11.5px] leading-none text-zk-muted">
        <span className="text-[13px] font-semibold tabular-nums text-zk-text">{percent}%</span> {by === "time" ? "of its time used" : "along"}
      </span>
      <span
        role="progressbar"
        aria-label={by === "time" ? `Time used, ${tone.label}` : "Progress"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="flex h-3.5 items-stretch gap-[3px]"
      >
        {Array.from({ length: SEGMENTS }, (_, index) => (
          <span key={index} className="w-[4px] rounded-full" style={{ backgroundColor: index < filled ? tone.on : "#e3e5ea" }} />
        ))}
      </span>
      {waiting ? <span className="truncate text-[11.5px] leading-tight text-zk-muted">{waiting}</span> : null}
    </span>
  );
}

/** File tiles take the colour of their kind, as in a mail client: PDFs red, images blue, the rest gray. */
function fileColour(kind: string): string {
  if (kind === "PDF") return "#e5484d";
  if (["PNG", "JPG", "JPEG", "GIF", "WEBP", "SVG"].includes(kind)) return "#1b8ce8";
  return "#686868";
}

/**
 * An opened Overview row: one card, as an opened email. Its head is who and where, with the decision it asks of you
 * as one clear button on the right (clicking the rest of the head folds it); under a thin line, the title, what the
 * work is, its files, and the full issue at the bottom.
 */
function FeedCard({ item, id, onClose }: { item: WorkFeedItem; id: string; onClose: () => void }) {
  const kind = KIND[item.kind];
  const tone = PILL_TONES[kind.tone];
  const who = item.who ?? "Nobody yet";
  return (
    <article id={id} aria-labelledby={`${id}-title`} className="my-1 rounded-2xl border border-zk-border bg-white px-5 pb-5 pt-4 shadow-[0_2px_10px_rgba(0,0,0,0.06)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-zk-divider pb-4">
        <button type="button" aria-expanded={true} aria-controls={id} onClick={onClose} className={`flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-left ${focus}`}>
          <IssueThumb item={item} />
          <span className="min-w-0">
            {/* The issue's title heads the card; who is on it goes in the line under it. */}
            <span id={`${id}-title`} className="block text-[16px] font-semibold leading-snug text-zk-text">{cleanTitle(item.title)}</span>
            <span className="mt-0.5 block truncate text-[13px] text-zk-muted">
              <span style={{ color: tone.color }}>{kind.label}</span> · <span className="tabular-nums">{formatIssueNumber(item.number)}</span>
              {item.projectName ? ` · ${item.projectName}` : ""} · {who} · <LocalTime date={item.at} />
            </span>
          </span>
        </button>
        {/* The decision it asks of you, on the right (full width under the head on a phone). */}
        {/* The same one thing as the closed card: the bar on work being worked on, else Approve. */}
        {item.stalledSince ? (
          <StalledLabel item={item} />
        ) : item.progress !== null ? (
          <ProgressBar value={item.progress} by={item.progressBy} substatus={item.substatus} />
        ) : item.kind === "delivered" ? (
          <DeliveredActions item={item} />
        ) : item.canConfirm || item.confirmed ? (
          <ConfirmLive item={item} />
        ) : (
        <Link
          href={item.decision.href}
          className={`inline-flex min-h-9 w-full shrink-0 items-center justify-center gap-1.5 sm:w-auto rounded-[9px] bg-electric-blue-strong px-3.5 text-[13.5px] font-semibold text-white transition hover:opacity-90 ${focus}`}
        >
          {item.decision.label}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </Link>
        )}
      </div>
      {/* Delivered and live work: what it says on the left, a preview of what was delivered on the right (under it on a phone). */}
      <div className={item.kind === "delivered" || item.kind === "live" || item.stallReason ? "grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,340px)]" : ""}>
      <div className="min-w-0 pt-4 text-[14.5px] leading-relaxed text-zk-text2">
        {/* When it was delivered, and why it isn't merged yet when the latest pull request report says why. */}
        {item.deliveredAt ? (
          <p className="m-0 mb-3 text-[13px] text-zk-muted">Delivered <LocalTime date={item.deliveredAt} absolute /></p>
        ) : null}
        {item.stallReason ? (
          <div role="note" className="mb-4 rounded-xl border border-zk-warn-bd bg-zk-warn-bg px-3.5 py-2.5 text-[13.5px] text-zk-warn-fg">
            <p className="m-0 font-semibold">
              Why it&apos;s stalled{item.stalledSince ? <span className="font-normal" suppressHydrationWarning> · no movement for {since(item.stalledSince)}</span> : null}
            </p>
            <p className="m-0 mt-0.5">{item.stallReason}</p>
          </div>
        ) : null}
        {item.mergeHold ? (
          <div role="note" className="mb-4 rounded-xl border border-zk-warn-bd bg-zk-warn-bg px-3.5 py-2.5 text-[13.5px] text-zk-warn-fg">
            <p className="m-0 font-semibold">Why it isn&apos;t merged yet</p>
            <p className="m-0 mt-0.5 whitespace-pre-line">{item.mergeHold}</p>
          </div>
        ) : null}
        {/* The summary, unless the description already opens with it. */}
        {item.summary && !item.body?.trimStart().startsWith(item.summary.trim().split("\n")[0]) ? <p className="m-0 mb-3 whitespace-pre-line">{item.summary}</p> : null}
        {item.body ? (
          // Quiet headings, as in a letter, not a document.
          <RichText content={item.body} className="text-[14.5px] [&_h1]:text-[14.5px] [&_h2]:text-[14.5px] [&_h3]:text-[14.5px] [&_h4]:text-[14.5px] [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold" />
        ) : item.summary ? null : (
          <p className="m-0 text-zk-muted">No description.</p>
        )}
      </div>
      {/* The right column: the full issue's link on top, then, when stalled, what you can do to move it on, then the
          preview of delivered work. */}
      {item.stallReason || item.kind === "delivered" || item.kind === "live" ? (
        <div className="min-w-0">
          <div className="mt-4 flex justify-end">
            <FullIssueLink href={item.href} />
          </div>
          {item.stallReason ? <StalledFix item={item} /> : null}
          {item.kind === "delivered" || item.kind === "live" ? <DeliveryPreview item={item} /> : null}
        </div>
      ) : null}
      </div>
      {item.files.length > 0 ? (
        <ul aria-label="Files" className="m-0 mt-5 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
          {item.files.map((file) => {
            const ext = fileKind(file.type, file.name);
            const colour = fileColour(ext);
            return (
              <li key={file.id}>
                <a
                  href={`${BASE_PATH}/api/attachments/${file.id}`}
                  download={file.name}
                  className={`flex items-center gap-3 rounded-xl bg-zk-bg px-3.5 py-3 transition hover:bg-zk-chip ${focus}`}
                >
                  <svg width="30" height="34" viewBox="0 0 30 34" aria-hidden="true" className="shrink-0">
                    <path d="M3 1h17l9 9v21a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" fill="white" stroke={colour} strokeWidth="1.6" />
                    <path d="M20 1v9h9" fill="none" stroke={colour} strokeWidth="1.6" />
                    <rect x="0" y="18" width="24" height="10" rx="2" fill={colour} />
                    <text x="12" y="25.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="white">{ext}</text>
                  </svg>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-zk-text">{file.name}</span>
                    <span className="block text-[12px] text-zk-muted">{ext} · {fileSize(file.size)}</span>
                  </span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-zk-muted"><path d="M12 4v12M7 11l5 5 5-5M5 20h14" /></svg>
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
      {/* At the bottom, on one line: who reported it on the left, the whole issue on the right. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {item.reporter ? <p className="m-0 text-[13.5px] text-zk-muted">Reported by {item.reporter}</p> : <span aria-hidden="true" />}
        <FullIssueLink href={item.href} />
      </div>
    </article>
  );
}

/** The link to the whole issue. */
function FullIssueLink({ href }: { href: string }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-1 text-[13.5px] font-medium text-zk-accent hover:underline ${focus}`}>
      Open the full issue
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    </Link>
  );
}

/**
 * An opened delivered card's preview (#work-feed): the delivery's screenshots, the first large and the rest small, each
 * opening full size; under them, the link to view what was delivered (its preview, else its link or pull request).
 */
/** "3 days", "5 hours", "12 minutes": how long since a moment, roughly. */
function since(date: Date): string {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(date).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * A stalled card's right (#work-feed-sections): where it is, as the one-word status ("Mergeable", "Working"), and under
 * it how long it has sat there, so it reads as stuck rather than done.
 */
function StalledLabel({ item, className = "" }: { item: WorkFeedItem; className?: string }) {
  return (
    <span title={item.stallReason ?? undefined} className={`flex shrink-0 flex-col items-end gap-1 ${className}`}>
      <StatusBadge substatus={item.substatus} />
      {item.stalledSince ? (
        <span className="text-[11.5px] tabular-nums text-zk-muted" suppressHydrationWarning>{since(item.stalledSince)}</span>
      ) : null}
    </span>
  );
}

/** What a person can do about stalled work (#stalled-fix): by themself, and what to ask their agent. */
type Fix = {
  /** The heading: what has to happen. */
  title: string;
  /** What you can do yourself, in a sentence. */
  you: string;
  /** The button for it: a link (the issue page, where the step is, or the pull request). */
  action: { label: string; href: string; external?: boolean } | null;
  /** Approve here, for delivered work waiting for its judgement. */
  approve?: boolean;
  /** What to paste to your agent, given the issue's full address. */
  prompt: (url: string) => string;
};

function fixFor(item: WorkFeedItem): Fix {
  const ref = `Ziki issue ${formatIssueNumber(item.number)}`;
  const pr = item.pullRequestUrl;
  const prLine = pr ? ` The pull request is ${pr}.` : "";
  switch (item.substatus) {
    case "in_progress":
    case "plan_review":
      if (!item.held) {
        return {
          title: "Get an agent on it again",
          you: "Nobody holds it now. Open the issue to award an open bid, or assign it to your agent.",
          action: { label: "Award or assign", href: item.href },
          prompt: (url) => `${ref} (${url}) was let go and nobody is working on it. Read it, check the project's mistake registry, and bid on it with a short plan so it can be awarded to you.`,
        };
      }
      return {
        title: "Wake the agent or hand it on",
        you: `${item.who ?? "The agent"} stopped checking in. If it's your agent, ask it to carry on. Otherwise, on the issue page the ⋯ menu gives it more time or stops it so the work can go to another agent.`,
        action: { label: "Open the issue", href: item.href },
        prompt: (url) => `Check ${ref} (${url}). If you hold the claim, carry on with the work and send a heartbeat now, or deliver what you have; if you can't finish it, release the claim so another agent can take it. If you don't hold it, bid on it so it can be handed to you.`,
      };
    case "requires_review":
      return {
        title: "Judge the delivery",
        you: "Look at what was delivered and approve it if it works. Your approval counts as a test verdict.",
        action: pr ? { label: "Look at the pull request", href: pr, external: true } : { label: "Open the issue", href: item.href },
        approve: item.canApprove,
        prompt: (url) => `Test the delivery on ${ref} (${url}).${prLine} Check out the change, run it, try what the issue describes, and post your verdict (good to merge or not) with a summary and screenshots as a test result.`,
      };
    case "accepted":
      return {
        title: "Give it a manager review",
        you: "It needs a manager's review. If you're an owner or admin, give the merge review from the issue page, or ask your manager agent to.",
        action: { label: "Review it", href: item.href },
        prompt: (url) => `As a manager agent, review the pull request for ${ref} (${url}).${prLine} Read the diff against the issue and the mistake registry, then post a merge review: accept, or reject with the feedback the author should act on.`,
      };
    case "ready_to_merge":
      return {
        title: "Merge the pull request",
        you: "It's accepted and only needs merging. Merge it from the issue's GitHub panel or on GitHub once its checks are green, or ask your merger agent.",
        action: pr ? { label: "Merge on GitHub", href: pr, external: true } : { label: "Open the issue", href: item.href },
        prompt: (url) => `As a merger agent, merge the pull request for ${ref} (${url}).${prLine} Check that it is mergeable and every check is green, merge it on GitHub, then report it merged and resolve the issue.`,
      };
    case "error":
      return {
        title: "Fix the pull request",
        you: "The pull request can't merge. From the issue's GitHub panel you can update the branch, re-run failed checks or send it back to the agent that wrote it.",
        action: { label: "Open the GitHub panel", href: item.href },
        prompt: (url) => `The pull request for ${ref} (${url}) can't be merged.${prLine}${item.mergeHold ? ` Reason: ${item.mergeHold}` : ""} Bring the branch up to date with main, fix conflicts or failing checks, push, and report the pull request status when it can merge.`,
      };
    case "merged_broken":
      return {
        title: "Get it fixed",
        you: "It was merged and judged broken. It takes bids for a fix: award one on the issue page, or have your agent bid.",
        action: { label: "Open the issue", href: item.href },
        prompt: (url) => `${ref} (${url}) was force-merged and judged broken.${prLine} Read the judgements on it, find what is wrong, and bid to fix it with a short plan.`,
      };
    default:
      return {
        title: "Move it on",
        you: "Open the issue to see what step it waits for.",
        action: { label: "Open the issue", href: item.href },
        prompt: (url) => `Check ${ref} (${url}): it hasn't moved for a while. Find what step it waits for and take it if you can.`,
      };
  }
}

const noSubscribe = () => () => {};

/**
 * An opened stalled card's right (#stalled-fix): what has to happen, what you can do yourself with one button, and a
 * message to copy and paste to your agent.
 */
function StalledFix({ item }: { item: WorkFeedItem }) {
  const fix = fixFor(item);
  // The issue's full address, for the agent; only known in the browser.
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
  const prompt = fix.prompt(`${origin}${item.href}`);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <aside aria-label="How to fix it" className="min-w-0 pt-4">
      <div className="rounded-xl border border-zk-border bg-zk-bg p-4">
        <p className="m-0 text-[14px] font-semibold text-zk-text">{fix.title}</p>
        <p className="m-0 mt-1 text-[13px] leading-relaxed text-zk-text2">{fix.you}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {fix.approve ? <DeliveredActions item={item} /> : null}
          {fix.action ? (
            fix.action.external ? (
              <a href={fix.action.href} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-8 items-center gap-1 rounded-[9px] bg-electric-blue-strong px-3 text-[13px] font-semibold text-white transition hover:opacity-90 ${focus}`}>
                {fix.action.label}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
              </a>
            ) : (
              <Link href={fix.action.href} className={`inline-flex min-h-8 items-center gap-1 rounded-[9px] bg-electric-blue-strong px-3 text-[13px] font-semibold text-white transition hover:opacity-90 ${focus}`}>
                {fix.action.label}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </Link>
            )
          ) : null}
        </div>
        <div className="mt-4 border-t border-zk-divider pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-zk-muted">Or ask your agent</p>
            <button type="button" onClick={() => void copy()} className={`inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-zk-border bg-white px-2 text-[12px] font-semibold text-zk-text transition hover:bg-zk-chip ${focus}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {copied ? <path d="m5 12 5 5 9-10" /> : <path d="M9 9h10v10H9zM5 15V5h10" />}
              </svg>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="m-0 mt-2 whitespace-pre-wrap break-words rounded-lg border border-zk-border bg-white px-3 py-2 font-mono text-[12px] leading-relaxed text-zk-text2" suppressHydrationWarning>
            {prompt}
          </p>
          <span aria-live="polite" className="sr-only">{copied ? "Copied to the clipboard" : ""}</span>
        </div>
      </div>
    </aside>
  );
}

/** Steps whose wait is for the merge, and the one whose wait is for review. */
const WAITING_FOR_MERGE = new Set<string>(["accepted", "ready_to_merge", "error"]);

/**
 * Under the preview (#work-feed-sections): when the issue was added, when an agent started, when it was delivered, and
 * how long it has been waiting since: for its review, or for the merge.
 */
function Timeline({ item }: { item: WorkFeedItem }) {
  const waiting = item.deliveredAt && (WAITING_FOR_MERGE.has(item.substatus) || item.substatus === "requires_review")
    ? { label: WAITING_FOR_MERGE.has(item.substatus) ? "Waiting for merge" : "Waiting for review", value: since(item.deliveredAt) }
    : null;
  const rows: { label: string; value: React.ReactNode }[] = [
    // Exact times ("Nov 19, 2026, 2:02 PM"), not "yesterday": the timeline tells how long each step took.
    { label: "Added", value: <LocalTime date={item.addedAt} absolute /> },
    { label: "Started", value: item.startedAt ? <LocalTime date={item.startedAt} absolute /> : "Not yet" },
    { label: "Delivered", value: item.deliveredAt ? <LocalTime date={item.deliveredAt} absolute /> : "Not yet" },
  ];
  return (
    <dl className="m-0 mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-zk-muted">{row.label}</dt>
          <dd className="m-0 text-right text-zk-text2">{row.value}</dd>
        </div>
      ))}
      {waiting ? (
        <div className="contents">
          <dt className="font-medium text-zk-text">{waiting.label}</dt>
          <dd className="m-0 text-right font-semibold tabular-nums text-zk-text" suppressHydrationWarning>{waiting.value}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function DeliveryPreview({ item }: { item: WorkFeedItem }) {
  const [first, ...rest] = item.screenshots;
  return (
    <aside aria-label="Preview" className="min-w-0 pt-4">
      {first && item.beforeScreenshots.length > 0 ? <p className="m-0 mb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-zk-muted">Now</p> : null}
      {first ? (
        <div className="flex flex-col gap-2">
          <a href={first} target="_blank" rel="noopener noreferrer" className={`block overflow-hidden rounded-xl border border-zk-border bg-zk-bg ${focus}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a screenshot the agent linked, any host */}
            <img src={first} alt={`Screenshot of the delivered work for ${formatIssueNumber(item.number)}`} loading="lazy" className="aspect-[4/3] w-full object-cover object-top" />
          </a>
          {rest.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {rest.map((url, index) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer" className={`block overflow-hidden rounded-lg border border-zk-border bg-zk-bg ${focus}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a screenshot the agent linked, any host */}
                  <img src={url} alt={`Screenshot ${index + 2}`} loading="lazy" className="aspect-[4/3] w-full object-cover object-top" />
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-zk-border bg-zk-bg px-4 text-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-zk-muted"><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21" /></svg>
          <span className="text-[13px] text-zk-muted">No screenshots with this delivery</span>
        </div>
      )}
      {/* How it looked when the work started, smaller, to compare. */}
      {item.beforeScreenshots.length > 0 ? (
        <div className="mt-3">
          <p className="m-0 mb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-zk-muted">Before</p>
          <div className="grid grid-cols-3 gap-2">
            {item.beforeScreenshots.map((url, index) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer" className={`block overflow-hidden rounded-lg border border-zk-border bg-zk-bg ${focus}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a screenshot the agent linked, any host */}
                <img src={url} alt={`Before the work, screenshot ${index + 1}`} loading="lazy" className="aspect-[4/3] w-full object-cover object-top" />
              </a>
            ))}
          </div>
        </div>
      ) : null}
      <Timeline item={item} />
      {/* Where it runs and its pull request, as two links. Live work without a live link says so (#live-link). */}
      {item.liveUrl || item.pullRequestUrl || item.kind === "live" ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {item.liveUrl ? (
            <OutLink href={item.liveUrl} label={item.kind === "live" ? "See it live" : "See it running"} />
          ) : item.kind === "live" ? (
            <p className="m-0 text-[13px] text-zk-muted">
              <span className="font-medium text-zk-text2">No live link added yet.</span> The merger agent is asked to add one.
            </p>
          ) : null}
          {item.pullRequestUrl ? <OutLink href={item.pullRequestUrl} label="Pull request" /> : null}
        </div>
      ) : null}
    </aside>
  );
}

/** A link out of Ziki, with the arrow that says so. */
function OutLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 text-[13.5px] font-medium text-zk-accent hover:underline ${focus}`}>
      {label}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
    </a>
  );
}

/** Above an Approve: the one-word state the work is in, small, in its colour and with its icon. */
function StateLine({ substatus }: { substatus: Substatus }) {
  const badge = STATUS_BADGE[substatus];
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold leading-none" style={{ color: PILL_TONES[badge.tone].color }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
        <path d={badge.icon} />
      </svg>
      {badge.label}
    </span>
  );
}

/**
 * Live work's one label (#live-confirmed): "Looks fine" while nobody has confirmed it; one click marks it Live ·
 * Confirmed and it moves from the Work Feed to the Delivered tab. Confirmed work reads Confirmed.
 */
function ConfirmLive({ item, className = "" }: { item: WorkFeedItem; className?: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(item.confirmed);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  // Approved just now, here: Send some Love shows, and the card stays until it is sent (then the feed refreshes and the
  // work moves to Delivered).
  const [justApproved, setJustApproved] = useState(false);
  const [loving, setLoving] = useState(false);
  const [cheering, setCheering] = useState(false);
  const confirm = () =>
    start(async () => {
      setError(null);
      const result = await confirmLiveWorkAction(item.id);
      if ("error" in result) setError(result.error);
      else {
        setDone(true);
        setJustApproved(true);
        // Approved (#just-delivered): fireworks, once.
        setCheering(true);
        setTimeout(() => setCheering(false), 2400);
      }
    });
  const sendLove = () => {
    setLoving(true);
    setTimeout(() => {
      setLoving(false);
      setJustApproved(false);
      router.refresh();
    }, 2600);
  };
  const button = `${PILL} transition ${focus}`;
  return (
    <div className={`flex flex-col items-end gap-1 ${className}`}>
      <StateLine substatus={item.substatus} />
      {done && justApproved ? (
        // After Approve (#just-delivered): thank whoever delivered it, with fireworks and hearts.
        <button
          type="button"
          onClick={sendLove}
          disabled={loving}
          className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border border-[#e0335a] bg-[#ef4f6b] px-2 text-[11.5px] font-bold text-white shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition hover:brightness-110 active:translate-y-px active:shadow-none disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue"
        >
          <span aria-hidden="true">♥</span>
          {loving ? "Love sent!" : "Send some Love"}
        </button>
      ) : done ? (
        <span className={button} style={PILL_TONES.green}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
          Confirmed
        </span>
      ) : (
        <button type="button" onClick={confirm} disabled={pending} aria-label={`Approve: ${formatIssueNumber(item.number)} works live`} className={RAISED}>
          <ThumbsUp />
          {pending ? "Approving…" : "Approve"}
        </button>
      )}
      {error ? <p role="alert" className="m-0 max-w-[220px] text-[12px] text-zk-bad-fg">{error}</p> : null}
      {loving || cheering ? (
        <span aria-hidden="true" className="pointer-events-none fixed inset-0 z-50">
          <CelebrationStyles />
          <Fireworks />
          {loving ? <Hearts /> : null}
        </span>
      ) : null}
      <span aria-live="polite" className="sr-only">{loving ? "Love sent" : ""}</span>
    </div>
  );
}

/**
 * The top of the newest delivery's card (#just-delivered): an agent dancing, "<name> just delivered this", and
 * fireworks going off behind it.
 */
function JustDelivered({ by }: { by: string | null }) {
  const name = by?.trim().split(/\s+/)[0] || "Your agent";
  return (
    <div className="relative flex items-center gap-2.5 overflow-hidden border-b border-[#f3e7c9] bg-gradient-to-r from-[#fffbf1] to-white px-5 py-2">
      {/* Still until Approve: the fireworks go off when it is approved. */}
      <DancingAgent size={28} still />
      <p className="relative m-0 text-[13px] font-medium text-zk-text2">
        {name} just delivered this <span aria-hidden="true">🎉</span>
      </p>
    </div>
  );
}

/**
 * Delivered work's one label (#work-feed): Approve judges it good to merge through your agent, the same judgement as
 * the issue page's, while it waits for that; once approved it reads Approved. Viewing what was delivered is in the
 * opened card's preview.
 */
function DeliveredActions({ item, className = "" }: { item: WorkFeedItem; className?: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(item.approved);
  const [error, setError] = useState<string | null>(null);
  const button = `${PILL} transition ${focus}`;
  const approve = () =>
    start(async () => {
      setError(null);
      const result = await approveDeliveredWorkAction(item.id);
      if ("error" in result) setError(result.error);
      else setDone(true);
    });
  return (
    <div className={`flex flex-col items-end gap-1 ${className}`}>
      <StateLine substatus={item.substatus} />
      <div className="flex items-center gap-1.5">
        {done ? (
          <span className={button} style={PILL_TONES.green}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
            Approved
          </span>
        ) : item.canApprove ? (
          <button type="button" onClick={approve} disabled={pending} className={RAISED}>
            <ThumbsUp />
            {pending ? "Approving…" : "Approve"}
          </button>
        ) : null}
      </div>
      {error ? <p role="alert" className="m-0 max-w-[220px] text-[12px] text-red-600">{error}</p> : null}
    </div>
  );
}

/** An idea filed in the last day, for the Work Feed's Just added (#just-added). */
export type JustAddedIdea = { id: string; number: number; title: string; at: Date; by: string | null; href: string };

/**
 * Just added (#just-added): the ideas filed in the last day, above the Work Feed's sections. The one the chat has just
 * filed flashes, so it is clear where it went: agents pick ideas up from here.
 */
function JustAdded({ ideas, flash }: { ideas: JustAddedIdea[]; flash: number | null }) {
  return (
    <section aria-labelledby="work-feed-just-added" className="mb-6">
      <style>{`
@keyframes zk-flash { 0%, 100% { background-color: #ffffff; box-shadow: 0 0 0 0 rgba(47,140,240,0) } 20%, 60% { background-color: #eaf3ff; box-shadow: 0 0 0 3px rgba(47,140,240,0.35) } }
@media (prefers-reduced-motion: reduce) { .zk-flash { animation: none !important; box-shadow: 0 0 0 2px rgba(47,140,240,0.4) } }
`}</style>
      <h2 id="work-feed-just-added" className="m-0 mb-2 px-1 text-[15px] font-semibold text-zk-text">Just added</h2>
      <ul className="m-0 flex list-none flex-col gap-3 rounded-xl bg-zk-bg p-4">
        {ideas.map((idea) => {
          const flashing = idea.number === flash;
          return (
            <li key={idea.id}>
              <Link
                href={idea.href}
                className={`flex items-center gap-4 rounded-2xl border border-zk-border bg-white px-5 py-3.5 transition hover:bg-zk-bg ${flashing ? "zk-flash" : ""} ${focus}`}
                style={flashing ? { animation: "zk-flash 1.6s ease-in-out 3" } : undefined}
              >
                <IssueThumb item={{ title: idea.title, files: [] }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-zk-text">{cleanTitle(idea.title)}</span>
                  <span className="mt-0.5 block truncate text-[13px] text-zk-muted">
                    Idea #{idea.number}{idea.by ? ` · ${idea.by}` : ""} · <LocalTime date={idea.at} />
                  </span>
                </span>
                <span className={PILL} style={PILL_TONES[flashing ? "blue" : "grey"]}>{flashing ? "Just added" : "New idea"}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
