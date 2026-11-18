import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { publish } from "@/lib/agent-api/events";
import { findSimilarIssues } from "@/lib/agent-api/create-policy";
import { checkAttachment, MAX_ATTACHMENT_BYTES } from "@/lib/attachments";
import { stripGitHubMarkup } from "@/lib/github-paste";
import { prisma } from "@/lib/prisma";
import {
  clientRateLimitKey,
  consumeRateLimits,
  type HeadersLike,
  type RateLimitItem,
} from "@/lib/rate-limit";
import { reportSummarySchema } from "@/lib/validations/report-summary";
import {
  publicReporterEmail,
  publicTrackingTokenHash,
} from "@/lib/public-projects";
import {
  publicTrackingPath,
  type PublicProjectRef,
} from "@/lib/public-project-paths";

export const PUBLIC_IDEA_BODY_BYTES = 8 * 1024 * 1024;
export const PUBLIC_IDEA_CLIENT_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 };
export const PUBLIC_IDEA_PROJECT_LIMIT = { max: 100, windowMs: 60 * 60 * 1000 };
export const PUBLIC_SIMILAR_LIMIT = { max: 30, windowMs: 60 * 1000 };

const trackingTokenSchema = z
  .string()
  .min(32)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid tracking token.");

function cleanPublicText(value: string): string {
  return stripGitHubMarkup(value)
    .replace(/<[^>]*>/g, "")
    .replace(/\u0000/g, "")
    .trim();
}

const publicText = (label: string, max: number, minimum = 0) =>
  z
    .string()
    .transform(cleanPublicText)
    .refine((value) => value.length >= minimum, `${label} must be at least ${minimum} characters.`)
    .refine((value) => value.length <= max, `${label} must be ${max} characters or fewer.`);

const publicSummarySchema = z
  .string()
  .transform(cleanPublicText)
  .pipe(reportSummarySchema);

const publicTitleSchema = publicText("Title", 200, 3)
  .refine((value) => !/[\r\n]/.test(value), "Title must be one line.");

export const publicScreenshotSchema = z
  .object({
    filename: z.string().min(1).max(200),
    data: z.string().min(1),
  })
  .optional();

export function draftTitle(description: string): string {
  const clean = cleanPublicText(description).replace(/[#*`>|]/g, "").trim();
  const firstLine = clean.split(/[\r\n]+/)[0]?.trim() ?? "";
  const match = firstLine.match(/^(.+?[.!?])(\s|$)/);
  let title = match ? match[1] : firstLine;
  if (title.length > 100) {
    title = title.slice(0, 97) + "…";
  }
  return title.trim().slice(0, 200);
}

export function draftSummary(description: string): string {
  let clean = cleanPublicText(description).replace(/[#*`>|]/g, "").trim();
  clean = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3).join("\n");
  if (clean.length > 300) {
    clean = clean.slice(0, 297) + "…";
  }
  if (clean.length < 20) {
    clean = `Issue reported: ${clean}`;
    if (clean.length < 20) {
      clean = clean.padEnd(20, ".");
    }
  }
  return clean;
}

const basePublicIdeaSchema = z
  .object({
    title: publicTitleSchema,
    summary: publicSummarySchema,
    description: publicText("Description", 2400, 10),
    stepsToReproduce: publicText("Steps to reproduce", 1000).optional().default(""),
    expectedBehavior: publicText("Expected behaviour", 700).optional().default(""),
    actualBehavior: publicText("Actual behaviour", 700).optional().default(""),
    website: z.string().max(200).optional().default(""),
    acknowledgeSimilar: z.boolean().optional().default(false),
    trackingToken: trackingTokenSchema,
    screenshot: publicScreenshotSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (publicIdeaDescription(value).length > 5000) {
      ctx.addIssue({ code: "custom", path: ["description"], message: "The complete report must be 5,000 characters or fewer." });
    }
  });

export const publicIdeaSchema = z.preprocess((raw) => {
  if (typeof raw !== "object" || raw === null) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  const desc = typeof obj.description === "string" ? obj.description : "";
  if ((!obj.title || (typeof obj.title === "string" && !obj.title.trim())) && desc.trim()) {
    obj.title = draftTitle(desc);
  }
  if ((!obj.summary || (typeof obj.summary === "string" && !obj.summary.trim())) && desc.trim()) {
    obj.summary = draftSummary(desc);
  }
  return obj;
}, basePublicIdeaSchema) as unknown as typeof basePublicIdeaSchema;

export type PublicIdeaInput = z.infer<typeof publicIdeaSchema>;

export type PublicIdeaMatch = {
  kind: "issue" | "idea";
  number: number;
  title: string;
  status: string;
};

export type PublicIdeaResult =
  | { status: 200 | 201; ideaId: string; ideaNumber: number; trackingPath: string; replayed: boolean }
  | { status: 400; error: "invalid_request" | "bot_detected"; message: string; fieldErrors?: Record<string, string[]> }
  | { status: 404; error: "not_found"; message: string }
  | { status: 409; error: "similar_ideas" | "tracking_conflict"; message: string; matches?: PublicIdeaMatch[] }
  | { status: 413; error: "too_large"; message: string }
  | { status: 429; error: "rate_limited"; message: string; retryAfterSeconds: number };

type PublicIntakeDb = Pick<PrismaClient, "project" | "idea" | "bug" | "user" | "attachment" | "agentEvent" | "webhookSubscription" | "$queryRaw" | "$transaction">;

type PublicIdeaDependencies = {
  submittedById?: string;
  db?: PublicIntakeDb;
  consume?: (items: RateLimitItem[]) => Promise<{ allowed: boolean; retryAfterMs: number }>;
  emit?: typeof publish;
};

function publicIdeaDescription(input: Pick<PublicIdeaInput, "description" | "stepsToReproduce" | "expectedBehavior" | "actualBehavior">): string {
  const sections = [`## Details\n${input.description}`];
  if (input.stepsToReproduce) sections.push(`## Steps to reproduce\n${input.stepsToReproduce}`);
  if (input.expectedBehavior) sections.push(`## Expected behaviour\n${input.expectedBehavior}`);
  if (input.actualBehavior) sections.push(`## Actual behaviour\n${input.actualBehavior}`);
  return sections.join("\n\n");
}

function publicMatches(matches: Awaited<ReturnType<typeof findSimilarIssues>>): PublicIdeaMatch[] {
  return matches.filter((match) => match.kind !== "idea").map((match) => {
    const kind = match.kind === "idea" ? "idea" : "issue";
    return {
      kind,
      number: match.number,
      title: match.title,
      status: String(match.status),
    };
  });
}

function retrySeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

export function parseBase64Data(raw: string): Uint8Array | null {
  try {
    const clean = raw.includes(",") ? raw.split(",")[1] ?? "" : raw;
    return new Uint8Array(Buffer.from(clean, "base64"));
  } catch {
    return null;
  }
}

export async function findPublicIdeaMatches(
  ref: PublicProjectRef,
  title: string,
  headers: HeadersLike,
  dependencies: PublicIdeaDependencies = {},
): Promise<{ status: 200; matches: PublicIdeaMatch[] } | Exclude<PublicIdeaResult, { status: 200 | 201 }>> {
  const parsedTitle = publicTitleSchema.safeParse(title);
  if (!parsedTitle.success) {
    return { status: 400, error: "invalid_request", message: "Enter a title between 3 and 200 characters." };
  }
  const db = dependencies.db ?? prisma;
  const project = await db.project.findFirst({
    where: {
      slug: ref.projectSlug,
      archivedAt: null,
      organisation: { slug: ref.orgSlug, archivedAt: null },
    },
    select: { id: true, organisationId: true, visibility: true, acceptsGuestIdeas: true },
  });
  if (!project) return { status: 404, error: "not_found", message: "Public issue intake is not available for this project." };
  // Never expose internal issues or duplicate suggestions for private projects (#1048).
  if (project.visibility === "private") {
    return { status: 200, matches: [] };
  }

  const consume = dependencies.consume ?? consumeRateLimits;
  const limited = await consume([
    { key: `public-similar:${clientRateLimitKey(headers)}`, config: PUBLIC_SIMILAR_LIMIT },
  ]);
  if (!limited.allowed) {
    return { status: 429, error: "rate_limited", message: "Too many searches. Please wait and try again.", retryAfterSeconds: retrySeconds(limited.retryAfterMs) };
  }

  const matches = await findSimilarIssues(db as PrismaClient, {
    organisationId: project.organisationId,
    projectId: project.id,
  }, parsedTitle.data, "product", false);
  return { status: 200, matches: publicMatches(matches) };
}

export async function createPublicIdea(
  ref: PublicProjectRef,
  rawInput: unknown,
  headers: HeadersLike,
  dependencies: PublicIdeaDependencies = {},
): Promise<PublicIdeaResult> {
  const parsed = publicIdeaSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      status: 400,
      error: "invalid_request",
      message: "Check the report and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const input = parsed.data;
  if (input.website) {
    return { status: 400, error: "bot_detected", message: "The report could not be submitted." };
  }

  const db = dependencies.db ?? prisma;
  const project = await db.project.findFirst({
    where: {
      slug: ref.projectSlug,
      archivedAt: null,
      organisation: { slug: ref.orgSlug, archivedAt: null },
    },
    select: { id: true, name: true, organisationId: true, visibility: true, acceptsGuestIdeas: true },
  });
  if (!project) return { status: 404, error: "not_found", message: "Public issue intake is not available for this project." };

  let checkedScreenshot: { bytes: Uint8Array; filename: string; contentType: string } | null = null;
  if (input.screenshot) {
    const bytes = parseBase64Data(input.screenshot.data);
    if (!bytes || bytes.byteLength === 0) {
      return {
        status: 400,
        error: "invalid_request",
        message: "Screenshot data is invalid.",
        fieldErrors: { screenshot: ["Screenshot data is invalid."] },
      };
    }
    const check = checkAttachment(bytes, input.screenshot.filename);
    if (!check.ok) {
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
        return { status: 413, error: "too_large", message: check.error };
      }
      return { status: 400, error: "invalid_request", message: check.error, fieldErrors: { screenshot: [check.error] } };
    }
    if (check.kind !== "image") {
      return {
        status: 400,
        error: "invalid_request",
        message: "Only image files (PNG, JPEG, GIF, WebP) are supported for screenshots.",
        fieldErrors: { screenshot: ["Only image files (PNG, JPEG, GIF, WebP) are supported for screenshots."] },
      };
    }
    checkedScreenshot = { bytes, filename: check.filename, contentType: check.contentType };
  }

  const tokenHash = publicTrackingTokenHash(input.trackingToken);
  const trackingPath = publicTrackingPath(ref, input.trackingToken);
  const existing = await db.idea.findUnique({
    where: { publicTrackingTokenHash: tokenHash },
    select: { id: true, number: true, projectId: true },
  });
  if (existing) {
    return existing.projectId === project.id
      ? { status: 200, ideaId: existing.id, ideaNumber: existing.number, trackingPath, replayed: true }
      : { status: 409, error: "tracking_conflict", message: "Create a new tracking token and try again." };
  }

  const consume = dependencies.consume ?? consumeRateLimits;
  const limited = await consume([
    { key: `public-idea:${clientRateLimitKey(headers)}`, config: PUBLIC_IDEA_CLIENT_LIMIT },
    { key: `public-idea-project:${project.id}`, config: PUBLIC_IDEA_PROJECT_LIMIT },
  ]);
  if (!limited.allowed) {
    return { status: 429, error: "rate_limited", message: "Too many reports were submitted. Please wait and try again.", retryAfterSeconds: retrySeconds(limited.retryAfterMs) };
  }

  // Never expose internal issues on a private project's shared feedback portal (#1048).
  if (!input.acknowledgeSimilar && project.visibility !== "private") {
    const matches = await findSimilarIssues(db as PrismaClient, {
      organisationId: project.organisationId,
      projectId: project.id,
    }, input.title, "product", false);
    if (matches.length > 0) {
      return {
        status: 409,
        error: "similar_ideas",
        message: "Review the possible matches before submitting another report.",
        matches: publicMatches(matches),
      };
    }
  }

  const emit = dependencies.emit ?? publish;
  const description = publicIdeaDescription(input);
  try {
    const idea = await db.$transaction(async (tx) => {
      const reporter = dependencies.submittedById ? { id: dependencies.submittedById } : await tx.user.upsert({
        where: { email: publicReporterEmail(project.id) },
        update: {},
        create: {
          name: `${project.name} public reporter`,
          email: publicReporterEmail(project.id),
          passwordHash: null,
          emailNotifications: false,
          notifyMentions: false,
          notifyAssignments: false,
          notifyStatusChanges: false,
        },
        select: { id: true },
      });
      const created = await tx.idea.create({
        data: {
          organisationId: project.organisationId,
          projectId: project.id,
          reporterId: reporter.id,
          beneficiaryUserId: reporter.id,
          title: input.title,
          summary: input.summary,
          description,
          source: "public",
          publicTrackingTokenHash: tokenHash,
          track: "product",
        },
        select: { id: true, number: true },
      });
      if (dependencies.submittedById) {
        await tx.publicSubmission.create({ data: { ideaId: created.id, userId: dependencies.submittedById } });
      }
      if (checkedScreenshot) {
        await tx.attachment.create({
          data: {
            uploaderId: reporter.id,
            ideaId: created.id,
            filename: checkedScreenshot.filename,
            contentType: checkedScreenshot.contentType,
            size: checkedScreenshot.bytes.byteLength,
            data: Buffer.from(checkedScreenshot.bytes),
          },
        });
      }
      await emit(tx, {
        organisationId: project.organisationId,
        projectId: project.id,
        type: "idea.created",
        payload: {
          ideaId: created.id,
          ideaNumber: created.number,
          projectId: project.id,
          reporterId: reporter.id,
          beneficiaryUserId: reporter.id,
          source: "public",
        },
      });
      return created;
    });
    return { status: 201, ideaId: idea.id, ideaNumber: idea.number, trackingPath, replayed: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await db.idea.findUnique({
        where: { publicTrackingTokenHash: tokenHash },
        select: { id: true, number: true, projectId: true },
      });
      if (replay?.projectId === project.id) {
        return { status: 200, ideaId: replay.id, ideaNumber: replay.number, trackingPath, replayed: true };
      }
    }
    throw error;
  }
}
