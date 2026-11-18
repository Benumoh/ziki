import type { FingerprintPart, SiteFingerprint } from "./preview";

/** How each part of a site's fingerprint reads when it changed between two scans (18 Nov). */
const CHANGED_LABEL: Record<FingerprintPart, string> = {
  certificate: "a new certificate",
  tls: "different TLS settings",
  headers: "different security headers",
  cookies: "different cookies",
  files: "a changed robots.txt or security.txt",
  email: "different email settings",
  repo: "different files in the repo",
};

/** A rescan's answer to "did the site change since the last scan?": what changed, empty when nothing did. */
export type SiteChange = { changed: string[] };

function readFingerprint(value: unknown): SiteFingerprint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: SiteFingerprint = {};
  for (const part of Object.keys(CHANGED_LABEL) as FingerprintPart[]) {
    const hash = (value as Record<string, unknown>)[part];
    if (typeof hash === "string") out[part] = hash;
  }
  return out;
}

/**
 * Compares the earlier scan's fingerprint with this one's. Only parts both scans really saw are compared, so a part
 * the quick scan couldn't read this time never reads as a change. Null when either scan has no fingerprint (a scan
 * made before 18 Nov, or a quick scan that couldn't run), or they share no part: then nothing is claimed either way.
 */
export function siteChangeBetween(earlier: unknown, current: unknown): SiteChange | null {
  const before = readFingerprint(earlier);
  const now = readFingerprint(current);
  if (!before || !now) return null;
  const shared = (Object.keys(CHANGED_LABEL) as FingerprintPart[]).filter((part) => before[part] && now[part]);
  if (shared.length === 0) return null;
  return { changed: shared.filter((part) => before[part] !== now[part]).map((part) => CHANGED_LABEL[part]) };
}

/** What a New finding's hover says about it: "This site changed since the last scan (…)" or "…looks the same…, so this was missed then". */
export function siteChangeSentence(change: SiteChange): string {
  if (change.changed.length === 0) return "The site looks the same as at the last scan, so this was missed then.";
  const list = change.changed.length === 1 ? change.changed[0] : `${change.changed.slice(0, -1).join(", ")} and ${change.changed.at(-1)}`;
  return `This site changed since the last scan (${list}).`;
}
