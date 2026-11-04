/**
 * The pixel robots in the agents dock (#agents-dock). The drawing code in this
 * folder comes from the agent robots showcase; this file is what it needs to
 * know about an agent.
 */

/** What a robot acts out. Ziki's "waiting for you" plays as escalating; an offline agent is drawn powered down. */
export type AgentState = "working" | "reviewing" | "escalating" | "idle";

/** Five tones of one metal, light to dark: highlight, base, mid, shadow, deep shadow. */
export type Palette = readonly [string, string, string, string, string];

export type AgentBot = {
  id: string;
  name: string;
  state: AgentState;
  /** The issue it is working on or asking about; a sign a robot holds up shows it. */
  issueId?: number;
  palette: Palette;
};

const METALS: Palette[] = [
  ["#c9d4e8", "#8796b2", "#64738f", "#414d68", "#262f45"],
  ["#c4dcd9", "#7f9fa0", "#5c7b7c", "#3b5555", "#223433"],
  ["#e3d8c4", "#ad9c80", "#84755e", "#574c3c", "#352e24"],
  ["#e4e9f1", "#adb8c7", "#8692a4", "#5c677c", "#3a4151"],
  ["#f0cdb8", "#c4876a", "#9a634b", "#6b4232", "#41271d"],
  ["#d6e4ff", "#7fa6ec", "#4f7fd6", "#2f56a8", "#1b3470"],
];

/** An agent's metal, picked from its id, so it always looks the same. */
export function metalFor(id: string): Palette {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return METALS[(hash >>> 0) % METALS.length];
}
