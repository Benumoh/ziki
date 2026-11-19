import { redirect } from "next/navigation";
import { issuesPath, orgRef } from "@/lib/project-paths";
import { requireOrgList } from "@/lib/project-route";

/** `/<org>/issues`: every project's issues, the All list (#project-filter). */
export default async function OrgIssuesIndexPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const resolved = await requireOrgList(org, `/${org}/issues`);
  redirect(issuesPath(orgRef(resolved.org), "all"));
}
