"use client";

import Link from "next/link";
import type React from "react";
import { useState, useTransition } from "react";
import { approveDeliveredWorkAction } from "@/app/actions/human-steps";
import { LocalTime } from "@/components/local-time";
import { RichText } from "@/components/rich-text";
import { BASE_PATH } from "@/lib/base-path";
import { formatIssueNumber } from "@/lib/issue-number";
import { cleanTitle } from "@/lib/issue-title";
import { PILL_TONES, TILE_TONES, toneForName, type PillTone } from "@/lib/pill-tones";

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
  /** Delivered work: where it was delivered (its preview, else its link or pull request), and whether it awaits approval. */
  viewUrl: string | null;
  canApprove: boolean;
  /** Already judged good to merge: Approve shows as done. */
  approved: boolean;
  /** The Status column: the status and step as one label, and the main status for its colour. */
  state: { label: string; status: string };
  /** Work under way: how much of its time to delivery has gone (0 to 1), or null when it has no due time. */
  progress: number | null;
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

/** Each main status's pill tone, for the pill on a card's right (Live is `resolved`). */
const STATUS_TONE: Record<string, PillTone> = { open: "yellow", in_progress: "blue", done: "green", merge: "purple", resolved: "cyan", closed: "grey" };

/** The pill on a card's right: soft tint, strong text. */
export const PILL = "inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[12.5px] font-semibold";

/**
 * The Overview's list (#work-feed): its title with the tabs and the Status filter on top, then a white card per piece
 * of work, newest first (the Work Feed mixes its statuses): who is on it, its title, its number, project and when it
 * last moved, and a pill on the right with its status, or View and Approve on delivered work. Clicking a card unfolds
 * it downwards, in place, as an opened email; clicking its head folds it.
 */
export function WorkFeed({ items, title, toolbar, empty, footer }: {
  items: WorkFeedItem[];
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

  return (
    <section aria-label={title}>
      {/* No title: the tabs on the left say which list this is, the Status filter is on the right. */}
      {toolbar ? <div className="mb-4 flex flex-wrap items-center justify-between gap-2">{toolbar}</div> : null}
      {items.length === 0 ? (
        <div className="rounded-2xl border border-zk-border bg-white p-5">{empty}</div>
      ) : (
        // The cards sit on a gray inset of the white panel, as Marketing's do.
        <ul className="m-0 flex list-none flex-col gap-3 rounded-xl bg-zk-bg p-4" aria-label="Work">
          {items.map((item) => {
            const who = item.who ?? "Nobody yet";
            return (
              <li key={item.id}>
                {openId === item.id ? (
                  // Opened, the card unfolds into the whole of it, as an opened email.
                  <FeedCard item={item} id={`work-feed-detail-${item.id}`} onClose={() => setOpenId(null)} />
                ) : (
                  <div className="flex items-center gap-4 rounded-2xl border border-zk-border bg-white px-5 py-4 transition hover:bg-zk-bg">
                    <button
                      type="button"
                      aria-expanded={false}
                      onClick={() => setOpenId(item.id)}
                      className={`flex min-w-0 flex-1 items-center gap-4 text-left ${focus}`}
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
                    {/* On the right: delivered work's View and Approve, else its status. */}
                    {item.kind === "delivered" ? (
                      <DeliveredActions item={item} className="max-sm:hidden" />
                    ) : item.progress !== null ? (
                      <ProgressBar value={item.progress} className="max-sm:hidden" />
                    ) : (
                      <span className={`${PILL} max-sm:hidden`} style={PILL_TONES[STATUS_TONE[item.state.status] ?? "grey"]}>{item.state.label}</span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
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
 * The picture at a card's left (#work-feed): a small screenshot of the issue, its first image, when it has one;
 * otherwise a tile in the colour of the kind of issue its title's tag names, with an icon that stands for it.
 */
export function IssueThumb({ item }: { item: Pick<WorkFeedItem, "title" | "files"> }) {
  const image = item.files.find((file) => file.type.startsWith("image/"));
  if (image) {
    return (
      <span aria-hidden="true" className="relative h-11 w-14 shrink-0 overflow-hidden rounded-[10px] border border-zk-border bg-zk-bg">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small authenticated attachment, served as is */}
        <img src={`${BASE_PATH}/api/attachments/${image.id}`} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
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
function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  const percent = Math.round(value * 100);
  return (
    <span
      role="progressbar"
      aria-label="In progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      title={`In progress · ${percent}% of its time used`}
      className={`block h-2 w-28 shrink-0 overflow-hidden rounded-full bg-[#ebe7fd] ${className}`}
    >
      <span className="block h-full rounded-full bg-[linear-gradient(90deg,#8b6cf6,#7a52ee)]" style={{ width: `${percent}%` }} />
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
        <button type="button" aria-expanded={true} aria-controls={id} onClick={onClose} className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left ${focus}`}>
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] text-[15px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]" style={TILE_TONES[item.who ? toneForName(item.who) : "grey"]}>
            {who.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className={`block truncate text-[15px] font-semibold ${item.who ? "text-zk-text" : "text-zk-muted"}`}>{who}</span>
            <span className="block truncate text-[13px] text-zk-muted">
              <span style={{ color: tone.color }}>{kind.label}</span> · <span className="tabular-nums">{formatIssueNumber(item.number)}</span>
              {item.projectName ? ` · ${item.projectName}` : ""} · <LocalTime date={item.at} />
            </span>
          </span>
        </button>
        {/* The decision it asks of you, on the right (full width under the head on a phone). */}
        {item.kind === "delivered" ? (
          <DeliveredActions item={item} />
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
      <div className="pt-4 text-[14.5px] leading-relaxed text-zk-text2">
        <h2 id={`${id}-title`} className="m-0 mb-3 text-[16px] font-semibold leading-snug text-zk-text">{cleanTitle(item.title)}</h2>
        {/* The summary, unless the description already opens with it. */}
        {item.summary && !item.body?.trimStart().startsWith(item.summary.trim().split("\n")[0]) ? <p className="m-0 mb-3 whitespace-pre-line">{item.summary}</p> : null}
        {item.body ? (
          // Quiet headings, as in a letter, not a document.
          <RichText content={item.body} className="text-[14.5px] [&_h1]:text-[14.5px] [&_h2]:text-[14.5px] [&_h3]:text-[14.5px] [&_h4]:text-[14.5px] [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold" />
        ) : item.summary ? null : (
          <p className="m-0 text-zk-muted">No description.</p>
        )}
        {item.reporter ? <p className="m-0 mt-4 text-[13.5px] text-zk-muted">Reported by {item.reporter}</p> : null}
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
      {/* At the bottom: the whole issue. */}
      <Link href={item.href} className={`mt-5 inline-flex items-center gap-1 text-[13.5px] font-medium text-zk-accent hover:underline ${focus}`}>
        Open the full issue
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </Link>
    </article>
  );
}

/**
 * Delivered work's two small buttons (#work-feed): View opens where it was delivered, in a new tab; Approve judges it
 * good to merge through your agent, the same judgement as the issue page's. Approve shows only while it waits for that;
 * once approved it reads Approved, done.
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
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center gap-1.5">
        {item.viewUrl ? (
          <a href={item.viewUrl} target="_blank" rel="noopener noreferrer" className={`${button} bg-zk-bg text-zk-text2 hover:text-zk-text`}>
            View
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
          </a>
        ) : null}
        {done ? (
          <span className={button} style={PILL_TONES.green}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
            Approved
          </span>
        ) : item.canApprove ? (
          <button type="button" onClick={approve} disabled={pending} className={`${button} hover:opacity-90 disabled:opacity-60`} style={PILL_TONES.green}>
            {pending ? "Approving…" : "Approve"}
          </button>
        ) : null}
      </div>
      {error ? <p role="alert" className="m-0 max-w-[220px] text-[12px] text-red-600">{error}</p> : null}
    </div>
  );
}
