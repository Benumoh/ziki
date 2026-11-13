import { describe, expect, it } from "vitest";
import { previewRisk, summarisePreview } from "./preview-summary";

describe("summarisePreview (#security-checks)", () => {
  const result = {
    ok: true as const,
    kind: "website" as const,
    target: "settle.ng",
    checkedAt: "2026-11-13T10:00:00.000Z",
    checked: ["email", "https", "headers"] as ("email" | "https" | "headers")[],
    counts: { critical: 0, high: 1, medium: 2, low: 0 },
    findings: [
      { id: "a", severity: "high" as const, area: "headers" as const, title: "HIDDEN-TITLE-1", detail: "HIDDEN-DETAIL-1" },
      { id: "b", severity: "medium" as const, area: "headers" as const, title: "HIDDEN-TITLE-2", detail: "HIDDEN-DETAIL-2" },
      { id: "c", severity: "medium" as const, area: "email" as const, title: "HIDDEN-TITLE-3", detail: "HIDDEN-DETAIL-3" },
    ],
  };

  it("keeps counts and areas in a fixed order, and drops every title and detail", () => {
    const summary = summarisePreview(result);
    expect(summary).toMatchObject({ target: "settle.ng", total: 3, risk: "high" });
    expect(summary.areas).toEqual([
      { area: "https", label: "HTTPS", problems: 0 },
      { area: "headers", label: "Security headers", problems: 2 },
      { area: "email", label: "Email settings", problems: 1 },
    ]);
    expect(JSON.stringify(summary)).not.toMatch(/HIDDEN-/);
  });

  it("takes the risk from the worst severity found", () => {
    expect(previewRisk({ critical: 1, high: 0, medium: 0, low: 0 })).toBe("critical");
    expect(previewRisk({ critical: 0, high: 0, medium: 0, low: 2 })).toBe("low");
    expect(previewRisk({ critical: 0, high: 0, medium: 0, low: 0 })).toBe("minimal");
  });
});
