import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/components/local-time", () => ({ LocalTime: () => <span>Today</span> }));
vi.mock("@/components/rich-text", () => ({ RichText: ({ content }: { content: string }) => <p>{content}</p> }));
vi.mock("@/components/feedback-detail-copy", () => ({ FeedbackDetailCopy: () => <button>Copy tracking link</button> }));
vi.mock("@/lib/auth-helpers", () => ({ optionalUser: async () => null }));
vi.mock("@/components/add-verdict-dialog", () => ({ AddVerdictDialog: () => null }));
import { FeedbackDetail } from "@/components/feedback-detail";
const idea = {
  number: 33, title: "Save fails", summary: "Save failed", description: "Tap Save on mobile", status: "open" as const, score: 2,
  createdAt: new Date(), updatedAt: new Date(), reporter: { name: "Guest" }, publicSubmission: null,
  project: { name: "Web", slug: "web", visibility: "public" as const, organisation: { name: "Team", slug: "team" }, workflow: { ideaThreshold: 4 } }, issue: null,
  verdicts: [{ id: "v1", opinion: "good" as const, votes: 3, summary: "Reproduced on mobile", updatedAt: new Date(), agent: { name: "Reviewer" } }, { id: "v2", opinion: "bad" as const, votes: 1, summary: "Needs more detail", updatedAt: new Date(), agent: null }],
};
it("shows actual weighted votes, project threshold and verdicts without a voting control", () => {
  const html = renderToStaticMarkup(<FeedbackDetail idea={idea} />);
  expect(html).toContain("Score 2 of 4");
  expect(html).toContain('title="3 good votes"');
  expect(html).toContain('title="1 bad vote"');
  expect(html).toContain("Reproduced on mobile");
  expect(html).not.toContain("Add verdict");
  expect(html).not.toContain("Report timeline");
  expect(html).not.toContain("Copy tracking link");
});
it("offers the private receipt and tracking actions only when authorized paths are provided", () => {
  const html = renderToStaticMarkup(<FeedbackDetail idea={idea} confirmationHref="/private?view=confirmation" trackingPath="/private" />);
  expect(html).toContain('href="/private?view=confirmation"');
  expect(html).toContain("Copy tracking link");
});

it("shows rejection pending only when the project's weighted vote criteria are met", () => {
  const pending = { ...idea, score: -4, verdicts: [{ ...idea.verdicts[0], opinion: "bad" as const, votes: 4 }] };
  const html = renderToStaticMarkup(<FeedbackDetail idea={pending} />);
  expect(html).toContain("Awaiting rejection decision");
  expect(html).toContain("no final rejection has been recorded");
  expect(html).not.toContain("Net votes:");
  const belowThreshold = renderToStaticMarkup(<FeedbackDetail idea={{ ...pending, verdicts: [{ ...pending.verdicts[0], votes: 3 }] }} />);
  expect(belowThreshold).not.toContain("Awaiting rejection decision");
  const rejected = renderToStaticMarkup(<FeedbackDetail idea={{ ...pending, status: "rejected" }} />);
  expect(rejected).not.toContain("Awaiting rejection decision");
});
