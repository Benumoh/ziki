import "server-only";
import type { Prisma, Status, Substatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findPublicProject } from "@/lib/public-projects";
import type { PublicProjectRef } from "@/lib/public-project-paths";

export type PublicIssueStatusFilter = "all" | "open" | "in_progress" | "resolved";

export type PublicIssueSummary = {
  id: string;
  number: number;
  title: string;
  summary: string | null;
  status: Status;
  substatus: Substatus;
  createdAt: Date;
  updatedAt: Date;
  area: { name: string } | null;
  type: { name: string } | null;
  _count: { publicFeedbackVotes: number };
};

export type PublicIssueDetail = PublicIssueSummary & {
  description: string | null;
};

const PUBLIC_ISSUE_SELECT = {
  id: true,
  number: true,
  title: true,
  summary: true,
  status: true,
  substatus: true,
  createdAt: true,
  updatedAt: true,
  area: { select: { name: true } },
  type: { select: { name: true } },
  _count: { select: { publicFeedbackVotes: true } },
} satisfies Prisma.BugSelect;

/** The statuses a guest's public issue list shows; closed issues are left out. */
export const PUBLIC_ISSUE_STATUSES = ["open", "in_progress", "done", "merge", "resolved"] as const;

export function parsePublicIssueStatus(value?: string | null): PublicIssueStatusFilter {
  if (value === "open" || value === "in_progress" || value === "resolved") {
    return value;
  }
  return "all";
}

export async function listPublicIssues(
  ref: PublicProjectRef,
  options: { query?: string; status?: PublicIssueStatusFilter; sort?: "votes" | "recent"; kind?: "problem" | "improvement" } = {},
) {
  const project = await findPublicProject(ref);
  if (!project) return null;

  const status = options.status ?? "all";
  const query = (options.query ?? "").trim();

  const where: Prisma.BugWhereInput = {
    projectId: project.id,
    isDeleted: false,
    securityFinding: { is: null },
    track: "product",
    status:
      status === "all"
        ? { in: [...PUBLIC_ISSUE_STATUSES] }
        : status,
  };

  if (options.kind) {
    const suggestions: Prisma.BugWhereInput = { type: { is: { OR: ["feature", "suggestion", "improvement", "enhancement"].map(name => ({ name: { contains: name, mode: "insensitive" as const } })) } } };
    where.AND = options.kind === "improvement" ? [suggestions] : [{ NOT: suggestions }];
  }

  if (query) {
    const parsedNumber = /^#?(\d+)$/.exec(query);
    if (parsedNumber) {
      where.OR = [
        { number: Number.parseInt(parsedNumber[1] ?? "0", 10) },
        { title: { contains: query, mode: "insensitive" } },
      ];
    } else {
      where.OR = [
        { title: { contains: query, mode: "insensitive" } },
        { summary: { contains: query, mode: "insensitive" } },
      ];
    }
  }

  const issues = await prisma.bug.findMany({
    where,
    orderBy: options.sort === "votes"
      ? [{ publicFeedbackVotes: { _count: "desc" } }, { updatedAt: "desc" }, { number: "desc" }]
      : [{ updatedAt: "desc" }, { number: "desc" }],
    take: 50,
    select: PUBLIC_ISSUE_SELECT,
  });

  return { project, issues };
}

export async function findPublicIssue(ref: PublicProjectRef, issueNumber: number) {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) return null;
  const project = await findPublicProject(ref);
  if (!project) return null;

  const issue = await prisma.bug.findFirst({
    where: {
      projectId: project.id,
      number: issueNumber,
      isDeleted: false,
      securityFinding: { is: null },
      track: "product",
    },
    select: {
      ...PUBLIC_ISSUE_SELECT,
      description: true,
    },
  });

  if (!issue) return null;
  return { project, issue };
}
