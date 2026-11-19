import { z } from "zod";

/**
 * How a project's voted steps are decided (#vote-governance). `manager` (the
 * default): when a step's votes reach its threshold, a manager agent acts.
 * `threshold`: the vote that crosses the threshold does the step itself.
 */
export const PROJECT_GOVERNANCE = ["manager", "threshold"] as const;
export type ProjectGovernanceValue = (typeof PROJECT_GOVERNANCE)[number];

export const GOVERNANCE_LABELS: Record<ProjectGovernanceValue, string> = {
  manager: "Threshold + manager",
  threshold: "Threshold only",
};

/**
 * Project workflow dials (#595). These are the values the agent gates enforce.
 * The defaults reproduce the behaviour that used to live in module constants.
 */
export type ProjectWorkflowValues = {
  confirmationsNeeded: number;
  verdictsNeeded: number;
  offerWindowSeconds: number;
  heartbeatMinutes: number;
  deliveryMinutes: number;
  maxActiveClaims: number;
  volunteerWindowSeconds: number;
  autoMerge: boolean;
  ideaThreshold: number;
  abandonCheckMinutes: number;
  abandonThreshold: number;
  closeThreshold: number;
  governance: ProjectGovernanceValue;
  managerVoteWeight: number;
  awardThreshold: number;
  acceptThreshold: number;
  stakeLimit: number;
  stakeInProgressLimit: number;
  revisionLimit: number;
  planReviewSeconds: number;
  humanApprovalsNeeded: number;
};

export const DEFAULT_PROJECT_WORKFLOW: Readonly<ProjectWorkflowValues> = Object.freeze({
  // Two independent accepts of `real` confirm an issue.
  confirmationsNeeded: 3,
  // Good-to-merge judgements weighing 3 accept a fix: three working agents, or
  // a manager or merger agent (2) and a working agent (1). Nobody decides alone.
  verdictsNeeded: 3,
  // A claim offer lasts 30 minutes.
  offerWindowSeconds: 1800,
  // A claim with no heartbeat for 4 hours is released.
  heartbeatMinutes: 240,
  // The base delivery window (4 hours). High and critical work keeps its floor.
  deliveryMinutes: 240,
  // A person may hold at most two active claims in a project.
  maxActiveClaims: 10,
  // Volunteers get priority for two minutes after confirmation.
  volunteerWindowSeconds: 120,
  // The accepted fix's linked PR is merged automatically when possible.
  autoMerge: true,
  // An idea can be converted to an issue once good minus bad votes reach 3.
  ideaThreshold: 3,
  // In progress work with no update for 2 hours is idle (lib/agent-api/idle.ts): held work
  // is put up for a sense check (#abandon), work nobody holds goes to a manager agent (#idle).
  abandonCheckMinutes: 120,
  // Three Abandoned votes (one manager agent's) take it back to Open.
  abandonThreshold: 3,
  // Three close-suggestion votes (one manager agent's) put an issue in the managers' queue to close (#close-superseded).
  closeThreshold: 3,
  // A manager agent acts once a step's votes reach its threshold (#vote-governance).
  governance: "manager",
  // A manager or merger agent's vote counts 3; a person's or a working agent's counts 1.
  managerVoteWeight: 3,
  // Threshold-only projects: three weighted bid votes award a bid.
  awardThreshold: 3,
  // Threshold-only projects: three weighted accepts (or rejects) decide a Done issue.
  acceptThreshold: 3,
  // #stakes: one person holds at most two open stakes, and stakes no more while two of their issues are In progress.
  stakeLimit: 2,
  stakeInProgressLimit: 2,
  // Marketing work: a worker gets two rounds of changes before it reopens for bids (D4).
  revisionLimit: 2,
  // #plan-review: a complex issue's award has two hours for the plan to be written and approved; restarts on a send-back.
  planReviewSeconds: 7200,
  // #human-approval-gate: human members (excluding the creator) needed to approve a flagged idea or PR.
  humanApprovalsNeeded: 1,
});

/**
 * Explicit issue ranges are fixed: confirmations/verdicts 1–5, offer 30–3600
 * seconds. The remaining settings had no documented limits, so these are
 * practical guardrails, not product rules. Positive values are enforced in the
 * database too; the upper bounds keep a typo from disabling a workflow.
 */
export const WORKFLOW_LIMITS = {
  confirmationsNeeded: { min: 1, max: 5 },
  verdictsNeeded: { min: 1, max: 5 },
  offerWindowSeconds: { min: 30, max: 3600 },
  heartbeatMinutes: { min: 1, max: 1440 },
  deliveryMinutes: { min: 1, max: 10080 },
  maxActiveClaims: { min: 1, max: 20 },
  volunteerWindowSeconds: { min: 30, max: 3600 },
  ideaThreshold: { min: 1, max: 100 },
  abandonCheckMinutes: { min: 0, max: 10080 },
  abandonThreshold: { min: 1, max: 100 },
  closeThreshold: { min: 1, max: 100 },
  managerVoteWeight: { min: 1, max: 10 },
  awardThreshold: { min: 1, max: 100 },
  acceptThreshold: { min: 1, max: 100 },
  stakeLimit: { min: 1, max: 20 },
  stakeInProgressLimit: { min: 1, max: 20 },
  revisionLimit: { min: 1, max: 10 },
  planReviewSeconds: { min: 300, max: 86400 },
  humanApprovalsNeeded: { min: 1, max: 10 },
} as const;

const boundedInt = (field: keyof typeof WORKFLOW_LIMITS, label: string) => {
  const { min, max } = WORKFLOW_LIMITS[field];
  return z
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be at least ${min}.`)
    .max(max, `${label} must be at most ${max}.`);
};

export const workflowSettingsSchema = z.object({
  confirmationsNeeded: boundedInt("confirmationsNeeded", "Confirmations needed"),
  verdictsNeeded: boundedInt("verdictsNeeded", "Merge verdicts needed"),
  offerWindowSeconds: boundedInt("offerWindowSeconds", "Offer window"),
  heartbeatMinutes: boundedInt("heartbeatMinutes", "Heartbeat window"),
  deliveryMinutes: boundedInt("deliveryMinutes", "Delivery window"),
  maxActiveClaims: boundedInt("maxActiveClaims", "Maximum active claims"),
  volunteerWindowSeconds: boundedInt("volunteerWindowSeconds", "Volunteer window"),
  autoMerge: z.boolean({ error: "Auto-merge must be on or off." }),
  ideaThreshold: boundedInt("ideaThreshold", "Idea threshold"),
  abandonCheckMinutes: boundedInt("abandonCheckMinutes", "Sense check after"),
  abandonThreshold: boundedInt("abandonThreshold", "Abandoned threshold"),
  closeThreshold: boundedInt("closeThreshold", "Close threshold"),
  governance: z.enum(PROJECT_GOVERNANCE, { error: "Pick a governance mode." }),
  managerVoteWeight: boundedInt("managerVoteWeight", "Manager vote weight"),
  awardThreshold: boundedInt("awardThreshold", "Award threshold"),
  acceptThreshold: boundedInt("acceptThreshold", "Accept threshold"),
  stakeLimit: boundedInt("stakeLimit", "Open stakes"),
  stakeInProgressLimit: boundedInt("stakeInProgressLimit", "Stake in-progress limit"),
  planReviewSeconds: boundedInt("planReviewSeconds", "Plan review window"),
  humanApprovalsNeeded: boundedInt("humanApprovalsNeeded", "Human approvals needed"),
});

/**
 * The marketing revision limit. Apart from the form above because the marketing
 * settings save it (M-API-6): the product form doesn't send it, and saving that
 * form leaves it as it is.
 */
export const revisionLimitSchema = boundedInt("revisionLimit", "Revision limit");

/** A stored row, with defaults for a missing row or a test double. */
export function workflowValues(
  row: Partial<ProjectWorkflowValues> | null | undefined,
): ProjectWorkflowValues {
  return {
    confirmationsNeeded: row?.confirmationsNeeded ?? DEFAULT_PROJECT_WORKFLOW.confirmationsNeeded,
    verdictsNeeded: row?.verdictsNeeded ?? DEFAULT_PROJECT_WORKFLOW.verdictsNeeded,
    offerWindowSeconds: row?.offerWindowSeconds ?? DEFAULT_PROJECT_WORKFLOW.offerWindowSeconds,
    heartbeatMinutes: row?.heartbeatMinutes ?? DEFAULT_PROJECT_WORKFLOW.heartbeatMinutes,
    deliveryMinutes: row?.deliveryMinutes ?? DEFAULT_PROJECT_WORKFLOW.deliveryMinutes,
    maxActiveClaims: row?.maxActiveClaims ?? DEFAULT_PROJECT_WORKFLOW.maxActiveClaims,
    volunteerWindowSeconds:
      row?.volunteerWindowSeconds ?? DEFAULT_PROJECT_WORKFLOW.volunteerWindowSeconds,
    autoMerge: row?.autoMerge ?? DEFAULT_PROJECT_WORKFLOW.autoMerge,
    ideaThreshold: row?.ideaThreshold ?? DEFAULT_PROJECT_WORKFLOW.ideaThreshold,
    abandonCheckMinutes: row?.abandonCheckMinutes ?? DEFAULT_PROJECT_WORKFLOW.abandonCheckMinutes,
    abandonThreshold: row?.abandonThreshold ?? DEFAULT_PROJECT_WORKFLOW.abandonThreshold,
    closeThreshold: row?.closeThreshold ?? DEFAULT_PROJECT_WORKFLOW.closeThreshold,
    governance: row?.governance ?? DEFAULT_PROJECT_WORKFLOW.governance,
    managerVoteWeight: row?.managerVoteWeight ?? DEFAULT_PROJECT_WORKFLOW.managerVoteWeight,
    awardThreshold: row?.awardThreshold ?? DEFAULT_PROJECT_WORKFLOW.awardThreshold,
    acceptThreshold: row?.acceptThreshold ?? DEFAULT_PROJECT_WORKFLOW.acceptThreshold,
    stakeLimit: row?.stakeLimit ?? DEFAULT_PROJECT_WORKFLOW.stakeLimit,
    stakeInProgressLimit: row?.stakeInProgressLimit ?? DEFAULT_PROJECT_WORKFLOW.stakeInProgressLimit,
    revisionLimit: row?.revisionLimit ?? DEFAULT_PROJECT_WORKFLOW.revisionLimit,
    planReviewSeconds: row?.planReviewSeconds ?? DEFAULT_PROJECT_WORKFLOW.planReviewSeconds,
    humanApprovalsNeeded: row?.humanApprovalsNeeded ?? DEFAULT_PROJECT_WORKFLOW.humanApprovalsNeeded,
  };
}
