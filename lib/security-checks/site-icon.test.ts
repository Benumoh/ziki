import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { declaredIcons } = await import("./site-icon");

describe("declaredIcons (#security-checks)", () => {
  const base = new URL("https://hotels.ng/");

  it("finds the icon a site declares in its page, as hotels.ng does (its /favicon.ico is empty)", () => {
    const html = '<head><link rel="shortcut icon" href="https://hotels.ng/img/hotelsng/favicon.png"></head>';
    expect(declaredIcons(html, base).map(String)).toEqual(["https://hotels.ng/img/hotelsng/favicon.png"]);
  });

  it("resolves a relative icon against the page and puts rel=icon before apple-touch-icon", () => {
    const html = '<link rel="apple-touch-icon" href="/apple.png"><link href="/fav.svg" rel="icon" type="image/svg+xml">';
    expect(declaredIcons(html, base).map(String)).toEqual(["https://hotels.ng/fav.svg", "https://hotels.ng/apple.png"]);
  });

  it("ignores links that aren't icons and addresses that aren't http or https", () => {
    const html = '<link rel="stylesheet" href="/a.css"><link rel="icon" href="javascript:alert(1)"><link rel="icon" href="data:image/png;base64,AAAA">';
    expect(declaredIcons(html, base)).toEqual([]);
  });
});
