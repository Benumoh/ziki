// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const route = vi.hoisted(() => ({ path: "/zedu/feedback" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.path, useSearchParams: () => new URLSearchParams() }));
import { FeedbackPortalNav } from "@/components/feedback-portal-nav";
afterEach(() => { cleanup(); route.path = "/zedu/feedback"; });
it("shows the stored organisation name rather than its legacy URL slug", () => {
  render(<FeedbackPortalNav orgSlug="zedu" orgName="Ziki" />);
  expect(screen.getByRole("link", { name: "Ziki main page" }).getAttribute("href")).toBe("/zedu");
  expect(screen.getByRole("link", { name: "Projects" }).getAttribute("href")).toBe("/zedu/feedback");
});
it("updates branding and navigation together for a different organisation", () => {
  const view = render(<FeedbackPortalNav orgSlug="zedu" orgName="Ziki" />);
  route.path = "/acme/feedback";
  view.rerender(<FeedbackPortalNav orgSlug="acme" orgName="Acme" />);
  expect(screen.queryByRole("link", { name: "Ziki main page" })).toBeNull();
  expect(screen.getByRole("link", { name: "Acme main page" }).getAttribute("href")).toBe("/acme");
  expect(screen.getByRole("link", { name: "Feedback" }).getAttribute("href")).toBe("/acme/feedback?view=ideas");
});
