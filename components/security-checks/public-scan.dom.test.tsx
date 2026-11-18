// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runPublicScan } from "@/app/actions/security-preview";
import { PublicScan, SCAN_RESULT_SLOT } from "./public-scan";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/actions/security-preview", () => ({ runPublicScan: vi.fn() }));

const summary = {
  kind: "website" as const,
  target: "settle.ng",
  checkedAt: "2026-11-15T12:00:00.000Z",
  total: 1,
  counts: { critical: 0, high: 0, medium: 1, low: 0 },
  risk: "medium" as const,
  areas: [{ area: "headers" as const, label: "Headers", problems: 1 }],
  rows: [{ severity: "medium" as const, area: "headers" as const, price: 2, label: "Headers", title: "No HSTS" }],
};

beforeEach(() => {
  // The page gives the scan's result its own place to open; the box fills it.
  const slot = document.createElement("div");
  slot.id = SCAN_RESULT_SLOT;
  document.body.appendChild(slot);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(runPublicScan).mockResolvedValue({ ok: true, summary } as never);
});

afterEach(() => {
  cleanup();
  document.getElementById(SCAN_RESULT_SLOT)?.remove();
  vi.useRealTimers();
  vi.resetAllMocks();
  push.mockReset();
});

async function scanSite(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Your URL"), "settle.ng");
  await user.keyboard("{Enter}");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
}

it("signed in, Try now goes on to the scan's progress page (asking which workspace first if there's more than one)", async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<PublicScan signedIn />);
  await scanSite(user);

  // The normal road: never added to whichever workspace happens to be open, unasked.
  const tryNow = await screen.findByRole("link", { name: "Try now" });
  expect(tryNow).toHaveAttribute("href", "/security?target=settle.ng&progress=1");
});

it("signed out, Try now takes the site through sign-up to that same Security page", async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<PublicScan signedIn={false} />);
  await scanSite(user);

  const signUp = await screen.findByRole("link", { name: "Try now" });
  expect(signUp).toHaveAttribute("href", `/signup?callbackUrl=${encodeURIComponent("/security?target=settle.ng&progress=1")}`);
});

it("gives the result its own address, so it can be shared", async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<PublicScan signedIn={false} />);
  await scanSite(user);

  expect(window.location.search).toBe("?site=settle.ng");
  window.history.replaceState(null, "", "/");
});

it("opening a shared address runs that scan again", async () => {
  window.history.replaceState(null, "", "/security-check?site=settle.ng");
  render(<PublicScan signedIn={false} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });

  expect(runPublicScan).toHaveBeenCalledWith("settle.ng");
  expect(await screen.findByRole("link", { name: "Try now" })).toBeInTheDocument();
  window.history.replaceState(null, "", "/");
});
