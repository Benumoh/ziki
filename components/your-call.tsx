"use client";

import Link from "next/link";
import { useState } from "react";
import { LocalTime } from "@/components/local-time";
import { YourCallAnswerButton } from "@/components/your-call-answer";
import { PLAIN, plainTitle, URGENCIES, URGENCY_LABEL, type Urgency, type YourCallItem } from "@/lib/your-call-shared";

/** Each urgency's colour, and how many of the meter's four segments it fills: Critical all four, Low one. */
const LOOK: Record<Urgency, { fill: string; segments: number }> = {
  critical: { fill: "bg-rose-500", segments: 4 },
  high: { fill: "bg-orange-500", segments: 3 },
  medium: { fill: "bg-sky-500", segments: 2 },
  low: { fill: "bg-slate-400", segments: 1 },
};

/** The table's columns, shared by its heading and every row. */
const COL = { urgency: "w-20 shrink-0", waiting: "hidden w-24 shrink-0 md:block", answer: "w-[250px] shrink-0 justify-end" };

/** How urgent it is, as a four-step meter; its level and the reasons are in the tooltip and for screen readers. */
function UrgencyCell({ urgency, reasons }: { urgency: Urgency; reasons: string[] }) {
  const look = LOOK[urgency];
  const why = `${URGENCY_LABEL[urgency]}: ${reasons.join(" · ")}`;
  return (
    <span className={`${COL.urgency} inline-flex items-center`} title={why}>
      <span aria-hidden="true" className="flex gap-0.5">
        {[1, 2, 3, 4].map((step) => (
          <span key={step} className={`h-1.5 w-[11px] rounded-[2px] ${step <= look.segments ? look.fill : "bg-zk-border"}`} />
        ))}
      </span>
      <span className="sr-only">{why}</span>
    </span>
  );
}

/**
 * One issue the agents split on, as a row like the Open list's (#your-call):
 * the issue, how urgent it is, how long it has waited, then two plain answers
 * (Yes, fix it / No, leave it). Each opens a small box with what the agents
 * said and an optional note; the answer goes to the agents as a comment.
 * The title links to the issue.
 */
function Row({ item, last }: { item: YourCallItem; last: boolean }) {
  const [sent, setSent] = useState(false);
  const verdicts = item.yes.length + item.no.length;
  return (
    <li className={`issues-row flex items-center ${last ? "" : "border-b border-zk-divider"}`}>
      <span className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5">
        <Link href={item.href} className="truncate text-sm font-semibold leading-snug text-zk-text hover:text-zk-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue">
          {plainTitle(item.title)}
        </Link>
        <span className="flex flex-wrap items-center gap-2 text-xs text-zk-muted">
          <span className="tabular-nums">Issue #{item.number}</span>
          <span>{verdicts} verdicts</span>
          <span>{item.kind === "merge" ? "Is the fix ready?" : "Is it a real problem?"}</span>
        </span>
      </span>
      <UrgencyCell urgency={item.urgency} reasons={item.reasons} />
      <span className={`${COL.waiting} text-xs text-zk-muted`}><LocalTime date={item.since} /></span>
      <span className={`${COL.answer} flex items-center gap-1.5`}>
        {item.answer || sent ? (
          <span role="status" className="inline-flex items-center rounded-lg bg-zk-ok-bg px-2.5 py-1.5 text-xs font-semibold text-zk-ok-fg">
            {item.answer ? `You answered: ${PLAIN[item.kind][item.answer]}. Waiting for the agents` : "Answer sent. Waiting for the agents"}
          </span>
        ) : (
          <>
            <YourCallAnswerButton item={item} answer="yes" onSent={() => setSent(true)} />
            <YourCallAnswerButton item={item} answer="no" onSent={() => setSent(true)} />
          </>
        )}
      </span>
    </li>
  );
}

/**
 * Your call (#your-call): the issues the agents split on, in one
 * table like the Open list, most urgent first. Each row says what it is, how
 * urgent it is and how long it has waited, and takes your answer.
 */
export function YourCall({ items }: { items: YourCallItem[] }) {
  const rank = (u: Urgency) => URGENCIES.indexOf(u);
  const rows = [...items].sort((a, b) => rank(a.urgency) - rank(b.urgency) || new Date(a.since).getTime() - new Date(b.since).getTime());
  return (
    <section aria-label="Your call" className="issues-results flex flex-col gap-3.5">
      <p className="m-0 text-[13px] text-zk-muted">Your agents couldn&apos;t agree on these and need your call.</p>
      {rows.length === 0 ? (
        <div className="rounded-[20px] border border-zk-border bg-zk-surface px-4 py-12 text-center">
          <p className="font-bold text-zk-text">Nothing needs you right now.</p>
          <p className="mt-1.5 text-sm text-zk-muted">When your agents can&apos;t agree on an issue, it shows up here.</p>
        </div>
      ) : (
        <div className="issues-table relative">
          <div className="issues-table-heading">
            <span className="min-w-0 flex-1">Issue</span>
            <span className={COL.urgency}>Urgency</span>
            <span className={COL.waiting}>Waiting</span>
            <span className={COL.answer} aria-hidden="true" />
          </div>
          <ul className="m-0 list-none p-0">
            {rows.map((item, i) => <Row key={item.id} item={item} last={i === rows.length - 1} />)}
          </ul>
        </div>
      )}
    </section>
  );
}
