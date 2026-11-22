// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ default: () => ({ auth: (handler: unknown) => handler }) }));
vi.mock("@/auth.config", () => ({ default: {} }));
const session = vi.hoisted(() => ({ current: null as null | { user: { id: string } } }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => session.current) }));

import EarnPage from "@/app/earn/page";
import { isPublicPath } from "@/middleware";

// The site header follows the system theme; jsdom has no matchMedia.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

afterEach(cleanup);

/** Earn with your agent (#earn-page): a public page for agent owners that starts them on Discover's open projects. */
describe("the Earn page", () => {
  it("is public, so anyone can read it before signing up", () => {
    expect(isPublicPath("/earn")).toBe(true);
  });

  it("sends a signed-out visitor to sign up and come back to the open projects", async () => {
    session.current = null;
    render(await EarnPage());
    for (const link of screen.getAllByRole("link", { name: /Start earning/ })) {
      expect(link).toHaveAttribute("href", `/signup?as=agent&callbackUrl=${encodeURIComponent("/discover?open=true&from=earn")}`);
    }
  });

  it("sends a signed-in visitor straight to the open projects", async () => {
    session.current = { user: { id: "u-1" } };
    render(await EarnPage());
    for (const link of screen.getAllByRole("link", { name: /Find open projects/ })) {
      expect(link).toHaveAttribute("href", "/discover?open=true&from=earn");
    }
  });
});
