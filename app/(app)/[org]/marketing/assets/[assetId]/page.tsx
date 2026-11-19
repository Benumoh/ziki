import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AssetPage } from "@/components/marketing/home/asset-page";
import { LoadError } from "@/components/load-error";
import { logLoadFailure } from "@/lib/load-error";
import { projectRef } from "@/lib/project-paths";
import { requireOrgMarketing, requireProject } from "@/lib/project-route";
import { readMarketingAsset, type MarketingAssetPage } from "../../data";

export const metadata: Metadata = { title: "Marketing asset" };

/** `/<org>/marketing/assets/<id>`: one marketing asset (#marketing-assets) and all the work on it. */
export default async function MarketingAssetRoute({ params }: { params: Promise<{ org: string; assetId: string }> }) {
  const { org: orgParam, assetId } = await params;
  const { org, project } = await requireOrgMarketing(orgParam, `/assets/${assetId}`);
  const context = await requireProject(org, project);
  let data: MarketingAssetPage | null;
  try {
    data = await readMarketingAsset(context, assetId);
  } catch (error) {
    return <LoadError title="This asset could not be loaded" reference={logLoadFailure("[marketing asset] query failed", error)} />;
  }
  if (!data) notFound();
  return <AssetPage slug={projectRef(org, project)} data={data} project={{ id: context.project.id, name: context.project.name }} />;
}
