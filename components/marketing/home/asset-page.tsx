import Link from "next/link";
import { RowAge } from "@/components/issue-row-meta";
import { PILL_TONES } from "@/lib/pill-tones";
import { marketingPath, type ProjectRef } from "@/lib/project-paths";
import type { MarketingAssetPage } from "@/app/(app)/[org]/marketing/data";
import { VideoStudio } from "@/components/marketing/video/video-studio";
import { AssetChat } from "./asset-chat";
import { AssetScore } from "./asset-score";
import { AssetUrl } from "./asset-url";
import { CELL, GROUP_TONE, HEAD, PILL } from "./marketing-home";
import { PANEL, SECTION_TITLE } from "@/lib/ui-style";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue";

/** A Videos asset's page holds the video studio, where the video is made. */
const VIDEO_TYPE = /video/i;

/**
 * One marketing asset's page (#marketing-assets): where it sits (Marketing › Landing Pages › About Us), its address,
 * a chat box to add work on it, and every piece of work on it as a grid, newest first, each opening its issue or
 * idea. A video's page also holds the video studio.
 */
export function AssetPage({ slug, data, project }: { slug: ProjectRef; data: MarketingAssetPage; project: { id: string; name: string } }) {
  const { asset, items } = data;
  const typeHref = `${marketingPath(slug)}?type=${encodeURIComponent(asset.typeId)}`;
  return (
    <section aria-labelledby="asset-title" className={`mx-auto w-full max-w-[920px] ${PANEL}`}>
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-zk-muted">
        <Link href={marketingPath(slug)} className={`hover:text-zk-text hover:underline ${focus}`}>Marketing</Link>
        <span aria-hidden="true">›</span>
        <Link href={typeHref} className={`hover:text-zk-text hover:underline ${focus}`}>{asset.typeName}</Link>
      </nav>
      {/* The name on the left; its address, with an edit pencil, on the right. */}
      <header className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h1 id="asset-title" className={`min-w-0 ${SECTION_TITLE}`}>{asset.name}</h1>
        <AssetUrl slug={slug} assetId={asset.id} url={asset.url} />
      </header>
      <div className="mt-3">
        <AssetScore slug={slug} assetId={asset.id} score={asset.score} note={asset.scoreNote} scoredAt={asset.scoredAt} />
      </div>
      {VIDEO_TYPE.test(asset.typeName) ? (
        <div className="mt-4">
          <VideoStudio projectName={project.name} />
        </div>
      ) : null}
      {/* Add work the way Your App takes ideas: say it, and it is filed on this asset. */}
      <div className="mt-4">
        <AssetChat projectId={project.id} typeId={asset.typeId} assetId={asset.id} assetName={asset.name} />
      </div>
      <div className="mt-4 rounded-xl bg-zk-bg p-4">
        <h2 className={`mb-3 flex items-center gap-2 px-1 ${SECTION_TITLE}`}>
          Work on {asset.name}
          <span className="text-[12px] font-normal tabular-nums text-zk-muted">{items.length}</span>
        </h2>
        <div className="overflow-x-auto rounded-lg border border-zk-border bg-zk-surface">
          <table className="w-full min-w-[600px] table-fixed border-collapse text-[13.5px]">
            <colgroup>
              <col className="w-[72px]" />
              <col />
              <col className="w-[130px]" />
              <col className="w-[96px]" />
              <col className="w-[128px]" />
            </colgroup>
            <thead className="bg-[#f7f8fa]">
              <tr>
                <th scope="col" className={HEAD}><span className="sr-only">Number</span></th>
                <th scope="col" className={HEAD}>Title</th>
                <th scope="col" className={HEAD}>Author</th>
                <th scope="col" className={HEAD}>Updated</th>
                <th scope="col" className={HEAD}>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-zk-muted">No work on {asset.name} yet. Say what to do in the box above.</td>
                </tr>
              ) : items.map((item) => (
                <tr key={item.id} className="transition hover:bg-zk-bg">
                  <td className={`${CELL} truncate text-[12px] tabular-nums text-zk-muted`}>{item.ref}</td>
                  <td className={CELL}>
                    <Link href={item.href} className={`block truncate font-medium text-zk-text hover:underline ${focus}`}>{item.title}</Link>
                    <span className="mt-0.5 block truncate text-[12px] text-zk-muted">{item.label}</span>
                  </td>
                  <td className={CELL}>
                    {item.agentName ? (
                      <span className="inline-block max-w-full truncate rounded bg-[#e8eef9] px-2 py-0.5 text-[13px] text-zk-text">{item.agentName}</span>
                    ) : <span className="text-zk-muted">—</span>}
                  </td>
                  <td className={`${CELL} text-[12.5px] text-zk-text2`}><RowAge date={item.updatedAt} sort="updated" /></td>
                  <td className={`${CELL} bg-[#fafafb]`}>
                    <span className={PILL} style={{ backgroundColor: PILL_TONES[GROUP_TONE[item.groupKey] ?? "grey"].color }}>{item.groupHeading}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
