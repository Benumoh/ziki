import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { formatZ } from "@/lib/points/rules";
import { issuePath } from "@/lib/issue-ref";
import { ideaPath } from "@/lib/project-paths";
import type { PointSources } from "@/lib/points/sources";

const card = "rounded-panel border border-zk-border bg-zk-surface p-4 sm:p-5";
const heading = "text-sm font-semibold uppercase tracking-wide text-zk-muted";

function share(points: number, total: number): string {
  return total > 0 ? `${Math.round((points / total) * 100)}%` : "–";
}

/**
 * Where a person's points came from (#points-sources): by action, by agent, by
 * day, signals worth a second look, and the latest entries. For the person and
 * the organisation's admins, so farming shows up.
 */
export function PointsSources({ sources, name }: { sources: PointSources; name: string }) {
  const positive = sources.bySource.reduce((sum, row) => sum + Math.max(row.points, 0), 0);
  const maxDay = Math.max(1, ...sources.byDay.map((day) => day.points));

  return (
    <section className={`${card} space-y-6`} aria-labelledby="points-sources-heading">
      <div>
        <h2 id="points-sources-heading" className={heading}>Where the $ came from</h2>
        <p className="mt-1 text-sm text-zk-text2">
          {formatZ(sources.total)} from {sources.entries.toLocaleString()} ledger entries for {name}, corrections included.
          Shown to {name} and the organisation&apos;s admins.
        </p>
      </div>

      {sources.signals.length > 0 ? (
        <ul className="m-0 list-none space-y-1.5 p-0" aria-label="Worth a second look">
          {sources.signals.map((signal) => (
            <li
              key={signal.text}
              className={`rounded-lg px-3 py-2 text-[13px] ${signal.level === "warn" ? "bg-zk-warn-bg text-zk-warn-fg" : "bg-zk-chip text-zk-text2"}`}
            >
              {signal.level === "warn" ? "⚠ " : ""}{signal.text}
            </li>
          ))}
        </ul>
      ) : sources.entries > 0 ? (
        <p className="rounded-lg bg-zk-ok-bg px-3 py-2 text-[13px] text-zk-ok-fg">Nothing unusual in how this $ was earned.</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[13px] font-semibold text-zk-text">By action</h3>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-zk-divider text-left text-zk-muted">
                <th className="py-1.5 pr-2 font-medium">What earned them</th>
                <th className="py-1.5 pr-2 text-right font-medium">Times</th>
                <th className="py-1.5 pr-2 text-right font-medium">Ziks</th>
                <th className="py-1.5 text-right font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {sources.bySource.map((row) => (
                <tr key={row.kind} className="border-b border-zk-divider last:border-0">
                  <td className="py-1.5 pr-2 text-zk-text">{row.label}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-zk-text2">{row.count.toLocaleString()}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-zk-text">{formatZ(row.points)}</td>
                  <td className="py-1.5 text-right tabular-nums text-zk-muted">{row.points > 0 ? share(row.points, positive) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h3 className="mb-2 text-[13px] font-semibold text-zk-text">By agent</h3>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-zk-divider text-left text-zk-muted">
                <th className="py-1.5 pr-2 font-medium">Who did the work</th>
                <th className="py-1.5 pr-2 text-right font-medium">Times</th>
                <th className="py-1.5 text-right font-medium">Ziks</th>
              </tr>
            </thead>
            <tbody>
              {sources.byAgent.map((row) => (
                <tr key={row.agentId ?? "self"} className="border-b border-zk-divider align-top last:border-0">
                  <td className="py-1.5 pr-2">
                    <span className="text-zk-text">{row.name}</span>
                    <span className="block text-[11.5px] text-zk-muted">{row.kinds.slice(0, 4).join(" · ")}{row.kinds.length > 4 ? " · …" : ""}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-zk-text2">{row.count.toLocaleString()}</td>
                  <td className="py-1.5 text-right tabular-nums text-zk-text">{formatZ(row.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-zk-text">Last 14 days</h3>
        <ol className="m-0 flex h-24 list-none items-end gap-1 p-0" aria-label="$ per day, last 14 days">
          {sources.byDay.map((day) => (
            <li key={day.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${day.day}: ${formatZ(day.points)} from ${day.count} entries`}>
              <span
                className="w-full rounded-t bg-electric-blue-strong/70"
                style={{ height: `${Math.max(day.points > 0 ? 4 : 0, (Math.max(day.points, 0) / maxDay) * 100)}%` }}
              />
              <span className="text-[10px] tabular-nums text-zk-muted">{day.day.slice(8)}</span>
              <span className="sr-only">{day.day}: {formatZ(day.points)}, {day.count} entries</span>
            </li>
          ))}
        </ol>
      </div>

      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-zk-text">Latest entries</h3>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-zk-surface">
              <tr className="border-b border-zk-divider text-left text-zk-muted">
                <th className="py-1.5 pr-2 font-medium">When</th>
                <th className="py-1.5 pr-2 font-medium">What</th>
                <th className="py-1.5 pr-2 font-medium">Agent</th>
                <th className="py-1.5 pr-2 font-medium">On</th>
                <th className="py-1.5 text-right font-medium">Ziks</th>
              </tr>
            </thead>
            <tbody>
              {sources.recent.map((row) => (
                <tr key={row.id} className={`border-b border-zk-divider last:border-0 ${row.corrected ? "text-zk-muted line-through" : ""}`}>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-zk-text2"><LocalTime date={row.at} /></td>
                  <td className="py-1.5 pr-2 text-zk-text">{row.label}</td>
                  <td className="py-1.5 pr-2 text-zk-text2">{row.agentName ?? "Themself"}</td>
                  <td className="py-1.5 pr-2">
                    {row.issue?.projectRef ? (
                      <Link href={issuePath(row.issue.projectRef, row.issue.number)} className="text-zk-accent hover:underline">#{row.issue.number}</Link>
                    ) : row.idea?.projectRef ? (
                      <Link href={ideaPath(row.idea.projectRef, row.idea.number)} className="text-zk-accent hover:underline">Idea #{row.idea.number}</Link>
                    ) : (
                      <span className="text-zk-muted">–</span>
                    )}
                  </td>
                  <td className={`py-1.5 text-right tabular-nums ${row.points < 0 ? "text-zk-bad-fg" : "text-zk-text"}`}>
                    {row.points > 0 ? "+" : ""}{formatZ(row.points)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
