/**
 * A mobile app's store link (#app-links): an App Store or Google Play page,
 * recognised and put in one canonical form. Pure and client-safe, so the
 * project header and the server's validation read links the same way.
 */

export type AppStore = "app_store" | "play";
export type AppLink = { store: AppStore; id: string; url: string };

export const STORE_LABEL: Record<AppStore, string> = { app_store: "App Store", play: "Google Play" };

/**
 * `apps.apple.com/us/app/name/id123`, `itunes.apple.com/app/id123` or
 * `play.google.com/store/apps/details?id=com.x.y`, with or without https://.
 * Null for anything else.
 */
export function parseAppLink(raw: string): AppLink | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 500) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();

  if (host === "apps.apple.com" || host === "itunes.apple.com") {
    const id = url.pathname.match(/\/id(\d{5,12})(?:\/|$)/)?.[1];
    if (!id) return null;
    const country = url.pathname.match(/^\/([a-z]{2})\//i)?.[1]?.toLowerCase() ?? "us";
    return { store: "app_store", id, url: `https://apps.apple.com/${country}/app/id${id}` };
  }

  if (host === "play.google.com" && url.pathname.startsWith("/store/apps/details")) {
    const id = url.searchParams.get("id") ?? "";
    if (id.length > 150 || !/^[a-zA-Z][\w]*(\.[a-zA-Z_][\w]*)+$/.test(id)) return null;
    return { store: "play", id, url: `https://play.google.com/store/apps/details?id=${id}` };
  }
  return null;
}
