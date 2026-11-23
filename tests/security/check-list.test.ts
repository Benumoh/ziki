import { describe, expect, it } from "vitest";
import { THREAT_LABEL, checkListTabs } from "@/lib/security-checks/check-list";
import type { CheckReport } from "@/lib/security-checks/report";

const base = {
  checkId: "c1",
  status: "checking",
  createdAt: new Date("2026-11-16T10:00:00Z"),
  startedAt: new Date("2026-11-16T10:00:00Z"),
  finishedAt: null,
  target: { id: "t1", kind: "website", value: "shop.test", input: "shop.test", verified: true },
  posted: false,
  quickScan: {
    kind: "website",
    target: "shop.test",
    checkedAt: "2026-11-16T10:00:00.000Z",
    total: 1,
    counts: { critical: 0, high: 0, medium: 0, low: 1 },
    risk: "low",
    areas: [{ area: "headers", label: "Security headers", problems: 1 }],
    rows: [{ severity: "low", area: "headers", price: 1, label: "Security headers", title: "No HSTS header" }],
  },
  counts: { critical: 1, high: 0, medium: 0, low: 0 },
  total: 1,
  clearParts: ["Cookies"],
} as const;

type TestPart = Omit<CheckReport["parts"][number], "agent"> & { agent?: string | null };

function report(parts: TestPart[], findings: Partial<CheckReport["findings"][number]>[] = []): CheckReport {
  return {
    ...base,
    parts: parts.map((part) => ({ agent: null, ...part })),
    progress: { done: 0, total: parts.length, percent: 0 },
    findings: findings.map((f, i) => ({ id: `r${i}`, partId: "p1", severity: "critical", area: "Login", title: "Admin open", description: "The admin page opens without a password.", howToFix: null, fix: null, checkId: "c1", recheck: null, recheckNote: null, ...f })),
    fixed: [],
    previousCheckId: null,
    nextCheckId: null,
  } as unknown as CheckReport;
}

describe("the check's list: Quick scan and Deeper scan tabs (16 Nov)", () => {
  it("has the quick scan first, then the deeper scan", () => {
    const [quick, deep] = checkListTabs(report([]));
    expect([quick.title, deep.title]).toEqual(["Quick scan", "Deeper scan"]);
    expect(quick.scanRows).toEqual([{ severity: "low", title: "No HSTS header", line: null, area: "Security headers" }]);
    expect(quick.count).toBe(1);
  });

  it("lists every part in the deeper scan: findings as soon as their part is done, unfinished parts with where they stand, clean ones as clear", () => {
    const [, deep] = checkListTabs(
      report([
        { id: "p1", title: "Login", status: "done" },
        { id: "p2", title: "Cookies", status: "done" },
        { id: "p3", title: "Forms", status: "checking", agent: "Ada" },
        { id: "p4", title: "Admin", status: "waiting" },
      ], [{}]),
    );
    expect(deep.findings!.map((f) => f.title)).toEqual(["Admin open"]);
    expect(deep.count).toBe(1);
    expect(deep.clear).toEqual(["Cookies"]);
    // A part being checked says which agent has it (18 Nov call: show the work happening).
    expect(deep.pending).toEqual([
      { id: "p3", title: "Forms", state: "checking", agent: "Ada" },
      { id: "p4", title: "Admin", state: "waiting", agent: null },
    ]);
    expect(deep.state).toEqual({ label: "2 of 4 done", tone: "working" });
  });

  it("says Waiting when no part has started, and Planning before there are parts", () => {
    expect(checkListTabs(report([{ id: "p1", title: "Forms", status: "waiting" }]))[1].state.label).toBe("Waiting");
    expect(checkListTabs(report([]))[1].state.label).toBe("Planning");
  });

  it("a cancelled check doesn't list unfinished parts as still being checked", () => {
    const cancelled = { ...report([{ id: "p3", title: "Forms", status: "waiting" }]), status: "cancelled" } as CheckReport;
    expect(checkListTabs(cancelled)[1].pending).toEqual([]);
  });

  it("a rescan lists no parts under Still checking: only its findings, the progress bar counts the parts (18 Nov)", () => {
    const rescan = { ...report([{ id: "p1", title: "Recheck: Login", status: "waiting" }, { id: "p2", title: "Cookies", status: "checking" }], [{ checkId: "c0", recheck: "checking" }]), previousCheckId: "c0" } as CheckReport;
    const [, deep] = checkListTabs(rescan);
    expect(deep.pending).toEqual([]);
    expect(deep.findings!.map((f) => [f.title, f.recheck])).toEqual([["Admin open", "checking"]]);
    expect(deep.state).toEqual({ label: "0 of 2 done", tone: "working" });
  });

  it("marks a rescan's own findings New, never an earlier one or a first scan's (18 Nov)", () => {
    const rescan = { ...report([{ id: "p1", title: "Login", status: "done" }], [{}, { checkId: "c0", recheck: "still_there" }]), previousCheckId: "c0" } as CheckReport;
    expect(checkListTabs(rescan)[1].findings!.map((f) => f.isNew)).toEqual([true, false]);
    // Each label explains itself on hover instead of a note at the top (18 Nov, Tolu).
    const changed = { ...rescan, siteChange: { changed: ["a new certificate"] } } as CheckReport;
    expect(checkListTabs(changed)[1].findings!.map((f) => f.hint)).toEqual([
      "Found for the first time on this scan. This site changed since the last scan (a new certificate).",
      "Found on the earlier scan and found again on this one.",
    ]);
    expect(checkListTabs(report([{ id: "p1", title: "Login", status: "done" }], [{}]))[1].findings![0]!.hint).toBeNull();
    expect(checkListTabs(report([{ id: "p1", title: "Login", status: "done" }], [{}]))[1].findings!.map((f) => f.isNew)).toEqual([false]);
  });

  it("keeps the quick scan's findings in their own section at the top once paid, tickable to fix, and the Deeper scan lists only the agents' (18 Nov)", () => {
    const paid = {
      ...report([{ id: "p1", title: "Login", status: "done" }], [{ area: "Automatic check: Security headers", title: "No HSTS header", partId: "auto" }, {}]),
      codeInList: true,
      paymentRequired: false,
    } as CheckReport;
    const [quick, deep] = checkListTabs(paid);
    expect(quick.merged).toBeUndefined();
    expect(quick.findings!.map((f) => [f.title, f.area])).toEqual([["No HSTS header", "Security headers"]]);
    expect(quick.count).toBe(1);
    expect(deep.findings!.map((f) => f.title)).toEqual(["Admin open"]);
    expect(deep.count).toBe(1);
  });

  it("before the deeper scan is paid for, lists the quick scan's findings under Quick scan and says what the deeper scan will check (#deeper-scan-gate)", () => {
    // A new scan (18 Nov): the quick scan's findings are saved in the list, under Ziki's automatic checks.
    const unpaid = { ...report([], [{ area: "Automatic check: Security headers", severity: "low", title: "No HSTS header", description: "Browsers aren't told to use HTTPS. More text." }]), status: "queued", codeInList: true, paymentRequired: true } as CheckReport;
    const [quick, deep] = checkListTabs(unpaid);
    expect(quick.merged).toBeUndefined();
    // Real findings, fixable before the deeper scan is bought: the same tick box, See the fix and Fix selected.
    expect(quick.scanRows).toBeUndefined();
    expect(quick.findings!.map((f) => [f.title, f.line, f.area])).toEqual([["No HSTS header", "Browsers aren't told to use HTTPS.", "Security headers"]]);
    expect(deep.state).toEqual({ label: "Not started", tone: "waiting" });
    expect(deep.findings).toBeUndefined();
    expect(deep.notChecked!.map((item) => item.title)).toContain("Exposed files");
  });

  it("once paid but before agents have parts, the quick scan's findings still show and the Deeper scan says Planning", () => {
    const planning = { ...report([], [{ area: "Automatic check: Cookies" }]), status: "queued", codeInList: true, paymentRequired: false } as CheckReport;
    const [quick, deep] = checkListTabs(planning);
    expect(quick.findings!.map((f) => f.title)).toEqual(["Admin open"]);
    expect(deep.state.label).toBe("Planning");
    expect(deep.findings).toEqual([]);
  });

  it("names severities as threats", () => {
    expect(THREAT_LABEL).toEqual({ critical: "Critical threat", high: "High threat", medium: "Medium threat", low: "Low threat" });
  });
});
