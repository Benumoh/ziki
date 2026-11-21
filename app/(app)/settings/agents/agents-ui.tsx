import type { AgentLevel } from "@prisma/client";
import type { ReactNode } from "react";

/** Shared presentational classes for the agents redesign (lane-local; shell is frozen). */
export const agentsSurface =
  "rounded-panel border border-zk-border bg-zk-surface";

export const agentsLink =
  "font-semibold text-zk-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2";

export const agentsPrimaryBtn =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-electric-blue-strong px-5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(46,111,239,0.30)] transition hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none";

export const agentsSecondaryBtn =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-zk-border bg-zk-surface px-5 text-sm font-bold text-zk-text transition hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export const agentsDangerBtn =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-zk-bad-bd bg-zk-bad-soft px-5 text-sm font-bold text-zk-bad-fg transition hover:bg-zk-bad-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zk-bad-fg focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export const agentsInputClass =
  "w-full rounded-xl border border-zk-border bg-zk-surface px-3.5 py-2.5 text-sm text-zk-text shadow-none placeholder:text-zk-muted focus:border-electric-blue focus:outline-none focus:ring-2 focus:ring-electric-blue/20";

export const agentsLabelClass = "block text-sm font-semibold text-zk-text";

export const agentsMutedClass = "text-sm text-zk-muted";

export const agentsChipClass =
  "inline-flex items-center rounded-full bg-zk-chip px-2.5 py-0.5 text-xs font-bold text-zk-text2";

const LEVEL_BADGE: Record<AgentLevel, string> = {
  working: "bg-zk-ok-bg text-zk-ok-fg",
  manager: "bg-[#FDECEF] text-[#B4233F] dark:bg-[#3A1424] dark:text-[#F9A8C0]",
  merger: "bg-[#7C3AED]/15 text-[#7C3AED] dark:bg-[#7C3AED]/25 dark:text-[#C4B5FD]",
};

export function levelBadgeClass(level: AgentLevel): string {
  return `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${LEVEL_BADGE[level]}`;
}

/** Formats a pairing code as ABCD-2345 while typing. */
export function formatPairingCode(value: string): string {
  const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

export function isValidPairingCode(value: string): boolean {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(value);
}

export function AgentsSurface({
  children,
  className = "",
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "li";
} & Record<string, unknown>) {
  return (
    <Tag className={`${agentsSurface} p-4 sm:p-6 ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
