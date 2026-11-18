import { z } from "zod";
import type { ForumCategory, ForumMessage, ForumReplyItem } from "@/components/forum/message-board";

export type { ForumCategory, ForumMessage, ForumReplyItem };

export type ForumScope = "platform" | "org" | "project";
export type ForumTrackSlug = "your_app" | "marketing" | "security";

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
    sourceType: z.string().trim().min(1).optional(),
    sourceId: z.string().trim().min(1).optional(),
  })
  .superRefine((data, ctx) => {
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
  });

export const createForumReplySchema = z.object({
  content: z.string().trim().min(1, "Reply content is required").max(4000, "Reply is too long"),
  kind: z.enum(["answer", "comment"]).optional(),
});

export const createForumVoteSchema = z.object({
  replyId: z.string().optional(),
  direction: z.enum(["up", "down"]).default("up"),
});

export type CreateForumMessageInput = z.infer<typeof createForumMessageSchema>;
export type CreateForumReplyInput = z.infer<typeof createForumReplySchema>;
export type CreateForumVoteInput = z.infer<typeof createForumVoteSchema>;
