/**
 * Join questions (#join-questions): what a member is asked once per
 * organisation, agent first, since agents do the work on Ziki. They bring an
 * agent they already have, connect a new one, or start without one. With an
 * agent, the card sets it up (work mode, pace) and shows the work Ziki picked
 * for it. Without one, they say what they're good at (`strengths`, kept on
 * their `Membership` for owners and admins to see on the Members page) and get
 * one real thing to do themselves. Client-safe: the card, the action and the
 * Members page share it.
 */

export const STRENGTHS = ["testing", "code", "design", "ideas", "review"] as const;
export type Strength = (typeof STRENGTHS)[number];

export const STRENGTH_OPTIONS: { id: Strength; icon: string; label: string }[] = [
  { id: "testing", icon: "🔍", label: "Finding bugs and testing" },
  { id: "code", icon: "⌨️", label: "Writing code" },
  { id: "design", icon: "🎨", label: "Design" },
  { id: "ideas", icon: "💡", label: "Ideas and feedback" },
  { id: "review", icon: "✅", label: "Reviewing work" },
];

const STRENGTH_SUMMARY: Record<Strength, string> = {
  testing: "testing",
  code: "code",
  design: "design",
  ideas: "ideas",
  review: "reviewing",
};

function isStrength(value: unknown): value is Strength {
  return typeof value === "string" && (STRENGTHS as readonly string[]).includes(value);
}

/** One line for the Members page, "Good at testing, reviewing", or null when they named nothing. */
export function joinAnswersSummary(saved: { strengths: readonly string[] }): string | null {
  const strengths = saved.strengths.filter(isStrength);
  return strengths.length > 0 ? `Good at ${strengths.map((value) => STRENGTH_SUMMARY[value]).join(", ")}` : null;
}

/** One of the member's own agents, as the card's first question lists it. */
export type JoinAgent = {
  id: string;
  name: string;
  /** Already active in this organisation. */
  activeHere: boolean;
  /** Its key for this organisation has called in: nothing to paste, it can be set up straight away. */
  connectedHere: boolean;
};

/**
 * The first real thing a member without an agent is shown, picked from what
 * they're good at (`lib/join-first-thing.ts`): an idea to vote on there and
 * then, an issue to confirm or delivered work to judge on its own page, or the
 * request box.
 */
export type FirstThing =
  | { kind: "idea"; ideaId: string; number: number; title: string; summary: string | null; href: string }
  | { kind: "confirm" | "judge"; number: number; title: string; href: string }
  | { kind: "request"; projectId: string };
