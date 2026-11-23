/**
 * Join questions (#join-questions): what someone who joins an organisation set
 * up by someone else says about themselves, kept on their `Membership`. Why they
 * came (`joinReason`), what they're good at (`strengths`) and how much time they
 * have (`weeklyTime`) pick the first real thing they're shown, and tell the
 * organisation's owners and admins who to ask on the Members page.
 * Client-safe: the card, the action and the Members page share it.
 */

export const JOIN_REASONS = ["team", "user", "helper", "looking"] as const;
export type JoinReason = (typeof JOIN_REASONS)[number];

export const STRENGTHS = ["testing", "code", "design", "ideas", "review"] as const;
export type Strength = (typeof STRENGTHS)[number];

export const WEEKLY_TIMES = ["minutes", "hour", "daily"] as const;
export type WeeklyTime = (typeof WEEKLY_TIMES)[number];

export const JOIN_REASON_OPTIONS: { id: JoinReason; icon: string; label: string; hint: string }[] = [
  { id: "team", icon: "🧑‍💻", label: "I'm on the team", hint: "I build or run this" },
  { id: "user", icon: "🙋", label: "I use it", hint: "I want it to get better" },
  { id: "helper", icon: "🤝", label: "I want to help", hint: "And earn Ziks for it" },
  { id: "looking", icon: "👀", label: "Just looking", hint: "Seeing what's here" },
];

export const STRENGTH_OPTIONS: { id: Strength; icon: string; label: string }[] = [
  { id: "testing", icon: "🔍", label: "Finding bugs and testing" },
  { id: "code", icon: "⌨️", label: "Writing code" },
  { id: "design", icon: "🎨", label: "Design" },
  { id: "ideas", icon: "💡", label: "Ideas and feedback" },
  { id: "review", icon: "✅", label: "Reviewing work" },
];

export const WEEKLY_TIME_OPTIONS: { id: WeeklyTime; icon: string; label: string; hint: string }[] = [
  { id: "minutes", icon: "☕", label: "A few minutes a week", hint: "Now and then" },
  { id: "hour", icon: "⏱️", label: "About an hour a week", hint: "A regular slot" },
  { id: "daily", icon: "🔥", label: "Most days", hint: "I'm in it" },
];

/** How the Members page says why someone joined. */
export const JOIN_REASON_SUMMARY: Record<JoinReason, string> = {
  team: "On the team",
  user: "Uses it",
  helper: "Here to help",
  looking: "Looking around",
};

export const WEEKLY_TIME_SUMMARY: Record<WeeklyTime, string> = {
  minutes: "a few minutes a week",
  hour: "about an hour a week",
  daily: "most days",
};

const STRENGTH_SUMMARY: Record<Strength, string> = {
  testing: "testing",
  code: "code",
  design: "design",
  ideas: "ideas",
  review: "reviewing",
};

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/**
 * One line for the Members page from what was saved, dropping anything no
 * longer an answer: "Here to help · good at testing, code · about an hour a week".
 * Null when they answered nothing.
 */
export function joinAnswersSummary(saved: { joinReason: string | null; strengths: readonly string[]; weeklyTime: string | null }): string | null {
  const parts: string[] = [];
  if (isOneOf(JOIN_REASONS, saved.joinReason)) parts.push(JOIN_REASON_SUMMARY[saved.joinReason]);
  const strengths = saved.strengths.filter((value): value is Strength => isOneOf(STRENGTHS, value));
  if (strengths.length > 0) parts.push(`good at ${strengths.map((value) => STRENGTH_SUMMARY[value]).join(", ")}`);
  if (isOneOf(WEEKLY_TIMES, saved.weeklyTime)) parts.push(WEEKLY_TIME_SUMMARY[saved.weeklyTime]);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The first real thing a joiner is shown, picked from their answers
 * (`lib/join-first-thing.ts`): an idea to vote on there and then, an issue to
 * confirm or delivered work to judge on its own page, or the request box.
 */
export type FirstThing =
  | { kind: "idea"; ideaId: string; number: number; title: string; summary: string | null; href: string }
  | { kind: "confirm" | "judge"; number: number; title: string; href: string }
  | { kind: "request"; projectId: string };
