import { isProjectFirstPath } from "@/lib/project-paths";
import { isReservedProjectSlug } from "@/lib/project-slug";

/** The agents strip's height (#agents-dock); the page keeps this much free at its foot. */
export const AGENTS_DOCK_HEIGHT = 76;

/**
 * Whether the agents bar is drawn on this page (#agents-dock).
 *
 * The bar is there to watch your agents work, so it is an allowlist: it shows
 * only on the pages where that happens, and only when you have agents.
 * Everything else hides it, including pages added later until they are named
 * here. The pages, matched on whole path segments (a trailing slash is fine):
 *
 * - the organisation's `/home`, `/feed`, `/activity` and `/inbox` (and below it);
 * - a project's landing page `/<org>/<project>`, its `/ideas`, `/issues` and
 *   `/clusters` pages (and below them), an issue `/<org>/<project>/<number>`,
 *   `/<org>/<project>/workstream`, `/<org>/<project>/agents` and `/<org>/<project>/work`;
 * - the organisation's Marketing pages, `/<org>/marketing` and below.
 *
 * An organisation's slug is any first segment that isn't a reserved top-level
 * route, so `/settings/...`, `/agents/...` and the rest never count as projects.
 * `/<org>` alone lists the organisation's projects, and an old `/<project>/...`
 * address is only passing through its redirect: neither draws the bar.
 */
export function dockVisibleOn(pathname: string | null | undefined, agentCount: number): boolean {
  if (agentCount <= 0) return false;
  const path = pathname ?? "";
  const segments = path.split("/").filter(Boolean);
  const [first] = segments;
  if (!first) return false;
  if (first === "inbox") return true;
  if (first === "home" || first === "feed" || first === "activity") return segments.length === 1;
  if (isReservedProjectSlug(first) || segments.length < 2 || isProjectFirstPath(path)) return false;
  // An old /<project>/ideas, which only redirects: Ideas are at /new now.
  if (segments[1] === "ideas" && segments.length === 2) return false;
  // The organisation-wide lists (#project-filter): /<org>/issues/…, /<org>/new and /<org>/queue.
  if (segments[1] === "issues" || segments[1] === "new") return true;
  if (segments[1] === "queue") return segments.length === 2;
  // The organisation's Marketing pages (#org-marketing).
  if (segments[1] === "marketing") return true;
  // A project's pages, after /<org>/<project>.
  const [page, ...below] = segments.slice(2);
  if (!page || page === "new" || page === "ideas" || page === "issues" || page === "clusters") return true;
  return below.length === 0 && (page === "workstream" || page === "queue" || page === "agents" || page === "work" || /^\d+$/.test(page));
}

/**
 * Whether to show the Leaderboard link: "you can't be the only person on a
 * leaderboard", so not in an organisation of one member. When the count couldn't
 * be loaded the link stays, as it always was.
 */
export function leaderboardVisible(memberCount: number | null | undefined): boolean {
  return memberCount == null || memberCount > 1;
}

