import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  findTarget: vi.fn(),
  prove: vi.fn(),
  record: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT ${path}`);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn().mockResolvedValue({ id: "u1", role: "member" }) }));
vi.mock("@/lib/organisation-access", () => ({ currentOrganisationAccess: mocks.access }));
vi.mock("@/lib/prisma", () => ({ prisma: { securityTarget: { findFirst: mocks.findTarget } } }));
vi.mock("@/lib/security-checks/ownership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security-checks/ownership")>()),
  proveOwnership: mocks.prove,
  recordOwnership: mocks.record,
}));

import { verifySecurityTarget } from "./security-ownership";

const target = { id: "t1", organisationId: "org1", kind: "website", value: "settle.ng", ownershipToken: "ziki-verify-x", verifiedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ organisationId: "org1", admin: false });
  mocks.findTarget.mockResolvedValue(target);
  mocks.record.mockResolvedValue({ checkId: "c1" });
});

describe("verifySecurityTarget (#security-checks part 2)", () => {
  it("only reads targets in the client's own workspace", async () => {
    mocks.findTarget.mockResolvedValue(null);
    expect(await verifySecurityTarget("t1")).toEqual({ error: "That site isn't in this workspace." });
    expect(mocks.findTarget).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "t1", organisationId: "org1" } }));
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("lets no check start while no proof is there, and says why for each way", async () => {
    mocks.prove.mockImplementation(async (_target, method: string) => ({ ok: false, reason: `no ${method}` }));
    expect(await verifySecurityTarget("t1")).toEqual({ missing: { dns_txt: "no dns_txt", html_tag: "no html_tag" } });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("records the first way that is there and goes back to Assets, where the free scan runs", async () => {
    mocks.prove.mockImplementation(async (_target, method: string) => (method === "html_tag" ? { ok: true } : { ok: false, reason: "no" }));
    await expect(verifySecurityTarget("t1")).rejects.toThrow("REDIRECT /security?check=c1");
    expect(mocks.record).toHaveBeenCalledWith("t1", "org1", "u1", "html_tag");
  });

  it("proves a server only by the file on it", async () => {
    mocks.findTarget.mockResolvedValue({ ...target, kind: "server", value: "8.8.4.4" });
    mocks.prove.mockResolvedValue({ ok: false, reason: "no" });
    expect(await verifySecurityTarget("t1")).toEqual({ missing: { server_file: "no" } });
    expect(mocks.prove.mock.calls.map((call) => call[1])).toEqual(["server_file"]);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("never asks a proven target again", async () => {
    mocks.findTarget.mockResolvedValue({ ...target, verifiedAt: new Date() });
    await expect(verifySecurityTarget("t1")).rejects.toThrow("REDIRECT /security?check=c1");
    expect(mocks.prove).not.toHaveBeenCalled();
  });
});
