/**
 * Where to send someone after they buy Ziks (#deeper-scan-gate, 18 Nov): back to the scan they were paying for, so
 * they can press Pay there. Only a security check's own page on this site is allowed, never another address, so
 * the link can't be used to send people elsewhere. Going back never pays by itself.
 */
const SCAN_PAGE = /^\/security\/checks\/[A-Za-z0-9_-]{1,100}$/;

/** The return path if it's one of ours, else null. */
export function safeReturnTo(value: unknown): string | null {
  return typeof value === "string" && SCAN_PAGE.test(value) ? value : null;
}

/** The Ziks page, remembering the scan to come back to. */
export function buyZiksHref(checkId: string): string {
  return `/coins?returnTo=${encodeURIComponent(`/security/checks/${checkId}`)}`;
}
