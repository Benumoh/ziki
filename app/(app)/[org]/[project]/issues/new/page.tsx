import Link from "next/link";
import { parseWorkCategory, typeForCategory } from "@/lib/work-category";
import { notFound } from "next/navigation";
import "./create-issue.css";
import { CreateIssueForm } from "@/components/create-issue-form";
import { loadReportFormData } from "./load-form-data";
import { ideasPath } from "@/lib/project-paths";

/* Distinct browser-tab title; the root layout appends the site name. */
export const metadata = { title: "Report an issue" };

/** `/<slug>/issues/new`: file a report into this project (#project-urls). */
export default async function NewBugPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ security?: string; kind?: string }>;
}) {
  const { org, project } = await params;
  // #security-findings: the Security page's "Report a vulnerability" opens the form with it ticked.
  const query = await searchParams;
  const security = query.security === "1";
  // A section's Add button (#work-segments): the type starts at that kind.
  const kind = parseWorkCategory(query.kind);
  const { user, admin, users, assigneeUsers, types, projectId, projectSlug, canContribute } =
    await loadReportFormData(org, project);
  if (!canContribute) notFound();

  return (
    <div className="create-issue-page mx-auto w-full min-w-0 space-y-6 pb-10">
      <div className="create-issue-heading space-y-2">
        <Link
          href={ideasPath(projectSlug)}
          className="inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-zk-accent hover:underline"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to issues
        </Link>
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-zk-text">
          {security ? "Report a security vulnerability" : "Report an issue"}
        </h1>
        <p className="text-sm text-zk-text2">
          {security
            ? "Describe the weakness and how to reproduce it. It stays private until authorized disclosure."
            : "Give the team the full picture: what you did, what you expected, what happened instead."}
        </p>
      </div>
      <div className="create-issue-card border border-zk-border bg-zk-surface">
        <CreateIssueForm
          users={users}
          assigneeUsers={assigneeUsers}
          types={types}
          isAdmin={admin}
          currentUserId={user.id}
          projectId={projectId}
          projectSlug={projectSlug}
          defaultSecurity={security}
          defaultTypeId={kind ? typeForCategory(kind, types)?.id : undefined}
        />
      </div>
    </div>
  );
}
