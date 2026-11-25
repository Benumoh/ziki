"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { isAdminOfOrganisation } from "@/lib/agents/membership";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { generateProjectDescription } from "@/lib/project-description-generation";
const input = z.object({ slug: z.string().trim().min(1).max(191), details: z.string().trim().max(1500) });
export async function generateProjectDescriptionAction(raw: { slug: string; details: string }): Promise<{ ok: true; description: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Add up to 1,500 characters of project details." };
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId || !await isAdminOfOrganisation(user, organisationId)) return { ok: false, error: "Only organisation owners and admins can draft a project description." };
  const project = await prisma.project.findFirst({
    where: { slug: parsed.data.slug, organisationId, archivedAt: null, organisation: { archivedAt: null } },
    select: { name: true, goal: true, organisation: { select: { name: true } }, areas: { select: { name: true }, take: 12 }, brief: { select: { product: true, audience: true } } },
  });
  if (!project) return { ok: false, error: "Project not found." };
  if (project.goal?.trim()) return { ok: false, error: "This project already has a description. Edit it directly instead." };
  if (!parsed.data.details && !project.brief?.product?.trim() && !project.brief?.audience?.trim()) return { ok: false, error: "Tell Ziki what the project does and who it is for, so it can draft an accurate description." };
  const limit = await consumeRateLimit(`project-description:${user.id}`, { max: 5, windowMs: 10 * 60_000 });
  if (!limit.allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };
  const description = await generateProjectDescription({ name: project.name, organisation: project.organisation.name, areas: project.areas.map(area => area.name), brief: project.brief ? { product: project.brief.product?.slice(0, 2000) ?? null, audience: project.brief.audience?.slice(0, 2000) ?? null } : null, details: parsed.data.details });
  return description ? { ok: true, description } : { ok: false, error: "Ziki's description assistant is unavailable. You can still write and save a description yourself." };
}
