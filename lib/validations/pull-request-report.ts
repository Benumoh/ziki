import { z } from "zod";

/**
 * The body of `POST /api/v1/issues/{id}/pull-request-status` (#pr-reports): what
 * an agent saw when it checked the issue's linked pull request on GitHub.
 * Ziki never asks GitHub itself; the latest report is the pull request's state.
 */

const sha = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{7,64}$/i, "Send a hexadecimal commit SHA.");

const branch = z.string().trim().min(1).max(255);

export const PULL_REQUEST_STATES = ["open", "closed", "merged", "not_found"] as const;
export const PULL_REQUEST_CHECKS = ["passing", "failing", "pending", "none"] as const;

export const pullRequestReportSchema = z
  .object({
    /** The pull request checked: must be the issue's linked one. */
    pullRequestUrl: z.string().trim().min(1).max(2048),
    /** `closed` means closed without being merged; `not_found` means GitHub answers 404. */
    state: z.enum(PULL_REQUEST_STATES),
    /** The branch it was merged into (with `merged`). */
    mergedInto: branch.optional(),
    /** Whether the repository's default branch contains its merge commit (with `merged`). */
    inDefaultBranch: z.boolean().optional(),
    /** Its head commit now. */
    headSha: sha.optional(),
    /** Its merge commit (with `merged`). */
    mergeCommitSha: sha.optional(),
    /** GitHub's actual merge timestamp (required with `merged`). */
    mergedAt: z.string().datetime({ offset: true }).optional(),
    /** Every check, status and deployment on the head commit: all passing, any failing, any still running, or none at all. */
    checks: z.enum(PULL_REQUEST_CHECKS).optional(),
    /** False when GitHub says it conflicts with its base branch. */
    mergeable: z.boolean().optional(),
    /** What you saw, in a sentence or two. */
    note: z.string().trim().min(1, "Add a note: what you saw on GitHub.").max(1000),
    projectId: z.string().trim().min(1).max(191).optional(),
  })
  .strict()
  .refine((body) => body.state === "merged" || (body.mergedInto === undefined && body.inDefaultBranch === undefined && body.mergeCommitSha === undefined && body.mergedAt === undefined), {
    message: "mergedInto, inDefaultBranch, mergeCommitSha and mergedAt go with state \"merged\" only.",
    path: ["state"],
  })
  .refine((body) => body.state !== "merged" || body.inDefaultBranch !== undefined, {
    message: "Say whether the default branch contains the merge (inDefaultBranch).",
    path: ["inDefaultBranch"],
  })
  .refine((body) => body.state !== "merged" || body.mergedAt !== undefined, {
    message: "Include GitHub's merge timestamp (mergedAt).",
    path: ["mergedAt"],
  });

export type PullRequestReportInput = z.infer<typeof pullRequestReportSchema>;
