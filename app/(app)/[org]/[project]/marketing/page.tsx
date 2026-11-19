import { permanentRedirect } from "next/navigation";
import { marketingPath, projectRef } from "@/lib/project-paths";
import { queryOf } from "../issues/_list/route-page";

type Props = {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Marketing's home belongs to the organisation (#org-marketing): `/<org>/<project>/marketing` goes to `/<org>/marketing`. */
export default async function ProjectMarketingPage({ params, searchParams }: Props) {
  const { org, project } = await params;
  permanentRedirect(`${marketingPath(projectRef(org, project))}${queryOf(await searchParams)}`);
}
