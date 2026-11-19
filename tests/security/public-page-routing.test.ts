import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const feedbackVotes = vi.hoisted(() => ({ state: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/public-feedback-votes", () => ({
  FEEDBACK_VISITOR_COOKIE: "ziki-feedback-visitor",
  publicFeedbackVoteState: feedbackVotes.state,
  setPublicFeedbackVote: feedbackVotes.set,
}));
vi.mock("@/lib/rate-limit", () => ({ clientRateLimitKey: () => "test-client", consumeRateLimits: async () => ({ allowed: true, retryAfterMs: 0 }) }));
import { PUT as putFeedbackVote, GET as getFeedbackVote } from "@/app/api/public/projects/[org]/[project]/issues/[number]/votes/route";

vi.mock("next-auth", () => ({ default: () => ({ auth: (handler: unknown) => handler }) }));
vi.mock("@/auth.config", () => ({ default: {} }));
vi.mock("@/app/actions/security-preview", () => ({ runPublicScan: vi.fn() }));
vi.mock("@/app/actions/security-assistant", () => ({}));
import { isPublicPath } from "@/middleware";
import { isReservedProjectSlug } from "@/lib/project-slug";
import { addAssetPath } from "@/components/security-checks/public-scan";
import {
  publicFeedbackPath,
  publicIntakeSegments,
  publicIssueDetailPath,
  publicIssuesPath,
  publicIssuesSegments,
  publicOrgFeedbackPath,
  publicOrgFeedbackSegments,
  publicReportPath,
} from "@/lib/public-project-paths";
import {
  buildDirectoryAreas,
  filterDirectoryProjects,
} from "@/lib/public-directory";

describe("The public docs", () => {
  it("opens the docs to everyone, and keeps their name from being taken by a workspace", () => {
    expect(isPublicPath("/docs")).toBe(true);
    expect(isPublicPath("/docs/users/getting-started")).toBe(true);
    expect(isPublicPath("/docs/developers/api-reference")).toBe(true);
    expect(isPublicPath("/docsfoo")).toBe(false);
    expect(isReservedProjectSlug("docs")).toBe(true);
  });
});

describe("Ziki Security's public page (#security-checks, C2)", () => {
  it("is open to everyone, while every other Security page still needs signing in", () => {
    expect(isPublicPath("/security")).toBe(true);
    expect(isPublicPath("/security-check")).toBe(true);
    expect(isPublicPath("/security/new")).toBe(false);
    expect(isPublicPath("/security/targets/t1/verify")).toBe(false);
    expect(isPublicPath("/security/checks/c1/pay")).toBe(false);
    expect(isPublicPath("/security/work")).toBe(false);
  });

  it("can't be taken by an organisation's name", () => {
    expect(isReservedProjectSlug("security-check")).toBe(true);
  });

  it("opens the plans page to anyone, and keeps its name and the Ziks page's from being taken by a workspace", () => {
    expect(isPublicPath("/pricing")).toBe(true);
    // The Ziks page is for people signed in.
    expect(isPublicPath("/coins")).toBe(false);
    expect(isReservedProjectSlug("pricing")).toBe(true);
    expect(isReservedProjectSlug("coins")).toBe(true);
  });

  it("brings the scanned address through sign-up to the Security page, where its scan starts", () => {
    expect(addAssetPath("yourshop.com")).toBe("/security?target=yourshop.com");
    expect(addAssetPath("api.shop.ng:8443")).toBe("/security?target=api.shop.ng%3A8443");
  });
});

describe("Public contributor directory & issue browsing (#985)", () => {
  it("opens /discover and public-issues paths to guests while keeping member issue lists protected", () => {
    expect(isPublicPath("/discover")).toBe(true);
    expect(isPublicPath("/discover?area=web&q=ziki")).toBe(true);
    expect(isPublicPath("/ziki/web/public-issues")).toBe(true);
    expect(isPublicPath("/ziki/web/public-issues/42")).toBe(true);
    expect(isPublicPath("/ziki/web/issues/open")).toBe(false);
    expect(publicIssuesSegments("/ziki/web/public-issues/42")).toEqual({
      orgSlug: "ziki",
      projectSlug: "web",
      kind: "public-issues",
    });
  });

  it("builds contributor report and public issue URLs for the selected project", () => {
    const ref = { orgSlug: "ziki", projectSlug: "desktop" };
    expect(publicReportPath(ref, "problem")).toBe("/ziki/desktop/report?type=problem");
    expect(publicReportPath(ref, "improvement")).toBe("/ziki/desktop/report?type=improvement");
    expect(publicIssuesPath(ref)).toBe("/ziki/desktop/public-issues");
    expect(publicIssueDetailPath(ref, 17)).toBe("/ziki/desktop/public-issues/17");
  });

  it("groups and filters public projects by Desktop, Web, Mobile, configured areas, and search query", () => {
    const projects = [
      {
        id: "p1",
        slug: "desktop",
        name: "Desktop",
        goal: "Native desktop client",
        isOpenForContributors: true,
        acceptsGuestIdeas: true,
        organisation: { name: "Ziki", slug: "ziki" },
        areas: [{ slug: "sync", name: "Sync" }],
      },
      {
        id: "p2",
        slug: "web",
        name: "Web",
        goal: "Browser app",
        isOpenForContributors: false,
        acceptsGuestIdeas: false,
        organisation: { name: "Ziki", slug: "ziki" },
        areas: [],
      },
    ];

    const areas = buildDirectoryAreas(projects);
    expect(areas.map((a) => [a.slug, a.count])).toEqual([
      ["desktop", 1],
      ["web", 1],
      ["mobile", 0],
      ["sync", 1],
    ]);

    expect(filterDirectoryProjects(projects, { area: "desktop" }).map((p) => p.id)).toEqual(["p1"]);
    expect(filterDirectoryProjects(projects, { area: "sync", query: "native" }).map((p) => p.id)).toEqual(["p1"]);
    expect(filterDirectoryProjects(projects, { area: "web", openOnly: true })).toEqual([]);
  });

  it("opens organization and project feedback portal links to external visitors (#1048)", () => {
    expect(isPublicPath("/ziki/feedback")).toBe(true);
    expect(isPublicPath("/ziki/desktop/feedback")).toBe(true);
    expect(isPublicPath("/ziki/mobile/feedback")).toBe(true);
    expect(isPublicPath("/ziki/web/feedback")).toBe(true);
    expect(publicOrgFeedbackPath("ziki")).toBe("/ziki/feedback");
    expect(publicFeedbackPath({ orgSlug: "ziki", projectSlug: "desktop" })).toBe("/ziki/desktop/feedback");
    expect(publicOrgFeedbackSegments("/ziki/feedback")).toEqual({
      orgSlug: "ziki",
      kind: "org-feedback",
    });
    expect(publicIntakeSegments("/ziki/desktop/feedback")).toEqual({
      orgSlug: "ziki",
      projectSlug: "desktop",
      kind: "feedback",
    });
  });
});

describe("Customer feedback voting boundaries (#1046)", () => {
  const context = { params: Promise.resolve({ org: "acme", project: "desktop", number: "42" }) };
  function request(body: unknown, origin = "https://ziki.test") {
    return new NextRequest("https://ziki.test/api/public/projects/acme/desktop/issues/42/votes", {
      method: "PUT", headers: { origin, host: "ziki.test", "content-type": "application/json" }, body: JSON.stringify(body),
    });
  }
  it("does not allow another site to place customer votes", async () => {
    feedbackVotes.set.mockClear();
    expect((await putFeedbackVote(request({ voted: true }, "https://other.test"), context)).status).toBe(403);
    expect(feedbackVotes.set).not.toHaveBeenCalled();
  });
  it("refuses injected agent scores and verdicts instead of treating them as customer interest", async () => {
    feedbackVotes.set.mockClear();
    expect((await putFeedbackVote(request({ voted: true, score: 99, verdict: "good" }), context)).status).toBe(400);
    expect(feedbackVotes.set).not.toHaveBeenCalled();
  });
  it("keeps unavailable projects/issues hidden from anonymous voters", async () => {
    feedbackVotes.state.mockResolvedValueOnce(null);
    feedbackVotes.set.mockClear();
    expect((await putFeedbackVote(request({ voted: true }), context)).status).toBe(404);
    expect(feedbackVotes.set).not.toHaveBeenCalled();
  });
  it("lets a signed-out visitor vote without acquiring a login session or receiving an internal issue id", async () => {
    feedbackVotes.state.mockResolvedValueOnce({ bugId: "internal-id", count: 1, voted: false });
    feedbackVotes.set.mockResolvedValueOnce({ count: 2, voted: true });
    const response = await putFeedbackVote(request({ voted: true }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 2, voted: true });
    expect(response.cookies.get("ziki-feedback-visitor")?.httpOnly).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.cookies.get("authjs.session-token")).toBeUndefined();
  });
  it("returns only customer vote state when a visitor checks an existing report", async () => {
    feedbackVotes.state.mockResolvedValueOnce({ bugId: "private-internal-id", count: 2, voted: false });
    const response = await getFeedbackVote(new NextRequest("https://ziki.test/api/public/projects/acme/desktop/issues/42/votes"), context);
    expect(await response.json()).toEqual({ count: 2, voted: false });
  });
});
