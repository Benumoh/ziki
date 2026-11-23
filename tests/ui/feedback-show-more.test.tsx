// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FeedbackShowMore } from "@/components/feedback-show-more";
afterEach(cleanup);
it("reveals seven entries at a time and stops offering more at the end", () => {
  render(<FeedbackShowMore items={Array.from({ length: 15 }, (_, index) => <li key={index}>Report {index + 1}</li>)} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(7);
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(14);
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(15);
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
});
it("shows a short result list in full without a redundant button", () => {
  render(<FeedbackShowMore items={[<li key="one">Report one</li>]} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
});
