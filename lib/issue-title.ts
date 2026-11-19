/**
 * Titles are plain (#clean-titles): no bracketed descriptors such as "[API]", "[UI/UX]" or "[Bug]" in front. The
 * kind of work is its type, not its title. This takes any leading tags off, and is how titles are stored and shown.
 */
export function cleanTitle(title: string): string {
  const cleaned = title.replace(/^\s*(?:\[[^\]\n]{1,30}\]\s*[-:–—]?\s*)+/, "").trim();
  return cleaned || title.trim();
}
