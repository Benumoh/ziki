import type { ReactNode } from "react";
import { TILE_TONES, toneForName } from "@/lib/pill-tones";

/** The same compact app strip used above Ziki's work feed. */
export function FeedbackPageHeader({ title, description, identity, actions, surface = "muted", compact = false }: {
  title: string;
  description: ReactNode;
  identity: string;
  actions?: ReactNode;
  surface?: "muted" | "white";
  compact?: boolean;
}) {
  return (
    <header className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-panel border border-zk-border px-5 ${compact ? "py-3" : "py-4"} ${surface === "white" ? "bg-zk-surface" : "bg-zk-text/[0.045]"}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-control text-[16px] font-medium ${compact ? "h-8 w-8" : "h-10 w-10"}`} style={TILE_TONES[toneForName(identity)]}>
          {identity.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h1 className="m-0 text-[15px] font-semibold text-zk-text">{title}</h1>
          <p className="mt-0.5 text-[13px] leading-5 text-zk-muted">{description}</p>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 max-sm:ml-[54px]">{actions}</div> : null}
    </header>
  );
}
