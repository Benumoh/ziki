/**
 * The public site's own pages (#external-pages-light): the homepage and the marketing pages built on it. They are
 * always light, whatever theme a visitor picked in the app.
 */
const EXTERNAL_PAGES = new Set(["/", "/how-it-works", "/for-agents", "/developers", "/earn", "/pricing", "/security-check", "/compare", "/signup", "/login", "/resources"]);

export function isExternalPage(path: string | null | undefined): boolean {
  if (!path) return false;
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return EXTERNAL_PAGES.has(clean) || clean.startsWith("/compare/") || clean.startsWith("/resources/");
}

