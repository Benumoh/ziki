import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Connect code pays through server actions (#security-code-scan); rendering the steps never calls them.
vi.mock("@/app/actions/security-code-scan", () => ({ codeScanCost: vi.fn(), startPaidCodeScan: vi.fn() }));
vi.mock("@/app/actions/ziks-loan", () => ({ borrowZiks: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ScanSteps } from "./scan-steps";

describe("ScanSteps (18 Nov)", () => {
  it("shows the quick scan done, the agents checking and the code scan locked, with its price", () => {
    const html = renderToStaticMarkup(<ScanSteps site="hotels.ng" quickFound={9} deepFound={0} phase="checking" done={3} total={9} codePrice={50} />);
    expect(html).toContain("Quick scan");
    expect(html).toContain("Done · 9 found");
    expect(html).toContain("Agents checking · 3 of 9");
    expect(html).toContain("(in progress)");
    expect(html).toContain("Code scan");
    expect(html).toContain("Connect code");
    expect(html).toContain("50 Ziks");
  });

  it("counts what the agents found once the deeper scan is done", () => {
    const html = renderToStaticMarkup(<ScanSteps site="shop.ng" quickFound={6} deepFound={3} phase="done" done={9} total={9} codePrice={50} />);
    expect(html).toContain("Done · 6 found");
    expect(html).toContain("Done · 3 found");
    expect(html).not.toContain("(in progress)");
  });
});

describe("ScanSteps before the deeper scan is paid for", () => {
  it("locks the deeper scan with Start and no price on the step", () => {
    const html = renderToStaticMarkup(<ScanSteps site="hotels.ng" quickFound={9} deepFound={0} phase="planning" done={0} total={0} codePrice={50} paymentRequired />);
    expect(html).toContain("Deeper scan");
    expect(html).toContain(">Start<");
    expect(html).not.toContain("20 Ziks");
    expect(html).not.toContain("Planning");
  });
});
