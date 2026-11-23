import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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

describe("ScanSteps: the code scan, connect first, pay later (18 Nov call)", () => {
  it("opens the Code scan page at any time, even before the deeper scan is paid for", () => {
    const html = renderToStaticMarkup(<ScanSteps quickFound={9} phase="planning" done={0} total={0} checkId="c1" paymentRequired />);
    expect(html).toContain('href="/security/checks/c1/code"');
  });

  it("always opens the website's own Code scan page, and says in plain words where the code scan stands", () => {
    const step = (codeScan: { checkId: string; paid: boolean; finished: boolean; found: number } | null) =>
      renderToStaticMarkup(<ScanSteps quickFound={9} phase="done" done={9} total={9} checkId="c1" codeScan={codeScan} />);
    expect(step(null)).toContain("Not started");
    const connected = step({ checkId: "code1", paid: false, finished: false, found: 2 });
    expect(connected).toContain('href="/security/checks/c1/code"');
    expect(connected).not.toContain('href="/security/checks/code1"');
    // Connecting gives a first look, not the whole code scan; a paid full check shows while it runs.
    expect(connected).toContain("First look done");
    expect(step({ checkId: "code1", paid: true, finished: false, found: 2 })).toContain("Full check running");
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
