import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.hoisted(() => vi.fn());
const isAdminOfOrganisation = vi.hoisted(() => vi.fn());
const currentOrganisationIdFor = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
const invalidateWorkflow = vi.hoisted(() => vi.fn());
const findFirst = vi.hoisted(() => vi.fn());
const findUnique = vi.hoisted(() => vi.fn());
const upsert = vi.hoisted(() => vi.fn());
const auditCreate = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn());
const requireAgent = vi.hoisted(() => vi.fn());
const briefFindUnique = vi.hoisted(() => vi.fn());
const briefUpsert = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next-auth", () => ({ default: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser }));
vi.mock("@/lib/agents/membership", () => ({ isAdminOfOrganisation }));
vi.mock("@/lib/organisation-context", () => ({
  currentOrganisationIdFor,
  NO_ORGANISATION_MESSAGE: "You're not a member of an organisation yet.",
}));
vi.mock("@/lib/workflow", () => ({
  invalidateWorkflow,
  workflowFor: vi.fn(async (projectId: string) => {
    const row = await findUnique({ where: { projectId } });
    return { revisionLimit: row?.revisionLimit ?? 2 };
  }),
}));
vi.mock("@/lib/agents/require-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agents/require-agent")>()),
  requireAgent,
}));
vi.mock("@/lib/agents/rate-budget", () => ({
  consumeAgentBudget: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst, findUnique },
    projectWorkflow: { findUnique, upsert },
    projectAuditEvent: { create: auditCreate },
    agentAuditEvent: { create: vi.fn() },
    user: { findUnique },
    projectBrief: { findUnique: briefFindUnique, upsert: briefUpsert },
    $transaction: transaction,
  },
}));

import {
  assertMarketingSettingsAccess,
  getMarketingSettings,
  updateMarketingSettings,
} from "@/lib/marketing/settings";
import { updateMarketingSettingsAction } from "@/app/actions/marketing-settings";
import { GET, PATCH } from "@/app/api/v1/projects/[id]/marketing/settings/route";
import { readProjectBrief, saveProjectBrief } from "@/lib/marketing/brief";
import { NextRequest } from "next/server";

describe("The project brief (M-API-8)", () => {
  const stored = { product: "Ziki", audience: null, currentFocus: "First ten teams", outOfScope: null };

  beforeEach(() => {
    vi.clearAllMocks();
    briefFindUnique.mockResolvedValue(null);
    findUnique.mockResolvedValue(null);
    transaction.mockImplementation(async (run: (tx: unknown) => unknown) =>
      run({ projectBrief: { upsert: briefUpsert }, projectAuditEvent: { create: auditCreate } }),
    );
  });

  it("gives agents the contract's field names, and null for a field nobody filled in", async () => {
    briefFindUnique.mockResolvedValue(stored);
    await expect(readProjectBrief("p1")).resolves.toEqual({
      product: "Ziki", audience: null, website: null, current_focus: "First ten teams", out_of_scope: null,
    });
  });

  it("gives agents the project's own site link as the website, even before anyone writes a brief", async () => {
    findUnique.mockResolvedValue({ siteUrl: "https://ziki.dev" });
    await expect(readProjectBrief("p1")).resolves.toEqual({
      product: null, audience: null, website: "https://ziki.dev", current_focus: null, out_of_scope: null,
    });
  });

  it("gives agents no brief when none exists or every field is blank", async () => {
    await expect(readProjectBrief("p1")).resolves.toBeNull();
    briefFindUnique.mockResolvedValue({ product: null, audience: null, currentFocus: null, outOfScope: null });
    await expect(readProjectBrief("p1")).resolves.toBeNull();
  });

  it("stores blanks as nothing and audits which fields changed", async () => {
    await saveProjectBrief("organisation-1", "p1", "user-1", {
      product: " Ziki ", audience: "", currentFocus: "First ten teams", outOfScope: "",
    });
    expect(briefUpsert).toHaveBeenCalledWith({
      where: { projectId: "p1" },
      update: stored,
      create: { projectId: "p1", ...stored },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organisationId: "organisation-1", projectId: "p1", actorUserId: "user-1", action: "marketing.brief.updated",
        changes: { fields: ["product", "currentFocus"] },
      }),
    });
  });

  it("writes nothing when nothing changed", async () => {
    briefFindUnique.mockResolvedValue(stored);
    await saveProjectBrief("organisation-1", "p1", "user-1", { product: "Ziki", currentFocus: "First ten teams" });
    expect(briefUpsert).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("refuses a website, which now lives in project settings, and an unknown field", async () => {
    await expect(saveProjectBrief("organisation-1", "p1", "user-1", { website: "https://ziki.dev" })).rejects.toThrow();
    await expect(saveProjectBrief("organisation-1", "p1", "user-1", { points: 5 })).rejects.toThrow();
    expect(briefUpsert).not.toHaveBeenCalled();
  });
});

describe("Marketing settings core (M-API-6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAdminOfOrganisation.mockResolvedValue(true);
    findFirst.mockResolvedValue({ id: "proj-1", slug: "marketing-proj", name: "Marketing Proj", workflow: null, organisation: { slug: "acme" } });
    findUnique.mockResolvedValue({ revisionLimit: 2 });
    transaction.mockImplementation(async (run: (tx: unknown) => unknown) =>
      run({
        projectWorkflow: { upsert },
        projectAuditEvent: { create: auditCreate },
      }),
    );
  });

  describe("assertMarketingSettingsAccess", () => {
    it("allows an organisation owner or admin", async () => {
      isAdminOfOrganisation.mockResolvedValue(true);
      await expect(assertMarketingSettingsAccess({ id: "user-1" }, "organisation-1", "change")).resolves.toBeUndefined();
    });

    it("refuses a member who is not an admin with 403", async () => {
      isAdminOfOrganisation.mockResolvedValue(false);
      await expect(assertMarketingSettingsAccess({ id: "user-2" }, "organisation-1", "change")).rejects.toThrow(
        "Only organisation owners and admins can change marketing settings.",
      );
      await expect(assertMarketingSettingsAccess({ id: "user-2" }, "organisation-1", "view")).rejects.toThrow(
        "Only organisation owners and admins can view marketing settings.",
      );
    });
  });

  describe("getMarketingSettings", () => {
    it("returns the project's revision limit, defaulting to 2", async () => {
      findUnique.mockResolvedValueOnce(null);
      const res = await getMarketingSettings("organisation-1", "proj-1");
      expect(res).toEqual({
        projectId: "proj-1",
        slug: "marketing-proj",
        ref: "acme/marketing-proj",
        name: "Marketing Proj",
        revisionLimit: 2,
      });
    });

    it("returns stored revision limit if present", async () => {
      findUnique.mockResolvedValueOnce({ revisionLimit: 5 });
      const res = await getMarketingSettings("organisation-1", "marketing-proj");
      expect(res.revisionLimit).toBe(5);
    });

    it("throws 404 if project is not found in organisation", async () => {
      findFirst.mockResolvedValueOnce(null);
      await expect(getMarketingSettings("organisation-1", "unknown")).rejects.toThrow("Project not found.");
    });
  });

  describe("updateMarketingSettings", () => {
    it("validates that revisionLimit is within 1 to 10", async () => {
      await expect(updateMarketingSettings("organisation-1", "proj-1", "user-1", { revisionLimit: 0 })).rejects.toThrow(
        "Revision limit must be at least 1.",
      );
      await expect(updateMarketingSettings("organisation-1", "proj-1", "user-1", { revisionLimit: 11 })).rejects.toThrow(
        "Revision limit must be at most 10.",
      );
      await expect(updateMarketingSettings("organisation-1", "proj-1", "user-1", { revisionLimit: 3.5 })).rejects.toThrow(
        "Revision limit must be a whole number.",
      );
    });

    it("saves the new revision limit, audits it, and invalidates cache", async () => {
      findUnique.mockResolvedValueOnce({ revisionLimit: 2 });
      const res = await updateMarketingSettings("organisation-1", "proj-1", "user-1", { revisionLimit: 4 });

      expect(res).toEqual({
        projectId: "proj-1",
        slug: "marketing-proj",
        ref: "acme/marketing-proj",
        name: "Marketing Proj",
        revisionLimit: 4,
      });

      expect(upsert).toHaveBeenCalledWith({
        where: { projectId: "proj-1" },
        update: { revisionLimit: 4 },
        create: { projectId: "proj-1", revisionLimit: 4 },
      });

      expect(auditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organisationId: "organisation-1",
          projectId: "proj-1",
          actorUserId: "user-1",
          action: "marketing.settings.updated",
          changes: { revisionLimit: { from: 2, to: 4 } },
        }),
      });

      expect(invalidateWorkflow).toHaveBeenCalledWith("proj-1");
    });

    it("skips writing if the limit is unchanged", async () => {
      findUnique.mockResolvedValueOnce({ revisionLimit: 2 });
      await updateMarketingSettings("organisation-1", "proj-1", "user-1", { revisionLimit: 2 });
      expect(upsert).not.toHaveBeenCalled();
      expect(auditCreate).not.toHaveBeenCalled();
    });

    it("throws 404 if project does not exist", async () => {
      findFirst.mockResolvedValueOnce(null);
      await expect(updateMarketingSettings("organisation-1", "missing", "user-1", { revisionLimit: 3 })).rejects.toThrow(
        "Project not found.",
      );
    });
  });
});

describe("Marketing settings API route (M-API-6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAdminOfOrganisation.mockResolvedValue(true);
    findFirst.mockResolvedValue({ id: "proj-1", slug: "marketing-proj", name: "Marketing Proj", workflow: null, organisation: { slug: "acme" } });
    findUnique.mockResolvedValue({ revisionLimit: 2 });
    requireAgent.mockResolvedValue({
      agentId: "agent-1",
      name: "TestAgent",
      ownerId: "owner-1",
      organisationId: "organisation-1",
      level: "working",
      ownerRole: "admin",
      burst: false,
      keyId: "key-1",
    });
    transaction.mockImplementation(async (run: (tx: unknown) => unknown) =>
      run({
        projectWorkflow: { upsert },
        projectAuditEvent: { create: auditCreate },
      }),
    );
  });

  it("GET /api/v1/projects/[id]/marketing/settings returns 200 with dials for an admin agent", async () => {
    const req = new NextRequest("http://localhost/api/v1/projects/proj-1/marketing/settings", {
      headers: { authorization: "Bearer ziki_test" },
    });
    const res = await GET(req, { params: Promise.resolve({ id: "proj-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      projectId: "proj-1",
      slug: "marketing-proj",
      revisionLimit: 2,
    });
  });

  it("GET returns 403 if agent owner is not an organisation admin", async () => {
    isAdminOfOrganisation.mockResolvedValue(false);
    const req = new NextRequest("http://localhost/api/v1/projects/proj-1/marketing/settings", {
      headers: { authorization: "Bearer ziki_test" },
    });
    const res = await GET(req, { params: Promise.resolve({ id: "proj-1" }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("Only organisation owners and admins can view marketing settings.");
  });

  it("PATCH /api/v1/projects/[id]/marketing/settings updates revisionLimit", async () => {
    const req = new NextRequest("http://localhost/api/v1/projects/proj-1/marketing/settings", {
      method: "PATCH",
      headers: {
        authorization: "Bearer ziki_test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ revisionLimit: 3 }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "proj-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      projectId: "proj-1",
      revisionLimit: 3,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { revisionLimit: 3 },
      }),
    );
  });

  it("PATCH returns 400 if revisionLimit is out of range", async () => {
    const req = new NextRequest("http://localhost/api/v1/projects/proj-1/marketing/settings", {
      method: "PATCH",
      headers: {
        authorization: "Bearer ziki_test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ revisionLimit: 20 }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "proj-1" }) });
    expect(res.status).toBe(400);
  });
});

describe("updateMarketingSettingsAction (M-API-6, M-UI-7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "user-admin", role: "admin" });
    isAdminOfOrganisation.mockResolvedValue(true);
    currentOrganisationIdFor.mockResolvedValue("organisation-1");
    findFirst.mockResolvedValue({ id: "proj-1", slug: "marketing-proj", name: "Marketing Proj", workflow: null, organisation: { slug: "acme" } });
    findUnique.mockResolvedValue({ revisionLimit: 2 });
    transaction.mockImplementation(async (run: (tx: unknown) => unknown) =>
      run({
        projectWorkflow: { upsert },
        projectAuditEvent: { create: auditCreate },
      }),
    );
  });

  it("updates revision limit through form action and revalidates paths", async () => {
    const fd = new FormData();
    fd.set("slug", "marketing-proj");
    fd.set("revisionLimit", "4");

    const res = await updateMarketingSettingsAction(undefined, fd);
    expect(res).toEqual({ ok: true, revisionLimit: 4 });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { revisionLimit: 4 },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/acme/marketing/settings");
    expect(revalidatePath).toHaveBeenCalledWith("/acme/marketing-proj/settings");
  });

  it("rejects non-admins", async () => {
    isAdminOfOrganisation.mockResolvedValue(false);
    const fd = new FormData();
    fd.set("slug", "marketing-proj");
    fd.set("revisionLimit", "4");

    const res = await updateMarketingSettingsAction(undefined, fd);
    expect(res).toMatchObject({
      ok: false,
      error: "Only organisation owners and admins can change marketing settings.",
    });
  });

  it("rejects invalid revision limits with fieldErrors", async () => {
    const fd = new FormData();
    fd.set("slug", "marketing-proj");
    fd.set("revisionLimit", "15");

    const res = await updateMarketingSettingsAction(undefined, fd);
    expect(res).toMatchObject({
      ok: false,
      fieldErrors: { revisionLimit: expect.stringContaining("at most 10") },
    });
  });
});
