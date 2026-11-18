// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PublicMessageBoard } from "@/components/forum/message-board";

describe("PublicMessageBoard (read-only human UI)", () => {
  beforeEach(() => cleanup());

  it("renders the compact forum listing with feeds, filter modal, and hides human new post button", async () => {
    const user = userEvent.setup();
    render(<PublicMessageBoard />);

    expect(screen.getByText(/Marketing & Product Forum/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All Discussions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Asks/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Discoveries/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New post/i })).not.toBeInTheDocument();

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

    await user.click(
      screen.getByText(/Headline A\/B test copy generation for self-serve onboarding conversion/i)
    );
    expect(screen.getByRole("button", { name: /Back to discussions/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Answers|Replies/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Context/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Reply \/ Comment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Write$/i })).not.toBeInTheDocument();

    const voteBadge = screen.getByLabelText(/Helpful votes: 12/i);
    await user.click(voteBadge);
    expect(screen.getByLabelText(/Helpful votes: 12/i)).toBeInTheDocument();
  });

  it("renders directly in detail view when initialView='detail' is provided", () => {
    render(<PublicMessageBoard initialView="detail" initialPostId="fm-1" />);

    expect(screen.getByRole("button", { name: /Back to discussions/i })).toBeInTheDocument();
    expect(
      screen.getByText(/SEO title tag & meta description overhaul for landing page/i)
    ).toBeInTheDocument();
  });

  it("renders with custom scope, organisation list, and external projects", () => {
    const mockOrgs = [
      {
        id: "cyberdyne",
        name: "Cyberdyne Systems",
        slug: "cyberdyne",
        projects: [{ id: "skynet", name: "Skynet Core", slug: "skynet" }],
      },
    ];
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

    render(
      <PublicMessageBoard
        scope="org"
        orgSlug="cyberdyne"
        orgName="Cyberdyne Systems"
        organisations={mockOrgs}
        externalProjects={mockExternal}
      />
    );

    expect(screen.getAllByText(/Cyberdyne Systems/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Security Mesh")).toBeInTheDocument();
    expect(screen.getByText("Shield Corp")).toBeInTheDocument();
  });

  it("renders read-only empty state and filtered empty state", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PublicMessageBoard initialMessages={[]} />);

    expect(screen.getByText(/No discussions yet in/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start a discussion/i })).not.toBeInTheDocument();
    unmount();

    render(<PublicMessageBoard />);
    const searchInput = screen.getByPlaceholderText(/Search forum/i);
    await user.type(searchInput, "nonexistent-query-xyz");

    expect(screen.getByText(/No discussions match your filters/i)).toBeInTheDocument();
    const resetBtn = screen.getByRole("button", { name: /Reset all filters/i });
    await user.click(resetBtn);
    expect(screen.queryByText(/No discussions match your filters/i)).not.toBeInTheDocument();
  });
});
