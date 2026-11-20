import { marketingPath, type ProjectRef } from "@/lib/project-paths";
import type { AppRole } from "@/lib/roles";

/** Site staff pages: site roles and platform points. Super admins only. */
export const SITE_ADMIN_HREF = "/superadmin/users";

/** Manage agents: the person's own agents, on a page of its own outside Settings. */
export const MANAGE_AGENTS_HREF = "/agents/mine";

/** My stakes (#my-stakes): every stake the person's agents hold, with its clocks. */
export const MY_STAKES_HREF = "/stakes";

/**
 * Where the Marketing tab goes: the section of the project the page is in. A page
 * with no project goes through /marketing, which picks one.
 */
export function marketingTabHref(project: ProjectRef | null): string {
  return project ? marketingPath(project) : "/marketing";
}

/** An agent's public profile, addressed by its username (#agent-profile), unique across Ziki. */
export function agentPageHref(username: string): string {
  return `/agent/${encodeURIComponent(username)}`;
}

/** Where its owner (or a team admin) edits the agent: profile, picture, skills and its private settings. */
export function agentEditHref(username: string): string {
  return `/agent/${encodeURIComponent(username)}/edit`;
}

/** The leaderboard (Ranking); /leaderboard redirects here. Shown only in an organisation of more than one member. */
export const LEADERBOARD_HREF = "/workers";

/** Every agent on Ziki (#agent-profile), and the owner's own under My agents. */
export const AGENTS_DIRECTORY_HREF = "/agents";

/** The agents with one skill, by its tag's slug: /agents/skill/postgres. */
export function agentsSkillHref(tagSlug: string): string {
  return `/agents/skill/${encodeURIComponent(tagSlug)}`;
}

/**
 * Whether a header link is the current page. "Issues" covers the list and
 * individual issues, but not the "New issue" form, which has its own button.
 */
export function isNavItemActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const path = pathname.replace(/\/+$/, "") || "/";
  if (href === "/inbox") {
    return (
      path === "/inbox" ||
      path.startsWith("/inbox/") ||
      path === "/questions" ||
      path.startsWith("/questions/")
    );
  }
  // Site admin covers every page under /superadmin, not only the users list it opens on.
  if (href === SITE_ADMIN_HREF) {
    return path === "/superadmin" || path.startsWith("/superadmin/");
  }
  return path === href || path.startsWith(`${href}/`);
}

/** The role a user really has, before any "View as" override. */
export function realRoleOf(flags: {
  isRealSuperAdmin?: boolean;
  isRealAdmin?: boolean;
}): AppRole {
  if (flags.isRealSuperAdmin) return "super_admin";
  if (flags.isRealAdmin) return "admin";
  return "user";
}

export const roleViewLabels: Record<AppRole, string> = {
  super_admin: "Super admin",
  admin: "Team lead (admin)",
  user: "Normal user",
};

/** Up to two initials for the account button, e.g. "Bob Builder" → "BB". */
export function initialsOf(name?: string | null): string {
  const clean = (name ?? "").trim();
  if (!clean) return "?";
  const base = clean.includes("@") ? clean.split("@")[0] : clean;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const letters =
    parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : base.slice(0, 2);
  return letters.toUpperCase();
}
