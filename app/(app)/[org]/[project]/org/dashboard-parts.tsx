import Link from "next/link";
import type { Breakdown, WeekPoint } from "@/lib/dashboard-queries";
import {
  RANGE_PRESETS,
  formatDateParam,
  isPreset,
  parseDateRange,
  presetRange,
} from "@/lib/dashboard-range";

/*
 * The organisation overview's figures (/org): the date range, stat tiles,
 * the weekly chart and the breakdown tables. Server components; each number
 * in a chart is also in a table.
 */

/** `basePath` is the overview's address, `/<slug>/org` (#project-urls). */
export function RangePicker({ range, basePath }: { range: ReturnType<typeof parseDateRange>; basePath: string }) {
  return (
    <nav aria-label="Date range" className="flex flex-wrap items-center gap-2">
      {RANGE_PRESETS.map((preset) => {
        const target = presetRange(preset.days);
        const active = isPreset(range, preset.days);
        return (
          <Link
            key={preset.days}
            href={`${basePath}?from=${formatDateParam(target.from)}&to=${formatDateParam(
              new Date(target.to.getTime() - 86400000),
            )}`}
            aria-current={active ? "page" : undefined}
            className={`rounded-full border px-3.5 py-2 text-sm font-medium transition ${
              active
                ? "border-electric-blue-strong bg-electric-blue-strong text-white"
                : "border-zk-border bg-zk-surface text-zk-text2 hover:bg-zk-chip"
            }`}
          >
            {preset.label}
          </Link>
        );
      })}
      <form
        action={basePath}
        className="flex flex-wrap items-end gap-2 sm:ml-2"
      >
        <label className="text-xs font-medium text-zk-text2">
          <span className="mb-1 block">From</span>
          <input
            type="date"
            name="from"
            defaultValue={formatDateParam(range.from)}
            className="rounded-xl border border-zk-border px-2.5 py-1.5 text-sm text-zk-text"
          />
        </label>
        <label className="text-xs font-medium text-zk-text2">
          <span className="mb-1 block">To</span>
          <input
            type="date"
            name="to"
            defaultValue={formatDateParam(new Date(range.to.getTime() - 86400000))}
            className="rounded-xl border border-zk-border px-2.5 py-1.5 text-sm text-zk-text"
          />
        </label>
        <button
          type="submit"
          className="rounded-full border border-zk-border bg-zk-surface px-3 py-1.5 text-sm font-medium text-zk-text2 transition hover:bg-zk-chip"
        >
          Apply
        </button>
      </form>
    </nav>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-panel border border-zk-border bg-zk-surface px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-zk-muted">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-zk-text">
        {value}
        {hint ? (
          <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-zk-muted">
            {hint}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

const WEEK_LABEL = (week: Date) =>
  week.toISOString().slice(0, 10);

export function WeeklyChart({ points }: { points: WeekPoint[] }) {
  const peak = Math.max(1, ...points.map((p) => Math.max(p.opened, p.closed)));
  const width = Math.max(points.length * 28, 120);
  const height = 140;

  return (
    <section className="rounded-panel border border-zk-border bg-zk-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zk-muted">
        Opened vs closed, by week
      </h2>
      <p className="mt-1 flex flex-wrap items-center gap-4 text-xs text-zk-text2">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-electric-blue-strong" />
          Opened
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-zk-muted" />
          Closed
        </span>
      </p>

      {points.length === 0 ? (
        <p className="mt-4 text-sm text-zk-muted">No weeks in this range.</p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            {/*
              The chart is decorative: every number in it is in the table
              below, which is the accessible version rather than a summary
              of one. So it is hidden from assistive technology instead of
              being given a label that cannot carry the data anyway.
            */}
            <svg
              viewBox={`0 0 ${width} ${height}`}
              width={width}
              height={height}
              role="presentation"
              aria-hidden="true"
              className="max-w-full"
            >
              {points.map((point, index) => {
                const x = index * 28 + 4;
                const openedH = Math.round((point.opened / peak) * (height - 24));
                const closedH = Math.round((point.closed / peak) * (height - 24));
                return (
                  <g key={point.week.toISOString()}>
                    <rect
                      x={x}
                      y={height - 16 - openedH}
                      width={9}
                      height={openedH}
                      rx={1.5}
                      className="fill-electric-blue-strong"
                    />
                    <rect
                      x={x + 11}
                      y={height - 16 - closedH}
                      width={9}
                      height={closedH}
                      rx={1.5}
                      className="fill-zk-muted"
                    />
                  </g>
                );
              })}
              <line
                x1={0}
                y1={height - 16}
                x2={width}
                y2={height - 16}
                className="stroke-zk-border"
                strokeWidth={1}
              />
            </svg>
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-zk-accent hover:underline">
              Show the figures
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <caption className="sr-only">
                  Issues opened and closed each week
                </caption>
                <thead className="text-left text-xs uppercase tracking-wide text-zk-accent">
                  <tr>
                    <th scope="col" className="py-1.5 pr-4">Week beginning</th>
                    <th scope="col" className="py-1.5 pr-4 text-right">Opened</th>
                    <th scope="col" className="py-1.5 text-right">Closed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zk-divider">
                  {points.map((point) => (
                    <tr key={point.week.toISOString()}>
                      <th scope="row" className="py-1.5 pr-4 font-normal text-zk-text2">
                        {WEEK_LABEL(point.week)}
                      </th>
                      <td className="py-1.5 pr-4 text-right tabular-nums">{point.opened}</td>
                      <td className="py-1.5 text-right tabular-nums">{point.closed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

export function BreakdownCard({
  title,
  rows,
  total,
  wide = false,
}: {
  title: string;
  rows: Breakdown[];
  total: number;
  wide?: boolean;
}) {
  return (
    <section className="rounded-panel border border-zk-border bg-zk-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zk-muted">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-zk-muted">Nothing in this range.</p>
      ) : (
        <table className={`mt-3 w-full text-sm ${wide ? "max-w-2xl" : ""}`}>
          <caption className="sr-only">{title}</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Group</th>
              <th scope="col">Issues</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="py-1 pr-3 text-left font-normal text-zk-text2">
                  {row.label}
                </th>
                <td className="w-full py-1 pr-3">
                  {/* Width is a visual echo of the number beside it, so it
                      carries no information of its own. */}
                  <span
                    aria-hidden="true"
                    className="block h-2 rounded-sm bg-electric-blue-strong/70"
                    style={{
                      width: `${total > 0 ? Math.max(2, (row.count / total) * 100) : 0}%`,
                    }}
                  />
                </td>
                <td className="py-1 text-right tabular-nums text-zk-text">
                  {row.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
