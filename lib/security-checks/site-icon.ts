import "server-only";
import http from "node:http";
import https from "node:https";
import { publicOnlyLookup } from "@/lib/security-checks/ownership";

/**
 * A website target's own icon (#security-checks), for the Targets list. Many sites don't serve
 * /favicon.ico, or serve an empty one (hotels.ng), and declare their icon in the page instead
 * (<link rel="icon" href="…">), which a browser on ziki.dev can't read. So the server reads the
 * site's page, finds the icon it declares, falls back to /favicon.ico, and hands back the image.
 *
 * Same rules as the quick scan: public addresses only (publicOnlyLookup, so a name can't point
 * at a private network), a short timeout, small size limits, and a few redirects at most.
 */

const TIMEOUT_MS = 4000;
const PAGE_BYTES = 400_000;
const ICON_BYTES = 200_000;
const REDIRECTS = 3;
const KEEP_MS = 24 * 60 * 60 * 1000;

export type SiteIcon = { type: string; body: Buffer };

type Answer = { status: number; type: string; location: string | null; body: Buffer };

const kept = new Map<string, { at: number; icon: SiteIcon | null }>();

function get(url: URL, maxBytes: number): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : url.protocol === "http:" ? http : null;
    if (!client) return reject(new Error("Only http and https."));
    const request = client.get(
      url,
      {
        lookup: publicOnlyLookup(),
        timeout: TIMEOUT_MS,
        headers: { "user-agent": "ZikiSecurity/1.0 (+https://ziki.dev/security)", accept: "text/html,image/*;q=0.9,*/*;q=0.5" },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            type: String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase(),
            location: typeof response.headers.location === "string" ? response.headers.location : null,
            body: Buffer.concat(chunks),
          }),
        );
        response.on("close", () =>
          resolve({ status: response.statusCode ?? 0, type: String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase(), location: null, body: Buffer.concat(chunks) }),
        );
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("Timed out.")));
    request.on("error", reject);
  });
}

/** Follows a few redirects, each through the same public-only lookup. */
async function follow(start: URL, maxBytes: number): Promise<{ url: URL; answer: Answer }> {
  let url = start;
  for (let hop = 0; hop <= REDIRECTS; hop += 1) {
    const answer = await get(url, maxBytes);
    if (answer.status >= 300 && answer.status < 400 && answer.location) {
      url = new URL(answer.location, url);
      continue;
    }
    return { url, answer };
  }
  throw new Error("Too many redirects.");
}

/** The icon the page declares, best first: rel="icon" / "shortcut icon", then apple-touch-icon. */
export function declaredIcons(html: string, base: URL): URL[] {
  const found: { url: URL; rank: number }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? /\bhref\s*=\s*([^\s>]+)/i.exec(tag)?.[1];
    if (!href || !/\bicon\b/.test(rel)) continue;
    try {
      const url = new URL(href.trim(), base);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      found.push({ url, rank: rel.includes("apple-touch") ? 1 : 0 });
    } catch {
      // Not a usable address: skip it.
    }
  }
  return found.sort((a, b) => a.rank - b.rank).map(({ url }) => url);
}

function looksLikeImage(answer: Answer): boolean {
  if (answer.status !== 200 || answer.body.length < 16) return false;
  return answer.type.startsWith("image/") || answer.type === "application/octet-stream" || answer.type === "";
}

/** The site's icon, or null when it has none we can show. Kept for a day per site. */
export async function siteIcon(host: string): Promise<SiteIcon | null> {
  const key = host.toLowerCase();
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.icon;
  let icon: SiteIcon | null = null;
  try {
    const home = new URL(`https://${key}/`);
    const candidates: URL[] = [];
    try {
      const { url, answer } = await follow(home, PAGE_BYTES);
      if (answer.status === 200 && answer.type.includes("html")) candidates.push(...declaredIcons(answer.body.toString("utf8"), url));
    } catch {
      // The page couldn't be read: still try /favicon.ico.
    }
    candidates.push(new URL("/favicon.ico", home));
    for (const candidate of candidates.slice(0, 4)) {
      try {
        const { answer } = await follow(candidate, ICON_BYTES);
        if (looksLikeImage(answer)) {
          icon = { type: answer.type.startsWith("image/") ? answer.type : "image/x-icon", body: answer.body };
          break;
        }
      } catch {
        // Try the next one.
      }
    }
  } catch {
    icon = null;
  }
  kept.set(key, { at: Date.now(), icon });
  return icon;
}
