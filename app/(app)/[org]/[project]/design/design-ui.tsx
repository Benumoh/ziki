import type { RedesignStatus } from "@prisma/client";
import { BASE_PATH } from "@/lib/base-path";
import { safeHref } from "@/lib/rich-text";
import { designStatus, type DesignStatusTone } from "@/lib/design-view";

/** Shared pieces of the Design list and a proposal's page (#9). */

const TONES: Record<DesignStatusTone, string> = {
  warn: "border-zk-warn-bd bg-zk-warn-bg text-zk-warn-fg",
  ok: "border-transparent bg-zk-ok-bg text-zk-ok-fg",
  bad: "border-zk-bad-bd bg-zk-bad-bg text-zk-bad-fg",
  muted: "border-zk-border bg-zk-chip text-zk-text2",
};

export function DesignStatusChip({ status, linked }: { status: RedesignStatus; linked: boolean }) {
  const { label, tone } = designStatus(status, linked);
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}>
      {label}
    </span>
  );
}

/** A mockup's address: our own route, which checks the viewer belongs to the proposal's organisation. */
export function mockupSrc(id: string): string {
  return `${BASE_PATH}/api/attachments/${encodeURIComponent(id)}`;
}

/** The live preview, opened in a new tab. Proposals only take HTTPS addresses; anything else isn't linked. */
export function PreviewLink({ url, className }: { url: string | null; className?: string }) {
  const href = url ? safeHref(url) : null;
  if (!href) return null;
  const shown = href.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={className ?? "inline-flex max-w-full items-center gap-1 text-sm font-semibold text-zk-accent hover:underline"}>
      <span className="truncate">Live preview: {shown}</span>
      <span aria-hidden="true">↗</span>
    </a>
  );
}
