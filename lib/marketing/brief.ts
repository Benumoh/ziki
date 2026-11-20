import { prisma } from "@/lib/prisma";
import { projectBriefSchema } from "@/lib/validations/marketing";

/** The brief as agents read it (docs/ziki-for-agents.md, "The project brief"). */
export type AgentBrief = {
  product: string | null;
  audience: string | null;
  website: string | null;
  current_focus: string | null;
  out_of_scope: string | null;
};

/** The project's brief for agents, or `null` when nobody has filled any of it in. */
export async function readProjectBrief(projectId: string): Promise<AgentBrief | null> {
  const [row, project] = await Promise.all([
    prisma.projectBrief.findUnique({ where: { projectId } }),
    prisma.project.findUnique({ where: { id: projectId }, select: { siteUrl: true, marketingUrl: true } }),
  ]);
  const brief: AgentBrief = {
    product: row?.product ?? null,
    audience: row?.audience ?? null,
    // The marketing site (#marketing-url), else the app's own address.
    website: project?.marketingUrl ?? project?.siteUrl ?? null,
    current_focus: row?.currentFocus ?? null,
    out_of_scope: row?.outOfScope ?? null,
  };
  return Object.values(brief).some(Boolean) ? brief : null;
}

/**
 * Save a project's whole brief and audit which fields changed. Callers check the
 * person may change marketing settings and that the project is in their organisation.
 */
export async function saveProjectBrief(
  organisationId: string,
  projectId: string,
  actorUserId: string,
  rawInput: unknown,
): Promise<void> {
  const brief = projectBriefSchema.parse(rawInput);
  const current = await prisma.projectBrief.findUnique({ where: { projectId } });
  const fields = (Object.keys(brief) as (keyof typeof brief)[]).filter(
    (field) => brief[field] !== (current?.[field] ?? null),
  );
  if (fields.length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.projectBrief.upsert({
      where: { projectId },
      update: brief,
      create: { projectId, ...brief },
    });
    await tx.projectAuditEvent.create({
      data: { organisationId, projectId, actorUserId, action: "marketing.brief.updated", changes: { fields } },
    });
  });
}
