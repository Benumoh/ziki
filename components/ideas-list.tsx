import { Fragment } from "react";
import Link from "next/link";
import { WorkSegmentFoot, WorkSegmentHeading } from "@/components/work-segment";
import type { WorkCategory } from "@/lib/work-category";
import { IdeaVoteBadge } from "@/components/vote-badge";
import { IdeaRowStatus } from "@/components/issue-row-status";
import { IdeaPathChips } from "@/components/idea-path";
import { LocalTime } from "@/components/local-time";
import { ideaPath, type ProjectRef } from "@/lib/project-paths";
import { SortHeader } from "@/components/sort-header";
import { DEFAULT_IDEA_SORT, IDEA_SORT_COOKIE } from "@/lib/list-sort";

export type IdeaListRow = {
  id: string;
  number: number;
  title: string;
  score: number;
  /** The project's `ideaThreshold`; null when it could not be read. */
  threshold: number | null;
  createdAt: Date;
  reporterName: string | null;
  /** Opened in place on the Overview (#work-feed): its summary and description, trimmed. */
  summary?: string | null;
  body?: string;
  /** The idea's own project, when the list shows several (#project-filter); the page's project otherwise. */
  ref?: ProjectRef;
  /** Its project's name, shown when the list holds every project. */
  projectName?: string | null;
  verdicts: number;
  /** A manager agent rejected it (#idea-rejected). */
  rejected?: boolean;
  /** A manager agent archived it (#idea-archive): the reason in words, e.g. "Already implemented". */
  archived?: string | null;
  /** Bad: manager agents are advised to reject it (lib/idea-rejection.ts). */
  bad?: boolean;
  /** Weighted good and bad votes (#724), shown as columns; 0 when nobody voted. */
  good: number;
  badVotes: number;
  /** The viewer already gave it a verdict (good, bad or neutral): its path shows In progress → Done, not Approve. */
  approvedByMe?: boolean;
  /** The latest thing that happened to it: an edit, a verdict, a rejection or archiving. */
  lastUpdateAt?: Date;
};

/**
 * The Ideas tab's New ideas, Drafted and Rejected ideas lists (#idea-table, #idea-rejected). Ideas are not issues: they
 * have their own numbers and pages, take verdicts instead of votes, and
 * leave this list once an agent converts them.
 */
export function IdeasList({ slug, ideas, empty, welcome, filters, sections, sort = DEFAULT_IDEA_SORT }: {
  slug: ProjectRef;
  ideas: IdeaListRow[];
  /** The list's sort, for the sortable column headers (#column-sort). */
  sort?: string;
  empty?: string;
  /** No open ideas yet: what Ziki is for, and a box to type the first one in. */
  welcome?: React.ReactNode;
  /** The section's status filters, shown after "Status" in the header row. */
  filters?: React.ReactNode;
  /**
   * New ideas grouped by kind (#work-segments): each kind's heading and count, the ideas shown under it (a few of
   * `ideas`, by id) and the link to all of that kind. Without it the ideas are one list.
   */
  sections?: { key: WorkCategory; label: string; add?: { href: string; label: string }; count: number; ids: string[]; href: string }[];
}) {
  if (ideas.length === 0 && welcome) return <>{welcome}</>;
  if (ideas.length === 0) {
    return (
      <div className="rounded-panel border border-zk-border bg-zk-surface px-4 py-12 text-center">
        <p className="font-bold text-zk-text">Nothing here right now.</p>
        <p className="mt-1.5 text-sm text-zk-muted">
          {empty ?? "New ideas show up here until an agent converts them to issues."}
        </p>
      </div>
    );
  }
  const renderRow = (idea: IdeaListRow, last: boolean) => (
              <li
                key={idea.id}
                data-testid="idea-row"
                className={`issues-row flex items-center gap-2 px-2 py-3.5 lg:gap-4 lg:px-4 ${
                  !last ? "border-b border-zk-divider" : ""
                }`}
              >
                <div className="issues-vote w-[52px] shrink-0">
                  <IdeaVoteBadge
                    ideaId={idea.id}
                    good={idea.good}
                    bad={idea.badVotes}
                    score={idea.score}
                    threshold={idea.threshold}
                    votable={!idea.rejected && !idea.archived}
                  />
                </div>
                <Link
                  href={ideaPath(idea.ref ?? slug, idea.number)}
                  className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-electric-blue"
                >
                  <span className="issues-row-title text-sm font-semibold leading-snug text-zk-text">{idea.title}</span>
                  <span className="issues-row-meta flex flex-wrap items-center gap-2 text-xs text-zk-muted">
                    <span className="font-mono tabular-nums">Idea #{idea.number}</span>
                    {idea.projectName ? <span className="rounded bg-zk-chip px-1.5 py-px text-[11px] font-medium text-zk-text2">{idea.projectName}</span> : null}
                    {idea.reporterName ? <span>{idea.reporterName}</span> : null}
                    <span>
                      {idea.verdicts} verdict{idea.verdicts === 1 ? "" : "s"}
                    </span>
                    <LocalTime date={idea.createdAt} />
                    <span className="inline-flex min-w-0 md:sr-only">
                      <IdeaRowStatus score={idea.score} threshold={idea.threshold} rejected={idea.rejected} archived={idea.archived} bad={idea.bad} />
                    </span>
                  </span>
                </Link>
                <span className="hidden w-24 shrink-0 text-xs text-zk-muted md:block" data-testid="idea-last-update">
                  {idea.lastUpdateAt ? <LocalTime date={idea.lastUpdateAt} /> : null}
                </span>
                {/* Idea → In progress → Done (or → Rejected), like the Live tab's deploy steps. Wider than the issues' status cell. */}
                <span className="issues-status-cell" style={{ width: 264, flexBasis: 264 }}>
                  <IdeaPathChips ideaId={idea.id} approvedByMe={Boolean(idea.approvedByMe)} score={idea.score} threshold={idea.threshold} rejected={idea.rejected} archived={idea.archived} bad={idea.bad} />
                </span>
              </li>
  );
  return (
    <section className="issues-results flex flex-col gap-3.5" aria-label="Ideas">
      <div className={`issues-table relative ${sections ? "issues-table--grouped" : ""}`}>
        <div>
          <div className="issues-table-heading">
            {/* Each column sorts the list on the server; the choice is kept in a cookie (#column-sort). */}
            <span className="w-[52px]">
              <SortHeader label="Score" current={sort} first="score" second="score_asc" cookie={IDEA_SORT_COOKIE} />
            </span>
            <span className="min-w-0 flex-1">
              <SortHeader label="Idea" current={sort} first="title" second="title_desc" firstDescending={false} cookie={IDEA_SORT_COOKIE} />
            </span>
            <span className="hidden w-24 shrink-0 md:block">
              <SortHeader label="Last update" current={sort} first="updated" second="updated_asc" cookie={IDEA_SORT_COOKIE} />
            </span>
            <span className="issues-status-cell justify-end" style={{ width: 264, flexBasis: 264 }}>
              {/* The column needs no label: its status filters say what it holds. */}
              {filters ?? <span className="sr-only">Status</span>}
            </span>
          </div>
          <ul>
            {sections
              ? sections.filter((section) => section.ids.length > 0).map((section) => (
                  <Fragment key={section.label}>
                    <WorkSegmentHeading label={section.label} add={section.add} />
                    {section.ids.map((id) => ideas.find((idea) => idea.id === id)).filter((idea): idea is IdeaListRow => Boolean(idea)).map((idea) => renderRow(idea, false))}
                    <WorkSegmentFoot href={section.href} label={section.label} count={section.count} shown={section.ids.length} />
                  </Fragment>
                ))
              : ideas.map((idea, index) => renderRow(idea, index === ideas.length - 1))}
          </ul>
        </div>
      </div>
    </section>
  );
}
