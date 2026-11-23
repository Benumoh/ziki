import { z } from "zod";
import { typeChangedSummary } from "@/lib/activity-log";
import { IssueApiError } from "@/lib/agent-api/errors";
import { expireTag, TAGS } from "@/lib/cache-tags";
import { canDeleteIssueType, issueTypeInputSchema } from "@/lib/issue-types";
import { MARKETING_TRACK } from "@/lib/marketing/track";
import { prisma } from "@/lib/prisma";

/**
 * Marketing task types (M-API-7): the `IssueType`s with `track: "marketing"`.
 * They have no price (D5), because each task pays out its own funded price. Types
 * belong to the organisation, so the name is unique across both tracks, and these
 * functions never read or change a product type. The agent routes and the
 * Marketing settings page both call these functions.
 */

export type MarketingTaskType = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  track: "marketing";
  createdAt: Date;
  updatedAt: Date;
};

const taskTypeSelect = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  track: true,
  createdAt: true,
  updatedAt: true,
} as const;

const nameField = issueTypeInputSchema.shape.name;
const descriptionField = z.string().trim().max(300, "Keep the description to 300 characters or fewer.").nullable();

/** POST body: `name` is required, `description` and `isActive` (default true) are optional. */
export const createMarketingTaskTypeSchema = z
  .object({
    name: nameField,
    description: descriptionField.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

/** PATCH body: any of the fields, at least one. */
export const updateMarketingTaskTypeSchema = z
  .object({
    name: nameField.optional(),
    description: descriptionField.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Send at least one of name, description or isActive." });

export type CreateMarketingTaskTypeInput = z.input<typeof createMarketingTaskTypeSchema>;
export type UpdateMarketingTaskTypeInput = z.input<typeof updateMarketingTaskTypeSchema>;

const NOT_FOUND = "Marketing task type not found.";

function invalid(message: string, field?: string): IssueApiError {
  return new IssueApiError(400, message, { error: "invalid_request", message, ...(field ? { field } : {}) });
}

function notFound(): IssueApiError {
  return new IssueApiError(404, NOT_FOUND, { error: "not_found", message: NOT_FOUND });
}

function duplicate(name: string): IssueApiError {
  const message = `A type named "${name}" already exists.`;
  return new IssueApiError(409, message, { error: "duplicate_name", message, field: "name" });
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  if (issue?.code === "unrecognized_keys") {
    const message = `Unknown field: ${issue.keys.join(", ")}.`;
    throw new IssueApiError(422, message, { error: "invalid_request", message, field: issue.keys[0] });
  }
  const field = issue?.path[0];
  throw invalid(issue?.message ?? "Invalid task type.", typeof field === "string" ? field : undefined);
}

const prismaCode = (err: unknown): string | undefined =>
  typeof err === "object" && err !== null && "code" in err && typeof err.code === "string" ? err.code : undefined;

/** The project, looked up by id or slug, must belong to the organisation. */
export async function marketingTaskTypeProject(organisationId: string, projectIdOrSlug: string) {
  const project = await prisma.project.findFirst({
    where: { organisationId, OR: [{ id: projectIdOrSlug }, { slug: projectIdOrSlug }] },
    select: { id: true, slug: true },
  });
  if (!project) throw new IssueApiError(404, "Project not found.", { error: "not_found", message: "Project not found." });
  return project;
}

/** A case-insensitive name match on either track, other than `exceptId`. */
async function assertNameFree(organisationId: string, name: string, exceptId?: string): Promise<void> {
  const existing = await prisma.issueType.findFirst({
    where: {
      organisationId,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { name: true },
  });
  if (existing) throw duplicate(existing.name);
}

async function findMarketingType(organisationId: string, id: string) {
  if (!id || typeof id !== "string" || id.length > 191) throw notFound();
  const row = await prisma.issueType.findFirst({
    where: { id, organisationId, ...MARKETING_TRACK },
    select: taskTypeSelect,
  });
  if (!row) throw notFound();
  return row as MarketingTaskType;
}

/** Active types, A–Z. With `includeInactive`, retired ones are listed too. */
export async function listMarketingTaskTypes(
  organisationId: string,
  options: { includeInactive?: boolean } = {},
): Promise<MarketingTaskType[]> {
  const rows = await prisma.issueType.findMany({
    where: { organisationId, ...MARKETING_TRACK, ...(options.includeInactive ? {} : { isActive: true }) },
    select: taskTypeSelect,
    orderBy: { name: "asc" },
  });
  return rows as MarketingTaskType[];
}

export async function getMarketingTaskType(organisationId: string, id: string): Promise<MarketingTaskType> {
  return findMarketingType(organisationId, id);
}

export async function createMarketingTaskType(organisationId: string, body: unknown): Promise<MarketingTaskType> {
  const input = parse(createMarketingTaskTypeSchema, body);
  const name = input.name.trim();
  await assertNameFree(organisationId, name);

  try {
    const row = await prisma.issueType.create({
      data: {
        organisationId,
        name,
        description: input.description ? input.description : null,
        track: "marketing",
        isActive: input.isActive ?? true,
      },
      select: taskTypeSelect,
    });
    expireTag(TAGS.issueTypes);
    return row as MarketingTaskType;
  } catch (err) {
    if (prismaCode(err) === "P2002") throw duplicate(name);
    throw err;
  }
}

/** A rename leaves a "type changed" note on every task that carries the type. */
export async function updateMarketingTaskType(
  organisationId: string,
  actorId: string,
  id: string,
  body: unknown,
): Promise<MarketingTaskType> {
  const input = parse(updateMarketingTaskTypeSchema, body);
  const current = await findMarketingType(organisationId, id);
  const name = input.name?.trim();
  if (name !== undefined) await assertNameFree(organisationId, name, id);

  try {
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.issueType.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(input.description !== undefined ? { description: input.description ? input.description : null } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        select: taskTypeSelect,
      });

      if (name !== undefined && current.name !== name) {
        const linked = await tx.bug.findMany({ where: { typeId: id, organisationId }, select: { id: true } });
        if (linked.length > 0) {
          await tx.bugActivity.createMany({
            data: linked.map((task) => ({
              bugId: task.id,
              actorId,
              type: "type_changed",
              summary: typeChangedSummary(current.name, name),
              metadata: { field: "type", from: current.name, to: name },
            })),
          });
        }
      }
      return updated;
    });
    expireTag(TAGS.issueTypes);
    return row as MarketingTaskType;
  } catch (err) {
    const code = prismaCode(err);
    if (code === "P2002" && name !== undefined) throw duplicate(name);
    if (code === "P2025") throw notFound();
    throw err;
  }
}

/** Flip a type between active and retired. Retired types keep their history but can't be proposed with. */
export async function toggleMarketingTaskTypeActive(organisationId: string, actorId: string, id: string): Promise<MarketingTaskType> {
  const current = await findMarketingType(organisationId, id);
  return updateMarketingTaskType(organisationId, actorId, id, { isActive: !current.isActive });
}

/**
 * Delete a type that no task or proposal uses. A type in use is refused with
 * the thing to do instead: deactivate it.
 */
export async function deleteMarketingTaskType(organisationId: string, id: string): Promise<{ id: string; deleted: true }> {
  await findMarketingType(organisationId, id);
  const [issues, ideas] = await Promise.all([
    prisma.bug.count({ where: { typeId: id, organisationId } }),
    prisma.idea.count({ where: { typeId: id, organisationId } }),
  ]);
  const check = canDeleteIssueType(issues + ideas);
  if (!check.allowed) {
    const message = check.reason ?? "This type is in use. Deactivate it instead.";
    throw new IssueApiError(409, message, { error: "type_in_use", message, issues, ideas });
  }

  try {
    await prisma.issueType.delete({ where: { id } });
  } catch (err) {
    if (prismaCode(err) === "P2025") throw notFound();
    throw err;
  }
  expireTag(TAGS.issueTypes);
  return { id, deleted: true };
}
