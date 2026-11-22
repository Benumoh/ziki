"use server";

import { revalidatePath } from "next/cache";
import { cleanMarketingHistory } from "@/lib/marketing/assistant";
import { askProjectChat, type ProjectChatAnswer } from "@/lib/project-chat/assistant";
import { prisma } from "@/lib/prisma";
import type { ProjectRef } from "@/lib/project-paths";
import { requireProject } from "@/lib/project-route";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

/** Messages one person may send the project chat in an hour. */
const CHAT_RATE_LIMIT = { max: 120, windowMs: 60 * 60 * 1000 };

/**
 * Send the conversation to the project chat (#project-chat) and get Ziki's reply. Any member of the project may talk
 * to it; only an organisation owner or admin can change the project's basics through it. Nothing is saved but what
 * its tools set: the page keeps the conversation, and files any idea the reply hands back.
 */
export async function askProjectChatAction(slug: ProjectRef, history: unknown): Promise<ProjectChatAnswer> {
  const [org, projectSlug] = slug.split("/");
  const context = await requireProject(org, projectSlug);
  if (!context.canContribute) return { ok: false, error: "You can't post in this project." };

  const turns = cleanMarketingHistory(history);
  if (turns.at(-1)?.role !== "user") return { ok: false, error: "Say something first." };
  const limit = checkRateLimit(`project-chat:${context.user.id}`, CHAT_RATE_LIMIT);
  if (!limit.allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };

  const project = await prisma.project.findUnique({
    where: { id: context.project.id },
    select: { name: true, siteUrl: true, marketingUrl: true, repoUrl: true },
  });
  if (!project) return { ok: false, error: "Project not found." };

  const answer = await askProjectChat(turns, {
    organisationId: context.organisationId,
    projectId: context.project.id,
    userId: context.user.id,
    canEdit: context.isOrgAdmin,
    project,
  });
  if (answer.ok && answer.changed.length) revalidatePath("/", "layout");
  return answer;
}
