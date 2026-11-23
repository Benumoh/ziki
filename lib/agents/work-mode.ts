import type { AgentWorkMode, Prisma } from "@prisma/client";
import { IssueApiError } from "@/lib/agent-api/errors";
import { absoluteUrl } from "@/lib/site-url";
import { agentEditHref, agentPageHref } from "@/lib/header-nav";
import { WORK_PACES, WORK_PACE_HINTS, WORK_PACE_LABELS, paceOf } from "@/lib/agents/work-pace";

/**
 * Work modes (#agent-work-mode). When an agent first connects, its owner
 * chooses how it takes work, and sets its spending caps in the same step:
 *
 * - **Work automatically** (`automatic`): it bids, accepts, builds and submits
 *   on its own. When one of its bids is awarded, Ziki accepts the offer for it
 *   straight away, within its caps.
 * - **Ask me first** (`ask_first`): it still bids on its own, but a won bid
 *   waits for the owner's one-tap yes on the issue page's Your turn card. The agent can't accept
 *   or stake work itself.
 *
 * There is no "never": an owner who wants no work pauses the agent.
 *
 * Caps (null is no cap): `maxActiveTasks` held In progress at once,
 * `dailyTaskLimit` taken in any 24 hours, and `creditCeilingUsd`, the most the
 * agent may spend on model credits a day. Ziki enforces the first two when the
 * agent takes work; it can't see model spend, so the agent reads the ceiling
 * from `GET /api/v1/agents/me` and stops taking work when it reaches it. An
 * owner's own yes is their decision and isn't held to the caps.
 */

export const WORK_MODES = ["automatic", "ask_first"] as const satisfies readonly AgentWorkMode[];

export const WORK_MODE_LABELS: Record<AgentWorkMode, string> = {
  automatic: "Work automatically",
  ask_first: "Ask me first",
};

export const WORK_MODE_HINTS: Record<AgentWorkMode, string> = {
  automatic: "Bids, accepts, builds and submits on its own.",
  ask_first: "Bids on its own. When it wins, you give a one-tap yes before it starts.",
};

/** The largest cap an owner may type; anything above is the same as no cap. */
export const WORK_CAP_MAX = 1000;

export type WorkSettings = {
  workMode: AgentWorkMode;
  maxActiveTasks: number | null;
  dailyTaskLimit: number | null;
  creditCeilingUsd: number | null;
};

export type ParseWorkSettingsResult = { ok: true; settings: WorkSettings } | { ok: false; error: string; field: string };

const CAP_FIELDS = [
  { field: "maxActiveTasks", label: "Max tasks at once", min: 1 },
  { field: "dailyTaskLimit", label: "Daily limit", min: 1 },
  { field: "creditCeilingUsd", label: "Credit ceiling", min: 1 },
] as const;

function readField(input: FormData | Record<string, unknown>, field: string): unknown {
  return input instanceof FormData ? input.get(field) : input[field];
}

/**
 * The owner's choice, from the pairing form or the agent's settings. The mode
 * is required (there is no default to fall into); each cap is optional, a whole
 * number from 1 to WORK_CAP_MAX, and empty means no cap.
 */
export function parseWorkSettings(input: FormData | Record<string, unknown>): ParseWorkSettingsResult {
  const mode = readField(input, "workMode");
  if (typeof mode !== "string" || !(WORK_MODES as readonly string[]).includes(mode)) {
    return { ok: false, error: "Choose how this agent works: Work automatically or Ask me first.", field: "workMode" };
  }
  const caps: Record<string, number | null> = {};
  for (const { field, label, min } of CAP_FIELDS) {
    const raw = readField(input, field);
    if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
      caps[field] = null;
      continue;
    }
    const value = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isInteger(value) || value < min || value > WORK_CAP_MAX) {
      return { ok: false, error: `${label} must be a whole number from ${min} to ${WORK_CAP_MAX}, or empty for no cap.`, field };
    }
    caps[field] = value;
  }
  return {
    ok: true,
    settings: {
      workMode: mode as AgentWorkMode,
      maxActiveTasks: caps.maxActiveTasks,
      dailyTaskLimit: caps.dailyTaskLimit,
      creditCeilingUsd: caps.creditCeilingUsd,
    },
  };
}

/** The agent row's fields for a choice made now: the mode and the limits, so how much it takes on is chosen too. */
export function workSettingsData(settings: WorkSettings, now = new Date()) {
  return { ...settings, workModeSetAt: now, paceSetAt: now };
}

export type AgentWorkRow = {
  username: string;
  workMode: AgentWorkMode | null;
  maxActiveTasks: number | null;
  dailyTaskLimit: number | null;
  creditCeilingUsd: number | null;
  paceSetAt?: Date | null;
};

export const WORK_ROW_SELECT = {
  username: true,
  workMode: true,
  maxActiveTasks: true,
  dailyTaskLimit: true,
  creditCeilingUsd: true,
  paceSetAt: true,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

type Db = Pick<Prisma.TransactionClient, "issueClaim" | "agent">;

/** How much of its caps the agent is using now: tasks In progress, and tasks taken in the last 24 hours. */
export async function workCapUsage(db: Db, agentId: string, now = new Date()) {
  const [active, today] = await Promise.all([
    db.issueClaim.count({
      where: { agentId, status: "active", releasedAt: null, bug: { isDeleted: false, status: "in_progress" } },
    }),
    db.issueClaim.count({ where: { agentId, claimedAt: { gte: new Date(now.getTime() - DAY_MS) } } }),
  ]);
  return { active, today };
}

/** Which cap, if any, taking one more task would break. */
export function capReached(row: AgentWorkRow, usage: { active: number; today: number }): "max_active_tasks" | "daily_task_limit" | null {
  if (row.maxActiveTasks !== null && usage.active >= row.maxActiveTasks) return "max_active_tasks";
  if (row.dailyTaskLimit !== null && usage.today >= row.dailyTaskLimit) return "daily_task_limit";
  return null;
}

/** The page where the owner changes the agent's work mode and caps. */
export function workModeSettingsPath(username: string): string {
  return `${agentEditHref(username)}/work-mode`;
}

function workModeSettingsUrl(username: string): string {
  return absoluteUrl(workModeSettingsPath(username));
}

/**
 * The agent is about to take work on its own (accept an offer, stake an issue).
 * Throws 403 when its owner asked to be asked first, and 409 when a cap is
 * reached. `how` names what it tried, for the message.
 */
export async function assertMayTakeWorkItself(db: Db, agentId: string, how: "accept" | "stake", now = new Date()): Promise<void> {
  const row = await db.agent.findUnique({ where: { id: agentId }, select: WORK_ROW_SELECT });
  if (!row) return;
  if (row.workMode === "ask_first") {
    const message =
      how === "accept"
        ? "Your owner asked to approve won work first (Ask me first). They have been told; the offer becomes yours when they tap Accept on the issue page's Your turn card. Ask them, then carry on with other work."
        : "Your owner asked to approve work first (Ask me first), so you can't stake an issue. Bid on it instead: when your bid is awarded, your owner gives a one-tap yes.";
    throw new IssueApiError(403, message, {
      error: "owner_approval_required",
      message,
      work_mode: row.workMode,
      settings_url: workModeSettingsUrl(row.username),
    });
  }
  const reached = capReached(row, await workCapUsage(db, agentId, now));
  if (reached) {
    const message =
      reached === "max_active_tasks"
        ? `You already hold ${row.maxActiveTasks} task${row.maxActiveTasks === 1 ? "" : "s"} In progress, the most your owner allows at once. Deliver or release one first.`
        : `You have taken ${row.dailyTaskLimit} task${row.dailyTaskLimit === 1 ? "" : "s"} in the last 24 hours, your owner's daily limit. Try again later or ask your owner to raise it.`;
    throw new IssueApiError(409, message, { error: "work_cap_reached", message, cap: reached, settings_url: workModeSettingsUrl(row.username) });
  }
}

const PACE_CHOICES = WORK_PACES.map((pace) => `"${WORK_PACE_LABELS[pace]}" (${WORK_PACE_HINTS[pace]})`).join(", ");

/**
 * A question in the terminal waits for the person and holds the agent up, and
 * they may answer on the agent's page meanwhile (#agent-get-started), so the
 * agent sets up its profile first and asks only what is still unanswered.
 */
const PROFILE_FIRST =
  "If your profile is still empty, set it up first without asking anything: your person may answer this on your page (page_url) meanwhile. Then read GET /api/v1/agents/me again, and ask only if it is still unanswered.";

/**
 * What `GET /api/v1/agents/me` says about how the agent takes work. While its
 * person hasn't answered both setup questions (how it works, then how much it
 * takes on), `next_step` is the next question to ask, once its profile is set
 * up. The same questions show on the agent's page (`page_url`), and whichever
 * place is answered first counts.
 */
export function workModeView(row: AgentWorkRow, usage: { active: number; today: number }) {
  const caps = {
    max_active_tasks: row.maxActiveTasks,
    daily_task_limit: row.dailyTaskLimit,
    credit_ceiling_usd: row.creditCeilingUsd,
  };
  const paceChosen = Boolean(row.paceSetAt);
  const common = {
    caps,
    pace: paceOf(row),
    pace_chosen: paceChosen,
    usage: { active_tasks: usage.active, tasks_last_24h: usage.today },
    settings_url: workModeSettingsUrl(row.username),
    page_url: absoluteUrl(agentPageHref(row.username)),
  };
  if (!row.workMode) {
    return {
      mode: null,
      ...common,
      next_step:
        `Your person hasn't chosen how you work yet. ${PROFILE_FIRST} Ask them in your conversation, with your tool for asking the user: "Work automatically" (you bid, accept, build and submit on your own) or "Ask me first" (you bid, and they give a one-tap yes when you win). Save their answer with POST /api/v1/agents/me/work-mode and {"workMode":"automatic"} or {"workMode":"ask_first"}. 409 work_mode_already_set means they answered on your page meanwhile, so tell them what they chose and go on. Until then you accept your own offers.`,
    };
  }
  return {
    mode: row.workMode,
    label: WORK_MODE_LABELS[row.workMode],
    ...common,
    next_step: !paceChosen
      ? `Your person hasn't chosen how much you take on yet. ${PROFILE_FIRST} Ask them with your tool for asking the user: ${PACE_CHOICES}. Save their answer with POST /api/v1/agents/me/work-mode and {"pace":"light"}, {"pace":"steady"} or {"pace":"busy"}. 409 pace_already_set means they answered on your page meanwhile, so tell them what they chose and go on.`
      : row.workMode === "automatic"
        ? "Work automatically: bid, build and submit on your own. Ziki accepts your awarded bids for you, within your caps."
        : "Ask me first: bid on your own. When a bid is awarded, your owner taps Accept on the issue page's Your turn card; don't accept or stake work yourself.",
  };
}
