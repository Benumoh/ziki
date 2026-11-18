import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { statusFromSegment } from "@/lib/project-paths";
import { IssuesList } from "../_list/issues-list";
import { queryOf } from "../_list/route-page";

type Props = {
  params: Promise<{ org: string; project: string; status: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Each list's title, by its path segment: the step its breadcrumb names. */
const LIST_TITLES: Record<string, string> = {
  open: "Open issues",
  "in-progress": "Issues in progress",
  closed: "Closed issues",
  "possibly-delivered": "Possibly delivered",
  "your-call": "Your call",
  "your-work": "Your work",
  done: "Done",
  merge: "Merge",
  error: "Merge errors",
  live: "Live",
  all: "All issues",
  rejected: "Rejected issues",
  duplicates: "Duplicates",
  finished: "Closed issues",
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { status } = await params;
  return { title: LIST_TITLES[status] ?? "Issues" };
}

/** `/<slug>/issues/<status>`: open, in-progress, done, merge, live, closed, all, rejected, duplicates (#project-urls). */
export default async function IssuesStatusPage({ params, searchParams }: Props) {
  const { org, project, status: segment } = await params;
  // The old Ziki tasks step (#earnings): Earn is part of Ziki now, so old links open the project's list.
  if (segment === "ziki-tasks") redirect(`/${org}/${project}/issues/open`);
  const status = statusFromSegment(segment);
  if (!status) notFound();
  const query = await searchParams;
  return <IssuesList org={org} slug={project} status={status} returnTo={`/${org}/${project}/issues/${segment}${queryOf(query)}`} searchParams={Promise.resolve(query)} />;
}
