import type { Palette } from "@/components/agent-robots/types";

/**
 * The fourteen colours (with Automatic, fifteen picks: three rows of five, like
 * the Ziki avatars) an owner can give an agent's pixel robot in the agents dock
 * (#agents-dock), picked on the agent's page. Each is one metal; the robot's
 * five shaded tones come from it. None picked, the robot keeps the metal its
 * id gives it.
 */
export type RobotColor = { key: string; label: string; hex: string };

export const ROBOT_COLORS: RobotColor[] = [
  { key: "steel", label: "Steel", hex: "#8796B2" },
  { key: "chrome", label: "Chrome", hex: "#ADB8C7" },
  { key: "gunmetal", label: "Gunmetal", hex: "#5F6A7D" },
  { key: "cobalt", label: "Cobalt", hex: "#6F96E0" },
  { key: "navy", label: "Navy", hex: "#4D65A8" },
  { key: "patina", label: "Patina", hex: "#7F9FA0" },
  { key: "jade", label: "Jade", hex: "#6F9F7E" },
  { key: "olive", label: "Olive", hex: "#8C9461" },
  { key: "brass", label: "Brass", hex: "#AD9C80" },
  { key: "gold", label: "Gold", hex: "#C9A54E" },
  { key: "copper", label: "Copper", hex: "#C4876A" },
  { key: "rust", label: "Rust", hex: "#A8633F" },
  { key: "crimson", label: "Crimson", hex: "#B5535B" },
  { key: "plum", label: "Plum", hex: "#8F7AA3" },
];

/**
 * The colours for an agent's face, the standard look: fourteen clear,
 * friendly colours (with Automatic, fifteen picks, like the robots'). None
 * picked, the face wears the one its id gives it.
 */
export type FaceColor = { key: string; label: string; hex: string };

export const FACE_COLORS: FaceColor[] = [
  { key: "blue", label: "Blue", hex: "#2E6FEF" },
  { key: "sky", label: "Sky", hex: "#1C8CD6" },
  { key: "teal", label: "Teal", hex: "#0F9488" },
  { key: "green", label: "Green", hex: "#1F9D55" },
  { key: "lime", label: "Lime", hex: "#5C940D" },
  { key: "gold", label: "Gold", hex: "#C98A00" },
  { key: "orange", label: "Orange", hex: "#E8590C" },
  { key: "coral", label: "Coral", hex: "#E5654B" },
  { key: "rose", label: "Rose", hex: "#D6336C" },
  { key: "magenta", label: "Magenta", hex: "#B83FB0" },
  { key: "violet", label: "Violet", hex: "#7C3AED" },
  { key: "indigo", label: "Indigo", hex: "#4C4FD1" },
  { key: "slate", label: "Slate", hex: "#56657E" },
  { key: "ink", label: "Ink", hex: "#232F48" },
];

export function faceColor(key: string | null | undefined): FaceColor | null {
  return FACE_COLORS.find((color) => color.key === key) ?? null;
}

export function robotColor(key: string | null | undefined): RobotColor | null {
  return ROBOT_COLORS.find((color) => color.key === key) ?? null;
}

/** Mixes a colour toward white (amount > 0) or black (amount < 0). */
function mix(hex: string, amount: number): string {
  const target = amount > 0 ? 255 : 0;
  const share = Math.abs(amount);
  const channel = (i: number) => {
    const value = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    return Math.round(value + (target - value) * share).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** A pixel robot's five tones of one metal, light to dark, from one colour. */
export function robotPalette(color: RobotColor): Palette {
  return [mix(color.hex, 0.55), color.hex, mix(color.hex, -0.25), mix(color.hex, -0.5), mix(color.hex, -0.72)];
}
