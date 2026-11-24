import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { REWARD_ZIK_MAX, REWARD_ZIK_MIN, REWARD_ZIK_STEP } from "@/lib/coins/price-rules";
import { MIN_ESTIMATES_TO_AWARD } from "./budget";

/**
 * Ziki's own estimate (#ziki-estimate). An issue has no price, so can't be funded or worked on, until three agents
 * estimate it; when fewer than three have a day after it was filed, Ziki's AI estimates it from its title and
 * description so it doesn't wait forever. Ziki's estimate counts as one estimate and gives the issue a price even with
 * fewer than three (lib/coins/budget.ts issuePriceZik). Ziki neither pays for the issue nor is paid for it, so it is
 * neutral, unlike the owner, who doesn't estimate. Agents can still estimate afterwards, until the price is locked.
 *
 * Uses ZIKI_CLAUDE_API_KEY with Claude Sonnet 5.5 at low effort, like Ziki's other quick judgements. Without the key,
 * or when the call fails, nothing is written and the issue is tried again on a later sweep.
 */

/** How long an issue waits for agents' estimates before Ziki gives its own. */
export const ZIKI_ESTIMATE_AFTER_MS = 24 * 60 * 60 * 1000;
/** The most issues Ziki estimates in one sweep, so a backlog is worked through without a burst of AI calls. */
const PER_SWEEP = 10;
const MODEL = "claude-sonnet-5-5";
const DESCRIPTION_MAX = 6000;

const Estimate = z.object({
  value: z.number().describe(`What solving it is worth, in Ziks, from ${REWARD_ZIK_MIN} (easy) to ${REWARD_ZIK_MAX} (expensive), in steps of ${REWARD_ZIK_STEP}.`),
  reason: z.string().describe("Why that much, in one or two sentences a person can check against the issue."),
});

const SYSTEM = `You price software work for a marketplace where AI coding agents fix issues and are paid in Ziks (1,000 Ziks are $1).
Estimate what solving the issue is worth to the agent that fixes it: ${REWARD_ZIK_MIN} Ziks for a small, clear fix (a typo, one setting, one component), up to ${REWARD_ZIK_MAX} Ziks for an expensive one (several parts of the system, a migration, unclear behaviour to investigate). Judge only from what the issue says; when it is vague, price the likely work, not the worst case. Answer with a whole number in steps of ${REWARD_ZIK_STEP}.`;

/** A model's number as a valid estimate: snapped to the nearest step and kept in range. Pure. */
export function snapEstimate(value: number): number {
  if (!Number.isFinite(value)) return REWARD_ZIK_MIN;
  const stepped = Math.round(value / REWARD_ZIK_STEP) * REWARD_ZIK_STEP;
  return Math.min(REWARD_ZIK_MAX, Math.max(REWARD_ZIK_MIN, stepped));
}

/** Ziki's estimate of one issue, or null without the key or when the call fails or is declined. */
export async function estimateWithZiki(issue: { title: string; description: string | null }): Promise<{ value: number; reason: string } | null> {
  const apiKey = process.env.ZIKI_CLAUDE_API_KEY?.trim();
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 1000,
      output_config: { effort: "low", format: zodOutputFormat(Estimate) },
      system: SYSTEM,
      messages: [{ role: "user", content: `Price this issue.\n\nTitle: ${issue.title}\n\n${(issue.description ?? "(no description)").slice(0, DESCRIPTION_MAX)}` }],
    });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
    const parsed = response.parsed_output;
    if (!parsed) return null;
    return { value: snapEstimate(parsed.value), reason: parsed.reason.trim().slice(0, 500) || "Estimated from the issue's description." };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) logger.error("[ziki-estimate] ZIKI_CLAUDE_API_KEY was rejected.");
    else if (error instanceof Anthropic.RateLimitError) logger.warn("[ziki-estimate] Claude rate limit reached; trying again later.");
    else logger.error("[ziki-estimate] Estimating the issue failed; trying again later.", error);
    return null;
  }
}

/**
 * Gives Ziki's estimate to the issues that have waited a day with fewer than three estimates and none from Ziki,
 * oldest first, PER_SWEEP at a time. Each estimate restarts the minute the price needs to settle, so more agents can
 * still estimate before it is funded. Part of the cron sweep (lib/cron/runner.ts).
 */
export async function sweepZikiEstimates(now: Date = new Date()): Promise<{ checked: number; estimated: number }> {
  if (!process.env.ZIKI_CLAUDE_API_KEY?.trim()) return { checked: 0, estimated: 0 };
  const due = await prisma.bug.findMany({
    where: {
      isDeleted: false,
      status: { notIn: ["closed", "resolved"] },
      rewardFixedAt: null,
      rewardEstimateCount: { lt: MIN_ESTIMATES_TO_AWARD },
      zikiEstimatedAt: null,
      createdAt: { lte: new Date(now.getTime() - ZIKI_ESTIMATE_AFTER_MS) },
      // A Solo project (#solo) has no prices.
      project: { solo: false },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: PER_SWEEP,
    select: { id: true, title: true, description: true },
  });
  let estimated = 0;
  for (const issue of due) {
    const estimate = await estimateWithZiki(issue);
    if (!estimate) continue;
    // Only if nothing changed meanwhile: still unpriced, unlocked and not estimated by Ziki.
    const { count } = await prisma.bug.updateMany({
      where: { id: issue.id, rewardFixedAt: null, zikiEstimatedAt: null, rewardEstimateCount: { lt: MIN_ESTIMATES_TO_AWARD } },
      data: { zikiEstimateZik: estimate.value, zikiEstimateReason: estimate.reason, zikiEstimatedAt: now, rewardEstimatedAt: now },
    });
    estimated += count;
  }
  return { checked: due.length, estimated };
}
