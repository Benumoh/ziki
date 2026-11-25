import { z } from "zod";
import type { ForumCategory, ForumMessage, ForumReplyItem } from "@/components/forum/message-board";

export type { ForumCategory, ForumMessage, ForumReplyItem };

export type ForumScope = "platform" | "org" | "project";
export type ForumTrackSlug = "your_app" | "marketing" | "security";

export const FORUM_SOURCE_TYPES = [
  "issue",
  "idea",
  "marketing_task",
  "marketing_idea",
  "security_finding",
  "security_check",
] as const;

export type ForumSourceType = (typeof FORUM_SOURCE_TYPES)[number];

export const TRACK_SOURCE_TYPES: Record<"your_app" | "marketing" | "security", readonly ForumSourceType[]> = {
  your_app: ["issue", "idea"],
  marketing: ["marketing_task", "marketing_idea"],
  security: ["security_finding", "security_check"],
};

export interface AccessibleOrganisation {
  id: string;
  name: string;
  slug: string;
  projects: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
}

export interface ExternalProject {
  id: string;
  name: string;
  slug: string;
  organisationId: string;
  organisationName: string;
  organisationSlug: string;
}

export const createForumMessageSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
    content: z.string().trim().min(1, "Content is required").max(8000, "Content exceeds 8000 characters"),
    category: z.enum(["help_needed", "review_request", "vote_call", "announcement"]).default("help_needed"),
    kind: z.enum(["ask", "report"]).optional(),
    track: z.enum(["product", "your_app", "marketing", "security"], {
      message: "Track is required ('product', 'your_app', 'marketing', or 'security')",
    }),
    tags: z.array(z.string().trim().min(1)).max(5).optional(),
    issueNumber: z.number().int().positive().optional(),
    offerAmount: z.string().trim().optional(),
    scope: z.enum(["platform", "org", "project"], {
      message: "Scope is required ('platform', 'org', or 'project')",
    }),
    organisationId: z.string().trim().min(1).optional(),
    projectId: z.string().trim().min(1).optional(),
    sourceType: z.enum(FORUM_SOURCE_TYPES).optional(),
    sourceId: z.string().trim().min(1).optional(),
    isPinned: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (Boolean(data.sourceType) !== Boolean(data.sourceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [data.sourceType ? "sourceId" : "sourceType"],
        message: "sourceType and sourceId must be provided together.",
      });
    }

    const normalizedTrack: "your_app" | "marketing" | "security" =
      data.track === "marketing" ? "marketing" : data.track === "security" ? "security" : "your_app";

    if (data.sourceType) {
      const allowedSources = TRACK_SOURCE_TYPES[normalizedTrack];
      if (!allowedSources.includes(data.sourceType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceType"],
          message: `sourceType '${data.sourceType}' is not allowed for track '${data.track}'. Allowed: ${allowedSources.join(", ")}.`,
        });
      }
    }

    if (data.issueNumber) {
      if (normalizedTrack === "security") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["issueNumber"],
          message: "issueNumber is not supported on the security track; use sourceType and sourceId.",
        });
      }
      if (data.sourceId && String(data.issueNumber) !== data.sourceId.replace(/^#/, "")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["issueNumber"],
          message: "Conflicting task references: issueNumber must match sourceId when both are provided.",
        });
      }
    }

    if (data.scope === "platform") {
      if (data.organisationId || data.projectId || data.issueNumber || data.sourceType || data.sourceId || data.offerAmount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scope"],
          message:
            "Platform-scope posts must not include organisationId, projectId, issueNumber, sourceType, sourceId, or offerAmount.",
        });
      }
    } else if (data.scope === "org") {
      if (!data.organisationId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["organisationId"],
          message: "organisationId is required when scope is 'org'.",
        });
      }
      if (data.projectId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["projectId"],
          message: "projectId must not be set when scope is 'org'.",
        });
      }
    } else if (data.scope === "project") {
      if (!data.projectId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["projectId"],
          message: "projectId is required when scope is 'project'.",
        });
      }
    }

    if (data.offerAmount) {
      if (data.kind === "report") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["offerAmount"],
          message: "Offers (bounties) are only allowed on 'ask' posts, never on 'report' posts.",
        });
      }
      if (!data.issueNumber && !data.sourceId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["offerAmount"],
          message: "An offer (bounty) must be linked to a task via issueNumber or sourceId so its budget limit can be verified.",
        });
      }
    }
  });

export const createForumReplySchema = z.object({
  content: z.string().trim().min(1, "Reply content is required").max(4000, "Reply is too long"),
  kind: z.enum(["answer", "comment"]).optional(),
});

export const createForumVoteSchema = z.object({
  replyId: z.string().optional(),
  direction: z.enum(["up", "down"]).default("up"),
});

export const closeForumPostSchema = z.object({
  closeReason: z.enum(["duplicate", "outdated", "dismissed", "expired", "policy"], {
    message: "closeReason is required ('duplicate', 'outdated', 'dismissed', 'expired', or 'policy')",
  }),
});

export const verifyForumPostSchema = z.object({
  replyId: z.string().trim().min(1).optional(),
  outcome: z.enum(["worked", "failed", "outdated"], {
    message: "outcome is required ('worked', 'failed', or 'outdated')",
  }),
  evidence: z
    .string()
    .trim()
    .min(1, "Verification evidence is required")
    .max(4000, "Evidence exceeds 4000 characters"),
});

export const pinForumPostSchema = z.object({
  pinned: z.boolean().default(true),
});

export const bookmarkForumPostSchema = z.object({
  bookmarked: z.boolean().default(true),
  note: z.string().trim().max(240, "Bookmark note exceeds 240 characters").optional(),
});

export type CreateForumMessageInput = z.infer<typeof createForumMessageSchema>;
export type CreateForumReplyInput = z.infer<typeof createForumReplySchema>;
export type CreateForumVoteInput = z.infer<typeof createForumVoteSchema>;
export type CloseForumPostInput = z.infer<typeof closeForumPostSchema>;
export type VerifyForumPostInput = z.infer<typeof verifyForumPostSchema>;
export type PinForumPostInput = z.infer<typeof pinForumPostSchema>;
export type BookmarkForumPostInput = z.infer<typeof bookmarkForumPostSchema>;
