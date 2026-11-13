import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/security-checks", () => ({ unlockSecurityFindings: vi.fn() }));
vi.mock("@/app/actions/security-assistant", () => ({ talkToSecurityAssistant: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/components/local-time", () => ({ LocalTime: () => <time>2 days ago</time> }));

import { SecurityChecksPanel } from "./entry-panel";
import type { WorkspaceCheckRow } from "@/lib/security-checks/entry";

const row = (over: Partial<WorkspaceCheckRow>): WorkspaceCheckRow => ({
  id: "c1", targetId: "t1", kind: "website", value: "settle.ng", status: "awaiting_ownership",
  verified: false, posted: false, findings: 0, unlocked: 0, createdAt: new Date("2026-11-11T10:00:00Z"), ...over,
});

describe("SecurityChecksPanel (#security-checks part 1)", () => {
  it("shows a new workspace one box asking what to secure, the three steps, and that the first scan is free", () => {
    const html = renderToStaticMarkup(<SecurityChecksPanel checks={[]} />);
    expect(html).toContain("What do you want to secure?");
    expect(html).not.toContain("free");
    expect(html).toContain("See what&#x27;s wrong");
    expect(html).toContain('name="target"');
    expect(html).not.toContain("Your sites");
  });

  it("shows a returning workspace its checks, without the empty state", () => {
    const html = renderToStaticMarkup(
      <SecurityChecksPanel
        checks={[
          row({}),
          row({ id: "c2", targetId: "t2", kind: "repo", value: "settle/app", status: "checking", verified: true }),
          row({ id: "c3", targetId: "t3", value: "shop.ng", status: "done", verified: true, posted: true, findings: 4, unlocked: 1 }),
          row({ id: "c4", targetId: "t4", value: "blog.ng", status: "done", verified: true, posted: true, findings: 2, unlocked: 2 }),
        ]}
      />,
    );
    expect(html).toContain("Assets, newest first");
    expect(html).not.toContain("Find the holes");
    expect(html).toContain('href="/security/targets/t1/verify"');
    expect(html).toContain(">Continue</a>");
    expect(html).toContain("Show it&#x27;s yours");
    // No report yet, so nothing to unlock.
    expect(html).not.toContain('href="/security/checks/c1/pay"');
    expect(html).not.toContain('href="/security/checks/c2/pay"');
    expect(html).toContain('href="/security/checks/c2"');
    // Posted with locked findings: unlock them.
    expect(html).toContain('href="/security/checks/c3/pay"');
    expect(html).toContain(">Unlock fixes</a>");
    expect(html).toContain("1 of 4</span> unlocked");
    // Every finding unlocked.
    expect(html).toContain("Fixes unlocked");
    expect(html).not.toContain('href="/security/checks/c4/pay"');
    expect(html).not.toContain("free");
    expect(html).toContain('aria-current="step"');
  });

  it("says nothing to fix when the report found nothing", () => {
    const html = renderToStaticMarkup(<SecurityChecksPanel checks={[row({ status: "done", verified: true, posted: true })]} />);
    expect(html).toContain("Nothing to fix");
    // Checking, once done, opens the report straight away.
    expect(html).toContain('href="/security/checks/c1">Checking</a>');
    expect(html).not.toContain("/pay");
  });

  it("confirms the fixes just unlocked", () => {
    const html = renderToStaticMarkup(
      <SecurityChecksPanel checks={[row({ status: "done", verified: true, posted: true, findings: 3, unlocked: 3 })]} highlight={{ checkId: "c1", unlocked: 3 }} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("3 fixes unlocked.");
  });

  it("says a new check was saved, and keeps Continue on its row", () => {
    const html = renderToStaticMarkup(<SecurityChecksPanel checks={[row({})]} highlight={{ checkId: "c1", unlocked: 0, added: true }} />);
    expect(html).toContain("Saved. Show it&#x27;s yours and the scan starts.");
    expect(html).toContain('href="/security/targets/t1/verify"');
  });
  it("shows a sidebar of where each site is, and filters the list by it", () => {
    const checks = [
      row({}),
      row({ id: "c2", targetId: "t2", value: "shop.ng", status: "done", verified: true, posted: true, findings: 2 }),
    ];
    const all = renderToStaticMarkup(<SecurityChecksPanel checks={checks} />);
    expect(all).toContain('aria-label="Status"');
    expect(all).toContain('href="/security?show=prove"');
    expect(all).toContain('href="/security?show=fix"');
    expect(all).toContain("settle.ng");
    expect(all).toContain("shop.ng");

    const fix = renderToStaticMarkup(<SecurityChecksPanel checks={checks} show="fix" />);
    expect(fix).toContain("shop.ng");
    expect(fix).not.toContain("settle.ng");
    expect(fix).toContain("Fix, newest first");

    const checking = renderToStaticMarkup(<SecurityChecksPanel checks={checks} show="checking" />);
    expect(checking).toContain("Nothing being checked right now");
  });
});
