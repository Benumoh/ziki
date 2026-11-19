import { redirect } from "next/navigation";
import { issuesPath, projectRef } from "@/lib/project-paths";

type Props = { params: Promise<{ org: string; project: string }> };

/**
 * `/<org>/<project>`, the project's address, opens its Overview (#project-urls).
 * There is no separate project page: the Overview tab is where a project
 * starts, and its list checks who may see it.
 */
export default async function ProjectAddress({ params }: Props) {
  const { org, project } = await params;
  redirect(issuesPath(projectRef(org, project), "your_work"));
}
