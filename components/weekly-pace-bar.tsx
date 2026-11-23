import { formatZik } from "@/lib/coins/math";
import { weeklyPace, type PaceState } from "@/lib/coins/weekly-pace";

const TONE: Record<PaceState, string> = {
  "on-track": "bg-[#0F3326] text-[#6EE7A8]",
  fixable: "bg-[#3A2D0B] text-[#F5C451]",
  short: "bg-[#3B1620] text-[#FF8A9B]",
};

/** Weekly pace bar for dark surfaces: earned (solid), in motion (striped), goal mark. */
export function WeeklyPaceBar({ earned, inMotion, target }: { earned: number; inMotion: number; target: number }) {
  const p = weeklyPace(earned, inMotion, target);
  return (
    <div className="relative flex flex-col gap-2.5" data-testid="weekly-pace">
      <div className="flex items-center justify-between gap-2 text-[13px]">
        <span className="font-bold text-[#A9BCDF] uppercase tracking-[0.08em] text-xs">This week</span>
        <span className={`rounded-full px-2 py-px font-bold ${TONE[p.state]}`}>{p.headline}</span>
      </div>
      <div
        role="progressbar"
        aria-label="Weekly pace"
        aria-valuemin={0}
        aria-valuemax={p.target}
        aria-valuenow={Math.min(p.earned, p.target)}
        aria-valuetext={`${formatZik(p.earned)} earned, ${formatZik(p.inMotion)} in motion, goal ${formatZik(p.target)}`}
        className="relative h-3.5 overflow-hidden rounded-full bg-blue-slate"
      >
        <div className="flex h-full w-full">
          <div className="h-full bg-electric-blue transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${p.earnedPct}%` }} />
          <div
            className="h-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
            style={{
              width: `${p.inMotionPct}%`,
              background: "repeating-linear-gradient(135deg,#4d6aa8 0 6px,#33497a 6px 12px)",
            }}
          />
        </div>
        <span aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-white/90" style={{ left: `${p.goalPct}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#C9D6EF]">
        <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="h-2 w-2 rounded-full bg-electric-blue" />Earned {formatZik(p.earned)}</span>
        <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="h-2 w-2 rounded-full bg-[#4d6aa8]" />In motion {formatZik(p.inMotion)}</span>
        <span className="ml-auto font-semibold">Goal {formatZik(p.target)}</span>
      </div>
      <span className="text-[13px] text-[#C9D6EF]">{p.detail}</span>
    </div>
  );
}
