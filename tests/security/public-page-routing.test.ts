import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ default: () => ({ auth: (handler: unknown) => handler }) }));
vi.mock("@/auth.config", () => ({ default: {} }));
vi.mock("@/app/actions/security-preview", () => ({ runPublicScan: vi.fn() }));
vi.mock("@/app/actions/security-assistant", () => ({}));
import { isPublicPath } from "@/middleware";
import { isReservedProjectSlug } from "@/lib/project-slug";
import { addAssetPath } from "@/components/security-checks/public-scan";
import {
  publicIssueDetailPath,
  publicIssuesPath,
  publicIssuesSegments,
  publicReportPath,
} from "@/lib/public-project-paths";
import {
  buildDirectoryAreas,
  filterDirectoryProjects,
} from "@/lib/public-directory";

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
});
