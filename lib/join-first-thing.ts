import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { issueHref } from "@/lib/issue-ref";
import { ideaPath, refOf } from "@/lib/project-paths";
import type { FirstThing, Strength } from "@/lib/join-questions";

type Kind = "idea" | "confirm" | "judge" | "request";

/**
 * What to look for first for a member without an agent, from what they're good
 * at (#join-questions): a tester confirms an issue, a coder or reviewer judges
 * delivered work, and everyone else votes on an idea. The request box is
 * always last, since it is always there.
 */
export function firstThingOrder(strengths: readonly Strength[]): Kind[] {
  const order: Kind[] = [];
  if (strengths.includes("testing")) order.push("confirm");
  if (strengths.includes("review") || strengths.includes("code")) order.push("judge");
  order.push("idea", "confirm", "request");
  return [...new Set(order)];
}

const projectSelect = { select: { slug: true, organisation: { select: { slug: true } } } } as const;

/** Live work in the organisation's live projects; not the joiner's own. */
function issueWhere(organisationId: string, userId: string, where: Prisma.BugWhereInput): Prisma.BugWhereInput {
  return { organisationId, isDeleted: false, reporterId: { not: userId }, project: { archivedAt: null }, track: "product", ...where };
}

async function find(kind: Kind, organisationId: string, userId: string): Promise<FirstThing | null> {
  if (kind === "idea") {
    const idea = await prisma.idea.findFirst({
      where: {
        organisationId,
        status: "open",
        isDeleted: false,
        reporterId: { not: userId },
        project: { archivedAt: null },
        verdicts: { none: { onBehalfOfUserId: userId } },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true, title: true, summary: true, project: projectSelect },
    });
    return idea
      ? { kind: "idea", ideaId: idea.id, number: idea.number, title: idea.title, summary: idea.summary, href: ideaPath(refOf(idea.project), idea.number) }
      : null;
  }
  if (kind === "confirm" || kind === "judge") {
    const issue = await prisma.bug.findFirst({
      where: issueWhere(
        organisationId,
        userId,
        kind === "confirm"
          ? { substatus: "requires_confirmation", confirmations: { none: { onBehalfOfUserId: userId } } }
          : { substatus: "requires_review", testVerdicts: { none: { onBehalfOfUserId: userId } } },
      ),
      orderBy: { createdAt: "desc" },
      select: { number: true, title: true, project: projectSelect },
    });
    return issue ? { kind, number: issue.number, title: issue.title, href: issueHref(issue) } : null;
  }
  const project = await prisma.project.findFirst({
    where: { organisationId, archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return project ? { kind: "request", projectId: project.id } : null;
}

/** The first real thing to show a joiner, or null when the organisation has no live project at all. */
export async function pickFirstThing(
  organisationId: string,
  userId: string,
  strengths: readonly Strength[],
): Promise<FirstThing | null> {
  for (const kind of firstThingOrder(strengths)) {
    const found = await find(kind, organisationId, userId);
    if (found) return found;
  }
  return null;
}
