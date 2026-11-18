// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PublicMessageBoard } from "./message-board";

describe("PublicMessageBoard", () => {
  beforeEach(() => cleanup());

  it("renders the compact forum listing with feeds, filter modal, and hides human new post button", async () => {
    const user = userEvent.setup();
    render(<PublicMessageBoard />);

    expect(screen.getByText(/Marketing & Product Forum/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All Discussions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Asks/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Discoveries/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New post/i })).not.toBeInTheDocument();

    // Filter modal opens status options
    const filterBtn = screen.getByRole("button", { name: /Open filter modal/i });
    await user.click(filterBtn);
    expect(screen.getByRole("button", { name: /All Statuses/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Only/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Resolved$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Verified Only/i })).toBeInTheDocument();
  });

  it("filters messages by Resolved status via filter modal and opens read-only post detail on card click", async () => {
    const user = userEvent.setup();
    render(<PublicMessageBoard />);

    const filterBtn = screen.getByRole("button", { name: /Open filter modal/i });
    await user.click(filterBtn);

    const resolvedOption = screen.getByRole("button", { name: /^Resolved$/i });
    await user.click(resolvedOption);

    expect(
      screen.getByText(/Headline A\/B test copy generation for self-serve onboarding conversion/i)
    ).toBeInTheDocument();

    // Click the compact card to open detail view
    await user.click(
      screen.getByText(/Headline A\/B test copy generation for self-serve onboarding conversion/i)
    );
    expect(screen.getByRole("button", { name: /Back to discussions/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Answers|Replies/i })).toBeInTheDocument();
    // RichText renders Markdown headings from activePost.content as heading elements
    expect(screen.getByRole("heading", { name: /Context/i })).toBeInTheDocument();
    // Detail view is read-only for humans: reply composer and reply button are hidden
    expect(screen.queryByRole("button", { name: /Add Reply \/ Comment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Write$/i })).not.toBeInTheDocument();

    // Upvoting is nullified for humans
    const voteBadge = screen.getByLabelText(/Helpful votes: 12/i);
    await user.click(voteBadge);
    expect(screen.getByLabelText(/Helpful votes: 12/i)).toBeInTheDocument();
  });

  it("renders new post composer without Why Context when initialView='new' is provided", () => {
    render(<PublicMessageBoard initialView="new" />);

    expect(screen.getByText(/Create New Forum Post/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Brief summary of request or announcement/i)).toBeInTheDocument();
    expect(screen.queryByText(/Why Context/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Write$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Preview$/i })).toBeInTheDocument();
  });

  it("renders directly in detail view when initialView='detail' is provided", async () => {
    render(<PublicMessageBoard initialView="detail" initialPostId="fm-1" />);

    expect(screen.getByRole("button", { name: /Back to discussions/i })).toBeInTheDocument();
    expect(
      screen.getByText(/SEO title tag & meta description overhaul for landing page/i)
    ).toBeInTheDocument();
  });

  it("renders with custom scope and organisation list", async () => {
    const mockOrgs = [
      {
        id: "cyberdyne",
        name: "Cyberdyne Systems",
        slug: "cyberdyne",
        projects: [{ id: "skynet", name: "Skynet Core", slug: "skynet" }],
      },
    ];

    render(
      <PublicMessageBoard
        scope="org"
        orgSlug="cyberdyne"
        orgName="Cyberdyne Systems"
        organisations={mockOrgs}
      />
    );

    expect(screen.getAllByText(/Cyberdyne Systems/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders external projects and handles external project selection", async () => {
    const mockExternal = [
      {
        id: "proj-ext",
        name: "Security Mesh",
        slug: "security-mesh",
        organisationId: "shield-org",
        organisationName: "Shield Corp",
        organisationSlug: "shield-corp",
      },
    ];

    render(<PublicMessageBoard externalProjects={mockExternal} />);

    expect(screen.getByText("Security Mesh")).toBeInTheDocument();
    expect(screen.getByText("Shield Corp")).toBeInTheDocument();
  });

  it("renders read-only empty state when initialMessages is empty without start discussion button", () => {
    render(<PublicMessageBoard initialMessages={[]} />);

    expect(screen.getByText(/No discussions yet in/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start a discussion/i })).not.toBeInTheDocument();
  });

  it("renders filtered empty state when search returns no results and resets filters", async () => {
    const user = userEvent.setup();
    render(<PublicMessageBoard />);

    const searchInput = screen.getByPlaceholderText(/Search forum/i);
    await user.type(searchInput, "nonexistent-query-xyz");

    expect(screen.getByText(/No discussions match your filters/i)).toBeInTheDocument();
    const resetBtn = screen.getByRole("button", { name: /Reset all filters/i });
    expect(resetBtn).toBeInTheDocument();

    await user.click(resetBtn);
    expect(screen.queryByText(/No discussions match your filters/i)).not.toBeInTheDocument();
  });

  it("renders discussion not found state when initialView='detail' and post does not exist", () => {
    render(<PublicMessageBoard initialView="detail" initialPostId="does-not-exist" initialMessages={[]} />);

    expect(screen.getByText(/Discussion not found/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Return to discussions list/i })).toBeInTheDocument();
  });
});
