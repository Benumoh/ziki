import { beforeEach, describe, expect, it, vi } from "vitest";
import { howToFixFor, saveCodeFindings } from "./code-findings";
import type { PreviewFinding, PreviewResult } from "./preview";

const now = new Date("2026-11-18T09:00:00Z");

const tx = {
  securityCheck: { findUnique: vi.fn(), update: vi.fn() },
  securityCheckItem: { findMany: vi.fn(), create: vi.fn() },
  securityCheckResult: { findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
};
const db = { $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) };

const csp: PreviewFinding = { id: "missing-csp", severity: "medium", area: "headers", title: "No Content Security Policy", detail: "No CSP header." };
const tls: PreviewFinding = { id: "old-tls-accepted", severity: "low", area: "certificate", title: "The site still accepts old versions of TLS", detail: "TLS 1.0." };
const result = (findings: PreviewFinding[], checked: PreviewFinding["area"][] = ["https", "certificate", "headers", "cookies"]): Extract<PreviewResult, { ok: true }> => ({
  ok: true, kind: "website", target: "settle.ng", checkedAt: now.toISOString(), checked, counts: { critical: 0, high: 0, medium: 0, low: 0 }, findings,
});

beforeEach(() => {
  vi.clearAllMocks();
  tx.securityCheck.findUnique.mockResolvedValue({ organisationId: "o1", requestedById: "u1", targetId: "t1", previousCheckId: null, status: "checking" });
  tx.securityCheckItem.findMany.mockResolvedValue([]);
  let part = 0;
  tx.securityCheckItem.create.mockImplementation(async () => ({ id: `auto${++part}` }));
  tx.securityCheckResult.findMany.mockResolvedValue([]);
});

describe("Ziki's code checks join the scan's main list (18 Nov)", () => {
  it("saves each finding as a real, priced finding with how to fix it, under a done automatic part per area", async () => {
    await expect(saveCodeFindings(db as never, "c1", result([csp, tls]), now)).resolves.toEqual({ added: 2, stillThere: 0, fixed: 0 });
    expect(tx.securityCheckItem.create.mock.calls.map(([call]) => [call.data.kind, call.data.title, call.data.status])).toEqual([
      ["automatic", "Automatic check: Security headers", "done"],
      ["automatic", "Automatic check: Certificate", "done"],
    ]);
    expect(tx.securityCheckResult.create.mock.calls[0]![0].data).toEqual({
      checkId: "c1", itemId: "auto1", severity: "medium", title: csp.title, description: csp.detail, howToFix: howToFixFor(csp), priceCoins: expect.any(Number),
    });
    expect(howToFixFor(csp)).toContain("Content-Security-Policy");
  });

  it("keeps the quick scan's fingerprint of the site on the check, for the next rescan to compare (18 Nov)", async () => {
    await saveCodeFindings(db as never, "c1", { ...result([]), fingerprint: { certificate: "c1", headers: "h1" } }, now);
    expect(tx.securityCheck.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { siteFingerprint: { certificate: "c1", headers: "h1" } } });
  });

  it("doesn't add a finding twice when the same check's quick scan runs again", async () => {
    tx.securityCheckItem.findMany.mockResolvedValue([{ id: "auto1", title: "Automatic check: Security headers" }]);
    tx.securityCheckResult.findMany.mockResolvedValueOnce([{ title: "no content security policy." }]);
    await expect(saveCodeFindings(db as never, "c1", result([csp, tls]), now)).resolves.toEqual({ added: 1, stillThere: 0, fixed: 0 });
    expect(tx.securityCheckResult.create.mock.calls.map(([call]) => call.data.title)).toEqual([tls.title]);
  });

  it("on a rescan, code rechecks its own earlier findings and adds only what's new", async () => {
    tx.securityCheck.findUnique.mockResolvedValue({ organisationId: "o1", requestedById: "u1", targetId: "t1", previousCheckId: "c0", status: "checking" });
    tx.securityCheckResult.findMany
      .mockResolvedValueOnce([]) // this check holds no code findings yet
      .mockResolvedValueOnce([
        { id: "e1", title: csp.title, item: { title: "Automatic check: Security headers" }, finding: null }, // still seen
        { id: "e2", title: "Cookies can be sent without HTTPS", item: { title: "Automatic check: Cookies" }, finding: null }, // gone from a checked area
        { id: "e3", title: "No DMARC policy for the domain's email", item: { title: "Automatic check: Email settings" }, finding: null }, // area not checked this time
        { id: "e4", title: "Browsers may guess file types", item: { title: "Automatic check: Security headers" }, finding: { bug: { status: "in_progress", isDeleted: false }, idea: null } }, // being fixed
      ]);
    const nosniff: PreviewFinding = { id: "missing-nosniff", severity: "low", area: "headers", title: "Browsers may guess file types", detail: "No nosniff." };

    await expect(saveCodeFindings(db as never, "c1", result([csp, tls, nosniff]), now)).resolves.toEqual({ added: 1, stillThere: 1, fixed: 1 });

    // Only this person's open code findings on earlier scans of the site.
    expect(tx.securityCheckResult.findMany.mock.calls[1]![0].where).toMatchObject({
      checkId: { not: "c1" }, check: { organisationId: "o1", requestedById: "u1", targetId: "t1" }, item: { kind: "automatic" },
      OR: [{ recheckState: null }, { recheckState: "still_there" }],
    });
    expect(tx.securityCheckResult.update.mock.calls.map(([call]) => [call.where.id, call.data.recheckState, call.data.recheckCheckId])).toEqual([
      ["e1", "still_there", "c1"],
      ["e2", "fixed", "c1"],
    ]);
    // Neither the earlier still-there one nor the one being fixed is filed again; only the new TLS one is added.
    expect(tx.securityCheckResult.create.mock.calls.map(([call]) => call.data.title)).toEqual([tls.title]);
  });

  it("does nothing for a removed scan", async () => {
    tx.securityCheck.findUnique.mockResolvedValue({ organisationId: "o1", requestedById: "u1", targetId: "t1", previousCheckId: null, status: "cancelled" });
    await expect(saveCodeFindings(db as never, "c1", result([csp]), now)).resolves.toEqual({ added: 0, stillThere: 0, fixed: 0 });
    expect(tx.securityCheckResult.create).not.toHaveBeenCalled();
  });
});
