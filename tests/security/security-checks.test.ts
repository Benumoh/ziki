import { beforeEach, describe, expect, it, vi } from "vitest";
import { inflateSync } from "node:zlib";
import { Prisma } from "@prisma/client";

const db = vi.hoisted(() => ({
  securityCheck: { findFirst: vi.fn() },
  securityCheckResult: { findMany: vi.fn(), findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const session = vi.hoisted(() => ({ userId: "owner", organisationId: "org1" }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: async () => ({ id: session.userId, role: "user" }) }));
vi.mock("@/lib/organisation-access", () => ({
  currentOrganisationAccess: async () => ({ organisationId: session.organisationId, admin: false }),
}));
const renderReportPdf = vi.hoisted(() => vi.fn());
vi.mock("@/components/security-checks/report-pdf", () => ({ renderReportPdf }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

import { fixOf, loadCheckReport } from "@/lib/security-checks/report";
import { GET as downloadReportPdf } from "@/app/(app)/security/checks/[id]/report.pdf/route";
import {
  CHECK_STATUS_LABEL,
  ITEM_STATUS_LABEL,
  SECURITY_CHECK_ITEM_KINDS,
  SECURITY_CHECK_ITEM_STATUSES,
  SECURITY_CHECK_PRICE_COINS,
  SECURITY_CHECK_STATUSES,
  SECURITY_TARGET_KINDS,
  TARGET_KIND_LABEL,
  FREE_SCANS_PER_TARGET,
  FREE_SCANS_PER_WORKSPACE_PER_MONTH,
  ON_CALL_INVITE_STATUSES,
  ON_CALL_QUIET_AFTER_MS,
  SEVERITY_PRICE,
  agentsMayWork,
  freeScanAllowed,
  freeScanMonthStart,
  isCheckPaid,
  isQuiet,
  isResultUnlocked,
  isSecurityCleared,
  unlockTotal,
  isReportPosted,
  isSecurityCheckItemStatus,
  isSecurityCheckStatus,
  isSecurityTargetKind,
} from "@/lib/security-checks";

/** Every compressed stream in a PDF, inflated (fonts' ToUnicode maps live in them). */
function inflatedStreams(pdf: Buffer): string[] {
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const start = pdf.indexOf("stream", at);
    if (start < 0) return out;
    const from = start + (pdf[start + 6] === 0x0d ? 8 : 7);
    const end = pdf.indexOf("endstream", from);
    if (end < 0) return out;
    try {
      out.push(inflateSync(pdf.subarray(from, end)).toString("latin1"));
    } catch {
      // not a compressed stream (the embedded font itself, for example)
    }
    at = end + 9;
  }
}

/** A ToUnicode target, UTF-16BE hex, as text. */
const hexToText = (hex: string) => Buffer.from(hex, "hex").swap16().toString("utf16le");

const enumValues =(name: string) =>
  Prisma.dmmf.datamodel.enums.find((e) => e.name === name)?.values.map((v) => v.name) ?? [];

describe("security check words (#security-checks)", () => {
  it("match the database enums exactly", () => {
    expect([...SECURITY_TARGET_KINDS].sort()).toEqual(enumValues("SecurityTargetKind").sort());
    expect([...SECURITY_CHECK_STATUSES].sort()).toEqual(enumValues("SecurityCheckStatus").sort());
    expect([...SECURITY_CHECK_ITEM_KINDS].sort()).toEqual(enumValues("SecurityCheckItemKind").sort());
    expect([...SECURITY_CHECK_ITEM_STATUSES].sort()).toEqual(enumValues("SecurityCheckItemStatus").sort());
  });

  it("label every value", () => {
    for (const kind of SECURITY_TARGET_KINDS) expect(TARGET_KIND_LABEL[kind]).toBeTruthy();
    for (const status of SECURITY_CHECK_STATUSES) expect(CHECK_STATUS_LABEL[status]).toBeTruthy();
    for (const status of SECURITY_CHECK_ITEM_STATUSES) expect(ITEM_STATUS_LABEL[status]).toBeTruthy();
  });

  it("guard unknown values", () => {
    expect(isSecurityTargetKind("repo")).toBe(true);
    expect(isSecurityTargetKind("domain")).toBe(false);
    expect(isSecurityCheckStatus("checking")).toBe(true);
    expect(isSecurityCheckStatus(1)).toBe(false);
    expect(isSecurityCheckItemStatus("done")).toBe(true);
    expect(isSecurityCheckItemStatus("finished")).toBe(false);
  });

  it("keep agents off a target until ownership is proven", () => {
    const verified = { verifiedAt: new Date() };
    expect(agentsMayWork({ status: "queued" }, { verifiedAt: null })).toBe(false);
    expect(agentsMayWork({ status: "awaiting_ownership" }, verified)).toBe(false);
    expect(agentsMayWork({ status: "queued" }, verified)).toBe(true);
    expect(agentsMayWork({ status: "checking" }, verified)).toBe(true);
    expect(agentsMayWork({ status: "done" }, verified)).toBe(false);
    expect(agentsMayWork({ status: "cancelled" }, verified)).toBe(false);
  });

  it("show results only once the collated report is posted", () => {
    expect(isReportPosted({ postedAt: null })).toBe(false);
    expect(isReportPosted({ postedAt: new Date() })).toBe(true);
  });

  it("unlock the report only once paid", () => {
    expect(isCheckPaid({ paidAt: null })).toBe(false);
    expect(isCheckPaid({ paidAt: new Date() })).toBe(true);
    expect(SECURITY_CHECK_PRICE_COINS).toBe(50);
  });
});

describe("what a client sees of a check (12 Nov plan, S1 and S2)", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 10, 12, 9, minutes));
  function check(postedAt: Date | null = at(9)) {
    return {
      id: "check1",
      status: postedAt ? "done" : "checking",
      free: true,
      postedAt,
      summary: "We checked 5 parts and found 3 problems, one of them critical. Unlock them to see the details and fixes.",
      createdAt: at(0),
      finishedAt: postedAt,
      startedAt: at(0),
      target: { id: "t1", kind: "website", value: "shop.example.test", input: "https://shop.example.test", verifiedAt: at(0) },
      items: [
        { id: "i1", title: "Login", status: "done", agentId: "a1" },
        { id: "i2", title: "TLS", status: "skipped", agentId: "a1" },
        { id: "i3", title: "Headers", status: postedAt ? "done" : "checking", agentId: "a2" },
        { id: "i4", title: "CORS", status: postedAt ? "done" : "waiting", agentId: null },
        { id: "i5", title: "Cookies", status: "done", agentId: "a2" },
      ],
    };
  }
  const PART_TITLE: Record<string, string> = { i1: "Login", i3: "Headers", i4: "CORS" };
  /** A result as the first (no text) query returns it. */
  const row = (id: string, severity: string, minute: number, opts: { unlocked?: boolean; itemId?: string; priceCoins?: number | null } = {}) => {
    const itemId = opts.itemId ?? "i1";
    return {
      id,
      itemId,
      severity,
      priceCoins: opts.priceCoins === undefined ? 9 : opts.priceCoins,
      unlockedAt: opts.unlocked ? at(20) : null,
      createdAt: at(minute),
      item: { title: PART_TITLE[itemId], agent: { id: "a1", name: "Atlas Agent", avatar: null } },
    };
  };
  /** An unlocked result's text, as the second query returns it. */
  const text = (id: string) => ({ id, title: `${id} title`, description: `${id} description`, howToFix: `${id} fix`, finding: null });
  /** The results table: the first query gets every row, the text query only what it asks for. */
  function results(rows: ReturnType<typeof row>[]) {
    db.securityCheckResult.findMany.mockImplementation(async ({ where }: { where: { unlockedAt?: unknown } }) =>
      where.unlockedAt ? rows.filter((r) => r.unlockedAt).map((r) => text(r.id)) : rows,
    );
  }

  beforeEach(() => {
    db.securityCheck.findFirst.mockReset();
    db.securityCheckResult.findMany.mockReset();
    db.securityCheckResult.findUnique.mockReset();
    renderReportPdf.mockReset();
    session.userId = "owner";
  });

  it("is the requester's alone: another person, even in the same workspace, gets nothing", async () => {
    db.securityCheck.findFirst.mockResolvedValue(null);
    expect(await loadCheckReport("check1", "org1", "teammate")).toBeNull();
    expect(db.securityCheck.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "check1", organisationId: "org1", requestedById: "teammate" } }),
    );
    expect(db.securityCheckResult.findMany).not.toHaveBeenCalled();
  });

  it("before the report is posted: progress only, no result read at all; the PDF goes back to the check", async () => {
    db.securityCheck.findFirst.mockResolvedValue(check(null));

    const report = await loadCheckReport("check1", "org1", "owner");

    expect(db.securityCheckResult.findMany).not.toHaveBeenCalled();
    expect(report).toMatchObject({ posted: false });
    expect(report).not.toHaveProperty("findings");
    expect(report).not.toHaveProperty("summary");
    // A skipped part counts as finished (3 of 5).
    expect(report?.progress).toEqual({ done: 3, total: 5, percent: 60 });

    const params = { params: Promise.resolve({ id: "check1" }) };
    await expect(downloadReportPdf(new Request("http://localhost/x"), params)).rejects.toThrow(/^redirect:\/security\/checks\/check1$/);
    expect(renderReportPdf).not.toHaveBeenCalled();
  });

  it("posted: a locked finding's text is never read; only unlocked findings come with their details and fix", async () => {
    db.securityCheck.findFirst.mockResolvedValue(check());
    results([
      row("low", "low", 1, { itemId: "i4", priceCoins: null }),
      row("crit", "critical", 2, { priceCoins: 5 }),
      row("high", "high", 3, { itemId: "i3", unlocked: true, priceCoins: 3 }),
    ]);

    const report = await loadCheckReport("check1", "org1", "owner");

    // The query for every finding reads no text at all.
    const [first, second] = db.securityCheckResult.findMany.mock.calls.map((call) => call[0]);
    for (const key of ["title", "description", "howToFix", "finding"]) expect(first.select).not.toHaveProperty(key);
    // The text query asks the database for unlocked findings only.
    expect(second.where).toEqual({ checkId: "check1", unlockedAt: { not: null } });

    if (!report?.posted) throw new Error("expected a posted report");
    expect(report.findings.map((f) => [f.id, f.locked])).toEqual([
      ["crit", true],
      ["high", false],
      ["low", true],
    ]);
    const [crit, high, low] = report.findings;
    // Locked: severity, the part that found it and its price. Nothing else.
    expect(crit).toEqual({ id: "crit", locked: true, severity: "critical", area: "Login", priceCoins: 5, agent: { id: "a1", name: "Atlas Agent", avatar: null } });
    // A result reported before per-finding prices costs its severity's price.
    expect(low).toMatchObject({ locked: true, area: "CORS", priceCoins: SEVERITY_PRICE.low });
    expect(high).toMatchObject({ locked: false, title: "high title", description: "high description", howToFix: "high fix", area: "Headers" });
    // The summary is for everyone: Ziki writes it without any finding's details.
    expect(report.summary).toContain("Unlock them");
    expect(report.counts).toEqual({ critical: 1, high: 1, medium: 0, low: 1 });
    expect(report.clearParts).toEqual(["Cookies"]);
    expect(report.agentCount).toBe(2);
  });

  it("posted with nothing unlocked: the text is never even asked for", async () => {
    db.securityCheck.findFirst.mockResolvedValue(check());
    results([row("crit", "critical", 1), row("low", "low", 2)]);

    const report = await loadCheckReport("check1", "org1", "owner");

    expect(db.securityCheckResult.findMany).toHaveBeenCalledTimes(1);
    if (!report?.posted) throw new Error("expected a posted report");
    expect(report.findings.every((f) => f.locked && !("title" in f) && !("howToFix" in f))).toBe(true);
  });

  it("PDF: free once posted, made from the same vague report; a stranger gets 404", async () => {
    const params = { params: Promise.resolve({ id: "check1" }) };
    db.securityCheck.findFirst.mockResolvedValue(check());
    results([row("crit", "critical", 1)]);
    renderReportPdf.mockResolvedValue(Buffer.from("%PDF-1.3"));

    const response = await downloadReportPdf(new Request("http://localhost/x"), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    const [[printed]] = renderReportPdf.mock.calls;
    expect(printed.findings[0]).toEqual(expect.objectContaining({ locked: true, area: "Login" }));
    expect(printed.findings[0]).not.toHaveProperty("title");

    renderReportPdf.mockReset();
    session.userId = "stranger";
    db.securityCheck.findFirst.mockResolvedValue(null);
    expect((await downloadReportPdf(new Request("http://localhost/x"), params)).status).toBe(404);
    expect(renderReportPdf).not.toHaveBeenCalled();
  });

  it("PDF: prints ₦ and Yoruba in its own embedded font, not Helvetica", async () => {
    const { renderReportPdf: render } = await vi.importActual<typeof import("@/components/security-checks/report-pdf")>(
      "@/components/security-checks/report-pdf",
    );
    const yoruba = "Ọjọ́ àti ẹ̀ṣọ́";
    const agent = { id: "a1", name: "Atlas Agent", avatar: null };
    const report = {
      checkId: "check1",
      status: "done",
      free: true,
      createdAt: at(0),
      startedAt: at(0),
      finishedAt: at(9),
      posted: true,
      summary: "Refunds of ₦50,000 skip the owner check.",
      target: { id: "t1", kind: "website", value: "ọjà.example.test", input: "https://ọjà.example.test", verified: true },
      parts: [],
      progress: { done: 2, total: 2, percent: 100 },
      agentCount: 1,
      clearParts: [],
      counts: { critical: 1, high: 1, medium: 0, low: 0 },
      total: 2,
      findings: [
        { id: "crit", locked: false, severity: "critical", area: "Login", priceCoins: 5, agent, title: yoruba, description: "d", howToFix: "f", fix: null },
        { id: "high", locked: true, severity: "high", area: "Owó sísan", priceCoins: 3, agent },
      ],
    } as never;

    const pdf = await render(report);
    const raw = pdf.toString("latin1");
    expect(raw.startsWith("%PDF")).toBe(true);
    expect(raw).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans-Regular/);
    expect(raw).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans-Bold/);
    expect(raw).not.toContain("Helvetica");

    // The embedded fonts' ToUnicode maps list the characters drawn with a real
    // glyph: ₦, the Yoruba letters and their tone marks are among them. (A
    // dotted letter whose plain letter is already used, like ṣ beside "sísan",
    // is drawn as that letter plus the dot, so it isn't listed on its own.)
    const maps = inflatedStreams(pdf).filter((stream) => stream.includes("begincmap")).join("\n");
    const printed = new Set([...maps.matchAll(/<([0-9a-f]{4,})>/gi)].map((m) => hexToText(m[1])));
    for (const char of ["₦", "Ọ", "ọ", "à", "́", "̀"]) expect(printed, char).toContain(char);
  });

  it("a sent problem's fix follows its finding: Live is fixed, a deleted issue doesn't count, a rejected idea is closed", () => {
    const project = { slug: "web", organisation: { slug: "ziki" } };
    const finding = (bug: object | null, idea: object | null = null, verifications: object[] = []) =>
      fixOf({ id: "f1", project, bug, idea, verifications } as never);
    const bug = (status: string, substatus: string, isDeleted = false) => ({ number: 912, status, substatus, pullRequestUrl: null, isDeleted });

    expect(fixOf(null)).toBeNull();
    expect(finding(bug("in_progress", "in_progress"))).toMatchObject({
      bucket: "fixing", substatus: "in_progress", issue: { number: 912 }, findingHref: "/security/findings/f1",
    });
    expect(finding(bug("resolved", "on_prod"), null, [{ passed: true, reviewer: { name: "Hana" } }])).toMatchObject({
      bucket: "fixed", recheck: { passed: true, by: "Hana" },
    });
    // A deleted issue falls back to its idea's stage.
    expect(finding(bug("resolved", "on_prod", true), { status: "open", isDeleted: false })).toMatchObject({
      bucket: "fixing", issue: null, stageLabel: "Waiting for verdicts",
    });
    expect(finding(null, { status: "rejected", isDeleted: false })).toMatchObject({ bucket: "closed", stageLabel: "Rejected" });
  });
});

describe("the 12 Nov plan's rules (#security-checks, #on-call)", () => {
  it("prices a finding by severity, worst costs most", () => {
    expect(SEVERITY_PRICE).toEqual({ critical: 5, high: 3, medium: 2, low: 1 });
    expect(unlockTotal([
      { severity: "critical", priceCoins: 5 },
      { severity: "high", priceCoins: null },
      { severity: "low", priceCoins: 1 },
    ])).toBe(9);
    expect(unlockTotal([])).toBe(0);
  });

  it("shows a finding's details only once it is unlocked", () => {
    expect(isResultUnlocked({ unlockedAt: null })).toBe(false);
    expect(isResultUnlocked({ unlockedAt: new Date() })).toBe(true);
  });

  it("allows one free scan per target and a few per workspace a month", () => {
    expect(freeScanAllowed({ targetFreeScans: 0, workspaceFreeScansThisMonth: 0 })).toEqual({ allowed: true });
    expect(freeScanAllowed({ targetFreeScans: FREE_SCANS_PER_TARGET, workspaceFreeScansThisMonth: 0 })).toEqual({ allowed: false, reason: "target_used" });
    expect(freeScanAllowed({ targetFreeScans: 0, workspaceFreeScansThisMonth: FREE_SCANS_PER_WORKSPACE_PER_MONTH })).toEqual({ allowed: false, reason: "workspace_limit" });
    expect(freeScanMonthStart(new Date("2026-11-30T23:59:00Z"))).toEqual(new Date("2026-11-01T00:00:00Z"));
  });

  it("flags an on-call agent as quiet after 15 minutes unseen, or when never seen", () => {
    const now = new Date("2026-11-12T20:00:00Z");
    expect(isQuiet(null, now)).toBe(true);
    expect(isQuiet(new Date(now.getTime() - ON_CALL_QUIET_AFTER_MS + 1000), now)).toBe(false);
    expect(isQuiet(new Date(now.getTime() - ON_CALL_QUIET_AFTER_MS), now)).toBe(true);
  });

  it("gives security work only to cleared agents", () => {
    expect(isSecurityCleared({ securityClearedAt: null })).toBe(false);
    expect(isSecurityCleared({ securityClearedAt: new Date() })).toBe(true);
  });

  it("lists every on-call invite status the database has", () => {
    expect([...ON_CALL_INVITE_STATUSES].sort()).toEqual(enumValues("OnCallInviteStatus").sort());
  });
});
