import { NextResponse, type NextRequest } from "next/server";
import { reportSummarySchema } from "@/lib/validations/report-summary";
import { z } from "zod";
import type { IdeaStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { audit } from "@/lib/agents/audit";
import { IssueApiError } from "@/lib/agent-api/errors";
import { publish } from "@/lib/agent-api/events";
import {
  createIdeaWithPolicy,
  decodeCursor,
  hashCreateRequest,
  LIMIT_RANGE_ERROR,
  pageSize,
  toPage,
  type IssueCursor,
} from "@/lib/agent-api/create-policy";
import { issueJson, issueProject, requireKnownFilter } from "@/lib/agent-api/issues";
import { parsePlatformFilter, PLATFORM_NONE } from "@/lib/platform-filter";
import { platformSelect, resolvePlatform, withPlatform } from "@/lib/platforms";
import { createBugSchema } from "@/lib/validations/issue";
import { attachmentIdsInMarkdown, linkAttachments } from "@/lib/attachment-link";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_ITEM, checkAttachment } from "@/lib/attachments";
import { MULTIPART_OVERHEAD_BYTES, readLimitedMultipart } from "@/lib/attachment-body";
import { createHash } from "node:crypto";
import { extractMentionedUserIds, normalizeMentions } from "@/lib/mentions";
import { boundSearchTerm, escapeSearchQuery } from "@/lib/search";
import { parseIssueRef } from "@/lib/issue-ref";
import { workflowFor } from "@/lib/workflow";
import { ideaVoteTotals, NO_VOTES } from "@/lib/idea-vote-totals";
import { agentAttachmentUrl } from "@/lib/agent-api/attachment-read";
import { convertVettedIdea } from "@/lib/agent-api/idea-verdicts";

/** How many ideas one person's agents may file as already vetted in 24 hours. */
export const VETTED_IDEAS_PER_DAY = 5;

/**
 * Ideas through the agent API (#idea-table). Every report is an idea: an
 * agent files one with `POST /api/v1/ideas`, people and agents give it
 * verdicts, and any agent converts it to an issue once its score
 * reaches the project's `ideaThreshold` (lib/agent-api/idea-verdicts.ts).
 * Ideas are numbered apart from issues.
 */

type Scope = { tenantId: string; projectId: string };

const idSchema = z.string().trim().min(1).max(191);
const attachmentIdsSchema = z.array(idSchema).max(MAX_ATTACHMENTS_PER_ITEM).optional();

export const createIdeaSchema = createBugSchema
  .pick({ title: true, description: true, areaId: true, proofLinks: true })
  .extend({
    /** #platforms: where it shows up, by slug ("desktop") or id, from GET /api/v1/platforms. */
    platform: z.string().trim().min(1).max(191).optional(),
    // #494: no beneficiaryUserId. The reporter is always the agent's owner.
    projectId: idSchema.optional(),
    typeId: z.unknown().optional(),
    acknowledgeSimilar: z.unknown().optional(),
    /** The owner says this idea was already vetted elsewhere: it becomes an issue at once (needs `vettedNote`). */
    alreadyVetted: z.boolean().optional(),
    /** Where and by whom it was approved, for example "Approved by Mark, sheet row 42". Shown on the issue. */
    vettedNote: z.string().trim().min(5).max(300).optional(),
    attachmentIds: attachmentIdsSchema,
    // Up to three plain lines a person can read at a glance (#report-summary).
    summary: reportSummarySchema,
  })
  .strict();

export const IDEA_STATUSES = ["open", "converted", "rejected", "archived"] as const satisfies readonly IdeaStatus[];

export const ideaSelect = {
  id: true,
  number: true,
  title: true,
  summary: true,
  description: true,
  status: true,
  score: true,
  typeId: true,
  categoryId: true,
  // #platforms: returned as `platform: { id, slug, name }` (ideaJson renames it).
  category: { select: platformSelect },
  areaId: true,
  proofLinks: true,
  projectId: true,
  reporterId: true,
  beneficiaryUserId: true,
  createdByAgentId: true,
  convertedAt: true,
  archiveReason: true,
  archiveEvidence: true,
  archiveDuplicateOf: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  area: { select: { id: true, name: true, slug: true } },
  issue: { select: { id: true, number: true } },
} satisfies Prisma.IdeaSelect;

type IdeaRow = Prisma.IdeaGetPayload<{ select: typeof ideaSelect }>;

/** The idea as the API shows it: the issue it became, and whether it can be converted now. */
export function ideaJson(idea: IdeaRow, ideaThreshold: number) {
  const { issue, ...rest } = withPlatform(idea);
  return {
    ...rest,
    issueId: issue?.id ?? null,
    issueNumber: issue?.number ?? null,
    ideaThreshold,
    convertible: idea.status === "open" && idea.score >= ideaThreshold,
  };
}

/** `?status=`, `?convertible=`, `?platform=` (slug, id or "none"), `?q=` and the shared cursor, newest first. */
export async function listAgentIdeas(scope: Scope, params: URLSearchParams) {
  const rawStatus = params.get("status");
  if (rawStatus && !(IDEA_STATUSES as readonly string[]).includes(rawStatus)) {
    throw new IssueApiError(400, `status must be one of ${IDEA_STATUSES.join(", ")}.`);
  }
  const convertibleRaw = params.get("convertible");
  if (convertibleRaw !== null && convertibleRaw !== "true" && convertibleRaw !== "false") {
    throw new IssueApiError(400, "convertible must be true or false.");
  }
  const cursorRaw = params.get("cursor");
  const cursor = decodeCursor(cursorRaw);
  if (cursorRaw !== null && !cursor) throw new IssueApiError(400, "Invalid cursor.");
  const limit = pageSize(params.get("limit"));
  if (limit === null) throw new IssueApiError(400, LIMIT_RANGE_ERROR);
  const { ideaThreshold } = await workflowFor(scope.projectId);
  const q = params.get("q")?.trim();
  const term = q ? escapeSearchQuery(boundSearchTerm(q)) : null;
  const rawPlatform = params.get("platform");
  const platforms = rawPlatform
    ? await prisma.category.findMany({ where: { tenantId: scope.tenantId }, select: { id: true, name: true, slug: true } })
    : [];
  const platform = requireKnownFilter("platform", rawPlatform, parsePlatformFilter(rawPlatform, platforms));
  const where: Prisma.IdeaWhereInput = {
    ...scope,
    isDeleted: false,
    ...(platform ? { categoryId: platform === PLATFORM_NONE ? null : platform } : {}),
    ...(rawStatus ? { status: rawStatus as IdeaStatus } : {}),
    ...(convertibleRaw === "true" ? { status: "open", score: { gte: ideaThreshold } } : {}),
    ...(convertibleRaw === "false" ? { NOT: { status: "open", score: { gte: ideaThreshold } } } : {}),
    ...(term
      ? { AND: [{ OR: [{ title: { contains: term, mode: "insensitive" } }, { description: { contains: term, mode: "insensitive" } }] }] }
      : {}),
    ...(cursor ? ideaCursorWhere(cursor) : {}),
  };
  const rows = await prisma.idea.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: ideaSelect,
  });
  const page = toPage(rows, limit);
  // #724: each idea's weighted good, bad and neutral votes, as the Ideas list shows them.
  const totals = await ideaVoteTotals(prisma, page.items.map((row) => row.id));
  return { ...page, items: page.items.map((row) => ({ ...ideaJson(row, ideaThreshold), votes: totals.get(row.id) ?? NO_VOTES })) };
}

function ideaCursorWhere(cursor: IssueCursor): Prisma.IdeaWhereInput {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

/** `ref` is the idea's number (`12`) or its id. */
export async function findIdea(scope: Scope, ref: string) {
  const parsed = parseIssueRef(ref);
  return prisma.idea.findFirst({
    where: { ...scope, isDeleted: false, ...(parsed.kind === "number" ? { number: parsed.number } : { id: parsed.id }) },
    select: { id: true },
  });
}

export async function readAgentIdea(scope: Scope, ref: string) {
  const found = await findIdea(scope, ref);
  if (!found) throw new IssueApiError(404, "Idea not found.");
  const [idea, { ideaThreshold }] = await Promise.all([
    prisma.idea.findUniqueOrThrow({
      where: { id: found.id },
      select: {
        ...ideaSelect,
        attachments: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, filename: true, contentType: true, size: true, createdAt: true },
        },
      },
    }),
    workflowFor(scope.projectId),
  ]);
  const votes = (await ideaVoteTotals(prisma, [idea.id])).get(idea.id) ?? NO_VOTES;
  const json = ideaJson(idea, ideaThreshold) as ReturnType<typeof ideaJson> & { attachments: typeof idea.attachments };
  // #722: each file with the URL an agent reads it from, with its key.
  return { ...json, attachments: idea.attachments.map((file) => ({ ...file, url: agentAttachmentUrl(file.id) })), votes };
}

async function normalizeTenantMentions(db: Prisma.TransactionClient, tenantId: string, body: string) {
  const ids = extractMentionedUserIds(body);
  const users = ids.length
    ? await db.user.findMany({ where: { id: { in: ids }, memberships: { some: { tenantId } } }, select: { id: true, name: true } })
    : [];
  return normalizeMentions(body, new Map(users.map((user) => [user.id, user.name])));
}

/** Files the agent's owner uploaded, by id (all must link) or linked from the text (best effort). */
async function linkAgentIdeaAttachments(
  tx: Prisma.TransactionClient,
  agent: AgentContext,
  input: { requested?: string[]; text: string; ideaId: string },
): Promise<void> {
  const requested = [...new Set(input.requested ?? [])];
  if (requested.length > 0) {
    const linked = await linkAttachments(tx, { ids: requested, uploaderId: agent.ownerId, ideaId: input.ideaId });
    if (linked !== requested.length) {
      throw new IssueApiError(422, "One or more attachmentIds weren't found, belong to someone else, or are already attached.");
    }
  }
  const referenced = attachmentIdsInMarkdown(input.text).filter((id) => !requested.includes(id));
  if (referenced.length > 0) {
    await linkAttachments(tx, { ids: referenced, uploaderId: agent.ownerId, ideaId: input.ideaId });
  }
}

/** `POST /api/v1/ideas`: an agent files a report, which is always an idea. */
/**
 * The create body (#722): JSON, or multipart/form-data with the same JSON in a
 * `payload` part and up to 5 `file` parts. Every file is checked before any is
 * stored, so one bad file creates nothing. Stored files join `attachmentIds`;
 * `digests` (their SHA-256) stand in for those new ids in the idempotency
 * hash, so a replay with the same files matches.
 */
async function ideaCreateBody(agent: AgentContext, request: NextRequest): Promise<{ body: unknown; uploaded: string[]; digests: string[] }> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) return { body: await issueJson(request), uploaded: [], digests: [] };
  const read = await readLimitedMultipart(request, MAX_ATTACHMENTS_PER_ITEM * MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES);
  if (!read.ok) {
    const message = read.reason === "too-large" ? "Over the size limit: up to 5 files of 5 MB each." : "Send multipart/form-data with a `payload` part and `file` parts.";
    throw new IssueApiError(read.status, message);
  }
  const raw = read.form.get("payload");
  if (typeof raw !== "string") throw new IssueApiError(400, "Send the JSON fields as a `payload` part.");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new IssueApiError(400, "The `payload` part is not valid JSON.");
  }
  const files = read.form.getAll("file").filter((part): part is File => typeof part !== "string");
  const existing = Array.isArray(body.attachmentIds) ? body.attachmentIds : [];
  if (existing.length + files.length > MAX_ATTACHMENTS_PER_ITEM) {
    throw new IssueApiError(422, `At most ${MAX_ATTACHMENTS_PER_ITEM} attachments per idea.`);
  }
  const checked: { bytes: Uint8Array; filename: string; contentType: string }[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkAttachment(bytes, file.name);
    if (!check.ok) throw new IssueApiError(bytes.byteLength > MAX_ATTACHMENT_BYTES ? 413 : 415, `${file.name}: ${check.error}`);
    checked.push({ bytes, filename: check.filename, contentType: check.contentType });
  }
  const uploaded: string[] = [];
  for (const file of checked) {
    const saved = await prisma.attachment.create({
      data: { uploaderId: agent.ownerId, filename: file.filename, contentType: file.contentType, size: file.bytes.byteLength, data: Buffer.from(file.bytes) },
      select: { id: true },
    });
    uploaded.push(saved.id);
  }
  const digests = checked.map((file) => createHash("sha256").update(file.bytes).digest("hex"));
  return { body: { ...body, attachmentIds: [...existing, ...uploaded] }, uploaded, digests };
}

/** Removes files a failed or replayed multipart create stored and nothing took. */
async function dropUnused(uploaded: string[]): Promise<void> {
  if (!uploaded.length) return;
  await prisma.attachment
    .deleteMany({ where: { id: { in: uploaded }, bugId: null, ideaId: null, commentId: null } })
    .catch((error: unknown) => console.error("[ideas] dropping unused uploads failed", error));
}

export async function createAgentIdea(agent: AgentContext, request: NextRequest) {
  const { body, uploaded, digests } = await ideaCreateBody(agent, request);
  try {
    const response = await createIdeaFromBody(agent, request, body, uploaded, digests);
    if (response.status !== 201) await dropUnused(uploaded);
    return response;
  } catch (error) {
    await dropUnused(uploaded);
    throw error;
  }
}

async function createIdeaFromBody(agent: AgentContext, request: NextRequest, body: unknown, uploaded: string[], digests: string[]) {
  const input = createIdeaSchema.parse(body);
  assertVettedFields(input);
  const scope = await issueProject(agent, request.nextUrl.searchParams, input.projectId);
  const beneficiaryUserId = agent.ownerId;
  let converted: { issueId: string; issueNumber: number } | null = null;
  const requestHash = hashCreateRequest({
    projectId: scope.projectId,
    beneficiaryUserId,
    title: input.title,
    summary: input.summary,
    description: input.description,
    platform: input.platform ?? null,
    proofLinks: input.proofLinks,
    typeId: input.typeId ?? null,
    acknowledgeSimilar: input.acknowledgeSimilar ?? null,
    ...(input.alreadyVetted ? { alreadyVetted: true, vettedNote: input.vettedNote } : {}),
    // Files sent in this request hash by content, not by the ids they were just given (#722).
    ...(input.attachmentIds?.filter((id) => !uploaded.includes(id)).length
      ? { attachmentIds: [...new Set(input.attachmentIds.filter((id) => !uploaded.includes(id)))].sort() }
      : {}),
    ...(digests.length ? { files: [...digests].sort() } : {}),
    ...(input.areaId ? { areaId: input.areaId } : {}),
  });
  const result = await createIdeaWithPolicy({
    agent,
    projectId: scope.projectId,
    idempotencyKey: request.headers.get("Idempotency-Key"),
    requestHash,
    title: input.title,
    typeId: input.typeId,
    acknowledgeSimilar: input.acknowledgeSimilar,
    insert: async (tx, policy) => {
      const member = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId: scope.tenantId, userId: beneficiaryUserId } },
        select: { userId: true },
      });
      if (!member) throw new IssueApiError(422, "The beneficiary must be a member of the tenant.");
      if (input.alreadyVetted) await assertVettedCap(tx, agent);
      const categoryId = input.platform ? (await resolvePlatform(tx, scope.tenantId, input.platform)).id : null;
      const areaId = input.areaId || null;
      if (areaId) {
        const area = await tx.projectArea.findFirst({ where: { id: areaId, projectId: scope.projectId }, select: { id: true } });
        if (!area) throw new IssueApiError(422, "Area not found in this project.");
      }
      const description = await normalizeTenantMentions(tx, scope.tenantId, input.description);
      const idea = await tx.idea.create({
        data: {
          ...scope,
          typeId: policy.typeId,
          title: input.title,
          summary: input.summary,
          description,
          categoryId,
          areaId,
          proofLinks: input.proofLinks,
          reporterId: beneficiaryUserId,
          beneficiaryUserId,
          createdByAgentId: agent.agentId,
        },
        select: { id: true, number: true },
      });
      await linkAgentIdeaAttachments(tx, agent, { requested: input.attachmentIds, text: description, ideaId: idea.id });
      await audit(agent, "idea.created", `idea:${idea.id}`, { beneficiaryUserId, number: idea.number }, { db: tx });
      await publish(tx, {
        tenantId: scope.tenantId,
        type: "idea.created",
        payload: { ideaId: idea.id, ideaNumber: idea.number, projectId: scope.projectId, beneficiaryUserId },
        actorAgentId: agent.agentId,
        projectId: scope.projectId,
      });
      // Already vetted: the idea becomes an issue now, and the note goes on the audit log with it.
      if (input.alreadyVetted && input.vettedNote) {
        await audit(agent, "idea.vetted", `idea:${idea.id}`, { vettedNote: input.vettedNote, number: idea.number }, { db: tx });
        const made = await convertVettedIdea(tx, agent, scope.projectId, idea.id, input.vettedNote);
        converted = { issueId: made.issueId, issueNumber: made.issueNumber };
      }
      return idea;
    },
  });
  if (result.status !== 200 && result.status !== 201) return NextResponse.json(result, { status: result.status });
  // A reused key can refer to another project; never return an out-of-scope idea.
  const idea = await readAgentIdea(scope, result.ideaId);
  return NextResponse.json({ idea, replayed: result.replayed, ...(input.alreadyVetted ? { converted: converted ?? (idea.issueId && idea.issueNumber ? { issueId: idea.issueId, issueNumber: idea.issueNumber } : null) } : {}) }, { status: result.status });
}

/** alreadyVetted and vettedNote go together: a vetted idea says where it was approved, and a note alone means nothing. */
export function assertVettedFields(input: { alreadyVetted?: boolean; vettedNote?: string }) {
  if (input.alreadyVetted && !input.vettedNote) {
    const message = "Say where it was approved: send a vettedNote with alreadyVetted, for example \"Approved by Mark, sheet row 42\".";
    throw new IssueApiError(400, message, { error: "invalid_request", message, field: "vettedNote" });
  }
  if (input.vettedNote && !input.alreadyVetted) {
    const message = "vettedNote is only for an idea sent with alreadyVetted: true.";
    throw new IssueApiError(400, message, { error: "invalid_request", message, field: "alreadyVetted" });
  }
}

/** One person's agents may file `VETTED_IDEAS_PER_DAY` already-vetted ideas in 24 hours: an honest flag, not a way round the verdicts. */
export async function assertVettedCap(tx: Prisma.TransactionClient, agent: AgentContext) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${agent.ownerId} FOR UPDATE`;
  const used = await tx.agentAuditEvent.count({
    where: { action: "idea.vetted", undoneAt: null, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, agent: { ownerUserId: agent.ownerId } },
  });
  if (used >= VETTED_IDEAS_PER_DAY) {
    const message = `You can file ${VETTED_IDEAS_PER_DAY} already vetted ideas in 24 hours, and they are used up. Send this one without alreadyVetted and it waits for verdicts as usual.`;
    throw new IssueApiError(429, message, { error: "vetted_limit", message, limit: VETTED_IDEAS_PER_DAY });
  }
}
