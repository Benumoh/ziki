"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { isSuperAdmin } from "@/lib/roles";
import { fixCheckId, fixSelection, listFixProjects, sendCheckFindings, type FixOutcome } from "@/lib/security-checks/fix";
import { prisma } from "@/lib/prisma";
import { isAdminOfOrganisation } from "@/lib/agents/membership";
import { nextProjectSlug, projectSettingsSchema, projectSlugBase } from "@/app/(app)/projects/validation";

async function currentClient() {
  const user = await requireUser();
  const access = await currentOrganisationAccess(user.id, user.role);
  if (!access.organisationId || !access.membershipRole) return null;
  return { userId: user.id, organisationId: access.organisationId, superAdmin: isSuperAdmin(user.role) };
}

export async function loadSecurityCheckFixOptions(checkId: string) {
  const parsed = fixCheckId.safeParse(checkId);
  if (!parsed.success) return null;
  const client = await currentClient();
  if (!client) return null;
  return listFixProjects(client, parsed.data);
}

export async function fixSecurityCheck(input: unknown): Promise<FixOutcome> {
  const selection = fixSelection.safeParse(input);
  if (!selection.success) return { ok: false, error: "Choose findings and a destination project." };
  const client = await currentClient();
  if (!client) return { ok: false, error: "Open your workspace before sending findings." };

  let outcome: FixOutcome;
  try {
    outcome = await sendCheckFindings(client, selection.data);
  } catch {
    // Database errors may include private report context. Return a safe message.
    return { ok: false, error: "Could not send the findings. Try again." };
  }
  if (outcome.ok) {
    revalidatePath("/security");
    const reportPath = `/security/checks/${encodeURIComponent(selection.data.checkId)}`;
    revalidatePath(reportPath);
    revalidatePath("/[org]/[project]", "layout");
  }
  return outcome;
}

/**
 * "New project" in the fix panel (18 Nov, Chloe): a private project named by the person (the site's name to start),
 * so a site that isn't the workspace's own (hotels.ng in the Ziki workspace) gets its own place for fixes. Private,
 * so it is never listed in Discover; it works like any other project in the workspace, agents included.
 */
export async function createFixProject(checkId: string, rawName: string): Promise<{ ok: true; projectId: string; name: string } | { ok: false; error: string }> {
  const parsedId = fixCheckId.safeParse(checkId);
  if (!parsedId.success) return { ok: false, error: "That scan isn't in your scans." };
  const user = await requireUser();
  const client = await currentClient();
  if (!client) return { ok: false, error: "Open your workspace first." };
  if (!client.superAdmin && !(await isAdminOfOrganisation(user, client.organisationId))) {
    return { ok: false, error: "Only workspace owners and admins can create projects." };
  }
  const check = await prisma.securityCheck.findFirst({
    where: { id: parsedId.data, requestedById: client.userId, organisationId: client.organisationId },
    select: { projectId: true, target: { select: { value: true } } },
  });
  if (!check) return { ok: false, error: "That scan isn't in your scans." };
  if (check.projectId) return { ok: false, error: "This scan's fixes already go to one of your projects." };
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) return { ok: false, error: "Enter a name for the new project." };
  const site = check.target.value;
  const parsed = projectSettingsSchema.safeParse({
    name,
    goal: `Security fixes for ${site}, from Ziki Security.`,
    repoUrl: "",
    stagingUrl: "",
    siteUrl: /^https?:\/\//i.test(site) ? site : `https://${site}`,
    visibility: "private",
    isOpenForContributors: false,
    acceptsGuestIdeas: false,
    contributorGuidelines: "",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the project name." };
  const existing = await prisma.project.findMany({ where: { organisationId: client.organisationId }, select: { slug: true, name: true } });
  if (existing.some((project) => project.name.trim().toLowerCase() === parsed.data.name.toLowerCase())) {
    return { ok: false, error: "A project with that name already exists. Choose another name, or pick it under One of your projects." };
  }
  const slug = nextProjectSlug(projectSlugBase(parsed.data.name), new Set(existing.map((project) => project.slug)));
  try {
    const project = await prisma.project.create({
      data: {
        organisationId: client.organisationId,
        name: parsed.data.name,
        slug,
        goal: parsed.data.goal,
        siteUrl: parsed.data.siteUrl,
        visibility: "private",
        workflow: { create: {} },
      },
      select: { id: true, name: true },
    });
    revalidatePath("/", "layout");
    return { ok: true, projectId: project.id, name: project.name };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2002") {
      return { ok: false, error: "A project with that name already exists. Choose another name." };
    }
    return { ok: false, error: "Couldn't create the project. Try again." };
  }
}
