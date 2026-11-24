import { describe, expect, it } from "vitest";
import { previewRisk, previewRows, quickScanForAgents, summarisePreview } from "./preview-summary";

describe("summarisePreview (#security-checks)", () => {
  const result = {
    ok: true as const,
    kind: "website" as const,
    target: "settle.ng",
    checkedAt: "2026-11-13T10:00:00.000Z",
    checked: ["email", "https", "headers"] as ("email" | "https" | "headers")[],
    counts: { critical: 0, high: 1, medium: 2, low: 0 },
    findings: [
      { id: "a", severity: "high" as const, area: "headers" as const, title: "No HSTS header", detail: "HIDDEN-DETAIL-1" },
      { id: "b", severity: "medium" as const, area: "headers" as const, title: "No Content Security Policy", detail: "HIDDEN-DETAIL-2" },
      { id: "c", severity: "medium" as const, area: "email" as const, title: "No DMARC record", detail: "HIDDEN-DETAIL-3" },
    ],
  };

  it("keeps counts and areas in a fixed order, lists each problem worst first by its title, and drops every detail", () => {
    const summary = summarisePreview(result);
    expect(summary).toMatchObject({ target: "settle.ng", total: 3, risk: "high" });
    expect(summary.areas).toEqual([
      { area: "https", label: "HTTPS", problems: 0 },
      { area: "headers", label: "Security headers", problems: 2 },
      { area: "email", label: "Email settings", problems: 1 },
    ]);
    expect(summary.rows).toEqual([
      { severity: "high", area: "headers", price: 300, label: "Security headers", title: "No HSTS header" },
      { severity: "medium", area: "headers", price: 200, label: "Security headers", title: "No Content Security Policy" },
      { severity: "medium", area: "email", price: 200, label: "Email settings", title: "No DMARC record" },
    ]);
    expect(JSON.stringify(summary)).not.toMatch(/HIDDEN-/);
  });

  it("lists a repo's areas in a fixed order after the website ones", () => {
    const summary = summarisePreview({
      ok: true,
      kind: "repo",
      target: "settle/app",
      checkedAt: "2026-11-13T10:00:00.000Z",
      checked: ["updates", "secrets", "policy"],
      counts: { critical: 0, high: 1, medium: 0, low: 1 },
      findings: [
        { id: "a", severity: "high", area: "secrets", title: "A file that usually holds secrets", detail: "HIDDEN-DETAIL" },
        { id: "b", severity: "low", area: "policy", title: "No security policy", detail: "HIDDEN-DETAIL" },
      ],
    });
    expect(summary).toMatchObject({ kind: "repo", target: "settle/app", total: 2, risk: "high" });
    expect(summary.areas).toEqual([
      { area: "secrets", label: "Secrets in files", problems: 1 },
      { area: "policy", label: "Security policy", problems: 1 },
      { area: "updates", label: "Dependency updates", problems: 0 },
    ]);
    expect(JSON.stringify(summary)).not.toMatch(/HIDDEN-/);
  });

  it("takes the risk from the worst severity found", () => {
    expect(previewRisk({ critical: 1, high: 0, medium: 0, low: 0 })).toBe("critical");
    expect(previewRisk({ critical: 0, high: 0, medium: 0, low: 2 })).toBe("low");
    expect(previewRisk({ critical: 0, high: 0, medium: 0, low: 0 })).toBe("minimal");
  });
});

describe("quick-scan findings as locked rows (14 Nov plan, D3)", () => {
  const findings = [
    { id: "cookie-no-samesite", severity: "low" as const, area: "cookies" as const, title: "Cookies don't say when other sites may send them", detail: "SECRET-DETAIL-LOW" },
    { id: "missing-hsts", severity: "high" as const, area: "headers" as const, title: "Browsers aren't told to always use HTTPS", detail: "SECRET-DETAIL-HIGH" },
    { id: "missing-dmarc", severity: "medium" as const, area: "email" as const, title: "Anyone can send email that claims to be from this domain", detail: "SECRET-DETAIL-MEDIUM" },
    { id: "certificate-expired", severity: "critical" as const, area: "certificate" as const, title: "The HTTPS certificate has expired", detail: "SECRET-DETAIL-CRITICAL" },
  ];

  it("lists every finding worst first with its area and price (critical 500, high 300, medium 200, low 100 Ziks)", () => {
    expect(previewRows(findings)).toEqual([
      { severity: "critical", area: "certificate", price: 500 },
      { severity: "high", area: "headers", price: 300 },
      { severity: "medium", area: "email", price: 200 },
      { severity: "low", area: "cookies", price: 100 },
    ]);
  });

  it("puts the rows in the summary the page gets, labelled with their short title, with no detail or finding id", () => {
    const summary = summarisePreview({
      ok: true,
      kind: "website",
      target: "settle.ng",
      checkedAt: "2026-11-14T10:00:00.000Z",
      checked: ["https", "certificate", "headers", "cookies", "email"],
      counts: { critical: 1, high: 1, medium: 1, low: 1 },
      findings,
    });
    expect(summary.rows).toEqual([
      { severity: "critical", area: "certificate", label: "Certificate", price: 500, title: "The HTTPS certificate has expired" },
      { severity: "high", area: "headers", label: "Security headers", price: 300, title: "Browsers aren't told to always use HTTPS" },
      { severity: "medium", area: "email", label: "Email settings", price: 200, title: "Anyone can send email that claims to be from this domain" },
      { severity: "low", area: "cookies", label: "Cookies", price: 100, title: "Cookies don't say when other sites may send them" },
    ]);
    const sent = JSON.stringify(summary);
    expect(sent).not.toMatch(/SECRET-/);
    // A finding's id names the problem ("missing-hsts"), so it never leaves the server either.
    for (const finding of findings) expect(sent).not.toContain(finding.id);
  });

  it("gives no rows when nothing was found", () => {
    expect(previewRows([])).toEqual([]);
  });
});

describe("what the quick scan tells the agents checking the same site (15 Nov call)", () => {
  const saved = {
    rows: [
      { severity: "medium", area: "headers", price: 2, label: "Security headers", title: "No HSTS" },
      { severity: "low", area: "cookies", price: 1, label: "Cookies", title: "  Cookie has no SameSite  " },
      { severity: "high", area: "https", price: 3, label: "HTTPS" },
      { severity: "urgent", area: "email", price: 1, label: "Email settings", title: "Not a real severity" },
    ],
  };

  it("passes on only the short titles with their severity and area, skipping rows without a title or with an unknown severity", () => {
    expect(quickScanForAgents(saved)).toEqual([
      { severity: "medium", area: "Security headers", title: "No HSTS" },
      { severity: "low", area: "Cookies", title: "Cookie has no SameSite" },
    ]);
  });

  it("gives nothing for an old scan without rows, or anything that isn't a saved scan", () => {
    expect(quickScanForAgents({ total: 3 })).toEqual([]);
    expect(quickScanForAgents(null)).toEqual([]);
    expect(quickScanForAgents("x")).toEqual([]);
  });

  it("never passes on more than the cap", () => {
    const many = { rows: Array.from({ length: 40 }, (_, i) => ({ severity: "low", label: "Cookies", title: "Finding " + i })) };
    expect(quickScanForAgents(many)).toHaveLength(20);
    expect(quickScanForAgents(many, 5)).toHaveLength(5);
  });
});
