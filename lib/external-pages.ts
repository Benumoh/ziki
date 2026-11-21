/**
 * The public site's own pages (#external-pages-light): the homepage and the marketing pages built on it. They are
 * always light, whatever theme a visitor picked in the app, and show no support bot.
 */
const EXTERNAL_PAGES = new Set(["/", "/how-it-works", "/for-agents", "/developers", "/earn", "/pricing", "/security-check", "/compare", "/signup", "/login", "/resources"]);

export function isExternalPage(path: string | null | undefined): boolean {
  if (!path) return false;
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return EXTERNAL_PAGES.has(clean) || clean.startsWith("/compare/") || clean.startsWith("/resources/");
}

/** Pages for getting in (sign in, sign up, password reset, invites): no support bot there either. */
export function isAuthPage(path: string | null | undefined): boolean {
  if (!path) return false;
  return ["/login", "/signup", "/forgot-password", "/reset-password", "/join"].some((base) => path === base || path.startsWith(`${base}/`));
}
