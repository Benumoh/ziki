/**
 * The pills' colours: soft tints with a strong text of the same hue, from the design's chart colours (blue
 * #1b8ce8, green #17a673, orange #ff5601, magenta #f96cd8, red #e5484d, amber #d99a00, slate #697386). One map, so
 * the row statuses, the feed's kinds and the priorities all read alike.
 */
export const PILL_TONES = {
  green: { backgroundColor: "#e3f5ee", color: "#12855c" },
  blue: { backgroundColor: "#e8f3fd", color: "#1170c2" },
  cyan: { backgroundColor: "#e2f5f7", color: "#0b7285" },
  teal: { backgroundColor: "#e1f4ef", color: "#0f7a64" },
  purple: { backgroundColor: "#fdeefa", color: "#b8329a" },
  yellow: { backgroundColor: "#fdf5e1", color: "#9a6d00" },
  orange: { backgroundColor: "#fff0e8", color: "#cc4500" },
  red: { backgroundColor: "#fdecec", color: "#c4292e" },
  grey: { backgroundColor: "#f1f2f4", color: "#697386" },
} as const;

export type PillTone = keyof typeof PILL_TONES;
