import { prisma } from "@/lib/prisma";
import type {
  Prisma,
  ForumScope as PrismaForumScope,
  ForumPostKind,
  ForumResolution,
  ForumReplyKind,
  ForumCloseReason,
  ForumVerificationOutcome,
  ForumVerificationStatus,
} from "@prisma/client";
import {
  type ForumCategory,
  type ForumMessage,
  type ForumReplyItem,
  type ForumScope,
  type CreateForumMessageInput,
  type AccessibleOrganisation,
  type ExternalProject,
} from "./forum-types";

export * from "./forum-types";

// In-memory store for offline tests
const memoryForumStore: ForumMessage[] = [];
const memoryBookmarks = new Map<string, Map<string, { agentId?: string; note?: string; createdAt: number }>>();

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type ForumPostWithRelations = Prisma.ForumPostGetPayload<{
  include: {
    authorUser: { select: { id: true; name: true; email: true; role: true } };
    authorAgent: { select: { id: true; name: true; username: true; model: true } };
    organisation: { select: { id: true; name: true; slug: true } };
    project: { select: { id: true; name: true; slug: true; organisation: { select: { slug: true } } } };
    replies: {
      include: {
        authorUser: { select: { id: true; name: true; email: true; role: true } };
        authorAgent: { select: { id: true; name: true; username: true; model: true } };
        votes: true;
        verifications: true;
      };
    };
    votes: true;
    verifications: true;
    offer: true;
  };
}> & {
  bookmarks?: Array<{ userId: string; bookmarkedByAgentId: string | null; note: string | null }>;
};

function mapPrismaReplyToReplyItem(
  reply: ForumPostWithRelations["replies"][number]
): ForumReplyItem {
  const isAgent = Boolean(reply.authorAgentId && reply.authorAgent);
  const authorName = isAgent
    ? reply.authorAgent?.name ?? "Agent"
    : reply.authorUser.name ?? "User";
  const handle = isAgent
    ? reply.authorAgent?.username ?? `agent-${reply.authorAgentId?.slice(0, 6)}`
    : reply.authorUser.email.split("@")[0];

  const helpfulCount = reply.votes?.reduce((acc, v) => acc + v.value, 0) ?? 0;

  return {
    id: reply.id,
    kind: reply.kind as "answer" | "comment",
    accepted: reply.isSolution,
    helpfulCount,
    author: {
      name: authorName,
      ownerName: reply.authorUser.name,
      handle,
      isAgent,
      model: reply.authorAgent?.model ?? undefined,
      role: isAgent ? "AGENT WORKER" : reply.authorUser.role === "admin" ? "ADMIN" : "MEMBER",
      avatarInitials: authorName.slice(0, 2).toUpperCase(),
      userId: reply.authorUser.id,
      agentId: reply.authorAgentId ?? undefined,
    },
    content: reply.body,
    createdAt: formatTimeAgo(reply.createdAt),
  };
}

function mapPrismaPostToMessage(post: ForumPostWithRelations, viewerUserId?: string): ForumMessage {
  const isAgent = Boolean(post.authorAgentId && post.authorAgent);
  const authorName = isAgent
    ? post.authorAgent?.name ?? "Agent"
    : post.authorUser.name ?? "User";
  const handle = isAgent
    ? post.authorAgent?.username ?? `agent-${post.authorAgentId?.slice(0, 6)}`
    : post.authorUser.email.split("@")[0];

  const code = `#${post.number}`;

  const helpfulCount = post.votes?.reduce((acc, v) => acc + v.value, 0) ?? 0;
  const verified = post.verification === "verified";
  const track = post.trackSlug === "your_app" ? "product" : (post.trackSlug as "product" | "marketing" | "security");

  const orgSlug = post.organisation?.slug ?? post.project?.organisation?.slug;
  const projectSlug = post.project?.slug;
  const bookmarkList = post.bookmarks ?? [];
  const viewerBookmark = viewerUserId ? bookmarkList.find((b) => b.userId === viewerUserId) : undefined;

  return {
    id: String(post.number),
    number: post.number,
    code,
    kind: post.kind as "ask" | "report",
    track,
    category: (post.category as ForumMessage["category"]) || "help_needed",
    scope: (post.scope as ForumScope) || "platform",
    organisationId: post.organisationId ?? undefined,
    organisationSlug: orgSlug ?? undefined,
    projectId: post.projectId ?? undefined,
    projectSlug: projectSlug ?? undefined,
    author: {
      name: authorName,
      ownerName: post.authorUser.name,
      handle,
      isAgent,
      model: post.authorAgent?.model ?? undefined,
      role: isAgent ? "AGENT WORKER" : post.authorUser.role === "admin" ? "ADMIN" : "MEMBER",
      avatarInitials: authorName.slice(0, 2).toUpperCase(),
      userId: post.authorUser.id,
      agentId: post.authorAgentId ?? undefined,
    },
    title: post.title,
    content: post.body,
    tags: post.tags && post.tags.length > 0 ? post.tags : ["General"],
    views: 1,
    helpfulCount,
    offerAmount: post.offer ? `$${Number(post.offer.amount).toFixed(2)}` : undefined,
    offerState: post.offer ? (post.offer.state as "reserved" | "paid" | "refunded") : undefined,
    verified,
    verificationStatus: (post.verification as ForumMessage["verificationStatus"]) ?? "unverified",
    closeReason: (post.closeReason as ForumMessage["closeReason"]) ?? undefined,
    sourceType: (post.sourceType as ForumMessage["sourceType"]) ?? undefined,
    sourceId: post.sourceId ?? undefined,
    issueNumber:
      (post.sourceType === "issue" || post.sourceType === "marketing_task") &&
      post.sourceId &&
      !isNaN(parseInt(post.sourceId.replace(/^#/, ""), 10))
        ? parseInt(post.sourceId.replace(/^#/, ""), 10)
        : undefined,
    createdAt: formatTimeAgo(post.createdAt),
    status:
      post.resolution === "resolved"
        ? "resolved"
        : post.resolution === "closed"
          ? "closed"
          : "open",
    isPinned: Boolean(post.isPinned),
    pinnedAt: post.pinnedAt ? post.pinnedAt.toISOString() : undefined,
    bookmarkCount: bookmarkList.length,
    bookmarkedByViewer: Boolean(viewerBookmark),
    bookmarkNote: viewerBookmark?.note ?? undefined,
    replies: (post.replies || []).map(mapPrismaReplyToReplyItem),
  };
}

export interface ListForumOptions {
  q?: string;
  category?: ForumCategory;
  issueNumber?: number;
  status?: "open" | "resolved" | "closed";
  track?: "product" | "your_app" | "marketing" | "security";
  kind?: "ask" | "report";
  scope?: ForumScope;
  organisationId?: string;
  projectId?: string;
  pinned?: boolean;
  bookmarked?: "owner" | "mine";
  mine?: boolean;
  viewerUserId?: string;
  viewerAgentId?: string;
  viewerOrgId?: string | null;
  sort?: "trending" | "newest" | "helpful" | "replies" | "saved";
  limit?: number;
  cursor?: string;
}

export interface PaginatedForumMessages {
  messages: ForumMessage[];
  count: number;
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export async function listForumMessagesPaginated(
  options?: ListForumOptions
): Promise<PaginatedForumMessages> {
  const all = await listForumMessages(options);
  const total = all.length;
  const rawLimit = options?.limit ?? 20;
  const limit = Math.min(Math.max(1, rawLimit), 50);

  let startIndex = 0;
  if (options?.cursor) {
    const cleanedCursor = options.cursor.trim().replace(/^#/, "");
    const idx = all.findIndex(
      (m) =>
        m.id === cleanedCursor ||
        m.id === options.cursor ||
        (m.number !== undefined && String(m.number) === cleanedCursor) ||
        m.code === `#${cleanedCursor}`
    );
    if (idx !== -1) {
      startIndex = idx + 1;
    }
  }

  const messages = all.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < total;
  const lastItem = messages[messages.length - 1];
  const nextCursor = hasMore && lastItem ? String(lastItem.number ?? lastItem.id) : null;

  return {
    messages,
    count: messages.length,
    total,
    hasMore,
    nextCursor,
  };
}

export async function listForumMessages(options?: ListForumOptions): Promise<ForumMessage[]> {
  try {
    const where: Prisma.ForumPostWhereInput = {};

    if (options?.q) {
      const query = options.q.trim();
      where.OR = [
        { title: { contains: query, mode: "insensitive" } },
        { body: { contains: query, mode: "insensitive" } },
      ];
    }

    if (options?.scope) {
      where.scope = options.scope as PrismaForumScope;
      if (options.scope === "platform") {
        where.organisationId = null;
        where.projectId = null;
      } else if (options.scope === "org" && options.organisationId) {
        where.organisationId = options.organisationId;
      } else if (options.scope === "project" && options.projectId) {
        where.projectId = options.projectId;
      }
    }

    if (options?.category && options.category !== "all") {
      where.category = options.category;
    }

    if (options?.status) {
      where.resolution = options.status as ForumResolution;
    }

    if (options?.track) {
      where.trackSlug =
        options.track === "product" || options.track === "your_app"
          ? "your_app"
          : options.track;
    }

    if (options?.kind) {
      where.kind = options.kind as ForumPostKind;
    }

    if (typeof options?.pinned === "boolean") {
      where.isPinned = options.pinned;
    }

    const andConditions: Prisma.ForumPostWhereInput[] = [];

    if (options?.bookmarked && options?.viewerUserId) {
      andConditions.push({
        bookmarks: {
          some:
            options.bookmarked === "mine" && options.viewerAgentId
              ? { userId: options.viewerUserId, bookmarkedByAgentId: options.viewerAgentId }
              : { userId: options.viewerUserId },
        },
      });
      // Enforce strict cross-org visibility for agent API callers even when sharing owner bookmarks.
      if (options.viewerAgentId && !options.scope) {
        andConditions.push({
          OR: [
            { scope: "platform" },
            ...(options.viewerOrgId ? [{ organisationId: options.viewerOrgId }] : []),
          ],
        });
      }
    }

    if (options?.mine && options?.viewerUserId) {
      andConditions.push({
        OR: [
          { authorUserId: options.viewerUserId },
          { replies: { some: { authorUserId: options.viewerUserId } } },
        ],
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const posts = await prisma.forumPost.findMany({
      where,
      include: {
        authorUser: { select: { id: true, name: true, email: true, role: true } },
        authorAgent: { select: { id: true, name: true, username: true, model: true } },
        organisation: { select: { id: true, name: true, slug: true } },
        project: { select: { id: true, name: true, slug: true, organisation: { select: { slug: true } } } },
        replies: {
          include: {
            authorUser: { select: { id: true, name: true, email: true, role: true } },
            authorAgent: { select: { id: true, name: true, username: true, model: true } },
            votes: true,
            verifications: true,
          },
          orderBy: { createdAt: "asc" },
        },
        votes: true,
        verifications: true,
        offer: true,
        bookmarks: { select: { userId: true, bookmarkedByAgentId: true, note: true } },
      },
      orderBy:
        options?.sort === "newest"
          ? { createdAt: "desc" }
          : [{ isPinned: "desc" }, { pinnedAt: "desc" }, { createdAt: "desc" }],
    });

    const mapped = posts.map((p) => mapPrismaPostToMessage(p, options?.viewerUserId));
    if (options?.sort === "helpful") {
      return mapped.sort((a, b) => b.helpfulCount - a.helpfulCount);
    }
    if (options?.sort === "replies") {
      return mapped.sort((a, b) => b.replies.length - a.replies.length);
    }
    if (options?.sort === "saved") {
      return mapped.sort((a, b) => (b.bookmarkCount ?? 0) - (a.bookmarkCount ?? 0));
    }
    return mapped;
  } catch {
    // If database is not ready or during tests, fall through to in-memory store
  }

  // In-memory fallback
  const filtered = memoryForumStore.filter((msg) => {
    if (options?.q) {
      const query = options.q.toLowerCase();
      const match =
        msg.title.toLowerCase().includes(query) ||
        msg.content.toLowerCase().includes(query) ||
        msg.author.name.toLowerCase().includes(query) ||
        msg.tags.some((t) => t.toLowerCase().includes(query));
      if (!match) return false;
    }
    if (options?.category && options.category !== "all" && msg.category !== options.category) {
      return false;
    }
    if (options?.issueNumber && msg.issueNumber !== options.issueNumber) {
      return false;
    }
    if (options?.status && msg.status !== options.status) {
      return false;
    }
    if (options?.track) {
      const normalizedTrack = options.track === "your_app" ? "product" : options.track;
      if (msg.track !== normalizedTrack) return false;
    }
    if (options?.kind && msg.kind !== options.kind) {
      return false;
    }
    if (typeof options?.pinned === "boolean" && Boolean(msg.isPinned) !== options.pinned) {
      return false;
    }
    if (options?.bookmarked && options?.viewerUserId) {
      const postBookmarks = memoryBookmarks.get(msg.id);
      const entry = postBookmarks?.get(options.viewerUserId);
      if (!entry) return false;
      if (options.bookmarked === "mine" && options.viewerAgentId && entry.agentId !== options.viewerAgentId) {
        return false;
      }
      if (options.viewerAgentId && !options.scope) {
        const canSee =
          (msg.scope ?? "platform") === "platform" ||
          (Boolean(options.viewerOrgId) && msg.organisationId === options.viewerOrgId);
        if (!canSee) return false;
      }
    }
    if (options?.mine && options?.viewerUserId) {
      const authored = msg.author.userId === options.viewerUserId;
      const replied = msg.replies.some((r) => r.author.userId === options.viewerUserId);
      if (!authored && !replied) return false;
    }
    return true;
  });

  const decorated = filtered.map((msg) => {
    const postBookmarks = memoryBookmarks.get(msg.id);
    const entry = options?.viewerUserId ? postBookmarks?.get(options.viewerUserId) : undefined;
    return {
      ...msg,
      bookmarkCount: postBookmarks ? postBookmarks.size : (msg.bookmarkCount ?? 0),
      bookmarkedByViewer: entry ? true : Boolean(msg.bookmarkedByViewer),
      bookmarkNote: entry?.note ?? msg.bookmarkNote,
    };
  });

  if (options?.sort === "newest") return decorated;
  if (options?.sort === "helpful") return decorated.sort((a, b) => b.helpfulCount - a.helpfulCount);
  if (options?.sort === "replies") return decorated.sort((a, b) => b.replies.length - a.replies.length);
  if (options?.sort === "saved") return decorated.sort((a, b) => (b.bookmarkCount ?? 0) - (a.bookmarkCount ?? 0));
  return decorated.sort((a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)));
}

export async function getForumMessageById(id: string, viewerUserId?: string): Promise<ForumMessage | null> {
  const cleaned = id.trim().replace(/^#/, "");
  const numeric = parseInt(cleaned, 10);
  const isNumeric = !isNaN(numeric) && String(numeric) === cleaned && numeric > 0;

  try {
    const post = await prisma.forumPost.findFirst({
      where: {
        OR: [
          { id },
          ...(isNumeric ? [{ number: numeric }] : []),
          ...(id.startsWith("fm-") && !isNaN(parseInt(id.slice(3), 10))
            ? [{ number: parseInt(id.slice(3), 10) }]
            : []),
          ...(id.includes("-") && !isNaN(parseInt(id.split("-")[1], 10))
            ? [{ number: parseInt(id.split("-")[1], 10) }]
            : []),
        ],
      },
      include: {
        authorUser: { select: { id: true, name: true, email: true, role: true } },
        authorAgent: { select: { id: true, name: true, username: true, model: true } },
        organisation: { select: { id: true, name: true, slug: true } },
        project: { select: { id: true, name: true, slug: true, organisation: { select: { slug: true } } } },
        replies: {
          include: {
            authorUser: { select: { id: true, name: true, email: true, role: true } },
            authorAgent: { select: { id: true, name: true, username: true, model: true } },
            votes: true,
            verifications: true,
          },
          orderBy: { createdAt: "asc" },
        },
        votes: true,
        verifications: true,
        offer: true,
        bookmarks: { select: { userId: true, bookmarkedByAgentId: true, note: true } },
      },
    });

    if (post) {
      return mapPrismaPostToMessage(post, viewerUserId);
    }
  } catch {
    // Fall through to in-memory fallback
  }

  return (
    memoryForumStore.find((m) => {
      if (m.id === id || m.id === cleaned) return true;
      if (isNumeric && (m.number === numeric || m.id === String(numeric))) return true;
      if (m.code.toLowerCase() === id.toLowerCase() || (isNumeric && m.code === `#${numeric}`)) return true;
      if (id.startsWith("fm-") && (m.id === id.slice(3) || (m.number !== undefined && String(m.number) === id.slice(3)))) return true;
      return false;
    }) ?? null
  );
}

async function assertAgentCanPinForumPost(params: {
  scope: PrismaForumScope;
  organisationId: string | null;
  actorUserId?: string;
  actorAgentId?: string;
  actorLevel?: string;
  actorOrgId?: string | null;
}): Promise<void> {
  const isManagerOrMerger = params.actorLevel === "manager" || params.actorLevel === "merger";
  if (!isManagerOrMerger) {
    throw new Error("Forbidden: Only manager or merger agents may pin forum posts.");
  }

  if (params.scope === "platform") {
    if (params.actorUserId && prisma.user?.findUnique) {
      try {
        const owner = await prisma.user.findUnique({
          where: { id: params.actorUserId },
          select: { role: true },
        });
        if (owner && owner.role !== "admin" && owner.role !== "super_admin") {
          throw new Error(
            "Forbidden: Only manager or merger agents owned by a platform admin may pin Global Forum posts."
          );
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Forbidden:")) {
          throw err;
        }
        // DB unavailable in offline unit tests
      }
    }
    return;
  }

  if (params.organisationId) {
    if (params.actorAgentId && prisma.agentActivation?.findUnique) {
      try {
        const activation = await prisma.agentActivation.findUnique({
          where: {
            agentId_organisationId: {
              agentId: params.actorAgentId,
              organisationId: params.organisationId,
            },
          },
          select: { level: true, deactivatedAt: true },
        });
        if (activation) {
          if (activation.deactivatedAt || (activation.level !== "manager" && activation.level !== "merger")) {
            throw new Error(
              "Forbidden: Agent must have active manager or merger level in this organisation to pin posts."
            );
          }
          return;
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Forbidden:")) {
          throw err;
        }
        // DB unavailable in offline unit tests
      }
    }

    if (params.actorOrgId && params.actorOrgId !== params.organisationId) {
      throw new Error("Forbidden: Agents may only pin posts inside their own organisation.");
    }
  }
}

export async function createForumMessage(
  author: ForumMessage["author"] & {
    userId?: string;
    agentId?: string;
    actorLevel?: string;
    actorOrgId?: string | null;
  },
  input: CreateForumMessageInput
): Promise<ForumMessage> {
  if (
    input.track !== "product" &&
    input.track !== "your_app" &&
    input.track !== "marketing" &&
    input.track !== "security"
  ) {
    throw new Error("Invalid or missing forum track. Must be 'product', 'your_app', 'marketing', or 'security'.");
  }
  const trackSlug: "your_app" | "marketing" | "security" =
    input.track === "marketing" ? "marketing" : input.track === "security" ? "security" : "your_app";
  const uiTrack: "product" | "marketing" | "security" =
    trackSlug === "your_app" ? "product" : trackSlug;
  if (input.scope !== "platform" && input.scope !== "org" && input.scope !== "project") {
    throw new Error("Scope is required ('platform', 'org', or 'project').");
  }
  const effectiveScope: PrismaForumScope = input.scope;
  const effectiveKind: ForumPostKind = (input.kind as ForumPostKind) || "ask";
  const parsedOffer = input.offerAmount
    ? parseFloat(input.offerAmount.replace(/[^0-9.]/g, ""))
    : NaN;
  const validOfferAmount =
    effectiveScope !== "platform" &&
    effectiveKind === "ask" &&
    !isNaN(parsedOffer) &&
    parsedOffer > 0
      ? parsedOffer
      : null;

  const derivedSourceType: string | null =
    effectiveScope === "platform"
      ? null
      : input.sourceType || (input.issueNumber ? (trackSlug === "marketing" ? "marketing_task" : "issue") : null);
  const derivedSourceId: string | null =
    effectiveScope === "platform"
      ? null
      : input.sourceId || (input.issueNumber ? String(input.issueNumber) : null);

  try {
    if (author.userId) {
      let resolvedOrgId: string | null = null;
      let resolvedProjId: string | null = null;

      if (effectiveScope === "org") {
        if (!input.organisationId) {
          throw new Error("Validation error: organisationId is required when scope is 'org'.");
        }
        if (prisma.organisation?.findFirst) {
          const org = await prisma.organisation.findFirst({
            where: {
              OR: [{ id: input.organisationId }, { slug: input.organisationId }],
              archivedAt: null,
            },
            select: { id: true },
          });
          if (!org) {
            throw new Error("Forbidden: target organisation not found or inaccessible.");
          }
          if (prisma.membership?.findUnique) {
            const member = await prisma.membership.findUnique({
              where: {
                organisationId_userId: {
                  organisationId: org.id,
                  userId: author.userId,
                },
              },
              select: { id: true },
            });
            if (!member) {
              throw new Error("Forbidden: agent owner is not a member of this organisation.");
            }
          }
          resolvedOrgId = org.id;
        } else {
          resolvedOrgId = input.organisationId;
        }
      } else if (effectiveScope === "project") {
        if (!input.projectId) {
          throw new Error("Validation error: projectId is required when scope is 'project'.");
        }
        if (prisma.project?.findFirst) {
          const proj = await prisma.project.findFirst({
            where: {
              OR: [{ id: input.projectId }, { slug: input.projectId }],
              archivedAt: null,
              organisation: {
                archivedAt: null,
                ...(input.organisationId
                  ? { OR: [{ id: input.organisationId }, { slug: input.organisationId }] }
                  : {}),
              },
            },
            select: { id: true, organisationId: true },
          });
          if (!proj) {
            throw new Error("Forbidden: target project not found or inaccessible.");
          }
          // Access to a project is granted by either (1) org membership OR (2) direct project membership
          if (prisma.membership?.findUnique || prisma.projectMembership?.findUnique) {
            const [orgMember, projMember] = await Promise.all([
              prisma.membership?.findUnique
                ? prisma.membership.findUnique({
                    where: {
                      organisationId_userId: {
                        organisationId: proj.organisationId,
                        userId: author.userId,
                      },
                    },
                    select: { id: true },
                  })
                : Promise.resolve(null),
              prisma.projectMembership?.findUnique
                ? prisma.projectMembership.findUnique({
                    where: {
                      projectId_userId: {
                        projectId: proj.id,
                        userId: author.userId,
                      },
                    },
                    select: { id: true },
                  })
                : Promise.resolve(null),
            ]);
            if (!orgMember && !projMember) {
              throw new Error(
                "Forbidden: agent owner does not have organisation or project membership for this project."
              );
            }
          }
          resolvedOrgId = proj.organisationId;
          resolvedProjId = proj.id;
        } else {
          resolvedOrgId = input.organisationId ?? null;
          resolvedProjId = input.projectId;
        }
      }

      if (input.offerAmount && effectiveKind === "report") {
        throw new Error("Validation error: Offers (bounties) are only allowed on 'ask' posts.");
      }

      if (validOfferAmount !== null && (!derivedSourceType || !derivedSourceId)) {
        throw new Error(
          "Validation error: An offer (bounty) must be linked to a task via issueNumber or sourceId."
        );
      }

      if (derivedSourceType && derivedSourceId) {
        if (derivedSourceType === "issue" || derivedSourceType === "marketing_task") {
          if (prisma.bug?.findFirst) {
            const numericTask = parseInt(derivedSourceId.replace(/^#/, ""), 10);
            const hasNumericTask = !isNaN(numericTask) && numericTask > 0;
            const linkedBug = await prisma.bug.findFirst({
              where: {
                ...(resolvedOrgId ? { organisationId: resolvedOrgId } : {}),
                ...(resolvedProjId ? { projectId: resolvedProjId } : {}),
                track: derivedSourceType === "marketing_task" ? "marketing" : "product",
                OR: [
                  { id: derivedSourceId },
                  ...(hasNumericTask ? [{ number: numericTask }] : []),
                ],
              },
              select: { id: true, number: true, reward: true },
            });

            if (!linkedBug) {
              throw new Error(
                `Validation error: Referenced ${derivedSourceType} not found in this scope.`
              );
            }

            if (validOfferAmount !== null) {
              const taskRewardLimit = Number(linkedBug.reward);
              let alreadyReservedOrPaid = 0;

              if (prisma.forumOffer?.findMany) {
                const existingOffers = await prisma.forumOffer.findMany({
                  where: {
                    ...(resolvedOrgId ? { organisationId: resolvedOrgId } : {}),
                    state: { in: ["reserved", "paid"] },
                    post: {
                      OR: [
                        { sourceId: linkedBug.id },
                        { sourceId: String(linkedBug.number) },
                      ],
                    },
                  },
                  select: { amount: true },
                });
                alreadyReservedOrPaid = existingOffers.reduce(
                  (acc, o) => acc + Number(o.amount),
                  0
                );
              }

              const remainingTaskBudget = Math.max(0, taskRewardLimit - alreadyReservedOrPaid);
              if (validOfferAmount > remainingTaskBudget) {
                throw new Error(
                  `Validation error: Offer amount ($${validOfferAmount.toFixed(2)}) exceeds the linked task's remaining reward limit ($${remainingTaskBudget.toFixed(2)} of $${taskRewardLimit.toFixed(2)}).`
                );
              }
            }
          }
        } else if (derivedSourceType === "idea" || derivedSourceType === "marketing_idea") {
          if (prisma.idea?.findFirst) {
            const linkedIdea = await prisma.idea.findFirst({
              where: {
                ...(resolvedOrgId ? { organisationId: resolvedOrgId } : {}),
                track: derivedSourceType === "marketing_idea" ? "marketing" : "product",
                id: derivedSourceId,
              },
              select: { id: true },
            });
            if (!linkedIdea) {
              throw new Error(
                `Validation error: Referenced ${derivedSourceType} not found in this scope.`
              );
            }
          }
        }
      }

      if (input.isPinned) {
        await assertAgentCanPinForumPost({
          scope: effectiveScope,
          organisationId: effectiveScope === "platform" ? null : resolvedOrgId,
          actorUserId: author.userId,
          actorAgentId: author.agentId,
          actorLevel: author.actorLevel,
          actorOrgId: author.actorOrgId,
        });
      }

      // Ensure default track exists
      await prisma.forumTrack.upsert({
        where: { slug: trackSlug },
        update: {},
        create: {
          slug: trackSlug,
          label: trackSlug === "your_app" ? "Your App" : trackSlug === "marketing" ? "Marketing" : "Security",
        },
      });

      const newPost = await prisma.forumPost.create({
        data: {
          scope: effectiveScope,
          kind: effectiveKind,
          category: input.category || "help_needed",
          trackSlug,
          title: input.title,
          body: input.content,
          tags: input.tags && input.tags.length > 0 ? input.tags : ["General"],
          authorUserId: author.userId,
          authorAgentId: author.agentId || null,
          organisationId: effectiveScope === "platform" ? null : resolvedOrgId,
          projectId: effectiveScope === "project" ? resolvedProjId : null,
          sourceType: derivedSourceType,
          sourceId: derivedSourceId,
          isPinned: Boolean(input.isPinned),
          pinnedAt: input.isPinned ? new Date() : null,
          pinnedByAgentId: input.isPinned ? author.agentId || null : null,
          ...(validOfferAmount !== null && resolvedOrgId
            ? {
                offer: {
                  create: {
                    organisationId: resolvedOrgId,
                    askerUserId: author.userId,
                    amount: validOfferAmount,
                    state: "reserved",
                  },
                },
              }
            : {}),
        },
        include: {
          authorUser: { select: { id: true, name: true, email: true, role: true } },
          authorAgent: { select: { id: true, name: true, username: true, model: true } },
          organisation: { select: { id: true, name: true, slug: true } },
          project: { select: { id: true, name: true, slug: true, organisation: { select: { slug: true } } } },
          replies: {
            include: {
              authorUser: { select: { id: true, name: true, email: true, role: true } },
              authorAgent: { select: { id: true, name: true, username: true, model: true } },
              votes: true,
              verifications: true,
            },
          },
          votes: true,
          verifications: true,
          offer: true,
        },
      });

      const mapped = mapPrismaPostToMessage(newPost);
      memoryForumStore.unshift(mapped);
      return mapped;
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.startsWith("Forbidden:") || err.message.startsWith("Validation error:"))
    ) {
      throw err;
    }
    // If DB fails, proceed with memory fallback
  }

  if (input.isPinned) {
    await assertAgentCanPinForumPost({
      scope: effectiveScope,
      organisationId: effectiveScope === "platform" ? null : (input.organisationId ?? null),
      actorUserId: author.userId,
      actorAgentId: author.agentId,
      actorLevel: author.actorLevel,
      actorOrgId: author.actorOrgId,
    });
  }

  const nextNum = memoryForumStore.length > 0
    ? Math.max(...memoryForumStore.map((m) => m.number || parseInt(m.id, 10) || 0)) + 1
    : 1;
  const newMsg: ForumMessage = {
    id: String(nextNum),
    number: nextNum,
    code: `#${nextNum}`,
    kind: input.kind ?? "ask",
    track: uiTrack,
    scope: effectiveScope,
    organisationId: effectiveScope === "platform" ? undefined : input.organisationId,
    projectId: effectiveScope === "project" ? input.projectId : undefined,
    author: {
      ...author,
      avatarInitials:
        author.avatarInitials ??
        author.name
          .split(/\s+/)
          .map((w) => w[0])
          .join("")
          .slice(0, 2)
          .toUpperCase(),
    },
    category: input.category,
    title: input.title,
    content: input.content,
    issueNumber:
      (derivedSourceType === "issue" || derivedSourceType === "marketing_task") &&
      derivedSourceId &&
      !isNaN(parseInt(derivedSourceId.replace(/^#/, ""), 10))
        ? parseInt(derivedSourceId.replace(/^#/, ""), 10)
        : input.issueNumber,
    sourceType: (derivedSourceType as ForumMessage["sourceType"]) ?? undefined,
    sourceId: derivedSourceId ?? undefined,
    tags: input.tags && input.tags.length > 0 ? input.tags : ["General"],
    views: 1,
    helpfulCount: 0,
    offerAmount: input.offerAmount || undefined,
    offerState: input.offerAmount ? "reserved" : undefined,
    verified: false,
    createdAt: "Just now",
    status: "open",
    isPinned: Boolean(input.isPinned),
    pinnedAt: input.isPinned ? new Date().toISOString() : undefined,
    bookmarkCount: 0,
    bookmarkedByViewer: false,
    replies: [],
  };

  memoryForumStore.unshift(newMsg);
  return newMsg;
}

export async function replyToForumMessage(
  messageId: string,
  author: ForumMessage["replies"][number]["author"] & { userId?: string; agentId?: string },
  content: string,
  kind: "answer" | "comment" = "comment"
): Promise<ForumMessage["replies"][number] | null> {
  const cleaned = messageId.trim().replace(/^#/, "");
  const numeric = parseInt(cleaned, 10);
  const isNumeric = !isNaN(numeric) && String(numeric) === cleaned && numeric > 0;

  const findInMemory = () => {
    return memoryForumStore.find((m) => {
      if (m.id === messageId || m.id === cleaned) return true;
      if (isNumeric && (m.number === numeric || m.id === String(numeric))) return true;
      if (m.code.toLowerCase() === messageId.toLowerCase() || (isNumeric && m.code === `#${numeric}`)) return true;
      if (messageId.startsWith("fm-") && (m.id === messageId.slice(3) || (m.number !== undefined && String(m.number) === messageId.slice(3)))) return true;
      return false;
    });
  };

  try {
    if (author.userId) {
      // Find the post
      const post = await prisma.forumPost.findFirst({
        where: {
          OR: [
            { id: messageId },
            ...(isNumeric ? [{ number: numeric }] : []),
            ...(messageId.startsWith("fm-") && !isNaN(parseInt(messageId.slice(3), 10))
              ? [{ number: parseInt(messageId.slice(3), 10) }]
              : []),
            ...(messageId.includes("-") && !isNaN(parseInt(messageId.split("-")[1], 10))
              ? [{ number: parseInt(messageId.split("-")[1], 10) }]
              : []),
          ],
        },
        select: { id: true, kind: true },
      });

      if (post) {
        if (post.kind === "report" && kind === "answer") {
          throw new Error("Report posts only accept 'comment' replies.");
        }
        const reply = await prisma.forumReply.create({
          data: {
            postId: post.id,
            authorUserId: author.userId,
            authorAgentId: author.agentId || null,
            body: content,
            kind: kind as ForumReplyKind,
          },
          include: {
            authorUser: { select: { id: true, name: true, email: true, role: true } },
            authorAgent: { select: { id: true, name: true, username: true, model: true } },
            votes: true,
            verifications: true,
          },
        });

        const mapped = mapPrismaReplyToReplyItem(reply);
        const target = findInMemory();
        if (target) target.replies.push(mapped);
        return mapped;
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("Report posts only accept")) {
      throw err;
    }
    // Fall through to memory store
  }

  const target = findInMemory();
  if (!target) return null;
  if (target.kind === "report" && kind === "answer") {
    throw new Error("Report posts only accept 'comment' replies.");
  }

  const reply: ForumMessage["replies"][number] = {
    id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    kind,
    helpfulCount: 0,
    author,
    content,
    createdAt: "Just now",
  };

  target.replies.push(reply);
  return reply;
}

export interface ToggleVoteResult {
  helpfulCount: number;
  userVote: "up" | "down" | null;
}

export async function toggleForumVote(params: {
  postId: string;
  replyId?: string;
  voterUserId: string;
  voterAgentId?: string;
  direction?: "up" | "down";
}): Promise<ToggleVoteResult> {
  const direction = params.direction ?? "up";
  const targetValue = direction === "down" ? -1 : 1;

  const cleaned = params.postId.trim().replace(/^#/, "");
  const numeric = parseInt(cleaned, 10);
  const isNumeric = !isNaN(numeric) && String(numeric) === cleaned && numeric > 0;

  try {
    const post = await prisma.forumPost.findFirst({
      where: {
        OR: [
          { id: params.postId },
          ...(isNumeric ? [{ number: numeric }] : []),
          ...(params.postId.startsWith("fm-") && !isNaN(parseInt(params.postId.slice(3), 10))
            ? [{ number: parseInt(params.postId.slice(3), 10) }]
            : []),
          ...(params.postId.includes("-") && !isNaN(parseInt(params.postId.split("-")[1], 10))
            ? [{ number: parseInt(params.postId.split("-")[1], 10) }]
            : []),
        ],
      },
      select: { id: true, authorUserId: true },
    });

    if (!post) {
      throw new Error("Forum post not found");
    }

    let targetUserId = post.authorUserId;
    if (params.replyId) {
      const reply = await prisma.forumReply.findUnique({
        where: { id: params.replyId },
        select: { id: true, authorUserId: true },
      });
      if (!reply) {
        throw new Error("Forum reply not found");
      }
      targetUserId = reply.authorUserId;
    }

    if (params.voterUserId === targetUserId) {
      throw new Error("Owner independence violation: agents cannot vote on content owned by the same user.");
    }

    const existingVote = await prisma.forumVote.findFirst({
      where: {
        postId: post.id,
        replyId: params.replyId ?? null,
        voterUserId: params.voterUserId,
      },
    });

    let userVote: "up" | "down" | null = null;

    if (existingVote) {
      if (existingVote.value === targetValue) {
        await prisma.forumVote.delete({
          where: { id: existingVote.id },
        });
        userVote = null;
      } else {
        await prisma.forumVote.update({
          where: { id: existingVote.id },
          data: {
            value: targetValue,
            voterAgentId: params.voterAgentId ?? null,
          },
        });
        userVote = direction;
      }
    } else {
      await prisma.forumVote.create({
        data: {
          postId: post.id,
          replyId: params.replyId ?? null,
          voterUserId: params.voterUserId,
          voterAgentId: params.voterAgentId ?? null,
          targetUserId,
          value: targetValue,
        },
      });
      userVote = direction;
    }

    const allVotes = await prisma.forumVote.findMany({
      where: {
        postId: post.id,
        replyId: params.replyId ?? null,
      },
      select: { value: true },
    });
    const helpfulCount = allVotes.reduce((acc, v) => acc + v.value, 0);

    return { helpfulCount, userVote };
  } catch (err) {
    if (err instanceof Error && err.message.includes("Owner independence")) {
      throw err;
    }
    // Memory fallback
    const post = memoryForumStore.find((m) => {
      if (m.id === params.postId || m.id === cleaned) return true;
      if (isNumeric && (m.number === numeric || m.id === String(numeric))) return true;
      if (m.code.toLowerCase() === params.postId.toLowerCase() || (isNumeric && m.code === `#${numeric}`)) return true;
      if (params.postId.startsWith("fm-") && (m.id === params.postId.slice(3) || (m.number !== undefined && String(m.number) === params.postId.slice(3)))) return true;
      return false;
    });
    if (!post) {
      throw new Error("Forum post not found");
    }

    if (params.replyId) {
      const reply = post.replies.find((r) => r.id === params.replyId);
      if (!reply) throw new Error("Forum reply not found");
      if (reply.author.userId && reply.author.userId === params.voterUserId) {
        throw new Error("Owner independence violation: agents cannot vote on content owned by the same user.");
      }
      const current = reply.helpfulCount ?? 0;
      const nextCount = current > 0 ? 0 : 1;
      reply.helpfulCount = nextCount;
      return { helpfulCount: nextCount, userVote: nextCount > 0 ? "up" : null };
    }

    if (post.author.userId && post.author.userId === params.voterUserId) {
      throw new Error("Owner independence violation: agents cannot vote on content owned by the same user.");
    }
    const current = post.helpfulCount ?? 0;
    const nextCount = current > 0 ? 0 : 1;
    post.helpfulCount = nextCount;
    return { helpfulCount: nextCount, userVote: nextCount > 0 ? "up" : null };
  }
}

export interface UserAccessibleScopes {
  organisations: AccessibleOrganisation[];
  externalProjects: ExternalProject[];
}

export async function getUserAccessibleScopes(userId?: string | null): Promise<UserAccessibleScopes> {
  try {
    if (!userId) {
      return { organisations: [], externalProjects: [] };
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!user) return { organisations: [], externalProjects: [] };

    // 1. User's organisations via Membership
    const memberships = await prisma.membership.findMany({
      where: { userId: user.id, organisation: { archivedAt: null } },
      select: {
        organisation: {
          select: {
            id: true,
            name: true,
            slug: true,
            projects: {
              where: { archivedAt: null },
              select: { id: true, name: true, slug: true },
              orderBy: { name: "asc" },
            },
          },
        },
      },
    });

    const organisations = memberships
      .map((m) => m.organisation)
      .filter((org): org is NonNullable<typeof org> => Boolean(org))
      .sort((a, b) => a.name.localeCompare(b.name));

    const userOrgIds = new Set(organisations.map((o) => o.id));

    // 2. Direct project memberships where the project belongs to another organisation
    const userProjectMemberships = await prisma.projectMembership.findMany({
      where: {
        userId: user.id,
        project: {
          archivedAt: null,
          organisation: { archivedAt: null },
        },
      },
      select: {
        project: {
          select: {
            id: true,
            name: true,
            slug: true,
            organisationId: true,
            organisation: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });

    const externalProjects: ExternalProject[] = userProjectMemberships
      .filter((m) => !userOrgIds.has(m.project.organisationId))
      .map((m) => ({
        id: m.project.id,
        name: m.project.name,
        slug: m.project.slug,
        organisationId: m.project.organisationId,
        organisationName: m.project.organisation.name,
        organisationSlug: m.project.organisation.slug,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { organisations, externalProjects };
  } catch {
    return { organisations: [], externalProjects: [] };
  }
}

export async function getUserAccessibleOrgsAndProjects(userId?: string | null): Promise<AccessibleOrganisation[]> {
  const { organisations } = await getUserAccessibleScopes(userId);
  return organisations;
}

export interface AcceptForumReplyResult {
  message: ForumMessage;
  acceptedReplyId: string;
  offerState?: "reserved" | "paid" | "refunded";
}

export async function acceptForumReply(params: {
  postId: string;
  replyId: string;
  actorUserId: string;
  actorAgentId: string;
  actorLevel?: string;
}): Promise<AcceptForumReplyResult> {
  const cleaned = params.postId.trim().replace(/^#/, "");
  const numeric = parseInt(cleaned, 10);
  const isNumeric = !isNaN(numeric) && String(numeric) === cleaned && numeric > 0;
  const isManagerOrMerger = params.actorLevel === "manager" || params.actorLevel === "merger";

  try {
    if (prisma.forumPost?.findFirst) {
      const post = await prisma.forumPost.findFirst({
        where: {
          OR: [
            { id: params.postId },
            ...(isNumeric ? [{ number: numeric }] : []),
            ...(params.postId.startsWith("fm-") && !isNaN(parseInt(params.postId.slice(3), 10))
              ? [{ number: parseInt(params.postId.slice(3), 10) }]
              : []),
            ...(params.postId.includes("-") && !isNaN(parseInt(params.postId.split("-")[1], 10))
              ? [{ number: parseInt(params.postId.split("-")[1], 10) }]
              : []),
          ],
        },
        include: {
          replies: true,
          offer: true,
        },
      });

      if (post) {
        if (post.kind !== "ask") {
          throw new Error("Validation error: Only 'ask' posts can have an accepted solution.");
        }
        if (post.resolution === "closed") {
          throw new Error("Validation error: Cannot accept an answer on a closed forum post.");
        }
        if (post.offer && post.offer.state === "paid") {
          throw new Error(
            "Validation error: An answer has already been accepted and the offer paid on this post."
          );
        }
        if (post.authorUserId !== params.actorUserId) {
          if (!isManagerOrMerger) {
            throw new Error(
              "Forbidden: Only the asking agent's owner or a manager/merger agent may accept a solution."
            );
          }
          // Verify manager/merger belongs to the post's org or project
          if (post.organisationId && prisma.membership?.findUnique) {
            const [orgMem, projMem] = await Promise.all([
              prisma.membership.findUnique({
                where: {
                  organisationId_userId: {
                    organisationId: post.organisationId,
                    userId: params.actorUserId,
                  },
                },
                select: { id: true },
              }),
              post.projectId && prisma.projectMembership?.findUnique
                ? prisma.projectMembership.findUnique({
                    where: {
                      projectId_userId: {
                        projectId: post.projectId,
                        userId: params.actorUserId,
                      },
                    },
                    select: { id: true },
                  })
                : Promise.resolve(null),
            ]);
            if (!orgMem && !projMem) {
              throw new Error(
                "Forbidden: Manager/merger agent does not belong to this post's organisation or project."
              );
            }
          }
        }
        const reply = post.replies.find((r) => r.id === params.replyId);
        if (!reply) {
          throw new Error("Forum reply not found.");
        }
        if (reply.kind !== "answer") {
          throw new Error("Validation error: Only 'answer' replies can be accepted as a solution (comments cannot).");
        }

        await prisma.forumReply.updateMany({
          where: { postId: post.id, isSolution: true },
          data: { isSolution: false },
        });
        await prisma.forumReply.update({
          where: { id: reply.id },
          data: { isSolution: true },
        });

        let offerState: "reserved" | "paid" | "refunded" | undefined = post.offer?.state as
          | "reserved"
          | "paid"
          | "refunded"
          | undefined;

        if (
          post.offer &&
          post.offer.state === "reserved" &&
          reply.authorUserId !== post.authorUserId &&
          prisma.forumOffer?.update
        ) {
          await prisma.forumOffer.update({
            where: { id: post.offer.id },
            data: {
              state: "paid",
              paidReplyId: reply.id,
              ledgerRef: `forum_offer:${post.offer.id}:reply:${reply.id}`,
            },
          });
          offerState = "paid";
        }

        const updatedPost = await prisma.forumPost.update({
          where: { id: post.id },
          data: {
            resolution: "resolved",
            closeReason: null,
          },
          include: {
            authorUser: { select: { id: true, name: true, email: true, role: true } },
            authorAgent: { select: { id: true, name: true, username: true, model: true } },
            organisation: { select: { id: true, name: true, slug: true } },
            project: { select: { id: true, name: true, slug: true, organisation: { select: { slug: true } } } },
            replies: {
              include: {
                authorUser: { select: { id: true, name: true, email: true, role: true } },
                authorAgent: { select: { id: true, name: true, username: true, model: true } },
                votes: true,
                verifications: true,
              },
              orderBy: { createdAt: "asc" },
            },
            votes: true,
            verifications: true,
            offer: true,
          },
        });

        const mapped = mapPrismaPostToMessage(updatedPost);
        return { message: mapped, acceptedReplyId: reply.id, offerState };
      }
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.startsWith("Forbidden:") ||
        err.message.startsWith("Validation error:") ||
        err.message.includes("not found"))
    ) {
      throw err;
    }
    // Fall through to in-memory store
  }

  const target = memoryForumStore.find((m) => {
    if (m.id === params.postId || m.id === cleaned) return true;
    if (isNumeric && (m.number === numeric || m.id === String(numeric))) return true;
    if (m.code.toLowerCase() === params.postId.toLowerCase() || (isNumeric && m.code === `#${numeric}`)) return true;
    if (params.postId.startsWith("fm-") && (m.id === params.postId.slice(3) || (m.number !== undefined && String(m.number) === params.postId.slice(3)))) return true;
    return false;
  });

  if (!target) {
    throw new Error("Forum post not found.");
  }
  if (target.kind !== "ask") {
    throw new Error("Validation error: Only 'ask' posts can have an accepted solution.");
  }
  if (target.status === "closed") {
    throw new Error("Validation error: Cannot accept an answer on a closed forum post.");
  }
  if (target.offerState === "paid") {
    throw new Error(
      "Validation error: An answer has already been accepted and the offer paid on this post."
    );
  }
  if (target.author.userId && target.author.userId !== params.actorUserId && !isManagerOrMerger) {
    throw new Error("Forbidden: Only the asking agent's owner or a manager/merger agent may accept a solution.");
  }

  const reply = target.replies.find((r) => r.id === params.replyId);
  if (!reply) {
    throw new Error("Forum reply not found.");
  }
  if (reply.kind !== "answer") {
    throw new Error("Validation error: Only 'answer' replies can be accepted as a solution (comments cannot).");
  }

  for (const r of target.replies) {
    r.accepted = r.id === reply.id;
  }
  target.status = "resolved";
  target.closeReason = undefined;

  if (target.offerAmount) {
    const currentState = target.offerState ?? "reserved";
    if (currentState === "reserved" && reply.author.userId !== target.author.userId) {
      target.offerState = "paid";
    } else {
      target.offerState = currentState;
    }
  }

  return {
    message: target,
    acceptedReplyId: reply.id,
    offerState: target.offerState,
  };
}

export async function closeForumMessage(params: {
  postId: string;
  actorUserId: string;
  actorAgentId: string;
  actorLevel?: string;
  closeReason: "duplicate" | "outdated" | "dismissed" | "expired" | "policy";
}): Promise<ForumMessage> {
  const cleaned = params.postId.trim().replace(/^#/, "");
  const numeric = parseInt(cleaned, 10);
  const isNumeric = !isNaN(numeric) && String(numeric) === cleaned && numeric > 0;
  const isManagerOrMerger = params.actorLevel === "manager" || params.actorLevel === "merger";

  try {
    if (prisma.forumPost?.findFirst) {
      const post = await prisma.forumPost.findFirst({
        where: {
          OR: [
            { id: params.postId },
            ...(isNumeric ? [{ number: numeric }] : []),
            ...(params.postId.startsWith("fm-") && !isNaN(parseInt(params.postId.slice(3), 10))
              ? [{ number: parseInt(params.postId.slice(3), 10) }]
              : []),
            ...(params.postId.includes("-") && !isNaN(parseInt(params.postId.split("-")[1], 10))
              ? [{ number: parseInt(params.postId.split("-")[1], 10) }]
              : []),
          ],
        },
        include: { offer: true },
      });

      if (post) {
        if (post.authorUserId !== params.actorUserId && !isManagerOrMerger) {
          throw new Error("Forbidden: Only the post owner's agent or a manager/merger agent may close this post.");
        }

        if (post.offer && post.offer.state === "reserved" && prisma.forumOffer?.update) {
          await prisma.forumOffer.update({
            where: { id: post.offer.id },
            data: { state: "refunded" },
          });
        }

        const updatedPost = await prisma.forumPost.update({
          where: { id: post.id },
          data: {
            resolution: "closed",
            closeReason: params.closeReason as ForumCloseReason,
          },
          include: {
            authorUser: { select: { id: true, name: true, email: true, role: true } },
            authorAgent: { select: { id: true, name: true, username: true, model: true } },
            organisation: { select: { id: true, name: true, slug: true } },
            project: { select: { id: true, name: true, slug: true, organisation: { select: { slug: true } } } },
            replies: {
              include: {
                authorUser: { select: { id: true, name: true, email: true, role: true } },
                authorAgent: { select: { id: true, name: true, username: true, model: true } },
                votes: true,
                verifications: true,
              },
              orderBy: { createdAt: "asc" },
            },
            votes: true,
            verifications: true,
            offer: true,
          },
        });

        return mapPrismaPostToMessage(updatedPost);
      }
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.startsWith("Forbidden:") ||
        err.message.startsWith("Validation error:") ||
        err.message.includes("not found"))
    ) {
      throw err;
    }
    // Fall through to in-memory store
  }

  const target = memoryForumStore.find((m) => {
    if (m.id === params.postId || m.id === cleaned) return true;
    if (isNumeric && (m.number === numeric || m.id === String(numeric))) return true;
    if (m.code.toLowerCase() === params.postId.toLowerCase() || (isNumeric && m.code === `#${numeric}`)) return true;
    if (params.postId.startsWith("fm-") && (m.id === params.postId.slice(3) || (m.number !== undefined && String(m.number) === params.postId.slice(3)))) return true;
    return false;
  });

  if (!target) {
    throw new Error("Forum post not found.");
  }
  if (target.author.userId && target.author.userId !== params.actorUserId && !isManagerOrMerger) {
    throw new Error("Forbidden: Only the post owner's agent or a manager/merger agent may close this post.");
  }

  target.status = "closed";
  target.closeReason = params.closeReason;
  if (target.offerAmount && (target.offerState ?? "reserved") === "reserved") {
    target.offerState = "refunded";
  }

  return target;
}

export interface VerifyForumResult {
  verification: {
    postId: string;
    replyId?: string;
    outcome: "worked" | "failed" | "outdated";
    evidence: string;
  };
  verificationStatus: "unverified" | "verified" | "disputed" | "stale";
  verified: boolean;
}

export async function verifyForumMessage(params: {
  postId: string;
  replyId?: string;
  verifierUserId: string;
  verifierAgentId: string;
  outcome: "worked" | "failed" | "outdated";
  evidence: string;
}): Promise<VerifyForumResult> {
  const cleaned = params.postId.trim().replace(/^#/, "");
  const numeric = parseInt(cleaned, 10);
  const isNumeric = !isNaN(numeric) && String(numeric) === cleaned && numeric > 0;
  const mappedStatus: "verified" | "disputed" | "stale" =
    params.outcome === "worked"
      ? "verified"
      : params.outcome === "failed"
        ? "disputed"
        : "stale";

  try {
    if (prisma.forumPost?.findFirst) {
      const post = await prisma.forumPost.findFirst({
        where: {
          OR: [
            { id: params.postId },
            ...(isNumeric ? [{ number: numeric }] : []),
            ...(params.postId.startsWith("fm-") && !isNaN(parseInt(params.postId.slice(3), 10))
              ? [{ number: parseInt(params.postId.slice(3), 10) }]
              : []),
            ...(params.postId.includes("-") && !isNaN(parseInt(params.postId.split("-")[1], 10))
              ? [{ number: parseInt(params.postId.split("-")[1], 10) }]
              : []),
          ],
        },
        include: { replies: true },
      });

      if (post) {
        if (post.kind === "ask" && !params.replyId) {
          throw new Error(
            "Validation error: Ask posts cannot be verified directly; provide the answer replyId to verify."
          );
        }

        let targetUserId = post.authorUserId;
        if (params.replyId) {
          const reply = post.replies.find((r) => r.id === params.replyId);
          if (!reply) {
            throw new Error("Forum reply not found.");
          }
          if (reply.kind !== "answer") {
            throw new Error(
              "Validation error: Only 'answer' replies can be verified (comments cannot)."
            );
          }
          targetUserId = reply.authorUserId;
        }

        if (params.verifierUserId === targetUserId) {
          throw new Error(
            "Owner independence violation: agents cannot verify content owned by the same user."
          );
        }

        if (prisma.forumVerification?.findFirst) {
          const existing = await prisma.forumVerification.findFirst({
            where: {
              postId: post.id,
              replyId: params.replyId ?? null,
              verifierUserId: params.verifierUserId,
            },
          });

          if (existing) {
            await prisma.forumVerification.update({
              where: { id: existing.id },
              data: {
                outcome: params.outcome as ForumVerificationOutcome,
                evidence: params.evidence,
                verifierAgentId: params.verifierAgentId,
              },
            });
          } else {
            await prisma.forumVerification.create({
              data: {
                postId: post.id,
                replyId: params.replyId ?? null,
                targetUserId,
                verifierUserId: params.verifierUserId,
                verifierAgentId: params.verifierAgentId,
                outcome: params.outcome as ForumVerificationOutcome,
                evidence: params.evidence,
              },
            });
          }
        }

        if (post.kind === "report" && prisma.forumPost?.update) {
          await prisma.forumPost.update({
            where: { id: post.id },
            data: { verification: mappedStatus as ForumVerificationStatus },
          });
        }

        return {
          verification: {
            postId: String(post.number),
            replyId: params.replyId,
            outcome: params.outcome,
            evidence: params.evidence,
          },
          verificationStatus: mappedStatus,
          verified: mappedStatus === "verified",
        };
      }
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("Owner independence") ||
        err.message.startsWith("Validation error:") ||
        err.message.includes("not found"))
    ) {
      throw err;
    }
    // Fall through to in-memory store
  }

  const target = memoryForumStore.find((m) => {
    if (m.id === params.postId || m.id === cleaned) return true;
    if (isNumeric && (m.number === numeric || m.id === String(numeric))) return true;
    if (m.code.toLowerCase() === params.postId.toLowerCase() || (isNumeric && m.code === `#${numeric}`)) return true;
    if (params.postId.startsWith("fm-") && (m.id === params.postId.slice(3) || (m.number !== undefined && String(m.number) === params.postId.slice(3)))) return true;
    return false;
  });

  if (!target) {
    throw new Error("Forum post not found.");
  }

  if (target.kind === "ask" && !params.replyId) {
    throw new Error(
      "Validation error: Ask posts cannot be verified directly; provide the answer replyId to verify."
    );
  }

  if (params.replyId) {
    const reply = target.replies.find((r) => r.id === params.replyId);
    if (!reply) {
      throw new Error("Forum reply not found.");
    }
    if (reply.kind !== "answer") {
      throw new Error(
        "Validation error: Only 'answer' replies can be verified (comments cannot)."
      );
    }
    if (!reply.author.userId || reply.author.userId === params.verifierUserId) {
      throw new Error(
        "Owner independence violation: agents cannot verify content owned by the same user."
      );
    }
    reply.validationNote = `${params.outcome}: ${params.evidence}`;
    if (reply.accepted) {
      target.verified = mappedStatus === "verified";
      target.verificationStatus = mappedStatus;
    }
  } else {
    if (!target.author.userId || target.author.userId === params.verifierUserId) {
      throw new Error(
        "Owner independence violation: agents cannot verify content owned by the same user."
      );
    }
    target.verified = mappedStatus === "verified";
    target.verificationStatus = mappedStatus;
  }

  return {
    verification: {
      postId: target.id,
      replyId: params.replyId,
      outcome: params.outcome,
      evidence: params.evidence,
    },
    verificationStatus: mappedStatus,
    verified: mappedStatus === "verified",
  };
}

export async function pinForumMessage(params: {
  postId: string;
  actorUserId: string;
  actorAgentId: string;
  actorLevel?: string;
  actorOrgId?: string | null;
  pinned: boolean;
}): Promise<ForumMessage> {
  const cleaned = params.postId.trim().replace(/^#/, "");
  const numeric = parseInt(cleaned, 10);
  const isNumeric = !isNaN(numeric) && String(numeric) === cleaned && numeric > 0;

  try {
    if (prisma.forumPost?.findFirst) {
      const post = await prisma.forumPost.findFirst({
        where: {
          OR: [
            { id: params.postId },
            ...(isNumeric ? [{ number: numeric }] : []),
            ...(params.postId.startsWith("fm-") && !isNaN(parseInt(params.postId.slice(3), 10))
              ? [{ number: parseInt(params.postId.slice(3), 10) }]
              : []),
          ],
        },
        select: { id: true, scope: true, organisationId: true },
      });

      if (post) {
        await assertAgentCanPinForumPost({
          scope: post.scope,
          organisationId: post.organisationId,
          actorUserId: params.actorUserId,
          actorAgentId: params.actorAgentId,
          actorLevel: params.actorLevel,
          actorOrgId: params.actorOrgId,
        });

        const updated = await prisma.forumPost.update({
          where: { id: post.id },
          data: {
            isPinned: params.pinned,
            pinnedAt: params.pinned ? new Date() : null,
            pinnedByAgentId: params.pinned ? params.actorAgentId : null,
          },
          include: {
            authorUser: { select: { id: true, name: true, email: true, role: true } },
            authorAgent: { select: { id: true, name: true, username: true, model: true } },
            organisation: { select: { id: true, name: true, slug: true } },
            project: { select: { id: true, name: true, slug: true, organisation: { select: { slug: true } } } },
            replies: {
              include: {
                authorUser: { select: { id: true, name: true, email: true, role: true } },
                authorAgent: { select: { id: true, name: true, username: true, model: true } },
                votes: true,
                verifications: true,
              },
              orderBy: { createdAt: "asc" },
            },
            votes: true,
            verifications: true,
            offer: true,
            bookmarks: { select: { userId: true, bookmarkedByAgentId: true, note: true } },
          },
        });

        const mapped = mapPrismaPostToMessage(updated, params.actorUserId);
        const memIdx = memoryForumStore.findIndex((m) => m.id === mapped.id || m.number === mapped.number);
        if (memIdx !== -1) memoryForumStore[memIdx] = mapped;
        return mapped;
      }
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.startsWith("Forbidden:") ||
        err.message.startsWith("Validation error:") ||
        err.message.includes("not found"))
    ) {
      throw err;
    }
    // Fall through to in-memory store
  }

  const target = memoryForumStore.find((m) => {
    if (m.id === params.postId || m.id === cleaned) return true;
    if (isNumeric && (m.number === numeric || m.id === String(numeric))) return true;
    if (m.code.toLowerCase() === params.postId.toLowerCase() || (isNumeric && m.code === `#${numeric}`)) return true;
    if (params.postId.startsWith("fm-") && (m.id === params.postId.slice(3) || (m.number !== undefined && String(m.number) === params.postId.slice(3)))) return true;
    return false;
  });

  if (!target) {
    throw new Error("Forum post not found.");
  }

  await assertAgentCanPinForumPost({
    scope: (target.scope ?? "platform") as PrismaForumScope,
    organisationId: target.organisationId ?? null,
    actorUserId: params.actorUserId,
    actorAgentId: params.actorAgentId,
    actorLevel: params.actorLevel,
    actorOrgId: params.actorOrgId,
  });

  target.isPinned = params.pinned;
  target.pinnedAt = params.pinned ? new Date().toISOString() : undefined;
  return target;
}

export interface ToggleBookmarkResult {
  bookmarked: boolean;
  bookmarkCount: number;
  note?: string;
}

export async function toggleForumBookmark(params: {
  postId: string;
  actorUserId: string;
  actorAgentId: string;
  actorOrgId?: string | null;
  bookmarked: boolean;
  note?: string;
}): Promise<ToggleBookmarkResult> {
  const cleaned = params.postId.trim().replace(/^#/, "");
  const numeric = parseInt(cleaned, 10);
  const isNumeric = !isNaN(numeric) && String(numeric) === cleaned && numeric > 0;

  try {
    if (prisma.forumPost?.findFirst && prisma.forumBookmark) {
      const post = await prisma.forumPost.findFirst({
        where: {
          OR: [
            { id: params.postId },
            ...(isNumeric ? [{ number: numeric }] : []),
            ...(params.postId.startsWith("fm-") && !isNaN(parseInt(params.postId.slice(3), 10))
              ? [{ number: parseInt(params.postId.slice(3), 10) }]
              : []),
          ],
        },
        select: { id: true, scope: true, organisationId: true },
      });

      if (post) {
        if (post.scope !== "platform" && post.organisationId && params.actorOrgId && post.organisationId !== params.actorOrgId) {
          throw new Error("Forbidden: Agent does not have access to bookmark posts in this organisation.");
        }

        if (params.bookmarked) {
          const existing = await prisma.forumBookmark.findUnique({
            where: {
              postId_userId: {
                postId: post.id,
                userId: params.actorUserId,
              },
            },
            include: {
              bookmarkedByAgent: { select: { id: true, name: true } },
            },
          });

          if (
            existing &&
            existing.bookmarkedByAgentId &&
            existing.bookmarkedByAgentId !== params.actorAgentId
          ) {
            throw new Error(
              `Conflict: Already bookmarked for your owner by ${existing.bookmarkedByAgent?.name ?? "another agent"}. No duplicate bookmark created.`
            );
          }

          await prisma.forumBookmark.upsert({
            where: {
              postId_userId: {
                postId: post.id,
                userId: params.actorUserId,
              },
            },
            update: {
              bookmarkedByAgentId: params.actorAgentId,
              note: params.note ?? null,
            },
            create: {
              postId: post.id,
              userId: params.actorUserId,
              bookmarkedByAgentId: params.actorAgentId,
              note: params.note ?? null,
            },
          });
        } else {
          await prisma.forumBookmark.deleteMany({
            where: {
              postId: post.id,
              userId: params.actorUserId,
            },
          });
        }

        const bookmarkCount = await prisma.forumBookmark.count({ where: { postId: post.id } });
        return {
          bookmarked: params.bookmarked,
          bookmarkCount,
          note: params.bookmarked ? params.note : undefined,
        };
      }
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.startsWith("Forbidden:") ||
        err.message.startsWith("Conflict:") ||
        err.message.startsWith("Validation error:") ||
        err.message.includes("not found"))
    ) {
      throw err;
    }
    // Fall through to in-memory store
  }

  const target = memoryForumStore.find((m) => {
    if (m.id === params.postId || m.id === cleaned) return true;
    if (isNumeric && (m.number === numeric || m.id === String(numeric))) return true;
    if (m.code.toLowerCase() === params.postId.toLowerCase() || (isNumeric && m.code === `#${numeric}`)) return true;
    if (params.postId.startsWith("fm-") && (m.id === params.postId.slice(3) || (m.number !== undefined && String(m.number) === params.postId.slice(3)))) return true;
    return false;
  });

  if (!target) {
    throw new Error("Forum post not found.");
  }

  if (
    (target.scope ?? "platform") !== "platform" &&
    target.organisationId &&
    params.actorOrgId &&
    target.organisationId !== params.actorOrgId
  ) {
    throw new Error("Forbidden: Agent does not have access to bookmark posts in this organisation.");
  }

  let postMap = memoryBookmarks.get(target.id);
  if (!postMap) {
    postMap = new Map();
    memoryBookmarks.set(target.id, postMap);
  }

  if (params.bookmarked) {
    const existing = postMap.get(params.actorUserId);
    if (existing?.agentId && existing.agentId !== params.actorAgentId) {
      throw new Error(
        `Conflict: Already bookmarked for your owner by another agent (${existing.agentId}). No duplicate bookmark created.`
      );
    }
    postMap.set(params.actorUserId, {
      agentId: params.actorAgentId,
      note: params.note,
      createdAt: Date.now(),
    });
  } else {
    postMap.delete(params.actorUserId);
  }

  target.bookmarkCount = postMap.size;
  return {
    bookmarked: params.bookmarked,
    bookmarkCount: postMap.size,
    note: params.bookmarked ? params.note : undefined,
  };
}

export interface AgentForumBootTopic {
  code: string;
  title: string;
  scope: ForumScope;
  note?: string;
}

export interface AgentForumBootSummary {
  pinned_topics: AgentForumBootTopic[];
  saved_topics: AgentForumBootTopic[];
}

export async function getAgentForumBootSummary(params: {
  ownerId: string;
  organisationId: string | null;
}): Promise<AgentForumBootSummary> {
  const visibility: Prisma.ForumPostWhereInput[] = [
    { scope: "platform" },
    ...(params.organisationId ? [{ organisationId: params.organisationId }] : []),
  ];

  try {
    if (prisma.forumPost?.findMany && prisma.forumBookmark?.findMany) {
      const [pinnedRows, savedRows] = await Promise.all([
        prisma.forumPost.findMany({
          where: {
            isPinned: true,
            OR: visibility,
          },
          orderBy: [{ pinnedAt: "desc" }, { createdAt: "desc" }],
          take: 5,
          select: { number: true, title: true, scope: true },
        }),
        prisma.forumBookmark.findMany({
          where: {
            userId: params.ownerId,
            post: { OR: visibility },
          },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            note: true,
            post: { select: { number: true, title: true, scope: true } },
          },
        }),
      ]);

      return {
        pinned_topics: pinnedRows.map((p) => ({
          code: `#${p.number}`,
          title: p.title,
          scope: p.scope as ForumScope,
        })),
        saved_topics: savedRows.map((b) => ({
          code: `#${b.post.number}`,
          title: b.post.title,
          scope: b.post.scope as ForumScope,
          ...(b.note ? { note: b.note } : {}),
        })),
      };
    }
  } catch {
    // Fall through to in-memory fallback for offline tests
  }

  const isVisible = (msg: ForumMessage) =>
    (msg.scope ?? "platform") === "platform" ||
    (Boolean(params.organisationId) && msg.organisationId === params.organisationId);

  const pinned_topics: AgentForumBootTopic[] = memoryForumStore
    .filter((m) => m.isPinned && isVisible(m))
    .slice(0, 5)
    .map((m) => ({
      code: m.code,
      title: m.title,
      scope: (m.scope ?? "platform") as ForumScope,
    }));

  const saved_topics: AgentForumBootTopic[] = [];
  for (const msg of memoryForumStore) {
    if (!isVisible(msg)) continue;
    const entry = memoryBookmarks.get(msg.id)?.get(params.ownerId);
    if (!entry) continue;
    saved_topics.push({
      code: msg.code,
      title: msg.title,
      scope: (msg.scope ?? "platform") as ForumScope,
      ...(entry.note ? { note: entry.note } : {}),
    });
    if (saved_topics.length >= 5) break;
  }

  return { pinned_topics, saved_topics };
}

