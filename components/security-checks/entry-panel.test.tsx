import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/security-checks", () => ({ unlockSecurityFindings: vi.fn() }));
vi.mock("@/app/actions/security-assistant", () => ({ talkToSecurityAssistant: vi.fn() }));
// Scan again (#security-rescan) can offer the one-time loan; its server action isn't used here.
vi.mock("@/app/actions/ziks-loan", () => ({ borrowZiks: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/components/local-time", () => ({ LocalTime: () => <time>2 days ago</time> }));

import { SecurityChecksPanel } from "./entry-panel";
import type { WorkspaceCheckRow } from "@/lib/security-checks/entry";
import type { PreviewSummary } from "@/lib/security-checks/preview-summary";

const row = (over: Partial<WorkspaceCheckRow>): WorkspaceCheckRow => ({
  id: "c1", targetId: "t1", kind: "website", value: "settle.ng", status: "queued",
  verified: false, posted: false, findings: 0, unlocked: 0, moved: 0, preview: null, agentReport: null, createdAt: new Date("2026-11-11T10:00:00Z"), ...over,
});

const quick: PreviewSummary = {
  kind: "website",
  target: "settle.ng",
  checkedAt: "2026-11-11T10:00:00.000Z",
  total: 2,
  counts: { critical: 0, high: 0, medium: 1, low: 1 },
  risk: "medium",
  areas: [
    { area: "https", label: "HTTPS", problems: 0 },
    { area: "headers", label: "Security headers", problems: 2 },
  ],
  rows: [
    { severity: "medium", area: "headers", label: "Security headers", title: "No Content Security Policy" },
    { severity: "low", area: "headers", label: "Security headers", title: "Browsers may guess file types" },
  ],
} as PreviewSummary;

describe("SecurityChecksPanel (#security-checks, 14 Nov plan)", () => {
  it("opens on the Feed, as Marketing's: pills for each kind, the sites as cards with See progress, no table (24 Nov)", () => {
    const html = renderToStaticMarkup(
      <SecurityChecksPanel checks={[row({}), row({ id: "c2", targetId: "t2", value: "shop.ng", status: "done", posted: true, findings: 2 })]} />,
    );
    expect(html).toContain('aria-label="Kinds of target"');
    for (const pill of ["Feed", "Websites", "Servers", "Repos"]) expect(html).toContain(pill);
    expect(html).toContain('aria-label="Feed"');
    expect(html).toContain("See progress");
    expect(html).toContain("Agents checking");
    expect(html).toContain('href="/security/checks/c2"');
    expect(html).not.toContain("<table");
    // Nothing to vote on, and no "Fix it" or "Needs fixing" (24 Nov, Chloe).
    expect(html).not.toMatch(/Vote on it|Fix it|Needs fixing/);
  });

  it("opens a new workspace on the chat box, as Marketing's, with an empty card under it (23 Nov)", () => {
    const html = renderToStaticMarkup(<SecurityChecksPanel checks={[]} />);
    expect(html).toContain("Which website should we secure? Paste its address, like https://yourproduct.com");
    expect(html).toContain('name="target"');
    expect(html).toContain("Nothing checked yet.");
    // How many on the left, Filter and search on the right; no status tabs.
    expect(html).toContain('aria-label="Kinds of target"');
    expect(html).not.toContain('aria-label="Targets by status"');
    // No title, subtitle or Add target button on top, and no proof step.
    expect(html).not.toContain("Add target");
    expect(html).not.toContain("Your websites, servers and repos");
    expect(html).not.toContain("Show it&#x27;s yours");
    expect(html).not.toContain("<table");
  });

  it("shows the empty card again when every scan was removed", () => {
    const html = renderToStaticMarkup(<SecurityChecksPanel checks={[row({ status: "cancelled" })]} />);
    expect(html).toContain("Nothing checked yet.");
    expect(html).toContain("Which website should we secure?");
  });

  it("keeps the box on top and lists the scans as rows, each with its stage, opening its page with one click", () => {
    const html = renderToStaticMarkup(
      <SecurityChecksPanel show="website"
        checks={[
          row({}),
          row({ id: "c2", targetId: "t2", kind: "repo", value: "settle/app", status: "checking" }),
          row({ id: "c3", targetId: "t3", value: "shop.ng", status: "done", posted: true, findings: 4, unlocked: 1 }),
          row({ id: "c4", targetId: "t4", value: "blog.ng", status: "done", posted: true, findings: 2, unlocked: 2, moved: 2 }),
        ]}
      />,
    );
    // The chat box stays on top once there are scans, as Marketing's: no Add target button, no empty card.
    expect(html).toContain('name="target"');
    expect(html).toContain("Which website should we secure?");
    expect(html).not.toContain('aria-label="Targets by status"');
    // The repo is under Repos, so Websites shows three.
    expect(html).toMatch(/All (<!-- -->)?Websites/);
    // Marketing's table, with the site's own icon and no line under the name (24 Nov, Chloe).
    expect(html).toContain("Last scanned</th>");
    // Under the name only while the agents are checking (24 Nov, Chloe).
    expect(html).toContain("Agents checking");
    // Marketing's heading: the funnel and "+ New Website" (24 Nov, Chloe).
    expect(html).toContain("New Website");
    expect(html).toContain('aria-label="Filter"');
    expect(html).not.toContain("Add target");
    expect(html).not.toContain("Nothing checked yet.");
    expect(html).toContain("Scanning");
    expect(html).toContain("Report ready");
    expect(html).toContain("In your app");
    // No proof step anywhere.
    expect(html).not.toContain("/verify");
    expect(html).not.toContain("Continue");
    // Still being checked: no report yet, so nothing to unlock.
    expect(html).toContain('href="/security/checks/c1"');
    expect(html).not.toContain('href="/security/checks/c1/pay"');
    // Posted with locked findings: no Unlock fixes on the list; that's on the scan's page.
    expect(html).toContain('href="/security/checks/c3"');
    expect(html).not.toContain('href="/security/checks/c3/pay"');
    expect(html).not.toContain("Unlock fixes");
    // All unlocked and moved: the row still opens the report.
    expect(html).not.toContain('href="/security/checks/c4/pay"');
    expect(html).toContain('href="/security/checks/c4"');
    // A targets table with headings that sort; the row opens the page, so no See progress or Open report button.
    expect(html).toContain('<table aria-label="Your targets"');
    expect(html).toContain("Problems</th>");
    expect(html).not.toContain("See progress");
    expect(html).not.toContain("Open report");
    expect(html).not.toContain('aria-label="Status"');
  });

  it("says nothing to fix when the report found nothing", () => {
    const html = renderToStaticMarkup(<SecurityChecksPanel show="website" checks={[row({ status: "done", posted: true })]} />);
    expect(html).toContain("No problems");
    expect(html).toContain('href="/security/checks/c1"');
    expect(html).not.toContain("/pay");
  });

  it("shows each scan's quick result as four coloured counts only: its full result is on the scan's page, not repeated on the list", () => {
    const html = renderToStaticMarkup(
      <SecurityChecksPanel show="website" checks={[row({ preview: quick }), row({ id: "c2", targetId: "t2", value: "shop.ng", preview: quick })]} />,
    );
    expect(html).toContain("from the quick scan.");
    // Always four boxes in the report's severity colours; empty ones faded.
    expect(html).toContain("security-severity--critical");
    expect(html).toContain("security-severity--low");
    expect(html).toContain("opacity-30");
    expect(html).not.toContain("No Content Security Policy");
    expect(html).not.toContain("See result");
    // Rows never open up; the only <details> is the funnel (Marketing's filter).
    expect(html.match(/<details/g)?.length ?? 0).toBe(1);
    expect(html).not.toContain("coin");
    // No delete on the list: like an issue, that belongs on the scan's own page.
    expect(html).not.toContain('aria-label="Remove');
  });

  it("counts the agents' findings instead of the quick scan once their report is posted", () => {
    const html = renderToStaticMarkup(
      <SecurityChecksPanel show="website"
        checks={[
          row({
            status: "done", posted: true, findings: 2, unlocked: 1, preview: quick,
            agentReport: {
              summary: "Two things to fix.",
              findings: [
                { id: "r1", severity: "high", title: "Session cookie has no Secure flag", unlocked: true, moved: false },
                { id: "r2", severity: "low", title: "Server version shown", unlocked: false, moved: false },
              ],
            },
          }),
        ]}
      />,
    );
    // Counted from the agents' findings (1 high, 1 low); the findings themselves are on the scan's page.
    expect(html).toContain('title="1 high problem, from the agents&#x27; report.');
    expect(html).toContain('title="1 low problem, from the agents&#x27; report.');
    expect(html).not.toContain("Session cookie has no Secure flag");
    // The browser scan only stays while no agent has reported.
    expect(html).not.toContain("No Content Security Policy");
    expect(html).not.toContain("from the quick scan");
  });

  it("confirms the fixes just unlocked", () => {
    const html = renderToStaticMarkup(
      <SecurityChecksPanel show="website" checks={[row({ status: "done", posted: true, findings: 3, unlocked: 3 })]} highlight={{ checkId: "c1", unlocked: 3 }} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("3 fixes unlocked.");
  });
});
