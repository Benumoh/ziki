// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
import { FeedbackIdeasToolbar } from "@/components/feedback-ideas-toolbar";
afterEach(() => { cleanup(); navigation.push.mockClear(); });
it("keeps the typed search and status when switching projects", () => {
  render(<FeedbackIdeasToolbar baseHref="/team/feedback?view=ideas" status="open" projects={[{ slug: "atlas", name: "Atlas" }]} />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "save report" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Project" }), { target: { value: "atlas" } });
  expect(navigation.push).toHaveBeenCalledWith("/team/feedback?view=ideas&q=save+report&project=atlas&status=open");
});
it("keeps a product-scoped search on that product's page", () => {
  render(<FeedbackIdeasToolbar baseHref="/team/atlas/feedback" status="open" />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "export" } });
  fireEvent.submit(screen.getByRole("button", { name: "Search feedback" }).closest("form")!);
  expect(navigation.push).toHaveBeenCalledWith("/team/atlas/feedback?q=export&status=open");
  expect(screen.queryByRole("combobox")).toBeNull();
});
