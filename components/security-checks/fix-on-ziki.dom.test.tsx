// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { fixSecurityCheck, loadSecurityCheckFixOptions } from "@/app/actions/security-check-fix";
import { FixOnZiki } from "./fix-on-ziki";

vi.mock("@/app/actions/ziks-loan", () => ({ borrowZiks: vi.fn() }));
vi.mock("@/app/actions/security-check-fix", () => ({
  fixSecurityCheck: vi.fn(),
  loadSecurityCheckFixOptions: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("sends only the selected finding IDs to the chosen project and shows the issue link", async () => {
  vi.mocked(loadSecurityCheckFixOptions).mockResolvedValue({
    projectId: null, projects: [{ id: "p1", name: "Web" }, { id: "p2", name: "Desktop" }],
  });
  vi.mocked(fixSecurityCheck).mockResolvedValue({
    ok: true, created: 1, reused: 0, coins: 0, issues: [{ resultId: "r1", number: 42, href: "/ziki/web/42" }],
  });
  const user = userEvent.setup();
  render(<FixOnZiki checkId="c1" results={[
    { id: "r1", severity: "high", title: "First finding" },
    { id: "r2", severity: "low", title: "Second finding" },
  ]} />);
  const project = await screen.findByRole("combobox", { name: "Destination project" });
  const send = screen.getByRole("button", { name: "Move to your app" });
  expect(send).toBeDisabled();
  await user.selectOptions(project, "p1");
  expect(send).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: "High First finding" }));
  await user.click(send);

  expect((await screen.findAllByRole("link", { name: "Issue #42" }))[0]).toHaveAttribute("href", "/ziki/web/42");
  expect(fixSecurityCheck).toHaveBeenCalledWith({ checkId: "c1", projectId: "p1", resultIds: ["r1"] });
  expect(project).toBeDisabled();
});

it("selects and clears all available findings without including moved ones", async () => {
  vi.mocked(loadSecurityCheckFixOptions).mockResolvedValue({
    projectId: "p1", projects: [{ id: "p1", name: "Web" }],
  });
  const user = userEvent.setup();
  render(<FixOnZiki standalone checkId="c1" results={[
    { id: "r1", severity: "high", title: "First finding", price: 3 },
    { id: "r2", severity: "low", title: "Second finding", price: 1 },
    { id: "r3", severity: "low", title: "Moved finding", moved: true, price: 1 },
  ]} />);

  await user.click(await screen.findByRole("button", { name: "Select all" }));
  expect(screen.getByRole("checkbox", { name: "High First finding" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Low Second finding" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Low Moved finding" })).not.toBeChecked();
  expect(screen.getByText("4 Ziks")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(screen.getByRole("button", { name: "Pay and move" })).toBeDisabled();
  expect(fixSecurityCheck).not.toHaveBeenCalled();
});
