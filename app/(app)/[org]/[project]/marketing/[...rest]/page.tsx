import { permanentRedirect } from "next/navigation";
import { marketingPath, projectRef } from "@/lib/project-paths";
import { queryOf } from "../../issues/_list/route-page";

type Props = {
  params: Promise<{ org: string; project: string; rest: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Marketing belongs to the organisation (#org-marketing): `/<org>/<project>/marketing/<page>` goes to `/<org>/marketing/<page>`. */
export default async function ProjectMarketingSectionPage({ params, searchParams }: Props) {
  const { org, project, rest } = await params;
  permanentRedirect(`${marketingPath(projectRef(org, project), rest.map(encodeURIComponent).join("/"))}${queryOf(await searchParams)}`);
}
