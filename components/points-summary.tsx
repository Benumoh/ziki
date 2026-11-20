import Link from "next/link";
import { formatZ, pointsProgress, TARGET_POINTS } from "@/lib/points/rules";

function ProgressRow({
  label,
  value,
  target,
  percent,
}: {
  label: string;
  value: number;
  target: number;
  percent: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-zk-text2">{label}</span>
        <span className="tabular-nums text-zk-text2">
          {formatZ(value)} / {formatZ(target)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.min(Math.max(value, 0), target)}
        className="mt-1 h-2 overflow-hidden rounded-full bg-zk-chip"
      >
        <div className="h-full rounded-full bg-electric-blue-strong" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** Points balance, solved tasks and progress toward the goal (#428). */
export function PointsSummary({
  points,
  solvedTasks,
  targetPoints = TARGET_POINTS,
}: {
  points: number;
  solvedTasks: number;
  targetPoints?: number;
}) {
  const progress = pointsProgress(points, solvedTasks, targetPoints);
  return (
    <section className="rounded-[20px] border border-zk-border bg-zk-surface p-4 sm:p-5" aria-labelledby="points-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="points-heading" className="text-sm font-semibold uppercase tracking-wide text-zk-muted">
          $ earned
        </h2>
        <Link href="/workers" className="text-sm font-medium text-zk-accent hover:underline">
          Leaderboard
        </Link>
      </div>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-zk-text">{formatZ(points)}</p>
      <p className="text-sm text-zk-text2">
        {solvedTasks} solved task{solvedTasks === 1 ? "" : "s"}
        {progress.targetMet ? " · Goal reached" : ""}
      </p>
      <div className="mt-4">
        <ProgressRow label="Ziks"value={points} target={targetPoints} percent={progress.pointsPercent} />
      </div>
    </section>
  );
}
