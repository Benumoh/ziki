import { describe, expect, it } from "vitest";
import { dockVisibleOn, leaderboardVisible } from "@/lib/agents-dock";
import { projectRef } from "@/lib/project-paths";

const ref = projectRef("zedu", "acme");

/**
 * The agents bar (#agents-dock): which pages draw it, when the Leaderboard
 * link is worth showing, and the one next step
 * a organisation card names in place of the empty bar. Pure rules.
 */

describe("dockVisibleOn: where the agents bar shows", () => {
  it.each([
    "/zedu/acme",
    "/zedu/acme/ideas",
    "/zedu/acme/ideas/drafts",
    "/zedu/acme/ideas/rejected",
    "/zedu/acme/ideas/7",
    "/zedu/acme/issues",
    "/zedu/acme/issues/open",
    "/zedu/acme/issues/new",
    "/zedu/acme/42",
    "/zedu/acme/workstream",
    "/zedu/acme/work",
    "/zedu/acme/clusters",
    "/zedu/acme/clusters/c1",
    "/inbox",
    "/inbox/escalations/abc",
    "/home",
    "/activity",
    "/feed",
  ])("shows on %s when you have agents", (path) => {
    expect(dockVisibleOn(path)).toBe(true);
    expect(dockVisibleOn(path)).toBe(true);
  });

  it.each(["/agents/mine", "/agent/robo", "/agent/robo/edit", "/agent/robo/edit/look"])(
    "hides on the page that manages agents: %s",
    (path) => {
      expect(dockVisibleOn(path)).toBe(false);
    },
  );

  it.each(["/settings/connect", "/settings/agents/connect", "/settings/agents/pair"])(
    "hides while creating or approving an agent: %s",
    (path) => {
      expect(dockVisibleOn(path)).toBe(false);
    },
  );

  it.each([
    "/settings",
    "/settings/agents",
    "/settings/agent/robo",
    "/projects/acme/settings",
    "/zedu/acme/org",
    "/zedu/acme/org/members",
    "/zedu/acme/org/invites",
    "/superadmin",
    "/superadmin/users",
    "/superadmin/orgs/acme",
    "/organisations",
    "/organisations/invite/abc",
    "/security",
  ])("hides on settings and admin: %s", (path) => {
    expect(dockVisibleOn(path)).toBe(false);
  });

  it.each(["/docs", "/agents", "/agents/skill/react", "/workers"])("hides on reading pages: %s", (path) => {
    expect(dockVisibleOn(path)).toBe(false);
  });

  it.each([
    "/forum",
    "/forum/12",
    "/fabbenco/forum",
    "/fabbenco/forum/12",
    "/fabbenco/web/forum",
    "/fabbenco/web/forum/12",
  ])("hides on forum pages: %s", (path) => {
    expect(dockVisibleOn(path)).toBe(false);
  });


  it("matches whole path segments, not prefixes", () => {
    // A project called "organic" or "settings-ui" is a project: its pages are work pages.
    expect(dockVisibleOn("/zedu/organic/issues")).toBe(true);
    expect(dockVisibleOn("/zedu/settings-ui/issues")).toBe(true);
    // Only the named sections count: not a look-alike, and not a page below one that isn't named.
    expect(dockVisibleOn("/zedu/acme/ideasx")).toBe(false);
    expect(dockVisibleOn("/zedu/acme/issuesx")).toBe(false);
    expect(dockVisibleOn("/zedu/acme/42x")).toBe(false);
    expect(dockVisibleOn("/zedu/acme/organisation")).toBe(false);
    expect(dockVisibleOn("/homepage")).toBe(false);
    // Home, activity and feed are those pages only, not what sits below them.
    expect(dockVisibleOn("/home/extra")).toBe(false);
    expect(dockVisibleOn("/activity/x")).toBe(false);
    expect(dockVisibleOn("/feed/x")).toBe(false);
    // A project that happens to be called "feeds" is a project: its landing page is a work page.
    expect(dockVisibleOn("/zedu/feeds")).toBe(true);
    // Under issues, whatever it is.
    expect(dockVisibleOn("/zedu/acme/issues/org")).toBe(true);
  });

  it("ignores a trailing slash", () => {
    expect(dockVisibleOn("/agents/mine/")).toBe(false);
    expect(dockVisibleOn("/zedu/acme/issues/")).toBe(true);
    expect(dockVisibleOn("/home/")).toBe(true);
  });

  it.each([
    "/questions",
    "/questions/abc",
    "/users/abc",
    "/team",
    "/milestones",
    "/jobs",
    "/marketing",
    "/leaderboard",
    "/zedu/acme/notes",
    "/zedu/acme/notes/agents/robo",
    "/zedu/acme/tasks/3",
    "/zedu/acme/projects",
    "/zedu/acme/42/history",
    "/zedu/acme/something-new",
    "/",
  ])("hides on a page the allowlist doesn't name: %s", (path) => {
    expect(dockVisibleOn(path)).toBe(false);
    expect(dockVisibleOn(path)).toBe(false);
  });

  it("hides on an organisation's list of projects", () => {
    expect(dockVisibleOn("/zedu")).toBe(false);
    expect(dockVisibleOn("/zedu/")).toBe(false);
  });

  it.each(["/acme/ideas", "/acme/42", "/acme/workstream", "/acme/work"])(
    "hides on an old project-first address while it redirects: %s",
    (path) => {
      expect(dockVisibleOn(path)).toBe(false);
    },
  );

  it.each(["/acme/issues/open", "/acme/new", "/acme/queue", "/acme/marketing", "/acme/marketing/assets/a1"])(
    "shows on the organisation-wide lists and Marketing (#project-filter, #org-marketing): %s",
    (path) => {
      expect(dockVisibleOn(path)).toBe(true);
    },
  );

  it("hides when the path is unknown", () => {
    expect(dockVisibleOn(null)).toBe(false);
    expect(dockVisibleOn(undefined)).toBe(false);
  });
});

describe("leaderboardVisible: you can't be the only person on a leaderboard", () => {
  it("hides it for a one-member organisation", () => {
    expect(leaderboardVisible(1)).toBe(false);
    expect(leaderboardVisible(0)).toBe(false);
  });

  it("shows it once there is more than one member", () => {
    expect(leaderboardVisible(2)).toBe(true);
    expect(leaderboardVisible(40)).toBe(true);
  });

  it("keeps it when the count could not be loaded", () => {
    expect(leaderboardVisible(null)).toBe(true);
    expect(leaderboardVisible(undefined)).toBe(true);
  });
});
