import { describe, expect, it } from "vitest";

import { securityReturnPath } from "@/lib/security-return-path";
import { buyZiksHref, safeReturnTo } from "@/lib/coins/return-to";
import { codeScanPage } from "@/lib/security-checks/code-scan-page";

describe("after creating a first workspace from Security (#security-checks)", () => {
  it("goes back to Security with the scanned site", () => {
    expect(securityReturnPath("/security?target=yourshop.com")).toBe("/security?target=yourshop.com");
    expect(securityReturnPath("/security")).toBe("/security");
  });

  it("goes nowhere else: other pages, other sites and tricks fall back to home", () => {
    for (const next of ["/settings", "/securityx", "https://evil.example/security", "//evil.example/security", "/login?callbackUrl=/security", null, undefined, ""]) {
      expect(securityReturnPath(next)).toBeNull();
    }
  });
});

describe("back to the scan after buying Ziks (#deeper-scan-gate)", () => {
  it("only ever returns to a security check's own page on this site", () => {
    expect(safeReturnTo("/security/checks/cmabc123")).toBe("/security/checks/cmabc123");
    expect(safeReturnTo("/security/checks/cmabc123/deeper")).toBe("/security/checks/cmabc123/deeper");
    for (const next of ["/security", "/security/checks/a/b", "/security/checks/a/deeper/x", "/coins", "https://evil.example/security/checks/x", "//evil.example/security/checks/x", "/security/checks/x?pay=1", null, undefined, ""]) {
      expect(safeReturnTo(next)).toBeNull();
    }
  });

  it("the Buy Ziks link carries the scan it came from", () => {
    expect(buyZiksHref("cmabc123")).toBe("/coins?returnTo=%2Fsecurity%2Fchecks%2Fcmabc123%2Fdeeper");
  });
});

describe("a code scan's pages send you to its website's Code scan page (18 Nov call)", () => {
  it("keeps a finding's Fix it for me and the return from buying Ziks, and nothing else", () => {
    expect(codeScanPage("site1")).toBe("/security/checks/site1/code");
    expect(codeScanPage("site1", { fix: ["r1", "r2"] })).toBe("/security/checks/site1/code?fix=r1%2Cr2");
    expect(codeScanPage("site1", { bought: "1" })).toBe("/security/checks/site1/code?bought=1");
    expect(codeScanPage("site1", { bought: "yes" })).toBe("/security/checks/site1/code");
  });
});
