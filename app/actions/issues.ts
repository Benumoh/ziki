"use server";

import { revalidatePath } from "next/cache";
import { revalidateIssue } from "@/lib/revalidate-issue";
import { fieldError, fromZodError } from "@/lib/form-errors";
import { redirect } from "next/navigation";
import {
  activityCreateData,
  areaChangedSummary,
  assigneeChangedSummary,
  boostedSummary,
  categoryChangedSummary,
  commentedSummary,
  commentPreview,
  deletedSummary,
  restoredSummary,
  statusChangedSummary,
  typeChangedSummary,
  unboostedSummary,
  type ActivityMetadata,
} from "@/lib/activity-log";
import { prisma } from "@/lib/prisma";
import { readAgentResolution } from "@/lib/agent-resolution";
import { requireUser } from "@/lib/auth-helpers";
import {
  resolveSessionUserId,
  SESSION_EXPIRED_MESSAGE,
} from "@/lib/session-user";
import {
  extractMentionedUserIds,
  newlyMentionedUserIds,
  normalizeMentions,
} from "@/lib/mentions";
import { resolveTenantMentions, tenantMemberWhere } from "@/lib/tenant-mentions";
import { structureIdea } from "@/lib/idea-structuring";
import {
  commentSchema,
  createBugSchema,
  editBugContentSchema,
  editProofLinksSchema,
  updateBugSchema,
} from "@/lib/validations/issue";
import {
  calculateVoteChange,
  DOWNVOTES_REMOVED_MESSAGE,
  isValidVoteDirection,
  reconcileVoteCount,
  tallyVoteGroups,
} from "@/lib/voting";
import {
  canDeleteTicket,
  canRestoreTicket,
  TICKET_DELETION_ERRORS,
} from "@/lib/ticket-deletion";
import {
  canBoostTicket,
  shouldUnboostOnStatusChange,
  TICKET_BOOST_ERRORS,
} from "@/lib/ticket-boosting";
import { canAssignTicket, TICKET_ASSIGN_ERRORS } from "@/lib/ticket-assignment";
import { canChangeTicketStatus, TICKET_TRIAGE_ERRORS } from "@/lib/ticket-triage";
import {
  canEditTicket,
  formatEditSummary,
  formatProofLinkSummary,
  getChangedEditFields,
  getProofLinkChanges,
  TICKET_EDIT_ERRORS,
} from "@/lib/ticket-editing";
import { Prisma, type ActivityType, type Substatus } from "@prisma/client";
import { notifyLater } from "@/lib/notify";
import { ensureWatching } from "@/lib/watch";
import { parseResolutionNote } from "@/lib/resolution-note";
import { isUntouchedTemplate, UNFILLED_TEMPLATE_MESSAGE } from "@/lib/issue-templates";
import type { NotificationEvent } from "@/lib/notifications";
import { getForeignKeyErrorMessage } from "@/lib/foreign-key-errors";
import { parseAttachmentIds } from "@/lib/attachments";
import { attachmentIdsInMarkdown, linkAttachments } from "@/lib/attachment-link";
import {
  bugInTenant,
  currentTenantIdFor,
  NO_TENANT_MESSAGE,
} from "@/lib/tenant-context";
import { currentTenantAccess } from "@/lib/tenant-access";
import { award, solverAwardFor } from "@/lib/points/award";
import { holdPayout } from "@/lib/points/payout";
import { isConfirmed } from "@/lib/agent-api/confirmations";
import { correct } from "@/lib/points/correct";
import { VOTE_POINTS, importanceSourceKey, pointSourceKey } from "@/lib/points/rules";
import {
  checkRateLimit,
  consumeRateLimit,
  ACTION_RATE_LIMITS,
  RATE_LIMIT_MESSAGE,
} from "@/lib/rate-limit";
import { publish } from "@/lib/agent-api/events";
import { issueChangePayload, publishWebEvent } from "@/lib/agent-api/web-events";
import { CommentPlacementError, placeComment, type CommentPlacement } from "@/lib/comment-placement";
import { reportedClosedUnmerged } from "@/lib/agent-api/pull-request-report";
import {
  agentMentionNames,
  agentOwnerIds,
  mentionedAgents,
  type MentionedAgent,
} from "@/lib/agent-mentions";
import { ideaPath } from "@/lib/project-paths";
import { ENTRY_SUBSTATUS, moveTo } from "@/lib/issue-substatus";

export type ActionResult = {
  error?: string;
  ok?: boolean;
  /** Which field failed, when there is one (#309). */
  field?: string;
  fieldErrors?: Record<string, string>;
  commentId?: string;
};

/**
 * Resolves `@[Name](userId)` tags against this tenant's members: known ids are
 * rewritten to the current name, anyone else degrades to plain `@Name` (#502).
 * `agents` are the issue tenant's agents the text may keep tags for (#603).
 */
async function normalizeMentionTags(
  text: string,
  tenantId: string,
  agents: MentionedAgent[] = [],
): Promise<string> {
  const mentionedIds = extractMentionedUserIds(text);
  if (mentionedIds.length === 0 && agents.length === 0) return text;

  const validUsers = mentionedIds.length
    ? await prisma.user.findMany({
        where: { id: { in: mentionedIds }, ...tenantMemberWhere(tenantId) },
        select: { id: true, name: true },
      })
    : [];
  const userMap = new Map([
    ...validUsers.map((user) => [user.id, user.name] as [string, string]),
    ...agentMentionNames(agents),
  ]);
  return normalizeMentions(text, userMap);
}

function foreignKeyError(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
    return getForeignKeyErrorMessage(error.meta as Record<string, unknown> | undefined);
  }
  return null;
}

/** Reads the type, including when the template column has not been migrated yet. */
async function issueTypeForCreate(typeId: string, tenantId: string) {
  try {
    return await prisma.issueType.findUnique({
      where: { id_tenantId: { id: typeId, tenantId } },
      select: { id: true, isActive: true, template: true },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const missingTemplate =
      (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2022" &&
        "meta" in error &&
        String((error as { meta?: { column?: unknown } }).meta?.column ?? "").includes("template")) ||
      /column [`'"]?(?:[\w."]+\.)*template[`'"]?/i.test(message);
    if (!missingTemplate) throw error;
    const row = await prisma.issueType.findUnique({
      where: { id_tenantId: { id: typeId, tenantId } },
      select: { id: true, isActive: true },
    });
    return row ? { ...row, template: null } : null;
  }
}

/** Redirects to login when the JWT is missing or no longer maps to a User row. */
async function requireUserId() {
  const resolved = await resolveSessionUserId();
  if ("error" in resolved) {
    redirect("/login");
  }
  return resolved.userId;
}

/**
 * Files a report as the signed-in user. Every report is an idea
 * (#idea-table): it takes verdicts until an agent converts it, which
 * creates the issue. Ideas have no assignee.
 */
export async function createBugAction(
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const userId = user.id;

  const limit = await consumeRateLimit(
    `create-bug:${userId}`,
    ACTION_RATE_LIMITS.createBug,
  );
  if (!limit.allowed) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  // Auto-generate title from description if omitted or blank (for simplified report intake)
  const rawTitle = formData.get("title");
  const rawDesc = formData.get("description");
  let titleStr = typeof rawTitle === "string" ? rawTitle.trim() : "";
  const isReport = formData.get("isReport") === "true";

  if (!titleStr && typeof rawDesc === "string" && rawDesc.trim().length >= 3) {
    const firstLine = rawDesc.trim().split(/\r?\n/)[0]?.trim() || "";
    titleStr = firstLine.slice(0, 80);
    if (titleStr.length < 3) {
      titleStr = rawDesc.trim().slice(0, 80);
    }
  }

  const parsed = createBugSchema.safeParse({
    title: titleStr,
    description: formData.get("description"),
    typeId: formData.get("typeId") || "",
    assigneeId: "",
    categoryId: formData.get("categoryId") || "",
    areaId: formData.get("areaId") || "",
    proofLinks: formData.get("proofLinks") || "",
  });

  if (!parsed.success) {
    return fromZodError(parsed.error);
  }

  const typeId =
    parsed.data.typeId && parsed.data.typeId.length > 0
      ? parsed.data.typeId
      : null;

  // #425: the idea goes into the reporter's tenant. No membership, no idea.
  const tenantId = await currentTenantIdFor(userId);
  // #project-urls: the project the form was opened in, and only if it is in this workspace.
  const requestedProjectId = typeof formData.get("projectId") === "string" ? String(formData.get("projectId")) : "";
  const targetProject = tenantId && requestedProjectId
    ? await prisma.project.findFirst({ where: { id: requestedProjectId, tenantId, archivedAt: null }, select: { id: true, slug: true } })
    : null;
  if (!tenantId || !targetProject) {
    return { error: NO_TENANT_MESSAGE };
  }
  const projectId = targetProject.id;

  if (typeId) {
    const issueType = await issueTypeForCreate(typeId, tenantId);
    if (!issueType || !issueType.isActive) {
      return fieldError("typeId", "That type no longer exists. Please pick another.");
    }
    // #307: headings alone pass the length check but say nothing.
    if (isUntouchedTemplate(parsed.data.description, issueType.template)) {
      return fieldError("description", UNFILLED_TEMPLATE_MESSAGE);
    }
  }

  const categoryId =
    parsed.data.categoryId && parsed.data.categoryId.length > 0
      ? parsed.data.categoryId
      : null;
  const areaId = parsed.data.areaId && parsed.data.areaId.length > 0
    ? parsed.data.areaId
    : null;
  // #idea-intake: Claude writes what they typed up as a clear idea (title and the standard
  // headings) before it is saved. Without the key, or if that fails, it is saved as typed.
  const structured = await structureIdea({ title: parsed.data.title, description: parsed.data.description });
  const ideaTitle = structured?.title ?? parsed.data.title;
  // #502: mentions resolve only to members of the idea's tenant.
  const description = await resolveTenantMentions(prisma, tenantId, structured?.description ?? parsed.data.description);

  if (categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: categoryId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!category) {
      return fieldError("categoryId", "Platform not found or inactive");
    }
  }

  if (areaId) {
    const area = await prisma.projectArea.findFirst({
      where: { id: areaId, projectId },
      select: { id: true },
    });
    if (!area) return fieldError("areaId", "Area not found in this project.");
  }

  let idea: { id: string; number: number };
  try {
    idea = await prisma.$transaction(async (tx) => {
      const created = await tx.idea.create({
        data: {
          tenantId,
          projectId,
          beneficiaryUserId: userId,
          reporterId: userId,
          title: ideaTitle,
          description,
          typeId,
          proofLinks: parsed.data.proofLinks,
          categoryId,
          areaId,
        },
        select: { id: true, number: true },
      });
      // Files uploaded while writing the report (#215), and images pasted
      // or dropped into the description (#305).
      await linkAttachments(tx, {
        ids: [
          ...new Set([
            ...parseAttachmentIds(formData.get("attachmentIds")),
            ...attachmentIdsInMarkdown(description),
          ]),
        ],
        uploaderId: userId,
        ideaId: created.id,
      });
      // #600 / #534: agents hear about ideas people file.
      await publish(tx, {
        tenantId,
        type: "idea.created",
        projectId,
        payload: {
          ideaId: created.id,
          ideaNumber: created.number,
          projectId,
          reporterId: userId,
          beneficiaryUserId: userId,
          isReport,
          actor: { kind: "user", id: userId, name: user.name ?? null },
        },
      });
      return created;
    });
  } catch (error) {
    const foreignKey = foreignKeyError(error);
    if (foreignKey) return { error: foreignKey };
    throw error;
  }

  revalidatePath("/[project]", "layout");
  redirect(ideaPath(targetProject.slug, idea.number));
}

/** Updates status (assignee/admin) and type/assignee (admin) and logs activity. */
export async function updateBugAction(
  bugId: string,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const userId = user.id;
  const access = await currentTenantAccess(userId, user.role);
  const admin = access.admin;

  const tenantId = await currentTenantIdFor(userId);
  const existing = await prisma.bug.findUnique({
    where: { id: bugId, ...bugInTenant(tenantId) },
    include: {
      assignee: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      area: { select: { id: true, name: true } },
      type: { select: { id: true, name: true } },
      milestone: { select: { id: true, title: true } },
    },
  });
  if (!existing || existing.isDeleted) {
    return { error: "Issue not found" };
  }

  const isAssignee = existing.assigneeId === userId;
  const assigneeRaw = formData.get("assigneeId");
  const hasAssigneeField = assigneeRaw !== null && assigneeRaw !== undefined;
  const targetAssigneeId = hasAssigneeField
    ? assigneeRaw === "" || assigneeRaw === "unassigned"
      ? null
      : typeof assigneeRaw === "string"
        ? assigneeRaw.trim()
        : null
    : undefined;

  const isSelfAssigning =
    targetAssigneeId !== undefined && targetAssigneeId === userId;

  // #202: `status` is a triage field and must be gated on the issue's current
  // assignee (or an admin) - never on the assignee this request is trying to
  // set. Without this, a self-assignment satisfied the gate above and the same
  // request could also close/reopen the issue, letting any user close any
  // unassigned issue. Checked before schema parsing so the error is explicit.
  const requestedStatus = formData.get("status") || undefined;
  if (
    requestedStatus &&
    !canChangeTicketStatus({
      actorId: userId,
      actorRole: user.role,
      membershipRole: access.membershipRole,
      currentAssigneeId: existing.assigneeId,
    })
  ) {
    return { error: TICKET_TRIAGE_ERRORS.statusUnauthorized };
  }

  if (!admin && !isAssignee && !isSelfAssigning) {
    return {
      error: "Only the assignee, or an owner or admin of this organization, can update this issue",
    };
  }

  if (!admin && isSelfAssigning && targetAssigneeId !== existing.assigneeId) {
    return { error: TICKET_ASSIGN_ERRORS.needsAgentClaim };
  }

  if (targetAssigneeId !== undefined && targetAssigneeId !== existing.assigneeId) {
    if (
      !canAssignTicket({
        actorId: userId,
        actorRole: user.role,
        membershipRole: access.membershipRole,
        currentAssigneeId: existing.assigneeId,
        targetAssigneeId,
      })
    ) {
      return { error: TICKET_ASSIGN_ERRORS.unauthorized };
    }
  }

  const categoryRaw = formData.get("categoryId");
  const areaRaw = formData.get("areaId");
  const typeRaw = formData.get("typeId");
  const parsed = updateBugSchema.safeParse({
    status: requestedStatus,
    typeId: admin
      ? typeRaw === "" || typeRaw === "none"
        ? null
        : typeRaw || undefined
      : undefined,
    assigneeId: targetAssigneeId,
    categoryId: admin
      ? categoryRaw === "" || categoryRaw === "none"
        ? null
        : categoryRaw || undefined
      : undefined,
    areaId: admin
      ? areaRaw === "" || areaRaw === "none"
        ? null
        : areaRaw || undefined
      : undefined,
  });

  if (!parsed.success) {
    return fromZodError(parsed.error);
  }

  // Claiming an issue doesn't also grant its status in the same request: a
  // normal user who isn't the assignee yet must assign themselves first
  // (#218, #175). Someone an admin already assigned can move the status
  // from this page; that does not require an agent claim.
  if (
    !admin &&
    !isAssignee &&
    parsed.data.status &&
    parsed.data.status !== existing.status
  ) {
    return { error: TICKET_ASSIGN_ERRORS.statusNeedsAssignment };
  }

  // #316: an optional note, only for a change into resolved or closed.
  const parsedNote = parseResolutionNote(formData.get("resolutionNote"), {
    from: existing.status,
    to: parsed.data.status,
  });
  if ("error" in parsedNote) return { error: parsedNote.error, field: "resolutionNote" };
  const resolutionNote = parsedNote.note;

  // #642: a pull request reported closed without merging cannot resolve the
  // issue (#pr-reports: the latest independent report, not GitHub).
  if (
    parsed.data.status === "resolved" &&
    existing.status !== "resolved" &&
    existing.pullRequestUrl &&
    (await reportedClosedUnmerged(existing.id, existing.pullRequestUrl))
  ) {
    return { error: "The linked pull request is reported closed without being merged." };
  }

  const data: {
    status?: typeof parsed.data.status;
    substatus?: Substatus;
    typeId?: string | null;
    assigneeId?: string | null;
    categoryId?: string | null;
    areaId?: string | null;
    milestoneId?: string | null;
    isBoosted?: boolean;
    boostedAt?: Date | null;
  } = {};

  if (parsed.data.status && parsed.data.status !== existing.status) Object.assign(data, moveTo(ENTRY_SUBSTATUS[parsed.data.status]));
  if (admin) {
    if (parsed.data.typeId !== undefined) {
      data.typeId = parsed.data.typeId === "" ? null : parsed.data.typeId;
    }
    if (parsed.data.categoryId !== undefined) {
      data.categoryId =
        parsed.data.categoryId === "" ? null : parsed.data.categoryId;
    }
    if (parsed.data.areaId !== undefined) {
      data.areaId = parsed.data.areaId === "" ? null : parsed.data.areaId;
    }
  }
  if (parsed.data.assigneeId !== undefined) {
    data.assigneeId =
      parsed.data.assigneeId === "" ? null : parsed.data.assigneeId;
  }

  type PendingActivity = {
    type: ActivityType;
    summary: string;
    metadata?: ActivityMetadata;
  };
  const pending: PendingActivity[] = [];

  if (data.substatus && data.substatus !== existing.substatus) {
    pending.push({
      type: "status_changed",
      summary: statusChangedSummary(existing.substatus, data.substatus),
      metadata: {
        field: "status",
        from: existing.substatus,
        to: data.substatus,
        ...(resolutionNote ? { note: resolutionNote } : {}),
      },
    });
  }

  // #256: a resolved or closed issue shouldn't stay pinned above open work.
  if (
    shouldUnboostOnStatusChange({
      isBoosted: existing.isBoosted,
      from: existing.status,
      to: data.status,
    })
  ) {
    data.isBoosted = false;
    data.boostedAt = null;
    pending.push({
      type: "unboosted",
      summary: unboostedSummary(),
      metadata: { field: "isBoosted", to: "false" },
    });
  }

  if (
    data.assigneeId !== undefined &&
    data.assigneeId !== existing.assigneeId
  ) {
    let toName: string | null = null;
    if (data.assigneeId) {
      const nextAssignee = await prisma.user.findFirst({
        where: { id: data.assigneeId, memberships: { some: { tenantId: existing.tenantId } } },
        select: { name: true },
      });
      if (!nextAssignee) {
        return { error: "Assignee not found in this workspace" };
      }
      toName = nextAssignee.name ?? null;
    }
    pending.push({
      type: "assignee_changed",
      summary: assigneeChangedSummary(existing.assignee?.name ?? null, toName),
      metadata: {
        field: "assigneeId",
        from: existing.assigneeId,
        to: data.assigneeId,
      },
    });
  }

  if (data.typeId !== undefined && data.typeId !== existing.typeId) {
    let toName: string | null = null;
    if (data.typeId) {
      const nextType = await prisma.issueType.findUnique({
        where: { id_tenantId: { id: data.typeId, tenantId: existing.tenantId } },
        select: { id: true, name: true, isActive: true },
      });
      if (!nextType || !nextType.isActive) {
        return { error: "That type no longer exists. Please pick another." };
      }
      toName = nextType.name;
    }
    pending.push({
      type: "type_changed",
      summary: typeChangedSummary(existing.type?.name ?? null, toName),
      metadata: {
        field: "type",
        from: existing.type?.name ?? null,
        to: toName,
      },
    });
  }

  if (
    data.categoryId !== undefined &&
    data.categoryId !== existing.categoryId
  ) {
    let toName: string | null = null;
    if (data.categoryId) {
      const cat = await prisma.category.findFirst({
        where: { id: data.categoryId, tenantId: existing.tenantId },
        select: { id: true, name: true },
      });
      if (!cat) {
        return { error: "Platform not found" };
      }
      toName = cat.name;
    }
    pending.push({
      type: "category_changed",
      summary: categoryChangedSummary(existing.category?.name ?? null, toName),
      metadata: {
        field: "category",
        from: existing.category?.name ?? null,
        to: toName,
      },
    });
  } else if (data.categoryId) {
    const cat = await prisma.category.findFirst({
      where: { id: data.categoryId, tenantId: existing.tenantId },
      select: { id: true },
    });
    if (!cat) {
      return { error: "Platform not found" };
    }
  }

  if (data.areaId !== undefined) {
    let toName: string | null = null;
    if (data.areaId) {
      const area = await prisma.projectArea.findFirst({
        where: { id: data.areaId, projectId: existing.projectId },
        select: { id: true, name: true },
      });
      if (!area) return { error: "Area not found in this project." };
      toName = area.name;
    }
    if (data.areaId !== existing.areaId) {
      pending.push({
        type: "area_changed",
        summary: areaChangedSummary(existing.area?.name ?? null, toName),
        metadata: { field: "area", from: existing.area?.name ?? null, to: toName },
      });
    }
  }

  // #289: admins put an issue in at most one milestone. Absent from the
  // form means "leave it"; "" or "none" takes it out.
  const milestoneRaw = admin ? formData.get("milestoneId") : null;
  if (typeof milestoneRaw === "string") {
    const nextMilestoneId = milestoneRaw === "" || milestoneRaw === "none" ? null : milestoneRaw.trim();
    if (nextMilestoneId !== existing.milestoneId) {
      let toTitle: string | null = null;
      if (nextMilestoneId) {
        const milestone = await prisma.milestone.findUnique({
          where: { id_tenantId: { id: nextMilestoneId, tenantId: existing.tenantId } },
          select: { title: true, isClosed: true },
        });
        if (!milestone) return fieldError("milestoneId", "That milestone no longer exists.");
        if (milestone.isClosed) {
          return fieldError("milestoneId", `"${milestone.title}" is closed. Reopen it to add issues.`);
        }
        toTitle = milestone.title;
      }
      data.milestoneId = nextMilestoneId;
      const fromTitle = existing.milestone?.title ?? null;
      pending.push({
        type: "milestone_changed",
        summary: toTitle
          ? fromTitle
            ? `moved this from milestone "${fromTitle}" to "${toTitle}"`
            : `added this to milestone "${toTitle}"`
          : `removed this from milestone "${fromTitle}"`,
        metadata: { field: "milestone", from: fromTitle, to: toTitle },
      });
    }
  }

  if (pending.length === 0 && Object.keys(data).length === 0) {
    return { ok: true };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // #676: Row lock the Bug to serialize concurrent updates and prevent voteCount races.
      if (typeof tx.$queryRaw === "function") {
        await tx.$queryRaw`SELECT id FROM "Bug" WHERE id = ${bugId} FOR UPDATE`;
      }

      if (Object.keys(data).length > 0) {
        await tx.bug.update({
          where: { id: bugId },
          data,
        });
      }
      if (data.status === "resolved" || data.status === "closed") {
        const activeClaims = typeof tx.issueClaim?.findMany === "function"
          ? await tx.issueClaim.findMany({
              where: { bugId, status: "active", releasedAt: null },
              select: { id: true, agentId: true, beneficiaryUserId: true },
            })
          : [];
        await tx.issueClaim.updateMany({
          where: { bugId, status: "active", releasedAt: null },
          data: { status: "released", releasedAt: new Date(), releaseReason: data.status },
        });
        for (const claim of activeClaims) {
          await publish(tx, {
            tenantId: existing.tenantId,
            type: "claim.released",
            actorAgentId: claim.agentId,
            bugId,
            payload: { claimId: claim.id, issueId: bugId, beneficiaryUserId: claim.beneficiaryUserId, reason: data.status },
          });
        }
      }
      if (data.assigneeId) {
        // The new assignee starts watching (#216).
        await ensureWatching(tx, bugId, [data.assigneeId]);
      }
      // Admin assignment follows the offer flow: creating or
      // reassigning an assignee produces an offered IssueClaim for that
      // user's agent, as an awarded bid does. Releasing
      // any prior active/offered claim first keeps the cap slot free.
      const assigneeChanged =
        data.assigneeId !== undefined && data.assigneeId !== existing.assigneeId;
      if (assigneeChanged) {
        // Release prior claims held by the previous assignee's agent.
        if (existing.assigneeId && typeof tx.issueClaim?.updateMany === "function") {
          const priorClaims =
            typeof tx.issueClaim.findMany === "function"
              ? await tx.issueClaim.findMany({
                  where: {
                    bugId,
                    beneficiaryUserId: existing.assigneeId,
                    status: { in: ["offered", "active"] },
                    releasedAt: null,
                  },
                  select: { id: true, agentId: true, beneficiaryUserId: true },
                })
              : [];
          await tx.issueClaim.updateMany({
            where: {
              bugId,
              beneficiaryUserId: existing.assigneeId,
              status: { in: ["offered", "active"] },
              releasedAt: null,
            },
            data: { status: "released", releasedAt: new Date(), releaseReason: "reassigned" },
          });
          for (const claim of priorClaims) {
            await publish(tx, {
              tenantId: existing.tenantId,
              type: "claim.released",
              actorAgentId: claim.agentId,
              bugId,
              payload: { claimId: claim.id, issueId: bugId, beneficiaryUserId: claim.beneficiaryUserId, reason: "reassigned" },
            });
          }
        }
        // Create an offered claim for the new assignee's agent, if any.
        if (data.assigneeId && typeof tx.issueClaim?.create === "function") {
          const agent = await tx.agent.findFirst({
            where: { ownerUserId: data.assigneeId, defaultProjectId: existing.projectId },
            select: { id: true },
          });
          if (agent) {
            const claim = await tx.issueClaim.create({
              data: {
                bugId,
                beneficiaryUserId: data.assigneeId,
                agentId: agent.id,
                status: "offered",
                offeredAt: new Date(),
                dispatcherUserId: userId,
              },
            });
            await publish(tx, {
              tenantId: existing.tenantId,
              type: "claim.offered",
              actorAgentId: agent.id,
              bugId,
              payload: { claimId: claim.id, issueId: bugId, beneficiaryUserId: data.assigneeId },
            });
          }
        }
      }
      // #428, #rewards: resolving an issue earns its assignee the issue's reward, once,
      // held until enough people report the work deployed (#live-payout).
      if (data.status === "resolved" && existing.status !== "resolved") {
        const solver = await solverAwardFor(tx, {
          id: bugId,
          tenantId: existing.tenantId,
          assigneeId: data.assigneeId !== undefined ? data.assigneeId : existing.assigneeId,
        });
        if (solver) await holdPayout(tx, bugId, [solver]);
      }
      if (pending.length > 0) {
        await tx.bugActivity.createMany({
          data: activityCreateData(
            pending.map((entry) => ({
              bugId,
              actorId: userId,
              ...entry,
            })),
          ),
        });
      }
      // #600: triage from the web app reaches agents too.
      if (Object.keys(data).length > 0) {
        await publishWebEvent(tx, {
          bugId,
          type: "issue.updated",
          actorUserId: userId,
          payload: issueChangePayload(data as Record<string, unknown>),
        });
      }
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return {
        error: getForeignKeyErrorMessage(
          error.meta as Record<string, unknown> | undefined,
        ),
      };
    }
    throw error;
  }

  const events: NotificationEvent[] = [];
  const actor = { actorId: userId, actorName: user.name ?? "Someone", bugId, bugTitle: existing.title };
  if (data.assigneeId !== undefined && data.assigneeId !== existing.assigneeId) {
    events.push({ ...actor, kind: "assignee_changed", fromUserId: existing.assigneeId, toUserId: data.assigneeId });
  }
  if (data.status && data.status !== existing.status) {
    events.push({ ...actor, kind: "status_changed", reporterId: existing.reporterId, from: existing.status, to: data.status, note: resolutionNote });
  }
  if (events.length > 0) notifyLater(...events);

  revalidatePath("/[project]", "layout");
  revalidateIssue();
  revalidatePath("/bugs");
  revalidatePath(`/bugs/${bugId}`);
  return { ok: true };
}

/**
 * Closes an issue with an optional resolution note.
 */
export async function closeBugAction(
  bugId: string,
  note?: string,
): Promise<ActionResult> {
  const formData = new FormData();
  formData.append("status", "closed");
  if (note) {
    formData.append("resolutionNote", note);
  }
  return updateBugAction(bugId, formData);
}

/**
 * Reopens an issue by setting its status back to open.
 */
export async function reopenBugAction(
  bugId: string,
): Promise<ActionResult> {
  const formData = new FormData();
  formData.append("status", "open");
  return updateBugAction(bugId, formData);
}

/**
 * Ziki #515: undo an agent's resolve in one click, back to the status the
 * issue had before, while that resolve is still the latest status change.
 *
 * Authorized like any status change (assignee or admin, #202), but not routed
 * through updateBugAction: that also wants a non-admin to hold an active
 * claim, and the agent resolve released it (a person-assigned issue never had
 * one), so the assignee could never undo it.
 */
export async function reopenAgentResolvedAction(bugId: string): Promise<ActionResult> {
  const user = await requireUser();
  const access = await currentTenantAccess(user.id, user.role);
  const tenantId = await currentTenantIdFor(user.id);
  const existing = await prisma.bug.findUnique({
    where: { id: bugId, ...bugInTenant(tenantId) },
    select: { id: true, status: true, substatus: true, assigneeId: true, isDeleted: true },
  });
  if (!existing || existing.isDeleted) return { error: "Issue not found" };
  if (
    !canChangeTicketStatus({
      actorId: user.id,
      actorRole: user.role,
      membershipRole: access.membershipRole,
      currentAssigneeId: existing.assigneeId,
    })
  ) {
    return { error: TICKET_TRIAGE_ERRORS.statusUnauthorized };
  }

  const latest = await prisma.bugActivity.findFirst({
    where: { bugId, type: "status_changed" },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });
  const resolution = existing.status === "resolved" ? readAgentResolution(latest?.metadata) : null;
  if (!resolution) return { error: "This issue wasn't resolved by an agent, so there is nothing to undo." };
  const to = resolution.previousStatus;

  const reopened = await prisma.$transaction(async (tx) => {
    // Someone may have changed the status since the read above.
    const changed = await tx.bug.updateMany({ where: { id: bugId, status: "resolved" }, data: moveTo(to) });
    if (changed.count !== 1) return false;
    await tx.bugActivity.create({
      data: {
        bugId,
        actorId: user.id,
        type: "status_changed",
        summary: statusChangedSummary(existing.substatus, to),
        metadata: { field: "status", from: existing.substatus, to, via: "reopen_agent_resolve" },
      },
    });
    await publishWebEvent(tx, { bugId, type: "issue.updated", actorUserId: user.id, payload: issueChangePayload(moveTo(to)) });
    return true;
  });
  if (!reopened) return { error: "The issue's status changed meanwhile. Refresh and try again." };

  revalidatePath("/[project]", "layout");
  revalidateIssue();
  revalidatePath("/bugs");
  revalidatePath(`/bugs/${bugId}`);
  return { ok: true };
}

/**
 * Assigns an issue to a user or clears the assignee if null or empty.
 */
export async function assignBugAction(
  bugId: string,
  assigneeId: string | null,
): Promise<ActionResult> {
  const formData = new FormData();
  formData.append("assigneeId", assigneeId ?? "");
  return updateBugAction(bugId, formData);
}

/** Allows the reporter or an admin to edit an issue's title and description. */
export async function editBugContentAction(
  bugId: string,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const userId = user.id;

  const limit = checkRateLimit(
    `edit-bug:${userId}`,
    ACTION_RATE_LIMITS.editBug,
  );
  if (!limit.allowed) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const existing = await prisma.bug.findUnique({
    where: { id: bugId, ...bugInTenant(await currentTenantIdFor(userId)) },
    select: {
      id: true,
      title: true,
      description: true,
      reporterId: true,
      beneficiaryUserId: true,
      status: true,
      substatus: true,
      tenantId: true,
      isDeleted: true,
    },
  });

  if (!existing || existing.isDeleted) {
    return { error: TICKET_EDIT_ERRORS.notFound };
  }

  if (
    !canEditTicket({
      actorId: userId,
      actorRole: user.role,
      membershipRole: (await currentTenantAccess(userId, user.role)).membershipRole,
      reporterId: existing.reporterId,
    })
  ) {
    return { error: TICKET_EDIT_ERRORS.unauthorized };
  }

  const parsed = editBugContentSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
  });

  if (!parsed.success) {
    return fromZodError(parsed.error);
  }

  const normalizedDescription = await resolveTenantMentions(prisma, existing.tenantId, parsed.data.description);
  const changedFields = getChangedEditFields(existing, {
    title: parsed.data.title,
    description: normalizedDescription,
  });

  if (changedFields.length === 0) {
    return { ok: true };
  }

  const summary = formatEditSummary(changedFields);

  await prisma.$transaction(async (tx) => {
    // #303: keep the version this edit replaces. Read again under a row
    // lock so two edits at once each store the version they replaced and
    // none goes missing from the history.
    const [previous] = await tx.$queryRaw<{ title: string; description: string }[]>`
      SELECT "title", "description" FROM "Bug" WHERE "id" = ${bugId} FOR UPDATE`;
    // Read before the revision below voids the confirmations.
    const wasConfirmed = await isConfirmed(bugId, tx);
    await tx.bugRevision.create({
      data: {
        bugId,
        title: previous?.title ?? existing.title,
        description: previous?.description ?? existing.description,
        editedById: userId,
      },
    });

    // #713: Editing an issue voids its confirmations and reverses any
    // reporter points awarded for the replaced report. The entries and their
    // replies stay (a person wrote them), but only entries given after the
    // latest edit count (lib/issue-stage.ts), so this revision clears them:
    // each person gives theirs again to count.
    type OptionalTxExtensions = {
      pointEntry?: {
        findFirst?: (args: unknown) => Promise<{ id: string; tenantId: string; userId: string; bugId: string | null; role: "solver" | "reporter" | "reviewer"; points: number } | null>;
        update?: (args: unknown) => Promise<unknown>;
      };
    };
    const txExtensions = tx as unknown as OptionalTxExtensions;

    if (wasConfirmed) {
      const recipientId = existing.beneficiaryUserId ?? existing.reporterId;
      const tenantId = existing.tenantId ?? (await currentTenantIdFor(userId));
      if (recipientId && typeof txExtensions.pointEntry?.findFirst === "function") {
        const entry = await txExtensions.pointEntry.findFirst({
          where: {
            tenantId,
            sourceKey: pointSourceKey("reporter", bugId, recipientId),
          },
          select: { id: true, tenantId: true, userId: true, bugId: true, role: true, points: true },
        });
        if (entry) {
          await correct(tx, { entry });
          if (typeof txExtensions.pointEntry?.update === "function") {
            await txExtensions.pointEntry.update({
              where: { id: entry.id },
              data: {
                sourceKey: `${pointSourceKey("reporter", bugId, recipientId)}:invalidated:${entry.id}`,
              },
            });
          }
        }
      }
    }

    await tx.bug.update({
      where: { id: bugId },
      data: {
        title: parsed.data.title,
        description: normalizedDescription,
        updatedAt: new Date(),
        // #requires-confirmation: the edit voided its confirmations, so an Open issue needs confirming again.
        ...(existing.substatus === "open" ? moveTo("requires_confirmation") : {}),
      },
    });

    // Images pasted into the edited description (#305); only the editor's
    // own, not-yet-linked uploads are claimed.
    await linkAttachments(tx, {
      ids: attachmentIdsInMarkdown(normalizedDescription),
      uploaderId: userId,
      bugId,
    });
    await publishWebEvent(tx, {
      bugId,
      type: "issue.updated",
      actorUserId: userId,
      payload: issueChangePayload(
        Object.fromEntries(
          changedFields.map((field) => [field, field === "title" ? parsed.data.title : normalizedDescription]),
        ),
      ),
    });

    await tx.bugActivity.create({
      data: {
        bugId,
        actorId: userId,
        type: "edited",
        summary,
        metadata: {
          fields: changedFields,
        },
      },
    });
  });

  const newlyMentioned = newlyMentionedUserIds(
    existing.description,
    normalizedDescription,
  );
  if (newlyMentioned.length > 0) {
    notifyLater({
      kind: "mentioned",
      actorId: userId,
      actorName: user.name ?? "Someone",
      bugId,
      bugTitle: parsed.data.title,
      place: "description",
      recipientIds: newlyMentioned,
    });
  }

  revalidatePath("/[project]", "layout");
  revalidateIssue();
  revalidatePath("/bugs");
  revalidatePath(`/bugs/${bugId}`);
  return { ok: true };
}

/**
 * Lets the reporter or an admin add, correct, or remove an issue's proof
 * links after filing (#737). Same rules as create: GitHub URLs, at most 20.
 */
export async function editProofLinksAction(
  bugId: string,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const userId = user.id;

  const limit = checkRateLimit(
    `edit-bug:${userId}`,
    ACTION_RATE_LIMITS.editBug,
  );
  if (!limit.allowed) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const existing = await prisma.bug.findUnique({
    where: { id: bugId, ...bugInTenant(await currentTenantIdFor(userId)) },
    select: {
      id: true,
      proofLinks: true,
      reporterId: true,
      assigneeId: true,
      isDeleted: true,
    },
  });

  if (!existing || existing.isDeleted) {
    return { error: TICKET_EDIT_ERRORS.notFound };
  }

  const mayEditLinks =
    existing.assigneeId === userId ||
    canEditTicket({
      actorId: userId,
      actorRole: user.role,
      membershipRole: (await currentTenantAccess(userId, user.role)).membershipRole,
      reporterId: existing.reporterId,
    });
  if (!mayEditLinks) {
    return { error: TICKET_EDIT_ERRORS.unauthorized };
  }

  const parsed = editProofLinksSchema.safeParse({
    proofLinks: formData.get("proofLinks") || "",
  });

  if (!parsed.success) {
    return fromZodError(parsed.error);
  }

  const proofLinks = parsed.data.proofLinks;
  const changes = getProofLinkChanges(existing.proofLinks ?? [], proofLinks);
  if (changes.added.length === 0 && changes.removed.length === 0) {
    return { ok: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.bug.update({
      where: { id: bugId },
      data: {
        proofLinks,
        updatedAt: new Date(),
      },
    });

    await publishWebEvent(tx, {
      bugId,
      type: "issue.updated",
      actorUserId: userId,
      payload: issueChangePayload({ proofLinks }),
    });

    await tx.bugActivity.create({
      data: {
        bugId,
        actorId: userId,
        type: "edited",
        summary: formatProofLinkSummary(changes),
        metadata: {
          fields: ["proofLinks"],
          added: changes.added,
          removed: changes.removed,
        },
      },
    });

  });

  revalidatePath("/[project]", "layout");
  revalidateIssue();
  revalidatePath("/bugs");
  revalidatePath(`/bugs/${bugId}`);
  return { ok: true };
}

/**
 * Adds a comment to a bug and records the activity: a reply to one stage
 * entry, or a comment on the issue itself (at any stage) or a reply to one.
 */
export async function addCommentAction(
  bugId: string,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await requireUserId();

  const limit = await consumeRateLimit(
    `add-comment:${userId}`,
    ACTION_RATE_LIMITS.addComment,
  );
  if (!limit.allowed) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const parsed = commentSchema.safeParse({
    body: formData.get("body"),
    confirmationId: formData.get("confirmationId") || undefined,
    bidId: formData.get("bidId") || undefined,
    deliveryId: formData.get("deliveryId") || undefined,
    testVerdictId: formData.get("testVerdictId") || undefined,
    mergeReviewId: formData.get("mergeReviewId") || undefined,
    parentId: formData.get("parentId") || undefined,
  });

  if (!parsed.success) {
    return fromZodError(parsed.error, "Invalid comment");
  }

  const bug = await prisma.bug.findUnique({
    where: { id: bugId, ...bugInTenant(await currentTenantIdFor(userId)) },
    select: {
      id: true,
      isDeleted: true,
      title: true,
      reporterId: true,
      assigneeId: true,
      tenantId: true,
      status: true,
      substatus: true,
      pullRequestUrl: true,
    },
  });
  if (!bug || bug.isDeleted) {
    return { error: "Issue not found" };
  }

  // One rule for where a comment may go, as for agents (lib/comment-placement.ts).
  let placement: CommentPlacement;
  try {
    placement = await placeComment(prisma, bug, parsed.data);
  } catch (error) {
    if (error instanceof CommentPlacementError) return { error: error.message };
    throw error;
  }
  const { confirmationId, bidId, deliveryId, testVerdictId, mergeReviewId, parentId, parentAuthorId } = placement;

  // #603: only agents in this issue's organization can be mentioned.
  const agents = await mentionedAgents(prisma, bug.tenantId, parsed.data.body);
  const normalizedBody = await normalizeMentionTags(parsed.data.body, bug.tenantId, agents);

  const commentId = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: {
        bugId,
        authorId: userId,
        body: normalizedBody,
        confirmationId,
        bidId,
        deliveryId,
        testVerdictId,
        mergeReviewId,
        parentId,
      },
      select: { id: true },
    });
    // Files uploaded with the comment (#215).
    await linkAttachments(tx, {
      ids: [
        ...new Set([
          ...parseAttachmentIds(formData.get("attachmentIds")),
          ...attachmentIdsInMarkdown(normalizedBody),
        ]),
      ],
      uploaderId: userId,
      bugId,
      commentId: created.id,
    });
    await tx.bugActivity.create({
      data: {
        bugId,
        actorId: userId,
        type: "commented",
        summary: commentedSummary(normalizedBody),
        metadata: {
          field: "comment",
          commentId: created.id,
          commentPreview: commentPreview(normalizedBody),
        } as Prisma.InputJsonValue,
      },
    });
    await tx.bug.update({ where: { id: bugId }, data: { updatedAt: new Date() } });
    // Commenting on an issue means you want to hear about replies (#216).
    await ensureWatching(tx, bugId, [userId]);
    // #600: a person's reply reaches the agents polling /api/v1/events.
    await publishWebEvent(tx, {
      bugId,
      type: "comment.created",
      actorUserId: userId,
      payload: {
        commentId: created.id,
        parentId,
        authorId: userId,
      },
    });
    return created.id;
  });

  // A mentioned agent's owner hears about it like a mention of them (#603).
  const mentioned = [...new Set([...extractMentionedUserIds(normalizedBody), ...agentOwnerIds(agents)])];
  const author = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  const actor = {
    actorId: userId,
    actorName: author?.name ?? "Someone",
    bugId,
    bugTitle: bug.title,
  };
  const excerpt = commentPreview(normalizedBody);
  const events: NotificationEvent[] = [];
  if (mentioned.length > 0) {
    events.push({ ...actor, kind: "mentioned", place: "comment", recipientIds: mentioned, excerpt, commentId });
  }
  // Watchers hear about every new comment (#216). The reporter and assignee
  // are the default audience; delivery adds anyone else watching.
  events.push({
    ...actor,
    kind: "comment_added",
    commentId,
    excerpt,
    parentAuthorId,
    recipientIds: [bug.reporterId, bug.assigneeId].filter((id): id is string => Boolean(id)),
    excludeIds: mentioned,
  });
  notifyLater(...events);

  revalidatePath("/[project]", "layout");
  revalidateIssue();
  revalidatePath("/bugs");
  revalidatePath(`/bugs/${bugId}`);
  return { ok: true, commentId };
}

export type ToggleVoteResult = ActionResult & {
  voted?: boolean;
  userVote?: number;
  voteCount?: number;
  likeCount?: number;
  dislikeCount?: number;
};

/**
 * Toggles the current user's importance mark on an issue (#importance; once an
 * upvote). Rejects any direction other than
 * 1 or -1, and -1 because downvotes are gone.
 */
export async function toggleVoteAction(
  bugId: string,
  direction: unknown = 1,
): Promise<ToggleVoteResult> {
  if (!isValidVoteDirection(direction)) {
    return { error: "Invalid vote" };
  }
  // #1059: only upvotes now. A stale page can still send -1; refuse it.
  if (direction === -1) {
    return { error: DOWNVOTES_REMOVED_MESSAGE };
  }

  // Do not redirect here — VoteButton needs a clear error for stale JWTs
  // after a DB reseed (old cuid no longer exists → Vote_userId_fkey).
  const resolved = await resolveSessionUserId();
  if ("error" in resolved) {
    return { error: SESSION_EXPIRED_MESSAGE };
  }
  const { userId } = resolved;

  const limit = await consumeRateLimit(
    `toggle-vote:${userId}`,
    ACTION_RATE_LIMITS.toggleVote,
  );
  if (!limit.allowed) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const bug = await prisma.bug.findUnique({
    where: { id: bugId, ...bugInTenant(await currentTenantIdFor(userId)) },
    select: { id: true, isDeleted: true, tenantId: true },
  });
  if (!bug || bug.isDeleted) {
    return { error: "Issue not found" };
  }

  const result = await prisma.$transaction(async (tx) => {
    // Acquire a row lock on the Bug to serialize concurrent vote updates
    // and prevent race-condition drift in voteCount (#362).
    await tx.$queryRaw`SELECT id FROM "Bug" WHERE id = ${bugId} FOR UPDATE`;

    const existing = await tx.vote.findUnique({
      where: { userId_bugId: { userId, bugId } },
    });

    const currentVote = existing?.value ?? 0;
    const { nextVote } = calculateVoteChange(currentVote, direction);

    if (nextVote === 0 && existing) {
      await tx.vote.delete({ where: { id: existing.id } });
    } else if (existing) {
      // #importance: a person's own click; no agent made it.
      await tx.vote.update({
        where: { id: existing.id },
        data: { value: nextVote, agentId: null },
      });
    } else {
      await tx.vote.create({
        data: { userId, bugId, value: nextVote },
      });
      // The first mark on an issue earns a point, once per person (#vote-points).
      await award(tx, {
        tenantId: bug.tenantId,
        userId,
        bugId,
        role: "vote",
        points: VOTE_POINTS,
        sourceKey: importanceSourceKey(bugId, userId),
      });
    }

    const voteCounts = await tx.vote.groupBy({
      by: ["value"],
      where: { bugId },
      _count: { _all: true },
    });

    const { likeCount, dislikeCount } = tallyVoteGroups(voteCounts);
    const voteCount = reconcileVoteCount(likeCount, dislikeCount);

    await tx.bug.update({
      where: { id: bugId },
      data: { voteCount },
    });

    return {
      voted: nextVote === 1,
      userVote: nextVote,
      voteCount,
      likeCount,
      dislikeCount,
    };
  });

  revalidatePath("/[project]", "layout");
  revalidateIssue();
  revalidatePath("/bugs");
  revalidatePath(`/bugs/${bugId}`);
  return { ok: true, ...result };
}

/**
 * Soft deletes a bug. Admins and super admins only.
 * The issue is hidden from normal views, but can be restored.
 */
export async function deleteBugAction(bugId: string): Promise<ActionResult> {
  const user = await requireUser();
  const access = await currentTenantAccess(user.id, user.role);
  if (!canDeleteTicket(user.role, access.membershipRole)) {
    return { error: TICKET_DELETION_ERRORS.unauthorized };
  }

  if (!bugId || typeof bugId !== "string" || bugId.trim().length === 0) {
    return { error: TICKET_DELETION_ERRORS.invalidId };
  }

  const existing = await prisma.bug.findUnique({
    where: { id: bugId, ...bugInTenant(await currentTenantIdFor(user.id)) },
    select: { id: true, isDeleted: true },
  });

  if (!existing) {
    return { error: TICKET_DELETION_ERRORS.notFound };
  }

  if (existing.isDeleted) {
    return { error: TICKET_DELETION_ERRORS.alreadyDeleted };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // #676: Row lock the Bug to serialize with concurrent vote / update actions.
      if (typeof tx.$queryRaw === "function") {
        await tx.$queryRaw`SELECT id FROM "Bug" WHERE id = ${bugId} FOR UPDATE`;
      }

      await tx.bug.update({
        where: { id: bugId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });
      // Release any unreleased claims on the soft-deleted issue (#627)
      await tx.issueClaim.updateMany({
        where: { bugId, releasedAt: null, status: { in: ["active", "offered"] } },
        data: { status: "released", releasedAt: new Date(), releaseReason: "deleted" },
      });
      // Delete attachments associated with the issue to prevent storage bloat (#658)
      await tx.attachment.deleteMany({ where: { bugId } });

      await publishWebEvent(tx, { bugId, type: "issue.deleted", actorUserId: user.id });

      await tx.bugActivity.create({
        data: {
          bugId,
          actorId: user.id,
          type: "deleted",
          summary: deletedSummary(),
        },
      });
    });
  } catch (error) {
    console.error("Failed to delete bug:", error);
    return { error: TICKET_DELETION_ERRORS.failed };
  }

  revalidatePath("/[project]", "layout");
  revalidateIssue();
  revalidatePath("/bugs");
  revalidatePath(`/bugs/${bugId}`);
  redirect("/home");
}

/**
 * Restores a soft-deleted bug. Admins and super admins only.
 * Returns the issue back to active status in views and searches.
 */
export async function restoreBugAction(bugId: string): Promise<ActionResult> {
  const user = await requireUser();
  const access = await currentTenantAccess(user.id, user.role);
  if (!canRestoreTicket(user.role, access.membershipRole)) {
    return { error: TICKET_DELETION_ERRORS.unauthorizedRestore };
  }

  if (!bugId || typeof bugId !== "string" || bugId.trim().length === 0) {
    return { error: TICKET_DELETION_ERRORS.invalidId };
  }

  const existing = await prisma.bug.findUnique({
    where: { id: bugId, ...bugInTenant(await currentTenantIdFor(user.id)) },
    select: { id: true, isDeleted: true },
  });

  if (!existing) {
    return { error: TICKET_DELETION_ERRORS.notFound };
  }

  if (!existing.isDeleted) {
    return { error: TICKET_DELETION_ERRORS.notDeleted };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // #676: Row lock the Bug to serialize with concurrent vote / update actions.
      if (typeof tx.$queryRaw === "function") {
        await tx.$queryRaw`SELECT id FROM "Bug" WHERE id = ${bugId} FOR UPDATE`;
      }

      // Reconcile voteCount from existing votes upon restoration (#676)
      let voteCount: number | undefined;
      if (tx.vote && typeof tx.vote.groupBy === "function") {
        const voteCounts = await tx.vote.groupBy({
          by: ["value"],
          where: { bugId },
          _count: { _all: true },
        });

        const { likeCount, dislikeCount } = tallyVoteGroups(voteCounts);
        voteCount = reconcileVoteCount(likeCount, dislikeCount);
      }

      await tx.bug.update({
        where: { id: bugId },
        data: {
          isDeleted: false,
          deletedAt: null,
          ...(voteCount !== undefined ? { voteCount } : {}),
        },
      });
      await publishWebEvent(tx, { bugId, type: "issue.restored", actorUserId: user.id });

      await tx.bugActivity.create({
        data: {
          bugId,
          actorId: user.id,
          type: "restored",
          summary: restoredSummary(),
        },
      });
    });
  } catch (error) {
    console.error("Failed to restore bug:", error);
    return { error: TICKET_DELETION_ERRORS.failedRestore };
  }

  revalidatePath("/[project]", "layout");
  revalidateIssue();
  revalidatePath("/bugs");
  revalidatePath(`/bugs/${bugId}`);
  return { ok: true };
}

/**
 * Toggles the boosted status of a bug. Admins and super admins only.
 * When boosted, the ticket appears pinned to the top of the list regardless of vote count.
 */
export async function toggleBoostBugAction(
  bugId: string,
): Promise<ActionResult & { isBoosted?: boolean }> {
  const user = await requireUser();
  const access = await currentTenantAccess(user.id, user.role);
  if (!canBoostTicket(user.role, access.membershipRole)) {
    return { error: TICKET_BOOST_ERRORS.unauthorized };
  }

  if (!bugId || typeof bugId !== "string" || bugId.trim().length === 0) {
    return { error: TICKET_BOOST_ERRORS.invalidId };
  }

  const existing = await prisma.bug.findUnique({
    where: { id: bugId, ...bugInTenant(await currentTenantIdFor(user.id)) },
    select: { id: true, isBoosted: true, isDeleted: true },
  });

  if (!existing || existing.isDeleted) {
    return { error: TICKET_BOOST_ERRORS.notFound };
  }

  const nextBoosted = !existing.isBoosted;
  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.bug.update({
        where: { id: bugId },
        data: {
          isBoosted: nextBoosted,
          boostedAt: nextBoosted ? now : null,
        },
      });

      await tx.bugActivity.create({
        data: {
          bugId,
          actorId: user.id,
          type: nextBoosted ? "boosted" : "unboosted",
          summary: nextBoosted ? boostedSummary() : unboostedSummary(),
          metadata: {
            field: "isBoosted",
            to: String(nextBoosted),
          } as Prisma.InputJsonValue,
        },
      });

      await publishWebEvent(tx, {
        bugId,
        type: "issue.updated",
        actorUserId: user.id,
        payload: issueChangePayload({ isBoosted: nextBoosted }),
      });
    });
  } catch (error) {
    console.error("Failed to toggle bug boost:", error);
    return { error: TICKET_BOOST_ERRORS.failed };
  }

  revalidatePath("/[project]", "layout");
  revalidateIssue();
  revalidatePath("/bugs");
  revalidatePath(`/bugs/${bugId}`);
  return { ok: true, isBoosted: nextBoosted };
}

/**
 * Allows a user to assign an issue to themselves, or unassign if currently assigned.
 * Validates permission via canAssignTicket.
 */
export async function selfAssignBugAction(
  bugId: string,
  assign: boolean = true,
): Promise<ActionResult> {
  const user = await requireUser();
  const userId = user.id;

  const limit = checkRateLimit(
    `self-assign:${userId}`,
    ACTION_RATE_LIMITS.selfAssign,
  );
  if (!limit.allowed) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  if (!bugId || typeof bugId !== "string" || bugId.trim().length === 0) {
    return { error: TICKET_ASSIGN_ERRORS.invalidId };
  }

  const existing = await prisma.bug.findUnique({
    where: { id: bugId, ...bugInTenant(await currentTenantIdFor(userId)) },
    select: {
      id: true,
      title: true,
      assigneeId: true,
      isDeleted: true,
      assignee: { select: { name: true } },
    },
  });

  if (!existing || existing.isDeleted) {
    return { error: TICKET_ASSIGN_ERRORS.notFound };
  }

  const targetAssigneeId = assign ? userId : null;

  if (assign && existing.assigneeId !== userId) {
    return { error: TICKET_ASSIGN_ERRORS.needsAgentClaim };
  }

  if (
    !canAssignTicket({
      actorId: userId,
      actorRole: user.role,
      membershipRole: (await currentTenantAccess(userId, user.role)).membershipRole,
      currentAssigneeId: existing.assigneeId,
      targetAssigneeId,
    })
  ) {
    return { error: TICKET_ASSIGN_ERRORS.unauthorized };
  }

  if (existing.assigneeId === targetAssigneeId) {
    return { ok: true };
  }

  const toName = targetAssigneeId ? user.name ?? null : null;

  try {
    await prisma.$transaction(async (tx) => {
      // #676: Row lock the Bug to serialize concurrent assignment and vote checks.
      if (typeof tx.$queryRaw === "function") {
        await tx.$queryRaw`SELECT id FROM "Bug" WHERE id = ${bugId} FOR UPDATE`;
      }

      await tx.bug.update({
        where: { id: bugId },
        data: { assigneeId: targetAssigneeId },
      });
      // Taking an issue means watching it (#216).
      await ensureWatching(tx, bugId, [targetAssigneeId]);

      await tx.bugActivity.create({
        data: {
          bugId,
          actorId: userId,
          type: "assignee_changed",
          summary: assigneeChangedSummary(
            existing.assignee?.name ?? null,
            toName,
          ),
          metadata: {
            field: "assigneeId",
            from: existing.assigneeId,
            to: targetAssigneeId,
          },
        },
      });
      await publishWebEvent(tx, {
        bugId,
        type: "issue.updated",
        actorUserId: userId,
        payload: issueChangePayload({ assigneeId: targetAssigneeId }),
      });
    });
  } catch (error) {
    console.error("Failed to self-assign issue:", error);
    return { error: TICKET_ASSIGN_ERRORS.failed };
  }

  notifyLater({
    kind: "assignee_changed",
    actorId: userId,
    actorName: user.name ?? "Someone",
    bugId,
    bugTitle: existing.title,
    fromUserId: existing.assigneeId,
    toUserId: targetAssigneeId,
  });

  revalidateIssue();
  revalidatePath("/[project]", "layout");
  revalidatePath(`/bugs/${bugId}`);
  revalidatePath("/bugs");
  return { ok: true };
}


