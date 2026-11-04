import { IssueApiError } from "@/lib/agent-api/errors";

export const DEFAULT_GOAL_PAGE_SIZE = 50;
export const MAX_GOAL_PAGE_SIZE = 100;

export type GoalCursor = {
  projectId: string;
  createdAt: Date;
  id: string;
};

export function encodeGoalCursor(cursor: GoalCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.projectId, cursor.createdAt.toISOString(), cursor.id]),
  ).toString("base64url");
}

/** A cursor belongs to the project whose page produced it. */
export function decodeGoalCursor(raw: string | null, projectId: string): GoalCursor | null {
  if (!raw || raw.length > 500) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 3) return null;
    const [cursorProjectId, iso, id] = value;
    if (
      cursorProjectId !== projectId ||
      typeof iso !== "string" ||
      typeof id !== "string" ||
      !id ||
      id.length > 191
    ) return null;
    const createdAt = new Date(iso);
    return Number.isNaN(createdAt.getTime()) ? null : { projectId, createdAt, id };
  } catch {
    return null;
  }
}

export function parseGoalPage(
  params: URLSearchParams,
  projectId: string,
): { limit: number; cursor: GoalCursor | null } {
  const rawLimit = params.get("limit");
  let limit = DEFAULT_GOAL_PAGE_SIZE;
  if (rawLimit !== null && rawLimit.trim() !== "") {
    const value = rawLimit.trim();
    if (!/^\d+$/.test(value) || Number(value) < 1) {
      throw new IssueApiError(
        422,
        `limit must be a whole number between 1 and ${MAX_GOAL_PAGE_SIZE}; the default is ${DEFAULT_GOAL_PAGE_SIZE}.`,
      );
    }
    limit = Math.min(Number(value), MAX_GOAL_PAGE_SIZE);
  }

  const rawCursor = params.get("cursor");
  const cursor = decodeGoalCursor(rawCursor, projectId);
  if (rawCursor !== null && !cursor) throw new IssueApiError(400, "Invalid cursor.");
  return { limit, cursor };
}
