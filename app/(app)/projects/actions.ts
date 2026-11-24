"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { fieldError, fromZodError } from "@/lib/form-errors";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { refererProjectRef } from "@/lib/referer-path";
import { ideasPath, orgPath, projectRef } from "@/lib/project-paths";
import { currentOrganisationIdFor, NO_ORGANISATION_MESSAGE } from "@/lib/organisation-context";
import { isAdminOfOrganisation } from "@/lib/agents/membership";
import { isSuperAdmin, type AppRole } from "@/lib/roles";
import {
  nextProjectSlug,
  productKindsSchema,
  projectLinksSchema,
  siteUrlSchema,
  projectSettingsSchema,
  projectSlugBase,
  parseRewardConfigFromFormData,
} from "./validation";
import { parseProjectRewardConfig } from "@/lib/rewards/config";
import { DEFAULT_PROJECT_NAME } from "@/lib/organisations";
import { defaultProjectNameFor, readProductKinds, type ProductKind } from "@/lib/product-kinds";
import { organisationSoloBlock, setSolo, SOLO_BLOCK_MESSAGE } from "@/lib/projects/solo";
import { invalidateWorkflow } from "@/lib/workflow";

export type ProjectActionResult = {
  error?: string;
  field?: string;
  fieldErrors?: Record<string, string>;
  message?: string;
};

/**
 * Back to the org's Projects page (#project-urls), with a message. From a
 * project's page it is that project's; from the project's settings (no project
 * in the address), or when that project is the one just deleted, it is the
 * organisation's first active project's.
 */
async function projectsMessage(
  key: "error" | "notice",
  message: string,
  place?: { organisationId: string; deletedSlug?: string },
): Promise<string> {
  let slug = await refererProjectRef();
  if (place && (!slug || (place.deletedSlug && String(slug).split("/")[1] === encodeURIComponent(place.deletedSlug)))) {
    const other = await prisma.project.findFirst({
      where: { organisationId: place.organisationId, archivedAt: null, ...(place.deletedSlug ? { slug: { not: place.deletedSlug } } : {}) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { slug: true, organisation: { select: { slug: true } } },
    });
    slug = other ? projectRef(other.organisation.slug, other.slug) : null;
  }
  return slug ? `${orgPath(slug, "projects")}?${key}=${encodeURIComponent(message)}` : "/home";
}

/** The current organisation, only when the signed-in person owns it or is super admin. */
async function ownerOrganisationFor(
  userId: string,
  userRole?: AppRole | null,
): Promise<{ organisationId: string } | { error: string }> {
  const organisationId = await currentOrganisationIdFor(userId);
  if (!organisationId) return { error: NO_ORGANISATION_MESSAGE };

  if (isSuperAdmin(userRole)) {
    return { organisationId };
  }

  const membership = await prisma.membership.findUnique({
    where: { organisationId_userId: { organisationId, userId } },
    select: { role: true },
  });
  if (membership?.role !== "owner") {
    return { error: "Only a organisation owner can manage its projects." };
  }
  return { organisationId };
}

function projectInOrganisation(organisationId: string, projectId: string) {
  if (!projectId) return null;
  return prisma.project.findFirst({
    where: { id: projectId, organisationId },
    select: {
      id: true,
      name: true,
      slug: true,
      archivedAt: true,
      _count: { select: { bugs: true } },
    },
  });
}

export async function updateProjectAction(
  _previous: ProjectActionResult | undefined,
  formData: FormData,
): Promise<ProjectActionResult> {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { error: NO_ORGANISATION_MESSAGE };
  if (!(await isAdminOfOrganisation(user, organisationId))) return { error: "Only organisation owners and admins can change project settings." };

  const visibilityRaw = (formData.get("visibility") as string | null)?.trim();
  const visibility = visibilityRaw === "public" ? "public" : "private";
  const isOpenForContributors = visibility === "public" && (formData.get("isOpenForContributors") === "true" || formData.get("isOpenForContributors") === "on");
  const acceptsGuestIdeas = visibility === "public" && (formData.get("acceptsGuestIdeas") === "true" || formData.get("acceptsGuestIdeas") === "on");
  // The schema trims it and turns an empty box into null; it must be given a string.
  const contributorGuidelines = (formData.get("contributorGuidelines") as string | null) ?? "";
  const humanApprovalGuidelines = (formData.get("humanApprovalGuidelines") as string | null) ?? "";

  const parsed = projectSettingsSchema.safeParse({
    name: formData.get("name"),
    goal: formData.get("goal"),
    repoUrl: formData.get("repoUrl"),
    stagingUrl: formData.get("stagingUrl"),
    siteUrl: formData.get("siteUrl") ?? "",
    appStoreUrl: formData.get("appStoreUrl") ?? "",
    playStoreUrl: formData.get("playStoreUrl") ?? "",
    // Left as it is when the form doesn't have it (#product-kinds).
    downloadUrl: formData.has("downloadUrl") ? String(formData.get("downloadUrl") ?? "") : undefined,
    visibility,
    isOpenForContributors,
    acceptsGuestIdeas,
    contributorGuidelines,
    humanApprovalGuidelines,
  });
  if (!parsed.success) return fromZodError(parsed.error, "Check the project settings.");
  const slug = String(formData.get("slug") ?? "").trim();
  const project = await prisma.project.findFirst({
    where: { organisationId, slug },
    select: { id: true, name: true, goal: true, repoUrl: true, stagingUrl: true, siteUrl: true, appStoreUrl: true, playStoreUrl: true, downloadUrl: true, visibility: true, isOpenForContributors: true, acceptsGuestIdeas: true, contributorGuidelines: true, humanApprovalGuidelines: true, rewardConfig: true },
  });
  if (!project) return { error: "Project not found." };

  // The project's own guidelines; with none, the platform's show where it is read.
  const rawReward = parseRewardConfigFromFormData(formData);
  const rewardConfig = rawReward ? parseProjectRewardConfig(rawReward) : undefined;

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of ["name", "goal", "repoUrl", "stagingUrl", "siteUrl", "appStoreUrl", "playStoreUrl", "downloadUrl", "visibility", "isOpenForContributors", "acceptsGuestIdeas", "contributorGuidelines"] as const) {
    if (parsed.data[field] !== undefined && project[field] !== parsed.data[field]) {
      changes[field] = { from: project[field], to: parsed.data[field] };
    }
  }
  if ((project.humanApprovalGuidelines ?? null) !== (parsed.data.humanApprovalGuidelines ?? null)) {
    changes.humanApprovalGuidelines = { from: project.humanApprovalGuidelines ?? null, to: parsed.data.humanApprovalGuidelines ?? null };
  }
  if (rewardConfig !== undefined && JSON.stringify(project.rewardConfig) !== JSON.stringify(rewardConfig)) {
    changes.rewardConfig = { from: project.rewardConfig, to: rewardConfig };
  }

  if (Object.keys(changes).length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: project.id },
        data: {
          ...parsed.data,
          ...(rewardConfig !== undefined ? { rewardConfig } : {}),
          // Opened to contributors just now: the Earn banner names it and comes back for it (#earnings).
          ...(parsed.data.isOpenForContributors && !project.isOpenForContributors ? { openedForContributorsAt: new Date() } : {}),
          // Public: other people can work on it, so it isn't Solo any more (#solo).
          ...(parsed.data.visibility === "public" ? { solo: false } : {}),
        },
      });
      await tx.projectAuditEvent.create({
        data: {
          organisationId,
          projectId: project.id,
          actorUserId: user.id,
          action: "settings.updated",
          changes: changes as Prisma.InputJsonValue,
        },
      });
    });
  }
  invalidateWorkflow(project.id);
  revalidatePath(`/projects/${slug}/settings`);
  revalidatePath("/", "layout");
  return {};
}

/**
 * The panel above the list (#project-links): set the project's live site and
 * GitHub repository in one step. Same rules as the settings page: organisation
 * owners and admins only, validated the same way, recorded in the project's
 * audit log.
 */
export async function saveProjectLinksAction(
  _previous: ProjectActionResult | undefined,
  formData: FormData,
): Promise<ProjectActionResult> {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { error: NO_ORGANISATION_MESSAGE };
  if (!(await isAdminOfOrganisation(user, organisationId))) return { error: "Only organisation owners and admins can set these." };

  // Store and download links only when the form has them (#app-links, #product-kinds): the panel above the list
  // sets just the site and repository, plus the one link being edited.
  const storeLink = (name: string) => (formData.has(name) ? String(formData.get(name) ?? "") : undefined);
  const parsed = projectLinksSchema.safeParse({
    siteUrl: formData.get("siteUrl") ?? "",
    repoUrl: formData.get("repoUrl") ?? "",
    appStoreUrl: storeLink("appStoreUrl"),
    playStoreUrl: storeLink("playStoreUrl"),
    downloadUrl: storeLink("downloadUrl"),
  });
  if (!parsed.success) return fromZodError(parsed.error, "Check the addresses.");
  // The marketing site (#marketing-url) only when the form has it: forms without the field leave it as it is.
  const marketing = formData.has("marketingUrl") ? siteUrlSchema.safeParse(formData.get("marketingUrl") ?? "") : null;
  if (marketing && !marketing.success) return { error: marketing.error.issues[0]?.message ?? "Check the marketing site.", fieldErrors: { marketingUrl: marketing.error.issues[0]?.message ?? "" } };
  const data: {
    siteUrl: string | null;
    repoUrl: string | null;
    marketingUrl?: string | null;
    appStoreUrl?: string | null;
    playStoreUrl?: string | null;
    downloadUrl?: string | null;
  } = { ...parsed.data, ...(marketing?.success ? { marketingUrl: marketing.data } : {}) };
  const slug = String(formData.get("slug") ?? "").trim();
  const project = await prisma.project.findFirst({
    where: { organisationId, slug },
    select: { id: true, siteUrl: true, repoUrl: true, marketingUrl: true, appStoreUrl: true, playStoreUrl: true, downloadUrl: true },
  });
  if (!project) return { error: "Project not found." };

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of ["siteUrl", "repoUrl", "marketingUrl", "appStoreUrl", "playStoreUrl", "downloadUrl"] as const) {
    const to = data[field];
    if (to !== undefined && project[field] !== to) changes[field] = { from: project[field], to };
  }
  if (Object.keys(changes).length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: project.id }, data });
      await tx.projectAuditEvent.create({
        data: { organisationId, projectId: project.id, actorUserId: user.id, action: "settings.updated", changes: changes as Prisma.InputJsonValue },
      });
    });
  }
  revalidatePath("/", "layout");
  return { message: "Saved." };
}

/**
 * First questions (#product-kinds): what the project is, one or more of website,
 * mobile, desktop and other (with the owner's words for it, such as a game), or not built yet.
 * Saving it also renames the untouched first project ("Web") when "Web" is wrong
 * for it: "App" for anything built without a website. A name
 * someone chose is never touched. Owners and admins only, audited like any settings change.
 */
export async function saveProductKindsAction(
  slug: string,
  kinds: ProductKind[],
  other: string,
): Promise<ProjectActionResult> {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { error: NO_ORGANISATION_MESSAGE };
  if (!(await isAdminOfOrganisation(user, organisationId))) return { error: "Only organisation owners and admins can set what a project is." };
  const parsed = productKindsSchema.safeParse({ kinds, other: String(other ?? "") });
  if (!parsed.success) return fromZodError(parsed.error, "Pick what you're building.");
  const project = await prisma.project.findFirst({
    where: { organisationId, slug: String(slug).trim() },
    select: { id: true, name: true, productKinds: true, productOther: true },
  });
  if (!project) return { error: "Project not found." };

  const { productKinds, productOther } = parsed.data;
  // Untouched: still "Web", or still the name the last answer gave it, so answering again renames it again.
  const untouched =
    project.name === DEFAULT_PROJECT_NAME ||
    project.name === defaultProjectNameFor(readProductKinds(project.productKinds), project.productOther);
  const fitting = untouched ? (defaultProjectNameFor(productKinds, productOther) ?? DEFAULT_PROJECT_NAME) : null;
  const renamed = fitting && fitting !== project.name ? fitting : null;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (project.productKinds.join(",") !== productKinds.join(",")) changes.productKinds = { from: project.productKinds, to: productKinds };
  if (project.productOther !== productOther) changes.productOther = { from: project.productOther, to: productOther };
  if (renamed) changes.name = { from: project.name, to: renamed };
  if (Object.keys(changes).length === 0) return {};

  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: project.id },
      data: { productKinds, productOther, ...(renamed ? { name: renamed } : {}) },
    });
    await tx.projectAuditEvent.create({
      data: { organisationId, projectId: project.id, actorUserId: user.id, action: "settings.updated", changes: changes as Prisma.InputJsonValue },
    });
  });
  revalidatePath("/", "layout");
  return { message: "Saved." };
}

/**
 * The Overview's "Who will work on your tasks?" card (#price-lock, #solo): makes the project public and open to contributors in
 * one step, so agents from outside the organisation can find it on Discover, join and price its issues. Owners and
 * admins only, recorded in the project's audit log like any settings change.
 */
export async function openProjectToAgentsAction(projectId: string): Promise<ProjectActionResult> {
  const user = await requireUser();
  const project = await prisma.project.findUnique({
    where: { id: String(projectId ?? "") },
    select: { id: true, organisationId: true, archivedAt: true, visibility: true, isOpenForContributors: true },
  });
  if (!project || project.archivedAt) return { error: "Project not found." };
  if (!(await isAdminOfOrganisation(user, project.organisationId))) return { error: "Only organisation owners and admins can open a project to agents." };
  if (project.visibility === "public" && project.isOpenForContributors) return { message: "It is already open to agents on Ziki." };

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (project.visibility !== "public") changes.visibility = { from: project.visibility, to: "public" };
  if (!project.isOpenForContributors) changes.isOpenForContributors = { from: false, to: true };
  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: project.id },
      // Opened to contributors just now: the Earn banner names it and comes back for it (#earnings). It is no longer
      // Solo (#solo): other people's agents will work on it.
      data: { visibility: "public", isOpenForContributors: true, solo: false, ...(project.isOpenForContributors ? {} : { openedForContributorsAt: new Date() }) },
    });
    await tx.projectAuditEvent.create({
      data: { organisationId: project.organisationId, projectId: project.id, actorUserId: user.id, action: "settings.updated", changes: changes as Prisma.InputJsonValue },
    });
  });
  invalidateWorkflow(project.id);
  revalidatePath("/", "layout");
  return { message: "Open. Agents on Ziki can now find this project, join it and price its issues." };
}

/**
 * Solo (#solo): the owner works on this project with their own agents only. Turning it on is refused while someone
 * else could work in it (lib/projects/solo.ts soloBlock). Owners and admins only, recorded in the project's audit log.
 */
export async function setProjectSoloAction(projectId: string, solo: boolean): Promise<ProjectActionResult> {
  const user = await requireUser();
  const project = await prisma.project.findUnique({ where: { id: String(projectId ?? "") }, select: { id: true, organisationId: true, archivedAt: true, solo: true } });
  if (!project || project.archivedAt) return { error: "Project not found." };
  if (!(await isAdminOfOrganisation(user, project.organisationId))) return { error: "Only organisation owners and admins can change how a project is worked on." };
  if (project.solo === solo) return { message: solo ? "It is already Solo." : "It is already open to others." };
  const result = await setSolo(project.id, solo);
  if (!result.ok) return { error: result.error };
  await prisma.projectAuditEvent.create({
    data: { organisationId: project.organisationId, projectId: project.id, actorUserId: user.id, action: "settings.updated", changes: { solo: { from: !solo, to: solo } } as Prisma.InputJsonValue },
  });
  revalidatePath("/", "layout");
  return {
    message: solo
      ? "Solo. Your tasks start straight away with your own agents: no prices, no funding."
      : "Solo is off. Make the project public and open it to agents on Ziki to have them price and work on your tasks.",
  };
}

/**
 * Create a project in the current organisation and make it active (#426).
 *
 * The slug is derived from the name; a second "Zedu Web" becomes
 * "zedu-web-2" rather than failing the person's click.
 */
export async function createProjectAction(
  _previous: ProjectActionResult | undefined,
  formData: FormData,
): Promise<ProjectActionResult> {
  const user = await requireUser();
  const requestedOrgSlug = (formData.get("orgSlug") as string | null)?.trim();
  let organisationId = await currentOrganisationIdFor(user.id);
  if (requestedOrgSlug) {
    const orgBySlug = await prisma.organisation.findUnique({
      where: { slug: requestedOrgSlug },
      select: { id: true, slug: true },
    });
    if (orgBySlug) {
      organisationId = orgBySlug.id;
    }
  }
  if (!organisationId) return { error: NO_ORGANISATION_MESSAGE };
  if (!(await isAdminOfOrganisation(user, organisationId))) {
    return { error: "Only organisation owners and admins can create projects." };
  }

  // #solo: just the owner and their own agents. Only while nobody else works in the organisation, and always private.
  const solo = formData.get("solo") === "true";
  if (solo) {
    const block = await organisationSoloBlock(prisma, organisationId);
    if (block) return { error: SOLO_BLOCK_MESSAGE[block] };
  }
  const visibilityRaw = (formData.get("visibility") as string | null)?.trim();
  const visibility: "public" | "private" = !solo && visibilityRaw === "public" ? "public" : "private";
  const isOpenForContributors = visibility === "public" && (formData.get("isOpenForContributors") === "true" || formData.get("isOpenForContributors") === "on");
  const acceptsGuestIdeas = visibility === "public" && (formData.get("acceptsGuestIdeas") === "true" || formData.get("acceptsGuestIdeas") === "on");
  // The schema trims it and turns an empty box into null; it must be given a string.
  const contributorGuidelines = (formData.get("contributorGuidelines") as string | null) ?? "";

  const parsed = projectSettingsSchema.safeParse({
    name: formData.get("name"),
    goal: formData.get("goal") ?? "",
    repoUrl: formData.get("repoUrl") ?? "",
    stagingUrl: formData.get("stagingUrl") ?? "",
    siteUrl: formData.get("siteUrl") ?? "",
    visibility,
    isOpenForContributors,
    acceptsGuestIdeas,
    contributorGuidelines,
  });
  if (!parsed.success) return fromZodError(parsed.error, "Check the project settings.");

  const existing = await prisma.project.findMany({
    where: { organisationId },
    select: { slug: true },
  });
  const slug = nextProjectSlug(
    projectSlugBase(parsed.data.name),
    new Set(existing.map((project) => project.slug)),
  );

  const rawReward = parseRewardConfigFromFormData(formData);
  const rewardConfig = rawReward ? parseProjectRewardConfig(rawReward) : null;

  try {
    await prisma.project.create({
      data: {
        organisationId,
        name: parsed.data.name,
        slug,
        goal: parsed.data.goal,
        repoUrl: parsed.data.repoUrl,
        siteUrl: parsed.data.siteUrl,
        stagingUrl: parsed.data.stagingUrl,
        visibility,
        isOpenForContributors,
        openedForContributorsAt: isOpenForContributors ? new Date() : null,
        acceptsGuestIdeas,
        contributorGuidelines: parsed.data.contributorGuidelines,
        rewardConfig: rewardConfig ?? undefined,
        solo,
        workflow: { create: {} },
      },
      select: { id: true },
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return fieldError("name", "A project with that name already exists.");
    }
    throw error;
  }

  revalidatePath("/", "layout");
  // A new project opens on its own page (#project-urls).
  const organisation = await prisma.organisation.findUnique({ where: { id: organisationId }, select: { slug: true } });
  redirect(organisation ? ideasPath(projectRef(organisation.slug, slug)) : "/home");
}

/** Archive or restore a project the organisation owner owns. */
export async function setProjectArchivedAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const owner = await ownerOrganisationFor(user.id, user.role);
  if ("error" in owner) redirect(await projectsMessage("error", owner.error));

  const project = await projectInOrganisation(owner.organisationId, String(formData.get("projectId") ?? ""));
  if (!project) redirect(await projectsMessage("error", "That project isn't in this organisation."));

  const archived = String(formData.get("archived") ?? "") === "true";
  if (Boolean(project.archivedAt) !== archived) {
    await prisma.project.update({
      where: { id: project.id },
      data: { archivedAt: archived ? new Date() : null },
    });
  }

  revalidatePath("/", "layout");
  redirect(await projectsMessage("notice", archived ? "Project archived." : "Project restored.", { organisationId: owner.organisationId }));
}

/** Delete a project after the owner types its name, and only when it has no issues. */
export async function deleteProjectAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const owner = await ownerOrganisationFor(user.id, user.role);
  if ("error" in owner) redirect(await projectsMessage("error", owner.error));

  const project = await projectInOrganisation(owner.organisationId, String(formData.get("projectId") ?? ""));
  if (!project) redirect(await projectsMessage("error", "That project isn't in this organisation."));

  if (project._count.bugs > 0) {
    redirect(
      await projectsMessage("error", "This project still has issues. Archive it instead."),
    );
  }

  const typed = String(formData.get("confirmName") ?? "").trim();
  if (typed !== project.name) {
    redirect(await projectsMessage("error", "Type the project's name exactly to confirm."));
  }

  try {
    await prisma.project.delete({ where: { id: project.id } });
  } catch (error) {
    console.error("[projects] deleteProjectAction failed", error);
    redirect(await projectsMessage("error", "Couldn't delete this project. Archive it instead."));
  }

  revalidatePath("/", "layout");
  redirect(await projectsMessage("notice", "Project deleted.", { organisationId: owner.organisationId, deletedSlug: project.slug }));
}
