import type { ActivityType } from "@prisma/client";
import { activityNote } from "@/lib/resolution-note";
import { LocalTime } from "@/components/local-time";
import { ExpandableText } from "@/components/expandable-text";

export type ActivityEntry = {
  id: string;
  /** An activity row's type, or "step" for a step entry (a confirmation, bid, award, delivery, judgement or merge review). */
  type: ActivityType | "step";
  summary: string;
  createdAt: Date;
  actor: { name: string };
  /** The person an agent acted for, named after it ("Mark's Claude for Mark"). */
  actorFor?: string | null;
  metadata?: unknown;
};

type When = Date | string;
const toDate = (at: When) => new Date(at);

/**
 * The issue's step entries as activity rows: each confirmation (not undone), bid and its
 * withdrawal, award and release, delivery, judgement and merge review. An agent's entry
 * names the agent, for its person; a person's own confirmation names the person.
 */
export function issueStepActivities(steps: {
  confirmations: { id: string; verdict: string; agentName: string | null; by: string; undone: boolean; updatedAt: When }[];
  bids: { id: string; agentName: string; by: string; createdAt?: When; updatedAt: When; withdrawnAt?: When | null }[];
  claims: { id: string; agentName: string; personName: string; offeredAt: When | null; claimedAt: When | null; releasedAt: When | null }[];
  deliveries: { id: string; agentName: string; by: string; updatedAt: When }[];
  testVerdicts: { id: string; agentName: string; by: string; goodToMerge: boolean; updatedAt: When }[];
  mergeReviews: { id: string; agentName: string; by: string; verdict: string; updatedAt: When }[];
}): ActivityEntry[] {
  const rows: ActivityEntry[] = [];
  const add = (id: string, at: When, actor: string, actorFor: string | null, summary: string) =>
    rows.push({ id, type: "step", summary, createdAt: toDate(at), actor: { name: actor }, actorFor });

  for (const c of steps.confirmations) {
    if (c.undone) continue;
    const summary =
      c.verdict === "confirm" ? "confirmed this issue" : c.verdict === "reject" ? "rejected this issue" : "gave a neutral confirmation";
    if (c.agentName) add(`step-confirmation-${c.id}`, c.updatedAt, c.agentName, c.by, summary);
    else add(`step-confirmation-${c.id}`, c.updatedAt, c.by, null, summary);
  }
  for (const b of steps.bids) {
    add(`step-bid-${b.id}`, b.createdAt ?? b.updatedAt, b.agentName, b.by, "bid");
    if (b.withdrawnAt) add(`step-bid-withdrawn-${b.id}`, b.withdrawnAt, b.agentName, b.by, "withdrew a bid");
  }
  for (const c of steps.claims) {
    const awardedAt = c.offeredAt ?? c.claimedAt;
    if (awardedAt) add(`step-award-${c.id}`, awardedAt, c.agentName, c.personName, "was awarded the issue");
    if (c.releasedAt) add(`step-release-${c.id}`, c.releasedAt, c.agentName, c.personName, "released it");
  }
  for (const d of steps.deliveries) add(`step-delivery-${d.id}`, d.updatedAt, d.agentName, d.by, "delivered the work");
  for (const v of steps.testVerdicts) {
    add(`step-verdict-${v.id}`, v.updatedAt, v.agentName, v.by, v.goodToMerge ? "judged it good to merge" : "judged it not good to merge");
  }
  for (const r of steps.mergeReviews) {
    add(`step-review-${r.id}`, r.updatedAt, r.agentName, r.by, r.verdict === "accept" ? "accepted it for merging" : "rejected it for merging");
  }
  return rows;
}

/** How many of the newest entries show before "Show earlier". */
const SHOWN = 2;

export function ActivityTimeline({
  activities,
  totalCount,
}: {
  /** The newest entries, oldest first. May be fewer than `totalCount`. */
  activities: ActivityEntry[];
  /** Every entry on the issue, so the heading does not under-report. */
  totalCount?: number;
}) {
  const total = totalCount ?? activities.length;
  // The newest SHOWN entries are always visible; the earlier ones show when
  // the toggle under them is ticked (CSS only, so it works without JavaScript).
  const earlier = activities.slice(0, Math.max(0, activities.length - SHOWN));
  const latest = activities.slice(earlier.length);
  const notLoaded = total - activities.length;
  return (
    <section className="group/activity rounded-panel border border-zk-border bg-zk-surface p-5">
      <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">
        Activity ({total})
      </h2>
      {activities.length === 0 ? (
        <p className="mt-3 text-sm text-zk-muted">No activity recorded yet.</p>
      ) : (
        <>
          {earlier.length > 0 ? (
            <ActivityList entries={earlier} className="mt-3 hidden pb-3 group-has-checked/activity:block" />
          ) : null}
          <ActivityList entries={latest} className={earlier.length > 0 ? "group-has-checked/activity:mt-0 mt-3" : "mt-3"} />
          {earlier.length > 0 ? (
            <label className="mt-3 inline-flex cursor-pointer select-none text-[11px] text-zk-muted hover:text-zk-text2 hover:underline has-focus-visible:ring-2 has-focus-visible:ring-electric-blue-strong">
              <input type="checkbox" className="sr-only" />
              <span className="group-has-checked/activity:hidden">
                Show {earlier.length} earlier
                {notLoaded > 0 ? ` (of ${earlier.length + notLoaded})` : ""}
              </span>
              <span className="hidden group-has-checked/activity:inline">Hide earlier</span>
            </label>
          ) : null}
        </>
      )}
    </section>
  );
}

function ActivityList({ entries, className }: { entries: ActivityEntry[]; className: string }) {
  return (
    <ol className={`relative space-y-0 border-l border-zk-divider pl-4 sm:pl-5 ${className}`}>
      {entries.map((entry) => (
        <li key={entry.id} className="relative pb-3 last:pb-0">
          <span
            aria-hidden
            className="absolute -left-[1.15rem] sm:-left-[1.4rem] top-1 h-2 w-2 rounded-full border-2 border-zk-surface bg-electric-blue-strong"
          />
          {/* One line: who did what, the time on the right. */}
          <div className="flex min-w-0 items-baseline gap-3 text-xs text-zk-text2">
            <p
              className="m-0 min-w-0 flex-1 truncate"
              title={`${entry.actor.name}${entry.actorFor ? ` for ${entry.actorFor}` : ""} ${entry.summary}`}
            >
              <span className="font-bold text-zk-text">{entry.actor.name}</span>
              {entry.actorFor ? <span className="text-zk-muted"> for {entry.actorFor}</span> : null} {entry.summary}
            </p>
            <LocalTime className="shrink-0 text-[11px] text-zk-muted" date={entry.createdAt} />
          </div>
          {entry.type === "status_changed" && activityNote(entry.metadata) ? (
            <ExpandableText maxLines={3} expandText="View more" collapseText="View less">
              <blockquote className="mt-1 whitespace-pre-wrap break-words border-l-[3px] border-zk-ok-fg/40 bg-zk-chip pl-3 text-xs text-zk-text2">
                {activityNote(entry.metadata)}
              </blockquote>
            </ExpandableText>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
