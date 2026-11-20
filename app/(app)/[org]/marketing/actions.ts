"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { projectLinksSchema } from "@/app/(app)/projects/validation";
import { IssueApiError } from "@/lib/agent-api/errors";
import { createMarketingAsset, updateMarketingAsset } from "@/lib/marketing/assets";
import { askMarketingAssistant, cleanMarketingHistory } from "@/lib/marketing/assistant";
import type { MarketingAnswer } from "@/lib/marketing/assistant-shared";
import { MARKETING_TRACK } from "@/lib/marketing/track";
import { prisma } from "@/lib/prisma";
import { marketingPath, type ProjectRef } from "@/lib/project-paths";
import { requireProject } from "@/lib/project-route";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

export type MarketingSiteResult = { error?: string; ok?: boolean };

const siteSchema = projectLinksSchema.pick({ siteUrl: true });

/**
 * The Marketing home's first step (#marketing-home): the website to improve the
 * marketing for. It is the project's site link, the same one Project settings
 * and the panel above the issue list set, so it has their rule: organisation
 * any project member for now, validated the same way, recorded in the audit log.
 */
export async function saveMarketingSiteAction(
  slug: ProjectRef,
  _previous: MarketingSiteResult | undefined,
  formData: FormData,
): Promise<MarketingSiteResult> {
  const [org, projectSlug] = slug.split("/");
  const context = await requireProject(org, projectSlug);

  const parsed = siteSchema.safeParse({ siteUrl: formData.get("siteUrl") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the address." };
  const siteUrl = parsed.data.siteUrl;
  if (!siteUrl) return { error: "Enter your website's address." };

  // The marketing site (#marketing-url): apart from the app's address, which it also becomes when that isn't set yet.
  const project = await prisma.project.findUnique({ where: { id: context.project.id }, select: { siteUrl: true, marketingUrl: true } });
  if (project?.marketingUrl !== siteUrl) {
    await prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: context.project.id }, data: { marketingUrl: siteUrl, ...(project?.siteUrl ? {} : { siteUrl }) } });
      await tx.projectAuditEvent.create({
        data: {
          organisationId: context.organisationId,
          projectId: context.project.id,
          actorUserId: context.user.id,
          action: "settings.updated",
          changes: { marketingUrl: { from: project?.marketingUrl ?? null, to: siteUrl }, ...(project?.siteUrl ? {} : { siteUrl: { from: null, to: siteUrl } }) } as Prisma.InputJsonValue,
        },
      });
    });
  }
  revalidatePath(marketingPath(slug));
  return { ok: true };
}

/** Messages one person may send the Marketing assistant in an hour. */
const ASSISTANT_RATE_LIMIT = { max: 60, windowMs: 60 * 60 * 1000 };

/**
 * Send the conversation to the Marketing assistant (#marketing-assistant) and
 * get its reply. Any project member for now, once the project has its
 * website. Its tools read this project only; a drafted task is filed only when
 * the person files it. Nothing is saved: the page keeps the conversation.
 */
export async function askMarketingAssistantAction(slug: ProjectRef, history: unknown): Promise<MarketingAnswer> {
  const [org, projectSlug] = slug.split("/");
  const context = await requireProject(org, projectSlug);

  const turns = cleanMarketingHistory(history);
  if (turns.at(-1)?.role !== "user") return { ok: false, error: "Describe the marketing problem first." };

  const [project, taskTypes] = await Promise.all([
    prisma.project.findUnique({ where: { id: context.project.id }, select: { name: true, siteUrl: true, marketingUrl: true } }),
    prisma.issueType.findMany({
      where: { organisationId: context.organisationId, ...MARKETING_TRACK, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  // The marketing site (#marketing-url), else the app's own address.
  const site = project?.marketingUrl ?? project?.siteUrl;
  if (!project || !site) return { ok: false, error: "Add the project's website first." };

  const limit = checkRateLimit(`marketing-assistant:${context.user.id}`, ASSISTANT_RATE_LIMIT);
  if (!limit.allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };

  return askMarketingAssistant(turns, {
    name: project.name,
    siteUrl: site,
    organisationId: context.organisationId,
    projectId: context.project.id,
    taskTypes,
  });
}

export type MarketingAssetResult = { error?: string; ok?: boolean };

/**
 * Add an asset to a marketing type (#marketing-assets): a landing page such as About Us, a video, a post series.
 * Work is then filed on it. The same rules as the agent route (lib/marketing/assets.ts).
 */
export async function createMarketingAssetAction(
  slug: ProjectRef,
  typeId: string,
  _previous: MarketingAssetResult | undefined,
  formData: FormData,
): Promise<MarketingAssetResult> {
  const [org, projectSlug] = slug.split("/");
  const context = await requireProject(org, projectSlug);
  try {
    await createMarketingAsset(context.organisationId, { name: String(formData.get("name") ?? ""), typeId });
  } catch (error) {
    if (error instanceof IssueApiError) return { error: error.message };
    throw error;
  }
  revalidatePath(marketingPath(slug));
  return { ok: true };
}

/** Set or clear an asset's address (#marketing-assets), from its page. The same rules as the agent route. */
export async function updateMarketingAssetUrlAction(
  slug: ProjectRef,
  assetId: string,
  _previous: MarketingAssetResult | undefined,
  formData: FormData,
): Promise<MarketingAssetResult> {
  const [org, projectSlug] = slug.split("/");
  const context = await requireProject(org, projectSlug);
  try {
    await updateMarketingAsset(context.organisationId, assetId, { url: String(formData.get("url") ?? "") });
  } catch (error) {
    if (error instanceof IssueApiError) return { error: error.message };
    throw error;
  }
  revalidatePath(marketingPath(slug, `assets/${assetId}`));
  return { ok: true };
}

/** Rate an asset from its page (#asset-score): a score 0-100 and why. The same rules as the agent route. */
export async function rateMarketingAssetAction(
  slug: ProjectRef,
  assetId: string,
  _previous: MarketingAssetResult | undefined,
  formData: FormData,
): Promise<MarketingAssetResult> {
  const [org, projectSlug] = slug.split("/");
  const context = await requireProject(org, projectSlug);
  const raw = String(formData.get("score") ?? "").trim();
  const score = raw === "" ? null : Number(raw);
  try {
    await updateMarketingAsset(context.organisationId, assetId, { score, scoreNote: String(formData.get("scoreNote") ?? "") });
  } catch (error) {
    if (error instanceof IssueApiError) return { error: error.message };
    throw error;
  }
  revalidatePath(marketingPath(slug, `assets/${assetId}`));
  revalidatePath(marketingPath(slug));
  return { ok: true };
}
