import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  addTargetAndCheck: vi.fn(),
  ask: vi.fn(),
  rate: vi.fn(),
  preview: vi.fn(),
  saveQuickScan: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn().mockResolvedValue({ id: "u1", role: "member" }) }));
vi.mock("@/lib/organisation-access", () => ({ currentOrganisationAccess: mocks.access }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate, RATE_LIMIT_MESSAGE: "Slow down." }));
vi.mock("@/lib/security-checks/entry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security-checks/entry")>()),
  addTargetAndCheck: mocks.addTargetAndCheck,
  saveQuickScan: mocks.saveQuickScan,
}));
vi.mock("@/lib/security-checks/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security-checks/assistant")>()),
  askSecurityAssistant: mocks.ask,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/security-checks/preview", () => ({ previewScan: mocks.preview }));

import { addSecurityAsset, talkToSecurityAssistant } from "./security-assistant";

const say = (text: string) => [{ role: "user" as const, text }];

const SCAN = {
  ok: true,
  kind: "website",
  target: "settle.ng",
  checkedAt: "2026-11-13T10:00:00.000Z",
  checked: ["https", "certificate", "headers", "cookies", "email"],
  counts: { critical: 0, high: 1, medium: 1, low: 0 },
  findings: [
    { id: "hsts", severity: "high", area: "headers", title: "No HSTS header SECRET", detail: "Browsers may load it over HTTP SECRET" },
    { id: "dmarc", severity: "medium", area: "email", title: "No DMARC record SECRET", detail: "Mail can be faked SECRET" },
  ],
};

describe("talkToSecurityAssistant (#security-checks, plan C3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ organisationId: "org1", admin: true });
    mocks.rate.mockReturnValue({ allowed: true });
    mocks.addTargetAndCheck.mockResolvedValue({ targetId: "t1", checkId: "c1", verified: false, reused: false });
    mocks.preview.mockResolvedValue(SCAN);
  });

  it("refuses anyone who is not an owner or admin, before scanning, asking the AI or saving anything", async () => {
    mocks.access.mockResolvedValue({ organisationId: "org1", admin: false });
    await expect(talkToSecurityAssistant(say("https://www.settle.ng"))).resolves.toMatchObject({ kind: "error", error: expect.stringContaining("owners and admins") });
    await expect(addSecurityAsset("settle.ng")).resolves.toMatchObject({ kind: "error", error: expect.stringContaining("owners and admins") });
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(mocks.addTargetAndCheck).not.toHaveBeenCalled();
  });

  it("scans a plain link without the AI, shows only counts, and saves nothing yet", async () => {
    const answer = await talkToSecurityAssistant(say("https://www.settle.ng"));
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(mocks.preview).toHaveBeenCalledWith("settle.ng", { visitor: "user:u1" });
    expect(mocks.addTargetAndCheck).not.toHaveBeenCalled();
    expect(answer).toMatchObject({ kind: "scan", target: "settle.ng", summary: { total: 2, risk: "high" } });
    // What was found never leaves the server before the site is proven.
    expect(JSON.stringify(answer)).not.toContain("SECRET");
  });

  it("offers no Show it's yours for a site the scan couldn't reach, but does when only the limit was hit", async () => {
    mocks.preview.mockResolvedValue({ ok: false, reason: "We couldn't reach settle.ng just now." });
    expect(await talkToSecurityAssistant(say("settle.ng"))).toMatchObject({ kind: "scan", summary: null, note: "We couldn't reach settle.ng just now.", canAdd: false });

    mocks.preview.mockResolvedValue({ ok: false, reason: "Too many scans.", retryAfterSeconds: 120 });
    expect(await talkToSecurityAssistant(say("settle.ng"))).toMatchObject({ kind: "scan", summary: null, canAdd: true });
  });

  it("quick-scans a GitHub repo like any other asset, and saves nothing until Show it's yours", async () => {
    mocks.preview.mockResolvedValue({ ...SCAN, kind: "repo", target: "settle/app", checked: ["secrets", "policy"], counts: { critical: 0, high: 1, medium: 0, low: 1 }, findings: [
      { id: "s", severity: "high", area: "secrets", title: "A file that usually holds secrets SECRET", detail: ".env SECRET" },
      { id: "p", severity: "low", area: "policy", title: "No security policy SECRET", detail: "No SECURITY.md SECRET" },
    ] });
    const answer = await talkToSecurityAssistant(say("github.com/settle/app"));
    // The scan reads its link back through the same parser, so a repo must go in as a GitHub address, not "owner/name".
    expect(mocks.preview).toHaveBeenCalledWith("github.com/settle/app", { visitor: "user:u1" });
    expect(mocks.addTargetAndCheck).not.toHaveBeenCalled();
    // The card's target is what Show it's yours sends back to be added, so it has to be an address the parser accepts.
    expect(answer).toMatchObject({ kind: "scan", target: "github.com/settle/app", summary: { kind: "repo", total: 2, risk: "high" } });
    expect(JSON.stringify(answer)).not.toContain("SECRET");
  });

  it("still offers Show it's yours for a repo it can't see, such as a private one", async () => {
    mocks.preview.mockResolvedValue({ ok: false, reason: "We couldn't see that repo on GitHub." });
    const answer = await talkToSecurityAssistant(say("github.com/settle/private-app"));
    expect(mocks.addTargetAndCheck).not.toHaveBeenCalled();
    expect(answer).toMatchObject({ kind: "scan", summary: null, note: "We couldn't see that repo on GitHub.", canAdd: true });
  });

  it("adds the asset only on Show it's yours, saves the quick scan's counts with it, then goes on to prove it", async () => {
    expect(await addSecurityAsset("settle.ng")).toMatchObject({ kind: "go", href: "/security/targets/t1/verify" });
    expect(mocks.addTargetAndCheck).toHaveBeenCalledWith("org1", "u1", expect.objectContaining({ kind: "website", value: "settle.ng" }));
    expect(mocks.saveQuickScan).toHaveBeenCalledWith("t1", expect.objectContaining({ total: 2, risk: "high" }));
    expect(JSON.stringify(mocks.saveQuickScan.mock.calls[0][1])).not.toContain("SECRET");

    mocks.addTargetAndCheck.mockResolvedValue({ targetId: "t1", checkId: "c9", verified: true, reused: false });
    expect(await addSecurityAsset("settle.ng")).toMatchObject({ kind: "go", href: "/security?check=c9&added=1" });
    expect(await addSecurityAsset("not a link")).toMatchObject({ kind: "error" });
  });

  it("refuses a private address without asking the AI", async () => {
    const answer = await talkToSecurityAssistant(say("192.168.1.1"));
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(mocks.addTargetAndCheck).not.toHaveBeenCalled();
    expect(answer.kind).toBe("reply");
  });

  it("lets the AI answer plain words, and scans the site it picks out after checking it again", async () => {
    mocks.ask.mockResolvedValue({ reply: "Here's a quick look.", target: "my site is settle.ng" });
    expect(await talkToSecurityAssistant(say("I want to secure my shop"))).toMatchObject({ kind: "reply" });
    expect(mocks.preview).not.toHaveBeenCalled();

    mocks.ask.mockResolvedValue({ reply: "Here's a quick look.", target: "settle.ng" });
    const answer = await talkToSecurityAssistant(say("It's settle dot ng, the website"));
    expect(answer).toMatchObject({ kind: "scan", reply: "Here's a quick look.", target: "settle.ng" });
    expect(mocks.addTargetAndCheck).not.toHaveBeenCalled();
  });

  it("never adds a private address the AI picks out", async () => {
    mocks.ask.mockResolvedValue({ reply: "Okay.", target: "10.0.0.4" });
    const answer = await talkToSecurityAssistant(say("check my server at ten zero zero four"));
    expect(mocks.addTargetAndCheck).not.toHaveBeenCalled();
    expect(answer.kind).toBe("reply");
  });

  it("asks for the address plainly when the AI can't answer, and stops at the rate limit", async () => {
    mocks.ask.mockResolvedValue(null);
    const answer = await talkToSecurityAssistant(say("hello"));
    expect(answer).toMatchObject({ kind: "reply" });
    expect((answer as { reply: string }).reply).toMatch(/website, a server address or a GitHub repo/);

    mocks.rate.mockReturnValue({ allowed: false });
    expect(await talkToSecurityAssistant(say("hello again"))).toEqual({ kind: "error", error: "Slow down." });
    expect(mocks.ask).toHaveBeenCalledTimes(1);
  });

  it("needs a workspace", async () => {
    mocks.access.mockResolvedValue({ organisationId: null, admin: false });
    expect((await talkToSecurityAssistant(say("settle.ng"))).kind).toBe("error");
  });
});
