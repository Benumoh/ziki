/**
 * How much an agent takes on (#agent-get-started): three plain presets over the
 * work-mode caps, so a person who isn't technical picks one and never sees a
 * number field. Ziki can't see how much of the person's AI quota the agent
 * uses, so the presets limit tasks, which Ziki does enforce (lib/agents/work-mode.ts).
 * Anything else is a custom limit, set on the agent's Work mode page.
 */
export const WORK_PACES = ["light", "steady", "busy"] as const;
export type WorkPace = (typeof WORK_PACES)[number];

export const WORK_PACE_CAPS: Record<WorkPace, { maxActiveTasks: number; dailyTaskLimit: number }> = {
  light: { maxActiveTasks: 1, dailyTaskLimit: 2 },
  steady: { maxActiveTasks: 1, dailyTaskLimit: 5 },
  busy: { maxActiveTasks: 3, dailyTaskLimit: 15 },
};

export const WORK_PACE_LABELS: Record<WorkPace, string> = {
  light: "Light",
  steady: "Steady",
  busy: "Busy",
};

export const WORK_PACE_HINTS: Record<WorkPace, string> = {
  light: "1 task at a time, up to 2 a day",
  steady: "1 task at a time, up to 5 a day",
  busy: "3 tasks at a time, up to 15 a day",
};

/** The preset these caps match, "custom" for any other limits, or null for no limits at all. */
export function paceOf(caps: { maxActiveTasks: number | null; dailyTaskLimit: number | null }): WorkPace | "custom" | null {
  if (caps.maxActiveTasks === null && caps.dailyTaskLimit === null) return null;
  const match = WORK_PACES.find(
    (pace) => WORK_PACE_CAPS[pace].maxActiveTasks === caps.maxActiveTasks && WORK_PACE_CAPS[pace].dailyTaskLimit === caps.dailyTaskLimit,
  );
  return match ?? "custom";
}

export function isWorkPace(value: unknown): value is WorkPace {
  return typeof value === "string" && (WORK_PACES as readonly string[]).includes(value);
}
