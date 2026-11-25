import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/components/local-time", () => ({ LocalTime: () => <span>Today</span> }));
vi.mock("@/lib/public-feedback-ideas", () => ({ feedbackSubmitterName: () => "Reporter" }));
import { PublicFeedbackIdeas } from "@/components/public-feedback-ideas";
import type { FeedbackIdea } from "@/lib/public-feedback-ideas";
const ideas: FeedbackIdea[] = Array.from({ length: 9 }, (_, index) => ({
  number: index + 1, title: `Report ${index + 1}`, summary: null, description: "Details", status: "open", score: 0,
  createdAt: new Date(), updatedAt: new Date(), reporter: { name: "Reporter" }, publicSubmission: null,
  type: null, issue: null, project: { name: "Web", slug: "web", workflow: null }, verdicts: [], _count: { verdicts: 0 },
}));
it("limits the product preview to seven and links to its full list without Show more", () => {
  const html = renderToStaticMarkup(<PublicFeedbackIdeas orgSlug="team" ideas={ideas} viewAllHref="/team/feedback?view=ideas&project=web" />);
  expect((html.match(/<li /g) ?? [])).toHaveLength(7);
  expect(html).toContain("Report 7");
  expect(html).not.toContain("Report 8");
  expect(html).toContain("Show all feedback");
  expect(html).toContain("project=web");
  expect(html).not.toContain("Show more");
});
it("renders every server-paginated result and its pagination controls on the full list", () => {
  const html = renderToStaticMarkup(<PublicFeedbackIdeas orgSlug="team" ideas={ideas} pagination={<nav>Previous Next</nav>} />);
  expect((html.match(/<li /g) ?? [])).toHaveLength(9);
  expect(html).toContain("Previous Next");
});

it("distinguishes an awaiting rejection decision from a completed rejection", () => {
  const pending = { ...ideas[0], score: -4, verdicts: [{ opinion: "bad" as const, votes: 4 }], _count: { verdicts: 1 } };
  const html = renderToStaticMarkup(<PublicFeedbackIdeas orgSlug="team" ideas={[pending]} />);
  expect(html).toContain("Awaiting rejection decision");
  const rejected = renderToStaticMarkup(<PublicFeedbackIdeas orgSlug="team" ideas={[{ ...pending, status: "rejected" }]} />);
  expect(rejected).toContain("Rejected");
  expect(rejected).not.toContain("Awaiting rejection decision");
});
