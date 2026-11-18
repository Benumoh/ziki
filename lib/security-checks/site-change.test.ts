import { describe, expect, it } from "vitest";
import { siteChangeBetween, siteChangeSentence } from "./site-change";

describe("did the site change since the last scan? (18 Nov)", () => {
  const before = { certificate: "c1", headers: "h1", cookies: "k1", email: "e1" };

  it("names what changed among the parts both scans saw", () => {
    expect(siteChangeBetween(before, { ...before, certificate: "c2", headers: "h2" })).toEqual({ changed: ["a new certificate", "different security headers"] });
    expect(siteChangeSentence({ changed: ["a new certificate", "different security headers"] })).toBe(
      "This site changed since the last scan (a new certificate and different security headers).",
    );
  });

  it("says the site looks the same when nothing it saw both times changed", () => {
    const same = siteChangeBetween(before, { ...before, files: "f1" });
    expect(same).toEqual({ changed: [] });
    expect(siteChangeSentence(same!)).toBe("The site looks the same as at the last scan, so this was missed then.");
  });

  it("claims nothing when a part wasn't seen this time, or either scan has no fingerprint", () => {
    // Email couldn't be read this time: not a change.
    expect(siteChangeBetween(before, { certificate: "c1", headers: "h1", cookies: "k1" })).toEqual({ changed: [] });
    expect(siteChangeBetween(null, before)).toBeNull();
    expect(siteChangeBetween(before, "not a fingerprint")).toBeNull();
    expect(siteChangeBetween({ repo: "r1" }, { certificate: "c1" })).toBeNull();
  });
});
