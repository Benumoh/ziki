// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { PublicContributorForm } from "@/components/public-contributor-form";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("contributor form context", () => {
  it("saves optional improvement location and reason in the submitted report", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ trackingPath: "/zedu/web/track/test" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<PublicContributorForm project={{ name: "Web", slug: "web" }} orgSlug="zedu" projectSlug="web" kind="improvement" />);
    fireEvent.change(screen.getByLabelText(/What would you like to improve/), { target: { value: "Add a CSV export for weekly reports." } });
    expect(screen.queryByLabelText(/Where should this be added/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add more detail (optional)" }));
    fireEvent.change(screen.getByLabelText(/Where should this be added/), { target: { value: "Reports page" } });
    fireEvent.change(screen.getByLabelText(/Why would it help/), { target: { value: "Share reports with the team" } });
    fireEvent.click(screen.getByRole("button", { name: "Send suggestion" }));
    await screen.findByText("Report received");
    const call = fetchMock.mock.calls.find(([, options]) => options?.method === "POST");
    const body = JSON.parse(call![1].body);
    expect(body.description).toContain("Where to add it: Reports page");
    expect(body.description).toContain("Why it helps: Share reports with the team");
    expect(body.title).toBe("Add a CSV export for weekly reports.");
  });
  it("uses problem wording and does not ask for improvement context", () => {
    render(<PublicContributorForm project={{ name: "Web", slug: "web" }} orgSlug="zedu" projectSlug="web" kind="problem" />);
    expect(screen.getByLabelText(/Summary of what went wrong/)).toBeTruthy();
    expect(screen.queryByLabelText(/Where should this be added/)).toBeNull();
    expect(screen.queryByText("Review your report")).toBeNull();
  });
});
