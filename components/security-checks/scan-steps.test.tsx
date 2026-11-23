import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Connect code pays through server actions (#security-code-scan); rendering the steps never calls them.
vi.mock("@/app/actions/security-code-scan", () => ({ codeScanCost: vi.fn(), startPaidCodeScan: vi.fn() }));
vi.mock("@/app/actions/ziks-loan", () => ({ borrowZiks: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ScanSteps } from "./scan-steps";

describe("ScanSteps (18 Nov call: each scan on its own page)", () => {
  it("opens the quick scan's page and the deeper scan's own page, and marks the page you're on", () => {
    const html = renderToStaticMarkup(<ScanSteps quickFound={9} phase="checking" done={3} total={9} checkId="c1" current="deeper" />);
    expect(html).toContain('href="/security/checks/c1"');
    expect(html).toContain('href="/security/checks/c1/deeper"');
    const marked = html.match(/<a[^>]*aria-current="page"[^>]*>/g) ?? [];
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('href="/security/checks/c1/deeper"');
    expect(html).toContain("Agents checking · 3 of 9");
  });

  it("says where each step stands without repeating the counts", () => {
    const html = renderToStaticMarkup(<ScanSteps quickFound={6} deepFound={3} phase="done" done={9} total={9} checkId="c1" />);
    expect(html).not.toContain("found");
    expect(html).not.toContain("(in progress)");
  });
});

describe("ScanSteps before the deeper scan is paid for", () => {
  it("says the deeper scan isn't started, with no Start, no price and no Connect code on the steps", () => {
    const html = renderToStaticMarkup(<ScanSteps quickFound={9} phase="planning" done={0} total={0} checkId="c1" paymentRequired />);
    expect(html).toContain("Not started");
    expect(html).not.toContain(">Start<");
    expect(html).not.toContain("Ziks");
    expect(html).not.toContain("Connect code");
  });
});
