import type { WorkStat } from "@/lib/work-stats";

/** "+18%", "−8%", "New" or "No change": this week against the week before. */
function trend(thisWeek: number, lastWeek: number): { text: string; up: boolean | null } {
  if (thisWeek === lastWeek) return { text: "No change", up: null };
  if (lastWeek === 0) return { text: "New", up: true };
  const change = Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
  return { text: `${change > 0 ? "+" : "−"}${Math.abs(change)}%`, up: change > 0 };
}

/**
 * The work page Overview's stat cards (#work-stats), in the analytics design's style: a coloured line with a dot down
 * the left, the label, this week's number with its trend against last week (green up, red down), what it counts,
 * and a strip of ticks along the bottom, one a day for four weeks, coloured on the days something happened.
 */
export function StatCards({ stats }: { stats: WorkStat[] }) {
  return (
    <ul aria-label="This week" className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => {
        const change = trend(stat.thisWeek, stat.lastWeek);
        const peak = Math.max(1, ...stat.daily);
        return (
          <li key={stat.key} className="relative overflow-hidden rounded-xl border border-zk-border bg-zk-surface px-5 pb-4 pt-4">
            {/* The coloured line down the left, with its dot at the top. */}
            <span aria-hidden="true" className="absolute left-[17px] top-[22px] h-[60px] w-px" style={{ backgroundColor: stat.colour }} />
            <span aria-hidden="true" className="absolute left-[15px] top-[20px] h-[5px] w-[5px] rounded-full" style={{ backgroundColor: stat.colour }} />
            <div className="pl-3">
              <p className="m-0 text-[14px] font-medium leading-5 text-[#697386]">{stat.label}</p>
              <p className="m-0 mt-1.5 flex items-center gap-2 text-[14px] leading-5">
                <span className="text-[20px] font-medium tracking-[-0.4px] text-zk-text">{stat.thisWeek}</span>
                <span className={`inline-flex items-center gap-0.5 ${change.up === null ? "text-zk-muted" : change.up ? "text-[#0f6e4c]" : "text-[#c4292e]"}`}>
                  {change.up === null ? null : (
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`h-3 w-3 ${change.up ? "" : "rotate-90"}`}>
                      <path d="M3 9 9 3M4.1 3H9v4.9" />
                    </svg>
                  )}
                  {change.text}
                </span>
              </p>
              <p className="m-0 mt-1 truncate text-[14px] leading-5 text-[#697386]" title={stat.note}>vs. {stat.lastWeek} last week</p>
            </div>
            {/* A tick a day for four weeks: coloured on days with any, stronger on busier ones. */}
            <span aria-hidden="true" className="mt-3 flex h-[13px] items-stretch gap-[2px]">
              {stat.daily.map((count, day) => (
                <span
                  key={day}
                  className="flex-1 rounded-[1px]"
                  style={count > 0 ? { backgroundColor: stat.colour, opacity: 0.35 + 0.65 * (count / peak) } : { backgroundColor: "#e8e8e8" }}
                />
              ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
