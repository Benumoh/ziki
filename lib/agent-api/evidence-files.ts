import { z } from "zod";

/**
 * Evidence files (#confirmation-files): the files, and optionally the lines, a
 * confirmation says the issue is in, or a judgement says the delivered work
 * changed. A confirm must name at least one; a judgement too.
 *
 * Nobody copies them: another agent sees an entry's files only once it has
 * given an entry of the same kind (a confirm, or a judgement) on that issue.
 * The entry's own person and organisation admins always see them.
 */

export const MAX_EVIDENCE_FILES = 20;

export const evidenceFileSchema = z
  .object({
    /** A path in the repository, e.g. "app/api/v1/ideas/route.ts". */
    path: z.string().trim().min(1, "Each file needs a path.").max(300),
    /** Optional line or range, e.g. "42" or "40-58". */
    lines: z
      .string()
      .trim()
      .max(60)
      .regex(/^\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*$/, "lines is a line or a range, such as 42 or 40-58.")
      .optional(),
  })
  .strict();

export type EvidenceFile = z.infer<typeof evidenceFileSchema>;

export const evidenceFilesSchema = z.array(evidenceFileSchema).max(MAX_EVIDENCE_FILES);

/** Reads a stored `files` column; anything malformed reads as no files. */
export function storedEvidenceFiles(value: unknown): EvidenceFile[] {
  const parsed = evidenceFilesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** The same files listed once, in their given order. */
export function uniqueEvidenceFiles(files: readonly EvidenceFile[]): EvidenceFile[] {
  const seen = new Set<string>();
  const unique: EvidenceFile[] = [];
  for (const file of files) {
    const key = `${file.path}\u0000${file.lines ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(file);
  }
  return unique;
}

/**
 * The web forms' text form: one file per line, as `path` or `path:lines`
 * (e.g. `lib/coins/issue-payout.ts:40-58`). Blank lines are skipped.
 */
export function parseEvidenceFileLines(text: string): EvidenceFile[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(.*?):(\d[\d\s,-]*)$/.exec(line);
      return match ? { path: match[1].trim(), lines: match[2].trim() } : { path: line };
    });
}

/** The inverse of `parseEvidenceFileLines`, to fill a form with saved files. */
export function evidenceFileLines(files: readonly EvidenceFile[]): string {
  return files.map((file) => (file.lines ? `${file.path}:${file.lines}` : file.path)).join("\n");
}

/** Who is looking: a person, whether they are an organisation admin, and whether they have given their own entry. */
export type EvidenceViewer = { userId: string; admin?: boolean; hasOwnEntry: boolean };

/** Whether `viewer` may see the files of an entry given for `entryUserId`. */
export function canSeeEvidenceFiles(viewer: EvidenceViewer | null | undefined, entryUserId: string): boolean {
  if (!viewer) return false;
  return viewer.admin === true || viewer.userId === entryUserId || viewer.hasOwnEntry;
}

/** An entry's files as a viewer sees them: the list, or how many are hidden. */
export type EvidenceFilesView = { files: EvidenceFile[] | null; filesHidden: boolean; fileCount: number };

export function evidenceFilesView(stored: unknown, visible: boolean): EvidenceFilesView {
  const files = storedEvidenceFiles(stored);
  return visible ? { files, filesHidden: false, fileCount: files.length } : { files: null, filesHidden: files.length > 0, fileCount: files.length };
}
