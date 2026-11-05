/**
 * Project slugs share the top level of the site with the app's own pages: an
 * issue lives at `/<project-slug>/<number>` and a project's work feed at
 * `/<project-slug>/work`. A project may therefore never take the name of a
 * top-level route, or its URLs would open that page instead.
 *
 * When you add a folder directly under `app/`, `app/(app)/`, `app/(auth)/`
 * (or any other route group), a top-level file route, a top-level redirect in
 * next.config.ts, or a top-level folder in `public/`, add its name here.
 * Existing projects that already use a newly reserved name need a migration
 * that renames them (see prisma/migrations/20261222000000_reserved_project_slugs).
 */
export const RESERVED_PROJECT_SLUGS: ReadonlySet<string> = new Set([
  // app/
  "actions",
  "api",
  "developers",
  "fonts",
  "for-agents",
  "how-it-works",
  "session-expired",
  // app/(app)/
  "activity",
  "superadmin",
  "agent",
  "agents",
  "docs",
  "escalations",
  "inbox",
  "feed",
  "home",
  "ideas",
  "issues",
  "jobs",
  "leaderboard",
  "marketing",
  "milestones",
  "notes",
  "notifications",
  "org",
  "points",
  "projects",
  "questions",
  "redesigns",
  "security",
  "settings",
  "team",
  "tenants",
  "users",
  "workers",
  // app/(auth)/
  "forgot-password",
  "join",
  "login",
  "reset-password",
  "signup",
  // Top-level files and metadata routes
  "apple-icon",
  "favicon",
  "icon",
  "icon1",
  "icon2",
  "llms",
  "manifest",
  "opengraph-image",
  "robots",
  "sitemap",
  "twitter-image",
  // Redirects in next.config.ts and middleware.ts
  "bug-tracker",
  "bugs",
  // public/
  "brand",
  "homepage",
  "icons",
]);

/** The suffix a reserved slug takes, matching the rename migration. */
const RESERVED_SUFFIX = "-project";

export function isReservedProjectSlug(slug: string): boolean {
  return RESERVED_PROJECT_SLUGS.has(slug);
}

const PROJECT_ISSUE_PATH = /^\/([^/]+)\/[0-9]+(\/[^/]+)?$/;

/**
 * Whether an app path (no base path, no query) is an issue page:
 * `/<project-slug>/<number>`, or with `subpages` also one below it such as
 * `/<project-slug>/<number>/history`. Top-level routes never count.
 */
export function isProjectIssuePath(path: string, { subpages = false }: { subpages?: boolean } = {}): boolean {
  const match = PROJECT_ISSUE_PATH.exec(path.replace(/\/+$/, ""));
  return Boolean(match && (subpages || !match[2]) && !isReservedProjectSlug(match[1]));
}

/** `slug`, or `slug-project` when it names a top-level route (`issues` → `issues-project`). */
export function unreservedProjectSlug(slug: string): string {
  return isReservedProjectSlug(slug) ? `${slug}${RESERVED_SUFFIX}` : slug;
}
