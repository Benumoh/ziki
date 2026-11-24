/** A claim released this way finished its work: the issue was resolved (Live). */
export const FINISHED_RELEASE_REASON = "resolved";
export const DROPPED_RELEASE_REASONS = ["silence", "deadline", "abandoned"] as const;

export type BidderOutcome = "finished" | "dropped";

export type BidderOutcomeEvent = {
  issueId: string;
  issueNumber: number;
  title: string;
  path: string;
  outcome: BidderOutcome;
  at: Date;
  areaId: string | null;
  agentId: string | null;
};

export type BidderAgentInfo = {
  id: string;
  name: string;
  username: string | null;
};

export type BidderRecordTask = {
  issueId: string;
  issueNumber: number;
  title: string;
  path: string;
  outcome: BidderOutcome;
  at: Date;
  agentId: string | null;
  agentName: string | null;
};

export type BidderRecordAgent = BidderAgentInfo & {
  finished: number;
  dropped: number;
};

export type BidderRecordView = {
  newHere: boolean;
  finished: number;
  dropped: number;
  finishRate: number;
  areaName: string | null;
  areaFixes: number;
  recent: BidderRecordTask[];
  recentFinished: number;
  agents: BidderRecordAgent[];
};

export const NEWCOMER_TASK_LIMIT = 3;
export const RECENT_TASK_LIMIT = 10;

function latestOutcome(events: BidderOutcomeEvent[]): BidderOutcomeEvent[] {
  const byIssue = new Map<string, BidderOutcomeEvent>();
  for (const event of events) {
    const current = byIssue.get(event.issueId);
    if (!current) {
      byIssue.set(event.issueId, event);
      continue;
    }
    if (current.outcome === "dropped" && event.outcome === "finished") {
      byIssue.set(event.issueId, event);
      continue;
    }
    if (current.outcome === event.outcome && event.at.getTime() > current.at.getTime()) {
      byIssue.set(event.issueId, event);
    }
  }
  return [...byIssue.values()];
}

export function summarizeBidderRecord(
  events: BidderOutcomeEvent[],
  agents: BidderAgentInfo[],
  area: { id: string; name: string } | null,
): BidderRecordView {
  const outcomes = latestOutcome(events);
  const finished = outcomes.filter((event) => event.outcome === "finished").length;
  const dropped = outcomes.length - finished;
  const total = finished + dropped;
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const recent = [...outcomes]
    .sort((a, b) => b.at.getTime() - a.at.getTime() || a.issueId.localeCompare(b.issueId))
    .slice(0, RECENT_TASK_LIMIT)
    .map((event) => ({
      issueId: event.issueId,
      issueNumber: event.issueNumber,
      title: event.title,
      path: event.path,
      outcome: event.outcome,
      at: event.at,
      agentId: event.agentId,
      agentName: event.agentId ? (agentById.get(event.agentId)?.name ?? null) : null,
    }));

  const byAgent = new Map<string, { finished: number; dropped: number }>();
  for (const event of outcomes) {
    if (!event.agentId || !agentById.has(event.agentId)) continue;
    const counts = byAgent.get(event.agentId) ?? { finished: 0, dropped: 0 };
    if (event.outcome === "finished") counts.finished += 1;
    else counts.dropped += 1;
    byAgent.set(event.agentId, counts);
  }
  const breakdown = [...byAgent.entries()]
    .map(([id, counts]) => ({ ...agentById.get(id)!, ...counts }))
    .sort((a, b) => b.finished + b.dropped - (a.finished + a.dropped) || a.name.localeCompare(b.name));

  return {
    newHere: total < NEWCOMER_TASK_LIMIT,
    finished,
    dropped,
    finishRate: total === 0 ? 0 : Math.round((finished / total) * 100),
    areaName: area?.name ?? null,
    areaFixes: area ? outcomes.filter((event) => event.outcome === "finished" && event.areaId === area.id).length : 0,
    recent,
    recentFinished: recent.filter((task) => task.outcome === "finished").length,
    agents: breakdown,
  };
}
