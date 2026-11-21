import { LocalTime } from "@/components/local-time";
import { ClaimDeadline } from "@/components/claim-deadline";
import { ExpandableText } from "@/components/expandable-text";

/**
 * What agents decided on one issue, in sentences (#448). The raw audit dump
 * stays on the audit page (#447); nothing here renders a JSON payload.
 */
export type AgentDecision =
  | {
      id: string;
      at: Date | string;
      kind: "confirmed";
      agentName: string;
      /** The person the agent acted for. */
      personName: string;
    }
  | {
      id: string;
      at: Date | string;
      /** #1122: a reviewer found it isn't a real issue. Never a confirmation. */
      kind: "rejected";
      agentName: string;
      personName: string;
      /** The reviewer's reasons, usually the reproduction they tried. */
      notes: string | null;
    }
  | {
      id: string;
      at: Date | string;
      kind: "claimed";
      agentName: string;
      personName: string;
      /** #593: the delivery deadline, and whether the one extension was used. */
      deliverBy?: Date | string | null;
      extendedAt?: Date | string | null;
      /** #606: the agent's owner, while the claim is paused on their answer. */
      waitingOnName?: string | null;
    }
  | {
      id: string;
      at: Date | string;
      /** #1446: a claim that was released or taken back. */
      kind: "claim_released";
      agentName: string;
      personName: string;
    }
  | {
      id: string;
      at: Date | string;
      /** #delivered-step: the agent holding the claim delivered its work. */
      kind: "delivered";
      agentName: string;
      personName: string;
    }
  | { id: string; at: Date | string; kind: "verdict"; agentName: string; personName: string; goodToMerge: boolean }
  | {
      id: string;
      at: Date | string;
      kind: "accepted";
      agentName: string;
      /** #1446: the merger agent merged and deployed it, not just accepted it. */
      merged?: boolean;
    }
  | {
      id: string;
      at: Date | string;
      /** #1446: the merger agent's deployment checks or merge failed. */
      kind: "deploy_failed";
      agentName: string;
      reason: string | null;
    }
  | {
      id: string;
      at: Date | string;
      /** #1429: a manager agent sent the fix back. Never an accept. */
      kind: "merge_rejected";
      agentName: string;
      /** What the manager agent asked to change. */
      notes: string | null;
    };

export function timeOf(decision: AgentDecision): number {
  return new Date(decision.at).getTime();
}

type VerdictVisual = {
  label: string;
  chip: string;
  iconWrap: string;
};

export function verdictVisual(decision: AgentDecision): VerdictVisual {
  switch (decision.kind) {
    case "rejected":
      return {
        label: "Not a real issue",
        chip: "bg-zk-bad-bg text-zk-bad-fg",
        iconWrap: "bg-zk-bad-bg text-zk-bad-fg",
      };
    case "confirmed":
      return {
        label: "Confirmed",
        chip: "bg-zk-ok-bg text-zk-ok-fg",
        iconWrap: "bg-zk-ok-bg text-zk-ok-fg",
      };
    case "claimed":
      return {
        label: "Claimed",
        chip: "bg-zk-info-bg text-zk-info-fg",
        iconWrap: "bg-zk-info-bg text-zk-info-fg",
      };
    case "verdict":
      return decision.goodToMerge
        ? {
            label: "Good to merge",
            chip: "bg-zk-ok-bg text-zk-ok-fg",
            iconWrap: "bg-zk-ok-bg text-zk-ok-fg",
          }
        : {
            label: "Not ready to merge",
            chip: "bg-zk-warn-bg text-zk-warn-fg",
            iconWrap: "bg-zk-warn-bg text-zk-warn-fg",
          };
    case "accepted":
      return {
        label: decision.merged ? "Deployed" : "Good to merge",
        chip: "bg-zk-ok-bg text-zk-ok-fg",
        iconWrap: "bg-zk-ok-bg text-zk-ok-fg",
      };
    case "merge_rejected":
      return {
        label: "Not ready to merge",
        chip: "bg-zk-warn-bg text-zk-warn-fg",
        iconWrap: "bg-zk-warn-bg text-zk-warn-fg",
      };
    case "delivered":
      return {
        label: "Work delivered",
        chip: "bg-zk-ok-bg text-zk-ok-fg",
        iconWrap: "bg-zk-ok-bg text-zk-ok-fg",
      };
    case "claim_released":
      return {
        label: "Claim released",
        chip: "bg-zk-bad-bg text-zk-bad-fg",
        iconWrap: "bg-zk-bad-bg text-zk-bad-fg",
      };
    case "deploy_failed":
      return {
        label: "Deployment failed",
        chip: "bg-zk-bad-bg text-zk-bad-fg",
        iconWrap: "bg-zk-bad-bg text-zk-bad-fg",
      };
  }
}

export function VerdictGlyph({ kind, goodToMerge }: { kind: AgentDecision["kind"]; goodToMerge?: boolean }) {
  const common = "h-[15px] w-[15px]";
  if (kind === "rejected" || kind === "claim_released") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={common} aria-hidden>
        <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "claimed" || kind === "delivered") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={common} aria-hidden>
        <path d="M12 5v14M5 12h14" strokeLinecap="round" />
      </svg>
    );
  }
  if ((kind === "verdict" && !goodToMerge) || kind === "merge_rejected" || kind === "deploy_failed") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={common} aria-hidden>
        <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "verdict" || kind === "accepted") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={common} aria-hidden>
        <circle cx="18" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <path d="M6 9v12M6 9a9 9 0 0 0 9 9" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={common} aria-hidden>
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function decisionSentence(decision: AgentDecision) {
  switch (decision.kind) {
    case "confirmed":
      return (
        <>
          <strong className="font-bold text-zk-text">{decision.agentName}</strong> confirmed this issue as real
          {decision.personName ? <> on behalf of {decision.personName}</> : null}.
        </>
      );
    case "rejected":
      return (
        <>
          <strong className="font-bold text-zk-text">{decision.agentName}</strong> found this isn&apos;t a real
          issue{decision.personName ? <> on behalf of {decision.personName}</> : null}.
        </>
      );
    case "claimed":
      return (
        <>
          <strong className="font-bold text-zk-text">{decision.agentName}</strong> claimed this issue for{" "}
          {decision.personName}.
          {decision.waitingOnName ? (
            <>
              {" "}
              Waiting for {decision.waitingOnName} to answer {decision.agentName}&apos;s question.
            </>
          ) : decision.deliverBy ? (
            <>
              {" "}
              <ClaimDeadline deliverBy={decision.deliverBy} />
              {decision.extendedAt ? " (extension used)" : ""}.
            </>
          ) : null}
        </>
      );
    case "verdict":
      return (
        <>
          <strong className="font-bold text-zk-text">{decision.agentName}</strong> said this fix is{" "}
          {decision.goodToMerge ? "good to merge" : "not ready to merge"}.
        </>
      );
    case "accepted":
      return decision.merged ? (
        <>
          <strong className="font-bold text-zk-text">{decision.agentName}</strong> merged and deployed the fix.
        </>
      ) : (
        <>
          <strong className="font-bold text-zk-text">{decision.agentName}</strong> accepted the fix and marked this
          issue resolved.
        </>
      );
    case "delivered":
      return (
        <>
          <strong className="font-bold text-zk-text">{decision.agentName}</strong> delivered the work for{" "}
          {decision.personName}.
        </>
      );
    case "claim_released":
      return (
        <>
          The claim by <strong className="font-bold text-zk-text">{decision.agentName}</strong> for{" "}
          {decision.personName} was released.
        </>
      );
    case "deploy_failed":
      return (
        <>
          <strong className="font-bold text-zk-text">{decision.agentName}</strong> couldn&apos;t deploy the fix
          {decision.reason ? <>: {decision.reason}</> : "."}
        </>
      );
    case "merge_rejected":
      return (
        <>
          <strong className="font-bold text-zk-text">{decision.agentName}</strong> rejected the fix and asked for
          changes before it can merge.
        </>
      );
  }
}

/**
 * The agent decisions on an issue, oldest first. Renders nothing when there
 * are none, so an issue with no agent activity omits the section.
 */
export function IssueAgentActivity({
  decisions,
  bare = false,
  highlightId = null,
}: {
  decisions: ReadonlyArray<AgentDecision>;
  /** Just the timeline, without its own box (inside the summary's "Show all"). */
  bare?: boolean;
  /** The decision a summary card was clicked for; its entry is tinted. */
  highlightId?: string | null;
}) {
  if (decisions.length === 0) return null;

  const ordered = [...decisions].sort((a, b) => timeOf(a) - timeOf(b) || a.id.localeCompare(b.id));

  const timeline = (
      <ol className="flex flex-col gap-1">
        {ordered.map((decision, index) => {
          const visual = verdictVisual(decision);
          const isLast = index === ordered.length - 1;
          return (
            <li
              key={decision.id}
              id={`agent-decision-${decision.id}`}
              className={`flex gap-3.5 rounded-xl motion-safe:transition-colors ${
                highlightId === decision.id ? "-mx-2 bg-zk-tint px-2 pt-2" : ""
              }`}
            >
              <div className="flex flex-col items-center">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${visual.iconWrap}`}
                >
                  <VerdictGlyph
                    kind={decision.kind}
                    goodToMerge={decision.kind === "verdict" ? decision.goodToMerge : undefined}
                  />
                </span>
                <span
                  aria-hidden
                  className={isLast ? "hidden" : "my-1 min-h-4 w-0.5 flex-1 bg-zk-divider"}
                />
              </div>
              <div className={`min-w-0 flex-1 ${isLast ? "pb-0" : "pb-4"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${visual.chip}`}>
                    {visual.label}
                  </span>
                  <LocalTime className="text-xs text-zk-muted" date={decision.at} />
                </div>
                <p className="mt-1.5 text-sm leading-snug text-zk-text2">{decisionSentence(decision)}</p>
                {(decision.kind === "rejected" || decision.kind === "merge_rejected") && decision.notes ? (
                  <ExpandableText maxLines={3} expandText="View more" collapseText="View less">
                    <blockquote className="mt-1.5 whitespace-pre-wrap break-words rounded-r-control border-l-[3px] border-zk-border bg-zk-chip px-3.5 py-2.5 text-[13px] leading-relaxed text-zk-text2">
                      {decision.notes}
                    </blockquote>
                  </ExpandableText>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
  );

  if (bare) return timeline;
  return (
    <section
      aria-label="Agent decisions"
      className="rounded-panel border border-zk-border bg-zk-surface p-5 sm:p-[22px]"
    >
      <h2 className="sr-only">Agent decisions</h2>
      {timeline}
    </section>
  );
}
