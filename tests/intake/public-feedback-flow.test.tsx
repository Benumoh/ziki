import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ project: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/public-projects", () => ({ findFeedbackProject: mocks.project }));
vi.mock("@/lib/auth-helpers", () => ({ optionalUser: mocks.user }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/components/public-product-overview", () => ({
  PublicProductOverview: ({ product }: { product: { name: string } }) => <div>About {product.name}</div>,
}));
vi.mock("@/components/public-contributor-form", () => ({
  PublicContributorForm: ({ kind, returnHref, signedIn }: { kind: string; returnHref: string; signedIn: boolean }) => <div>{kind}<a href={returnHref}>All feedback</a>{signedIn ? "Account connected" : "Continue as guest"}</div>,
}));
vi.mock("@/components/public-feedback-idea-detail", () => ({
  PublicFeedbackIdeaDetail: ({ project, number }: { project: { projectSlug: string }; number: number }) => <div>{project.projectSlug} feedback idea {number}</div>,
}));
vi.mock("@/components/local-time", () => ({ LocalTime: () => <span>Today</span> }));
vi.mock("@/components/rich-text", () => ({ RichText: ({ content }: { content: string }) => <p>{content}</p> }));

import FeedbackPage from "@/app/(app)/[org]/[project]/feedback/page";
import { PublicReportProgress } from "@/components/public-report-progress";

describe("external feedback flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.project.mockResolvedValue({ name: "Desktop", slug: "desktop", organisation: { slug: "team", name: "Team" } });
    mocks.user.mockResolvedValue(null);
  });

  it.each(["web", "mobile", "desktop"])("opens the %s product information before the report form", async project => {
    mocks.project.mockResolvedValue({ name: project, slug: project, organisation: { slug: "team", name: "Team" } });
    const page = await FeedbackPage({ params: Promise.resolve({ org: "team", project }), searchParams: Promise.resolve({}) });
    expect(renderToStaticMarkup(page)).toContain(`About ${project}`);
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it.each(["problem", "improvement"])("keeps guest %s reporting linked to its selected project", async type => {
    const page = await FeedbackPage({ params: Promise.resolve({ org: "team", project: "desktop" }), searchParams: Promise.resolve({ type }) });
    const html = renderToStaticMarkup(page);
    expect(html).toContain("Continue as guest");
    expect(html).toContain('href="/team/desktop/feedback"');
    expect(html).toContain(type);
  });

  it("opens a submitted idea in the selected project's feedback flow", async () => {
    const page = await FeedbackPage({ params: Promise.resolve({ org: "team", project: "mobile" }), searchParams: Promise.resolve({ idea: "42" }) });
    expect(renderToStaticMarkup(page)).toContain("mobile feedback idea 42");
  });

  it.each(["on_dev", "on_staging", "merged_broken", "force_merged", "on_prod"] as const)("shows the actual resolution state for %s", substatus => {
    const html = renderToStaticMarkup(<PublicReportProgress title="Save fails" number="#1" state={substatus} summary="Save fails on desktop." description="Steps to reproduce" createdAt={new Date()} updatedAt={new Date()} issue={{ status: "resolved", substatus }} />);
    expect(html.includes("live in production")).toBe(substatus === "on_prod");
    expect(html).toContain("Steps and details");
  });
});
