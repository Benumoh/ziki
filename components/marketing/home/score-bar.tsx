/**
 * How good an asset is now (#asset-score), as a bar: 0-100 filled from the left, red below 40, amber below 70,
 * green from 70, with the number beside it. Not rated yet: an empty track and a dash.
 */
export function ScoreBar({ score, note, className = "" }: { score: number | null; note?: string | null; className?: string }) {
  const colour = score === null ? "" : score < 40 ? "#e5484d" : score < 70 ? "#d99a00" : "#17a673";
  const label = score === null ? "Not rated yet" : `Score ${score} of 100${note ? `: ${note}` : ""}`;
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`} title={label}>
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score ?? undefined}
        className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zk-chip"
      >
        {score === null ? null : <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${score}%`, backgroundColor: colour }} />}
      </span>
      <span className={`w-7 shrink-0 text-right text-[12px] tabular-nums ${score === null ? "text-zk-muted" : "font-semibold text-zk-text2"}`}>{score ?? "—"}</span>
    </span>
  );
}
