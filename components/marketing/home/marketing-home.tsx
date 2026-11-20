import Link from "next/link";
import { RowAge } from "@/components/issue-row-meta";
import { PILL_TONES, TILE_TONES, toneForName, type PillTone } from "@/lib/pill-tones";
import { marketingPath, type ProjectRef } from "@/lib/project-paths";
import { AddAsset } from "./add-asset";
import { ScoreBar } from "./score-bar";
import { HOME_GROUPS, type HomeAsset, type HomeTaskGroup, type HomeTaskItem, type HomeTaskType, type MarketingHomeData } from "./model";
import { GAP, PANEL, SECTION_TITLE, TOOL_BUTTON, TOOL_BUTTON_ON } from "@/lib/ui-style";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue";
const chip = `inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition ${focus}`;
/** The spreadsheet grid's header cells, body cells and solid pills. */
export const HEAD = "h-9 border-b border-r border-zk-border px-3 text-left text-[12.5px] font-medium text-zk-text2 last:border-r-0";
export const CELL = "border-b border-r border-zk-divider px-3 py-2 align-middle last:border-r-0";
export const PILL = "inline-flex max-w-full items-center truncate rounded-full px-2.5 py-0.5 text-[12px] font-semibold text-white";
/** Cards are flat: a thin line, no shadow. */
const LIFT = "";

/** Each group's colour, from the pills' tones. */
export const GROUP_TONE: Record<string, PillTone> = { done: "green", in_progress: "blue", open: "yellow", ideas: "purple", resolved: "cyan", closed: "grey" };

/** What a tab shows: one type, or the Overview (#marketing-overview) of them all. */
type Scope = { type: HomeTaskType | null; name: string; base: string };

/**
 * The Marketing home (#marketing-agent-home), laid out like the main list: one narrow white panel with Overview and
 * the task types as chips, then the tab's work: what needs attention as cards, and its assets (#marketing-assets)
 * as a grid, each with the work on it underneath.
 */
export function MarketingHome({ slug, data, status = null }: { slug: ProjectRef; data: MarketingHomeData; /** `?status=`: the grid shows only this group. */ status?: string | null }) {
  const home = marketingPath(slug);
  const scope: Scope = data.selected
    ? { type: data.selected, name: data.selected.name, base: `${home}?type=${encodeURIComponent(data.selected.id)}` }
    : { type: null, name: "Marketing", base: home };
  return (
    <section aria-labelledby="marketing-home-title" className={`mx-auto w-full max-w-[920px] ${PANEL}`}>
      {/* No visible title: the Marketing tab above says where you are. */}
      <h1 id="marketing-home-title" className="sr-only">Marketing</h1>
      {data.types.length === 0 ? (
        <div className="mt-4 rounded-2xl bg-zk-bg px-4 py-12 text-center">
          <p className="font-semibold text-zk-text">No marketing task types yet.</p>
          <p className="mt-1.5 text-sm text-zk-muted">An organisation owner or admin can add them in Marketing settings.</p>
        </div>
      ) : (
        <>
          <TypePills slug={slug} data={data} />
          <WorkFeed slug={slug} scope={scope} groups={data.groups} assets={data.assets} status={status} />
        </>
      )}
    </section>
  );
}

/** "Landing Pages" → "New Landing Page"; a name that isn't a plural reads "New asset". */
function newLabel(name: string): string {
  return /[^s]s$/i.test(name) ? `New ${name.slice(0, -1)}` : "New asset";
}

function TypePills({ slug, data }: { slug: ProjectRef; data: MarketingHomeData }) {
  const total = data.types.reduce((sum, type) => sum + type.count, 0);
  const pill = (selected: boolean) =>
    `${chip} ${selected ? "bg-white text-zk-text shadow-[0_1px_3px_rgba(16,24,40,0.12)] ring-1 ring-black/[0.04]" : "bg-zk-bg text-zk-text2 hover:bg-zk-chip"}`;
  return (
    <nav aria-label="Task types" className="flex flex-wrap items-center gap-1.5">
      {/* First, and where Marketing opens: the Feed, what needs you across every type. */}
      <Link href={marketingPath(slug)} scroll={false} aria-current={data.overview ? "page" : undefined} className={pill(data.overview)}>
        Feed
        <span className="text-[12px] tabular-nums text-zk-muted">{total}</span>
      </Link>
      {data.types.map((type) => {
        const selected = type.id === data.selected?.id;
        return (
          <Link
            key={type.id}
            href={`${marketingPath(slug)}?type=${encodeURIComponent(type.id)}`}
            scroll={false}
            aria-current={selected ? "page" : undefined}
            className={pill(selected)}
          >
            {type.name}
            <span className="text-[12px] tabular-nums text-zk-muted">
              {type.count}
              <span className="sr-only">{type.count === 1 ? " task" : " tasks"}</span>
            </span>
          </Link>
        );
      })}
      {/* Marketing settings, at the end of the tabs. */}
      <Link href={marketingPath(slug, "settings")} aria-label="Marketing settings" title="Marketing settings" className={`ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-zk-text2 transition hover:bg-zk-chip hover:text-zk-text ${focus}`}>
        <svg {...smallIcon}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
      </Link>
    </nav>
  );
}

/**
 * The grid's filter: a funnel button that opens a menu of the tab's statuses, each with its count, and All.
 * Picking one shows only the work in that status (`?status=`); the button turns blue and names it while one is picked.
 */
function StatusFilter({ scope, groups, picked }: { scope: Scope; groups: HomeTaskGroup[]; picked: HomeTaskGroup | null }) {
  const join = scope.base.includes("?") ? "&" : "?";
  const options = [
    { key: null as string | null, label: scope.type ? `All ${scope.name}` : "All work", count: groups.reduce((sum, group) => sum + group.items.length + group.more, 0), href: scope.base },
    ...groups.map((group) => ({ key: group.key as string | null, label: group.heading, count: group.items.length + group.more, href: `${scope.base}${join}status=${encodeURIComponent(group.key)}` })),
  ];
  return (
    // Keyed by the pick, so the menu is closed again once a pick loads.
    <details key={picked?.key ?? "all"} className="group relative">
      <summary
        aria-label={picked ? `Filter: ${picked.heading}` : "Filter"}
        title="Filter"
        className={`${TOOL_BUTTON} ${picked ? TOOL_BUTTON_ON : ""} ${focus}`}
      >
        <svg {...smallIcon}><path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" /></svg>
        {picked ? picked.heading : null}
      </summary>
      <div role="menu" aria-label="Filter by status" className="absolute right-0 z-20 mt-1.5 w-56 rounded-xl border border-zk-border bg-white p-1.5 shadow-[0_4px_16px_-4px_rgba(16,24,40,0.12)]">
        <p className="m-0 px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-zk-muted">Status</p>
        {options.map((option) => {
          const current = (picked?.key ?? null) === option.key;
          const tone = option.key ? PILL_TONES[GROUP_TONE[option.key] ?? "grey"] : null;
          return (
            <Link
              key={option.key ?? "all"}
              role="menuitemradio"
              aria-checked={current}
              href={option.href}
              scroll={false}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition hover:bg-zk-bg ${current ? "font-semibold text-zk-text" : "text-zk-text2"} ${focus}`}
            >
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tone ? tone.color : "transparent", border: tone ? undefined : "1px solid currentColor" }} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              <span className="text-[12px] tabular-nums text-zk-muted">{option.count}</span>
              <svg {...smallIcon} className={`h-3.5 w-3.5 shrink-0 text-zk-accent ${current ? "" : "invisible"}`}><path d="M20 6 9 17l-5-5" /></svg>
            </Link>
          );
        })}
      </div>
    </details>
  );
}

/** The groups that wait on a person: work to review, and ideas to vote on. */
const ATTENTION: Record<string, string> = { done: "Review it", ideas: "Vote on it" };
/** What each of those needs from you, in a sentence, under the asset's name. */
const NEEDS: Record<string, string> = { done: "Work is done on it: review it before it goes live", ideas: "An idea for it is waiting for your vote" };

/** Which work leads an asset's row: the step that most needs someone, then the newest. */
const GROUP_ORDER = HOME_GROUPS.map((group) => group.key as string);

type Work = { item: HomeTaskItem; group: HomeTaskGroup };

/** A row of the grid: an asset with the work on it. */
type Row = { key: string; name: string; asset: HomeAsset; typeName: string | null; work: Work[]; updatedAt: Date };

/**
 * The tab's work (#marketing-agent-home). The Feed (all types): only what needs you, as larger cards, each naming the
 * asset (About Us) and, underneath, what it needs from you (work to review, an idea to vote on). A type's tab: its
 * assets (#marketing-assets) as a grid, each row an asset and, underneath in small text, the work going on with it.
 * All marketing work is on an asset (#marketing-assets), so there is no row of work on none.
 */
function WorkFeed({ slug, scope, groups, assets, status }: { slug: ProjectRef; scope: Scope; groups: HomeTaskGroup[]; assets: HomeAsset[]; status: string | null }) {
  if (!scope.type) return <AttentionFeed slug={slug} groups={groups} assets={assets} />;
  if (groups.length === 0 && assets.length === 0) {
    return (
      <div className="mt-4 rounded-xl bg-zk-bg p-4">
        <div className={`flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-zk-border bg-white px-4 py-10 text-center ${LIFT}`}>
          <div>
            <p className="font-semibold text-zk-text">Nothing in {scope.name} yet.</p>
            <p className="mt-1 text-sm text-zk-muted">Add the first one to get started.</p>
          </div>
          <AddAsset slug={slug} typeId={scope.type.id} label={newLabel(scope.type.name)} />
        </div>
      </div>
    );
  }
  // The filter keeps only work in one group; an unknown one keeps it all.
  const picked = groups.find((group) => group.key === status) ?? null;
  const work: Work[] = (picked ? [picked] : groups).flatMap((group) => group.items.map((item) => ({ item, group })));
  const lead = (a: Work, b: Work) =>
    GROUP_ORDER.indexOf(a.group.key) - GROUP_ORDER.indexOf(b.group.key) || new Date(b.item.updatedAt).getTime() - new Date(a.item.updatedAt).getTime();
  const newest = (dates: Date[]) => new Date(Math.max(...dates.map((date) => new Date(date).getTime())));

  const rows: Row[] = assets
    .map((asset) => {
      const on = work.filter((entry) => entry.item.assetId === asset.id).sort(lead);
      return { key: asset.id, name: asset.name, asset, typeName: asset.typeName, work: on, updatedAt: newest([asset.updatedAt, ...on.map((entry) => entry.item.updatedAt)]) };
    })
    // While filtering, an asset with no work in that status drops out.
    .filter((row) => !picked || row.work.length > 0)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const more = groups.reduce((sum, group) => sum + group.more, 0);

  return (
    <div className={`mt-4 flex flex-col ${GAP} rounded-xl bg-zk-bg p-4`} aria-label={`${scope.name} work`}>
      <section aria-labelledby="marketing-all">
        {/* The grid's heading, with the filter and the button to add an asset (New Landing Page) on its right. */}
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <h3 id="marketing-all" className={`flex items-center gap-2 ${SECTION_TITLE}`}>
            All {scope.name}
            <span className="text-[12px] font-normal tabular-nums text-zk-muted">{assets.length}</span>
          </h3>
          <div className="flex shrink-0 items-center gap-2">
            <StatusFilter scope={scope} groups={groups} picked={picked} />
            <AddAsset slug={slug} typeId={scope.type.id} label={newLabel(scope.type.name)} />
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-zk-border bg-white">
          <table className="w-full min-w-[620px] table-fixed border-collapse text-[13.5px]">
            <colgroup>
              <col />
              {scope.type ? null : <col className="w-[150px]" />}
              <col className="w-[130px]" />
              <col className="w-[96px]" />
              <col className="w-[128px]" />
            </colgroup>
            <thead className="bg-[#f7f8fa]">
              <tr>
                <th scope="col" className={HEAD}>Name</th>
                {scope.type ? null : <th scope="col" className={HEAD}>Category</th>}
                <th scope="col" className={HEAD}>Score</th>
                <th scope="col" className={HEAD}>Updated</th>
                <th scope="col" className={HEAD}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={scope.type ? 4 : 5} className="px-3 py-8 text-center text-zk-muted">Nothing here in that status.</td>
                </tr>
              ) : rows.map((row) => {
                const current = row.work[0] ?? null;
                return (
                  <tr key={row.key} className="transition hover:bg-zk-bg">
                    <td className={CELL}>
                      {/* An asset opens its own page, with all the work on it. */}
                      <Link href={marketingPath(slug, `assets/${encodeURIComponent(row.asset.id)}`)} className={`block truncate font-semibold text-zk-text hover:underline ${focus}`}>
                        {row.name}
                      </Link>
                      {/* Underneath, in small text: the work going on with it now. */}
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-zk-muted">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5 shrink-0"><path d="M4 4v7a4 4 0 0 0 4 4h12" /><path d="m15 10 5 5-5 5" /></svg>
                        {current ? (
                          <>
                            <Link href={current.item.href} className={`min-w-0 truncate text-zk-text2 hover:underline ${focus}`}>{current.item.title}</Link>
                            {row.work.length > 1 ? <span className="shrink-0">· +{row.work.length - 1} more</span> : null}
                          </>
                        ) : (
                          <span className="truncate">No work on it yet</span>
                        )}
                      </span>
                    </td>
                    {scope.type ? null : <td className={`${CELL} truncate text-[12.5px] text-zk-text2`}>{row.typeName ?? "—"}</td>}
                    {/* How good it is now (#asset-score). */}
                    <td className={CELL}><ScoreBar score={row.asset.score} note={row.asset.scoreNote} /></td>
                    <td className={`${CELL} text-[12.5px] text-zk-text2`}><RowAge date={row.updatedAt} sort="updated" /></td>
                    <td className={`${CELL} bg-[#fafafb]`}>
                      {current ? (
                        <span className={PILL} style={{ backgroundColor: PILL_TONES[GROUP_TONE[current.group.key] ?? "grey"].color }}>{current.group.heading}</span>
                      ) : <span className="text-[12.5px] text-zk-muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {more > 0 ? <p className="mt-2 text-center text-[13px] text-zk-muted">And {more} more not listed.</p> : null}
      </section>
    </div>
  );
}

/**
 * The Marketing Feed (#marketing-agent-home): what needs you across every type, newest first, as larger cards. Each
 * names the asset the work is on and, underneath, what it needs from you; the pill on the right says it in a word.
 * A card opens its asset's page, where all of that asset's work is.
 */
function AttentionFeed({ slug, groups, assets }: { slug: ProjectRef; groups: HomeTaskGroup[]; assets: HomeAsset[] }) {
  const attention = groups
    .filter((group) => group.key in ATTENTION)
    .flatMap((group) => group.items.map((item) => ({ item, group })))
    .sort((a, b) => new Date(b.item.updatedAt).getTime() - new Date(a.item.updatedAt).getTime());
  return (
    <div className="mt-4 rounded-xl bg-zk-bg p-4" aria-label="Feed">
      {attention.length === 0 ? (
        <div className="flex min-h-40 flex-col items-center justify-center rounded-2xl border border-zk-border bg-white px-4 py-10 text-center">
          <p className="font-semibold text-zk-text">Nothing needs you right now.</p>
          <p className="mt-1 text-sm text-zk-muted">Work to review and ideas to vote on show up here.</p>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {attention.map(({ item, group }) => {
            const tone = PILL_TONES[GROUP_TONE[group.key] ?? "grey"];
            const asset = assets.find((entry) => entry.id === item.assetId);
            const name = asset?.name ?? item.title;
            return (
              <li key={item.id}>
                <Link href={asset ? marketingPath(slug, `assets/${encodeURIComponent(asset.id)}`) : item.href} className={`flex items-center gap-4 rounded-2xl border border-zk-border bg-white px-5 py-4 transition hover:bg-zk-bg ${focus}`}>
                  <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] text-[15px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]" style={TILE_TONES[toneForName(name)]}>
                    {name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-zk-text">{name}</span>
                    <span className="mt-0.5 block truncate text-[13px] text-zk-muted">
                      {NEEDS[group.key]} · <RowAge date={item.updatedAt} sort="updated" />
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full px-3 py-1 text-[12.5px] font-semibold" style={tone}>{ATTENTION[group.key]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const smallIcon = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, className: "h-4 w-4" } as const;
