import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { formatIssueNumber } from "@/lib/issue-number";
import { PILL_TONES, type PillTone } from "@/lib/pill-tones";
import { GAP, SECTION_TITLE } from "@/lib/ui-style";

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
};

/** One kind's section: its newest few, how many there are in all, and where View all goes. */
export type WorkFeedSection = { kind: WorkFeedKind; items: WorkFeedItem[]; total: number; href: string };

/** Each kind's section name, colour, icon and the line its rows say. */
const KIND: Record<WorkFeedKind, { label: string; tone: PillTone; icon: string; line: string }> = {
  design: { label: "Designs to review", tone: "purple", icon: "M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.586 7.586M11 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", line: "An agent proposed a design. Pick the one you want." },
  delivered: { label: "Delivered", tone: "green", icon: "M20 6 9 17l-5-5", line: "The work is done. Take a look before it goes live." },
  live: { label: "Live", tone: "cyan", icon: "M22 12h-4l-3 9L9 3l-3 9H2", line: "This is out. Check it works for you." },
  working: { label: "In progress", tone: "blue", icon: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83", line: "An agent is working on it." },
  waiting: { label: "Waiting", tone: "yellow", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2", line: "Waiting for an agent to take it on." },
};

/** The kinds that ask something of you: their rows carry the unread dot. */
const ASKS: readonly WorkFeedKind[] = ["design", "delivered"];

/**
 * The Overview as an inbox (#work-feed): a section per kind (designs to review, delivered, live, in progress,
 * waiting), each a white card of rows, newest first, with View all under it. A row reads like a message: who is on
 * it, when, the title, and a line saying what it needs; the work waiting on you has a blue dot.
 */
export function WorkFeed({ sections }: { sections: WorkFeedSection[] }) {
  return (
    <div className={`flex flex-col ${GAP} rounded-xl bg-zk-bg p-4`} aria-label="All work">
      {sections.map((section) => {
        const kind = KIND[section.kind];
        const tone = PILL_TONES[kind.tone];
        return (
          <section key={section.kind} aria-label={kind.label}>
            {/* The section's heading, outside its card: its icon and name, and how many. */}
            <h3 className={`mb-3 flex items-center gap-2 px-1 ${SECTION_TITLE}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tone.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={kind.icon} />
              </svg>
              {kind.label}
              <span className="text-[12px] font-normal tabular-nums text-zk-muted">{section.total}</span>
            </h3>
            <ul className="m-0 list-none overflow-hidden rounded-xl border border-zk-border bg-white p-1.5">
              {section.items.map((item, index) => {
                const who = item.who ?? "Nobody yet";
                return (
                  <li key={item.id} className={index < section.items.length - 1 ? "mx-3.5 border-b border-zk-divider [&>a]:-mx-3.5" : ""}>
                    <Link href={item.href} className="relative flex gap-3.5 rounded-xl px-5 py-3.5 transition hover:bg-zk-bg">
                      {/* Waiting on you: a blue dot in the margin, as an unread message. */}
                      {ASKS.includes(item.kind) ? (
                        <span aria-label="Needs you" className="absolute left-2 top-[26px] h-1.5 w-1.5 rounded-full bg-zk-accent" />
                      ) : null}
                      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold" style={tone}>
                        {who.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className={`truncate text-[14px] font-semibold ${item.who ? "text-zk-text" : "text-zk-muted"}`}>{who}</span>
                          <span className="shrink-0 text-[12px] text-zk-muted">
                            <LocalTime date={item.at} />
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-[13.5px] font-medium text-zk-text">{item.title}</span>
                        <span className="mt-0.5 block truncate text-[13px] text-zk-muted">
                          <span className="tabular-nums">{formatIssueNumber(item.number)}</span>
                          {item.projectName ? ` · ${item.projectName}` : ""} · {kind.line}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {section.total > section.items.length ? (
              <div className="mt-2 text-center">
                <Link href={section.href} className="inline-flex items-center gap-1 text-[13px] font-medium text-zk-accent hover:underline">
                  View all ({section.total})
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </Link>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
