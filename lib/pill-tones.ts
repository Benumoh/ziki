/**
 * The pills' colours, from the agents design: soft warm tints with a strong text of the same hue (green #2fb36b,
 * Ziki blue #0972d5, teal #2ec4b6, violet #8b5cf6, amber #f5b73b, orange #f26b3a, red #ef4766, slate #5b6478), each
 * text deepened to at least 4.5:1 on its tint, and on white when a pill is solid. One map, so the row statuses, the
 * feed's kinds and the priorities all read alike.
 */
export const PILL_TONES = {
  green: { backgroundColor: "#edf8f1", color: "#187a42" },
  blue: { backgroundColor: "#eef8ff", color: "#086ccc" },
  cyan: { backgroundColor: "#e8f7f5", color: "#0f766c" },
  teal: { backgroundColor: "#e8f7f5", color: "#0f766c" },
  purple: { backgroundColor: "#f3effe", color: "#6b46d9" },
  yellow: { backgroundColor: "#fff8db", color: "#7a5a00" },
  orange: { backgroundColor: "#fff1ea", color: "#b8441b" },
  red: { backgroundColor: "#fff1ee", color: "#c4381f" },
  grey: { backgroundColor: "#f3f3f5", color: "#555b6a" },
} as const;

export type PillTone = keyof typeof PILL_TONES;

/**
 * The design's icon tiles: each tone as a soft top-to-bottom gradient with white on it, for the avatars that name an
 * agent or an asset. The initials on them are large and bold, so the lower stop keeps them at 3:1 or more.
 */
export const TILE_TONES: Record<PillTone, { backgroundImage: string; color: string }> = {
  green: { backgroundImage: "linear-gradient(180deg, #45c47d 0%, #229a57 100%)", color: "#ffffff" },
  blue: { backgroundImage: "linear-gradient(180deg, #6f8cfa 0%, #4560ee 100%)", color: "#ffffff" },
  cyan: { backgroundImage: "linear-gradient(180deg, #44cfc2 0%, #179a8e 100%)", color: "#ffffff" },
  teal: { backgroundImage: "linear-gradient(180deg, #44cfc2 0%, #179a8e 100%)", color: "#ffffff" },
  purple: { backgroundImage: "linear-gradient(180deg, #a585fa 0%, #7a52ee 100%)", color: "#ffffff" },
  yellow: { backgroundImage: "linear-gradient(180deg, #f8c457 0%, #e79a12 100%)", color: "#ffffff" },
  orange: { backgroundImage: "linear-gradient(180deg, #f8875c 0%, #ea5a2a 100%)", color: "#ffffff" },
  red: { backgroundImage: "linear-gradient(180deg, #f6637f 0%, #e1344f 100%)", color: "#ffffff" },
  grey: { backgroundImage: "linear-gradient(180deg, #737c90 0%, #4b5366 100%)", color: "#ffffff" },
};

/** A steady tone for a name, so the same agent or asset always gets the same tile colour. */
export function toneForName(name: string): PillTone {
  const tones: PillTone[] = ["orange", "purple", "blue", "green", "red", "teal", "yellow", "grey"];
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return tones[hash % tones.length];
}
