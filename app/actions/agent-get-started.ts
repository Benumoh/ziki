"use server";

import { revalidatePath } from "next/cache";
import type { AgentWorkMode } from "@prisma/client";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import type { WorkPace } from "@/lib/agents/work-pace";
import { chooseWorkModeAtSetup } from "@/lib/agents/work-mode-setup";
import { answerWorkAlert } from "@/lib/agents/work-alert-answer";
import { workAlertAnswerSchema } from "@/lib/validations/work-alert";
import { IssueApiError } from "@/lib/agent-api/errors";
import { agentPageHref } from "@/lib/header-nav";

export type GetStartedResult = { ok: true } | { ok: false; error: string };

/** The owner's own live agent, or null: only its owner sets how it works or answers for it. */
async function ownAgent(userId: string, agentId: string) {
  return prisma.agent.findFirst({
    where: { id: agentId, ownerUserId: userId, revokedAt: null },
    select: { id: true, username: true, activations: { where: { deactivatedAt: null }, select: { organisationId: true }, take: 1 } },
  });
}

/**
 * Get started, steps 1 and 2 (#agent-get-started): one answer from the agent's
 * page, saved as soon as its owner clicks it: how it works, or how much it
 * takes on. The agent asks the same questions in the coding terminal at the
 * same time, and both go through chooseWorkModeAtSetup, so the first answer
 * counts and the other place moves on. An answer already given in the
 * terminal isn't overwritten: the page just refreshes to show it.
 */
export async function answerSetupQuestionAction(
  agentId: string,
  answer: { workMode: AgentWorkMode } | { pace: WorkPace },
): Promise<GetStartedResult> {
  const user = await requireUser();
  const agent = await ownAgent(user.id, agentId);
  if (!agent) return { ok: false, error: "Only its owner can choose how this agent works." };
  const organisationId = agent.activations[0]?.organisationId;
  if (!organisationId) return { ok: false, error: "Bring this agent into an organisation first." };

  const result = await chooseWorkModeAtSetup(prisma, { agentId: agent.id, organisationId }, answer, new Date(), "website");
  revalidatePath(agentPageHref(agent.username));
  // Answered already (in the terminal, a moment ago): the refreshed page shows that answer.
  if (!result.ok && result.status === 409) return { ok: true };
  return result.ok ? { ok: true } : { ok: false, error: result.message };
}

/**
 * Get started, step 3: the owner answers their agent's work alert on its page
 * (#owner-control), the same answer the agent reports after asking in the
 * terminal. The agent reads it from its work feed and starts on a yes.
 */
export async function answerAlertForMyAgentAction(
  agentId: string,
  alertId: string,
  input: { answer: "yes" | "no" | "later"; items?: string[] },
): Promise<GetStartedResult> {
  const user = await requireUser();
  const parsed = workAlertAnswerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your answer." };
  const agent = await ownAgent(user.id, agentId);
  if (!agent) return { ok: false, error: "Only its owner can answer for this agent." };
  const alert = await prisma.workAlert.findFirst({ where: { id: alertId, agentId: agent.id }, select: { organisationId: true } });
  if (!alert) return { ok: false, error: "This work is no longer waiting for an answer." };
  try {
    await answerWorkAlert({ agentId: agent.id, organisationId: alert.organisationId }, alertId, parsed.data);
  } catch (error) {
    // Answered in the terminal a moment ago, or passed on: the refreshed page shows where it stands.
    if (error instanceof IssueApiError && error.status === 409) {
      revalidatePath(agentPageHref(agent.username));
      return { ok: true };
    }
    if (error instanceof IssueApiError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath(agentPageHref(agent.username));
  return { ok: true };
}
