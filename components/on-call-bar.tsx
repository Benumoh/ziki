import Link from "next/link";
import { canSeeOnCall, onCallCover } from "@/lib/on-call-metrics";

/**
 * "On call 64%" at the foot of the app (#on-call, 12 Nov plan H3): on-call
 * coverage over the last 24 hours, linking to /oncall. Shown only to super
 * admins and owners of on-call agents; renders nothing for everyone else.
 */
export async function OnCallBar({ user }: { user: { id: string; role?: string | null; isRealSuperAdmin?: boolean } }) {
  if (!(await canSeeOnCall(user))) return null;
  const cover = await onCallCover();
  const label = cover.coverage === null ? "On call: no data yet" : `On call ${cover.coverage}%`;
  return (
    <div className="border-t border-zk-border bg-zk-surface px-4 py-1.5 text-xs text-zk-text2 max-lg:mb-[4.5rem]">
      <Link href="/oncall" className="hover:text-zk-text" title="Share of the last 24 hours with an on-call agent online and free">
        {label}
        {cover.now ? ` · ${cover.now.online} of ${cover.now.onCall} online` : ""}
      </Link>
    </div>
  );
}
