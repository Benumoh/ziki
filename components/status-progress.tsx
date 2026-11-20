import { decisionStageInfo, pipelineStages, type DecisionStage } from "@/lib/decision-stages";

/** Most steps the side rail's progress shows. */
const MAX_NODES = 6;

/**
 * The issue's progress in the side rail's Status card (#status-progress): the progress report, abridged to at most six
 * steps down a line. Earlier steps that are done fold into the first node ("Idea → Open, done"); the current step is
 * marked now (or set back, in amber); the next ones are hollow. Each step says how many entries it has.
 */
export function StatusProgress({
  currentStage,
  setback = false,
  entryCounts = {},
  live,
}: {
  currentStage: DecisionStage;
  setback?: boolean;
  entryCounts?: Partial<Record<DecisionStage, number>>;
  /** On a Live issue: where its fix really is, in place of the Live step's count. */
  live?: { caption: string };
}) {
  const steps = pipelineStages(currentStage);
  const current = steps.indexOf(currentStage);
  // A window of six around the current step, at most two done steps before it; the rest done before fold into one.
  const start = Math.max(0, Math.min(current - 2, steps.length - MAX_NODES));
  const shown = steps.slice(start, start + MAX_NODES);
  const folded = steps.slice(0, start);

  return (
    <ol aria-label="Progress" className="m-0 mt-1 flex list-none flex-col p-0">
      {folded.length > 0 ? (
        <Node state="done" label={`${decisionStageInfo[folded[0]].label} → ${decisionStageInfo[folded.at(-1)!].label}`} caption="Done" last={false} />
      ) : null}
      {shown.map((stage, index) => {
        const at = start + index;
        const state = at < current ? "done" : at > current ? "todo" : setback ? "warn" : "now";
        const count = entryCounts[stage];
        const [one, many] = decisionStageInfo[stage].entry;
        const caption = stage === "live" && live
          ? live.caption
          : count !== undefined && (state !== "todo" || count > 0) ? `${count} ${count === 1 ? one : many}` : null;
        return <Node key={stage} state={state} label={decisionStageInfo[stage].label} caption={caption} last={index === shown.length - 1} />;
      })}
    </ol>
  );
}

function Node({ state, label, caption, last }: { state: "done" | "now" | "warn" | "todo"; label: string; caption: string | null; last: boolean }) {
  const ring = state === "now" ? "border-[#1f8a4c]" : state === "warn" ? "border-zk-warn-fg" : state === "done" ? "border-[#1f8a4c] bg-[#1f8a4c]" : "border-zk-border";
  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      {/* The line down to the next step. */}
      {last ? null : <span aria-hidden="true" className={`absolute left-[8px] top-[18px] bottom-0 w-[2px] ${state === "done" ? "bg-[#1f8a4c]/40" : "bg-zk-border"}`} />}
      <span aria-hidden="true" className={`relative mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 bg-zk-surface ${ring}`}>
        {state === "done" ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
        ) : state === "now" ? (
          <span className="h-2 w-2 rounded-full bg-[#1f8a4c]" />
        ) : state === "warn" ? (
          <span className="h-2 w-2 rounded-full bg-zk-warn-fg" />
        ) : null}
      </span>
      <span className="min-w-0">
        <span className={`block text-[13px] leading-5 ${state === "todo" ? "font-medium text-zk-muted" : "font-semibold text-zk-text"}`}>
          {label}
          {state === "now" ? <span className="font-semibold text-[#176b3b]"> (now)</span> : state === "warn" ? <span className="font-semibold text-zk-warn-fg"> (sent back)</span> : null}
        </span>
        {caption ? <span className="block text-[12px] leading-4 text-zk-muted">{caption}</span> : null}
      </span>
    </li>
  );
}
