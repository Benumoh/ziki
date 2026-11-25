import "server-only";
import type { AgentWorkMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { workAlertView } from "@/lib/agents/work-alerts";
import { paceOf, type WorkPace } from "@/lib/agents/work-pace";
import { formatZik } from "@/lib/coins/math";

/**
 * A question is open in both places (the card and the agent's terminal), or
 * its first work is on the way: the page refreshes every few seconds then, so
 * an answer given in the terminal shows here and the card moves on.
 */
export function setupWaiting(state: GetStartedState): boolean {
  if (!state.connected) return false;
  return !state.workMode || !state.paceChosen || state.welcomeDue || (state.alert !== null && state.alert.answer === null);
}

/** How long after an agent is added the card keeps saying Ziki is finding work for it. */
const WELCOME_WAIT_MS = 30 * 60_000;

export type GetStartedItem = { key: string; action: string; number: number; title: string; url: string; pays?: string | null };

export type GetStartedAlert = {
  id: string;
  projectName: string;
  headline: string;
  question: string;
  items: GetStartedItem[];
  /** At least what an offer in it pays once the issue is live, e.g. "6,300 Ziks"; null without one. */
  pays: string | null;
  answer: "yes" | "no" | "later" | null;
};

export type GetStartedState = {
  agentId: string;
  agentName: string;
  workMode: AgentWorkMode | null;
  pace: WorkPace | "custom" | null;
  /** Its owner has answered how much it takes on (here, in the terminal, or with limits on the Work mode page). */
  paceChosen: boolean;
  /** Its key has been used: the agent has called in at least once. */
  connected: boolean;
  /** Newly connected and never alerted here: its welcome (the work it can do now) is on the way. */
  welcomeDue: boolean;
  alert: GetStartedAlert | null;
};

/**
 * What the agent's Get started card shows its owner (#agent-get-started): how
 * it works, how much it takes on, and the work Ziki has picked out for it
 * (its open work alert in the organisation the owner is in), and what an offer
 * in it pays. Null while the agent is paused.
 */
export async function loadGetStarted(
  agent: { id: string; name: string },
  organisationId: string,
  now: Date = new Date(),
): Promise<GetStartedState | null> {
  const [row, used, alertRow, anyAlert] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: agent.id },
      select: { workMode: true, maxActiveTasks: true, dailyTaskLimit: true, paceSetAt: true, pausedAt: true, createdAt: true },
    }),
    prisma.agentApiKey.findFirst({ where: { agentId: agent.id, lastUsedAt: { not: null } }, select: { id: true } }),
    prisma.workAlert.findFirst({
      where: { agentId: agent.id, organisationId, status: "sent", endedAt: null },
      orderBy: { createdAt: "desc" },
      include: { project: { select: { id: true, name: true } } },
    }),
    prisma.workAlert.findFirst({ where: { agentId: agent.id, organisationId }, select: { id: true } }),
  ]);
  if (!row || row.pausedAt) return null;

  let alert: GetStartedAlert | null = null;
  if (alertRow) {
    const view = workAlertView(alertRow, alertRow.project);
    alert = {
      id: view.id,
      projectName: view.project.name,
      headline: view.headline,
      question: view.question,
      items: view.share.map((item) => ({ key: item.key, action: item.action, number: item.number, title: item.title, url: item.url })),
      pays: view.pays > 0 ? formatZik(view.pays) : null,
      answer: view.answer,
    };
  }

  const connected = Boolean(used);
  // The welcome comes within a minute of first connecting, when there is work it can do; after
  // WELCOME_WAIT_MS with none, there was nothing waiting, so the card stops saying it is looking.
  const welcomeDue = connected && !anyAlert && now.getTime() - row.createdAt.getTime() < WELCOME_WAIT_MS;
  // Once chosen, steps 1 and 2 shrink to one line and step 3 says where its work stands, so the card stays small.
  return {
    agentId: agent.id,
    agentName: agent.name,
    workMode: row.workMode,
    pace: paceOf(row),
    paceChosen: Boolean(row.paceSetAt),
    connected,
    welcomeDue,
    alert,
  };
}
