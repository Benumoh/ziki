import { z } from "zod";
import { IssueApiError } from "@/lib/agent-api/errors";
import { MARKETING_TRACK } from "@/lib/marketing/track";
import { prisma } from "@/lib/prisma";

/**
 * Marketing assets (#marketing-assets): the things a marketing type's work is about, such as the About Us page under
 * Landing Pages or a launch video. Issues and ideas sit under one. They belong to the organisation, like Marketing.
 * The agent routes (/api/v1/projects/{id}/marketing/assets), the Marketing page and filing an idea all use these.
 */

export type MarketingAssetJson = {
  id: string; name: string; url: string | null; typeId: string; typeName: string;
  /** How good it is now, 0-100 (#asset-score), why, and when it was rated; null until rated. */
  score: number | null; scoreNote: string | null; scoredAt: Date | null;
  createdAt: Date; updatedAt: Date;
};

const assetSelect = {
  id: true, name: true, url: true, typeId: true, score: true, scoreNote: true, scoredAt: true, createdAt: true, updatedAt: true, type: { select: { name: true } },
} as const;

function assetJson({ type, ...asset }: Omit<MarketingAssetJson, "typeName"> & { type: { name: string } }): MarketingAssetJson {
  return { ...asset, typeName: type.name };
}

const nameField = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(2, "Give it a name of 2 to 80 characters.").max(80, "Give it a name of 2 to 80 characters."));
/** Where it lives: an http(s) address, at most 500 characters; empty clears it. */
const urlField = z
  .string()
  .trim()
  .max(500, "Keep the address to 500 characters.")
  .refine((value) => value === "" || /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(value), "Enter a full address, starting with https://.")
  .transform((value) => value || null)
  .nullable();

/** POST body: the asset's name, the marketing type it is under, and optionally its address. */
export const createMarketingAssetSchema = z.object({ name: nameField, typeId: z.string().trim().min(1).max(191), url: urlField.optional() }).strict();

/** How good it is now (#asset-score): a whole number 0-100, or null to clear it. */
const scoreField = z.number().int("The score is a whole number from 0 to 100.").min(0, "The score is from 0 to 100.").max(100, "The score is from 0 to 100.").nullable();
/** Why it got that score: at most 300 characters. */
const scoreNoteField = z.string().trim().max(300, "Keep the reason to 300 characters.").transform((value) => value || null).nullable();

/** PATCH body: a new name, address or score (with why), at least one. */
export const updateMarketingAssetSchema = z
  .object({ name: nameField.optional(), url: urlField.optional(), score: scoreField.optional(), scoreNote: scoreNoteField.optional() })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: "Send name, url or score." })
  .refine((value) => value.scoreNote === undefined || value.score !== undefined, { message: "Send scoreNote with a score.", path: ["scoreNote"] });

function badRequest(error: z.ZodError): never {
  const issue = error.issues[0];
  const field = String(issue?.path[0] ?? "name");
  const message = issue?.message ?? "Check the asset.";
  throw new IssueApiError(400, message, { error: "invalid_request", message, field });
}

/** The organisation's assets, by name; `typeId` keeps one type's. */
export async function listMarketingAssets(organisationId: string, typeId?: string | null): Promise<MarketingAssetJson[]> {
  const rows = await prisma.marketingAsset.findMany({
    where: { organisationId, ...(typeId ? { typeId } : {}) },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: assetSelect,
  });
  return rows.map(assetJson);
}

/**
 * Add an asset under an active marketing type. Any member (or their agent) may. 400 for a bad body, 422
 * invalid_type for a type that isn't an active marketing type here, 409 duplicate_name for a name the type has.
 */
export async function createMarketingAsset(organisationId: string, body: unknown): Promise<MarketingAssetJson> {
  const parsed = createMarketingAssetSchema.safeParse(body);
  if (!parsed.success) badRequest(parsed.error);
  const { name, typeId, url } = parsed.data;
  const type = await prisma.issueType.findFirst({ where: { id: typeId, organisationId, ...MARKETING_TRACK, isActive: true }, select: { id: true } });
  if (!type) {
    const message = "typeId must be one of the organisation's active marketing task types.";
    throw new IssueApiError(422, message, { error: "invalid_type", message, field: "typeId" });
  }
  const taken = await prisma.marketingAsset.findFirst({ where: { typeId, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
  if (taken) {
    const message = `This type already has an asset called ${name}.`;
    throw new IssueApiError(409, message, { error: "duplicate_name", message, field: "name" });
  }
  return assetJson(await prisma.marketingAsset.create({ data: { organisationId, typeId, name, url: url ?? null }, select: assetSelect }));
}

/**
 * Rename an asset, set its address, or rate how good it is now (`score` 0-100 with `scoreNote`; rating stamps
 * `scoredAt`, and a new score replaces the reason). Any member (or their agent) may. 404 for another organisation's.
 */
export async function updateMarketingAsset(organisationId: string, assetId: string, body: unknown): Promise<MarketingAssetJson> {
  const parsed = updateMarketingAssetSchema.safeParse(body);
  if (!parsed.success) badRequest(parsed.error);
  const asset = await prisma.marketingAsset.findFirst({ where: { id: assetId, organisationId }, select: { id: true, typeId: true } });
  if (!asset) throw new IssueApiError(404, "Asset not found.", { error: "not_found", message: "Asset not found." });
  const { name, url, score, scoreNote } = parsed.data;
  if (name !== undefined) {
    const taken = await prisma.marketingAsset.findFirst({ where: { typeId: asset.typeId, name: { equals: name, mode: "insensitive" }, NOT: { id: asset.id } }, select: { id: true } });
    if (taken) {
      const message = `This type already has an asset called ${name}.`;
      throw new IssueApiError(409, message, { error: "duplicate_name", message, field: "name" });
    }
  }
  const rating = score === undefined ? {} : { score, scoreNote: score === null ? null : scoreNote ?? null, scoredAt: score === null ? null : new Date() };
  return assetJson(
    await prisma.marketingAsset.update({
      where: { id: asset.id },
      data: { ...(name !== undefined ? { name } : {}), ...(url !== undefined ? { url } : {}), ...rating },
      select: assetSelect,
    }),
  );
}

/**
 * The asset marketing work sits on (#marketing-assets): `assetId` when given, which must be one of this organisation's
 * assets under the work's own type (422 invalid_asset otherwise). Marketing work filed without one gains an asset of
 * its own under its type, named after its title (at most 80 characters), or the one already by that name: every piece
 * of marketing work is on an asset, so there is no "Other work". Work that isn't marketing, or has no type, has none.
 */
export async function assetForWork(
  db: Pick<typeof prisma, "marketingAsset">,
  organisationId: string,
  assetId: string | null | undefined,
  track: string,
  typeId: string | null,
  title: string,
): Promise<string | null> {
  if (!assetId) {
    if (track !== "marketing" || !typeId) return null;
    // Named as the migration named earlier work's assets: the title, trimmed, cut at 80 characters.
    const name = title.trim().slice(0, 80);
    const asset = await db.marketingAsset.upsert({
      where: { typeId_name: { typeId, name } },
      create: { organisationId, typeId, name },
      update: {},
      select: { id: true },
    });
    return asset.id;
  }
  const asset = await db.marketingAsset.findFirst({ where: { id: assetId, organisationId }, select: { typeId: true } });
  if (track !== "marketing" || !asset || asset.typeId !== typeId) {
    const message = "assetId must be one of this organisation's marketing assets, under the idea's typeId (list them with GET /api/v1/projects/{id}/marketing/assets).";
    throw new IssueApiError(422, message, { error: "invalid_asset", message, field: "assetId" });
  }
  return assetId;
}
