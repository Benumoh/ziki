// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoleAccessBadge } from "@/components/role-access-tooltip";
import { roleAccessFor } from "@/lib/role-access";

const access = roleAccessFor("member", "user")!;

function renderBadge(organisationName: string | null = "Zedu") {
  return render(
    <div>
      <RoleAccessBadge label="Member" access={access} organisationName={organisationName} requestHref="/zedu/desktop/org/team" />
      <button type="button">Elsewhere</button>
    </div>,
  );
}

const trigger = () => screen.getByRole("button", { name: /member: what this role can do/i });
const card = () => screen.queryByRole("region", { name: /your access as member/i });

afterEach(cleanup);

describe("RoleAccessBadge", () => {
  it("shows the role as a badge and keeps the card closed at rest", () => {
    renderBadge();
    expect(trigger().textContent).toContain("Member");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(card()).toBeNull();
  });

  it("opens on hover and lists what the member can and cannot do", async () => {
    const user = userEvent.setup();
    renderBadge();
    await user.hover(trigger());

    expect(card()).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Your role in Zedu")).toBeDefined();

    const can = screen.getByRole("list", { name: "You can" });
    expect(can.textContent).toContain("View ideas and verdicts");
    expect(can.textContent).toContain("Add and vote on ideas");
    expect(can.textContent).toContain("Create and manage your agents");

    const cannot = screen.getByRole("list", { name: "You can't" });
    expect(cannot.textContent).toContain("Approve ideas");
    expect(cannot.textContent).toContain("Change organisation settings");
    expect(cannot.textContent).toContain("Invite or remove members");
  });

  it("links to the place to ask for more access", async () => {
    const user = userEvent.setup();
    renderBadge();
    await user.hover(trigger());
    const link = screen.getByRole("link", { name: /request upgraded access/i });
    expect(link.getAttribute("href")).toBe("/zedu/desktop/org/team");
  });

  it("stays open while the pointer crosses from the badge onto the card", async () => {
    const user = userEvent.setup();
    renderBadge();
    await user.hover(trigger());
    // Off the badge into the gap, then onto the card: the close is delayed, and entering the card cancels it.
    await user.unhover(trigger());
    await user.hover(screen.getByRole("link", { name: /request upgraded access/i }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(card()).not.toBeNull();
  });

  it("closes a moment after the pointer leaves", async () => {
    const user = userEvent.setup();
    renderBadge();
    await user.hover(trigger());
    await user.unhover(trigger());
    await waitFor(() => expect(card()).toBeNull());
  });

  it("opens on keyboard focus and closes on Escape, returning focus to the badge", async () => {
    const user = userEvent.setup();
    renderBadge();
    await user.tab();
    expect(document.activeElement).toBe(trigger());
    expect(card()).not.toBeNull();

    await user.keyboard("{Escape}");
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("is reachable from the keyboard: Tab moves from the badge to the link", async () => {
    const user = userEvent.setup();
    renderBadge();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: /request upgraded access/i }));
    expect(card()).not.toBeNull();
  });

  it("closes when focus moves somewhere else", async () => {
    const user = userEvent.setup();
    renderBadge();
    await user.tab();
    await user.tab(); // the link
    await user.tab(); // out to "Elsewhere"
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Elsewhere" }));
    expect(card()).toBeNull();
  });

  it("opens on click, for touch screens that cannot hover, and a second click keeps it open", async () => {
    const user = userEvent.setup();
    renderBadge();
    await user.click(trigger());
    expect(card()).not.toBeNull();
    await user.click(trigger());
    expect(card()).not.toBeNull();
  });

  it("says just 'Your role' when the organisation's name is not known", async () => {
    const user = userEvent.setup();
    renderBadge(null);
    await user.hover(trigger());
    expect(screen.getByText("Your role")).toBeDefined();
  });
});
