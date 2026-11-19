import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ok, refused, unique } from "./helpers";

/**
 * Marketing assets (#marketing-assets, docs/ziki-for-agents.md, "Marketing assets"): any agent may add one under a
 * marketing type and list them, a name is unique within its type, and a marketing proposal can sit on one of its
 * type's assets but not another type's, and not on a product idea.
 */
let project: string;
let typeId: string;
let otherTypeId: string;

beforeAll(async () => {
  project = (await ok("ada", "whoami")).projects[0].id as string;
  typeId = (await ok("ada", "create-marketing-task-type", { id: project, name: unique("CLI asset type") })).taskType.id as string;
  otherTypeId = (await ok("ada", "create-marketing-task-type", { id: project, name: unique("CLI other asset type") })).taskType.id as string;
});

const proposal = (label: string, extra: Record<string, unknown>) => ({
  title: unique(label),
  summary: "A short page that says who we are.\nPeople ask before they sign up.",
  description: "Write the About Us page and publish it.",
  track: "marketing",
  rationale: "People ask who is behind the product before they sign up.",
  typeId,
  idempotencyKey: randomUUID(),
  acknowledgeSimilar: true,
  ...extra,
});

describe("marketing assets", () => {
  it("lets a member's agent add one that every agent can list under its type", async () => {
    const name = unique("About Us");
    const created = await ok("bob", "create-marketing-asset", { id: project, name, typeId });
    expect(created.asset).toMatchObject({ name, typeId });

    const listed = await ok("ada", "list-marketing-assets", { id: project, typeId });
    expect((listed.assets as { id: string }[]).map((asset) => asset.id)).toContain(created.asset.id);
    const other = await ok("ada", "list-marketing-assets", { id: project, typeId: otherTypeId });
    expect((other.assets as { id: string }[]).map((asset) => asset.id)).not.toContain(created.asset.id);
  });

  it("keeps an asset's address, and lets any agent change it", async () => {
    const created = await ok("ada", "create-marketing-asset", { id: project, name: unique("Home page"), typeId, url: "https://example.com/" });
    expect(created.asset.url).toBe("https://example.com/");
    const updated = await ok("bob", "update-marketing-asset", { id: project, assetId: created.asset.id, url: "https://example.com/home" });
    expect(updated.asset).toMatchObject({ id: created.asset.id, url: "https://example.com/home" });
    const bad = await refused("bob", "update-marketing-asset", { id: project, assetId: created.asset.id, url: "not an address" }, 400);
    expect(bad).toMatchObject({ error: "invalid_request", field: "url" });
  });

  it("lets any agent rate how good an asset is now, 0 to 100, and says why", async () => {
    const created = await ok("ada", "create-marketing-asset", { id: project, name: unique("Features page"), typeId });
    expect(created.asset.score).toBeNull();
    const rated = await ok("bob", "update-marketing-asset", { id: project, assetId: created.asset.id, score: 64, scoreNote: "Clear, but no screenshots." });
    expect(rated.asset).toMatchObject({ score: 64, scoreNote: "Clear, but no screenshots." });
    expect(rated.asset.scoredAt).toBeTruthy();
    // A reason only comes with a score.
    const noScore = await refused("bob", "update-marketing-asset", { id: project, assetId: created.asset.id, scoreNote: "Better now." }, 400);
    expect(noScore).toMatchObject({ error: "invalid_request", field: "scoreNote" });
  });

  it("refuses a name the type already has, ignoring case", async () => {
    const name = unique("Pricing");
    await ok("ada", "create-marketing-asset", { id: project, name, typeId });
    const body = await refused("ada", "create-marketing-asset", { id: project, name: name.toUpperCase(), typeId }, 409);
    expect(body).toMatchObject({ error: "duplicate_name", field: "name" });
  });

  it("files a proposal on an asset of its type, and refuses another type's", async () => {
    const asset = (await ok("ada", "create-marketing-asset", { id: project, name: unique("Careers"), typeId })).asset;
    const filed = await ok("ada", "create-idea", proposal("CLI marketing: on an asset", { assetId: asset.id }));
    expect(filed.idea).toMatchObject({ assetId: asset.id, typeId });

    const wrong = await refused("ada", "create-idea", proposal("CLI marketing: another type's asset", { typeId: otherTypeId, assetId: asset.id }), 422);
    expect(wrong).toMatchObject({ error: "invalid_asset" });
  });
});
