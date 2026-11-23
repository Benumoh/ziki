"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import { LocalTime } from "@/components/local-time";
import type { PointEntriesPage } from "@/lib/points/entries";
import { formatZ } from "@/lib/points/rules";
import {
  type DetailedPointEntry,
  type PointLedgerSummary,
  pointRoleLabels,
  pointRoleDescription,
} from "@/lib/points/ledger";
import type { PointRole } from "@prisma/client";

export type PointsLedgerProps = {
  page?: PointEntriesPage | null;
  profileId?: string;
  from?: string;
  to?: string;
  error?: boolean;
  entries?: DetailedPointEntry[];
  summary?: PointLedgerSummary;
};

const roleBadgeClasses: Record<string, string> = {
  solver: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20",
  reviewer: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20",
  reporter: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20",
  triager: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20",
  submission: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
  dispatcher: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20",
};

export function PointsLedger({
  page,
  profileId,
  from,
  to,
  error,
  entries,
  summary: externalSummary,
}: PointsLedgerProps) {
  const [selectedRole, setSelectedRole] = useState<string>("all");

  const query = new URLSearchParams();
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  if (page?.nextCursor) query.set("cursor", page.nextCursor);

  // Normalize entries whether provided directly or through page.items
  type StandardItem = {
    id: string;
    points: number;
    role: string;
    source: string;
    createdAt: string | Date;
    correctedAt?: Date | null;
    issue?: { id: string; number: number; title: string; path?: string } | null;
    idea?: { id: string; number: number; title: string; path: string } | null;
    description?: string;
  };

  const allItems: StandardItem[] = useMemo(() => {
    if (entries) {
      return entries.map((e) => ({
        id: e.id,
        points: e.points,
        role: e.role,
        source: pointRoleLabels[e.role] ?? e.role,
        createdAt: e.createdAt,
        correctedAt: e.correctedAt,
        issue: e.bug
          ? {
              id: e.bug.id,
              number: e.bug.number,
              title: e.bug.title,
              path: `/issues/${e.bug.id}`,
            }
          : null,
        description: pointRoleDescription(e.role, e.points),
      }));
    }

    if (page?.items) {
      return page.items.map((item) => ({
        id: item.id,
        points: item.points,
        role: item.role,
        source: item.source,
        createdAt: item.createdAt,
        issue: item.issue,
        idea: item.idea,
        description:
          item.points < 0
            ? "Administrative correction or reversed award"
            : pointRoleDescription(item.role as PointRole, item.points),
      }));
    }

    return [];
  }, [entries, page]);

  // Compute summary metrics if not explicitly passed
  const summary: PointLedgerSummary = useMemo(() => {
    if (externalSummary) return externalSummary;
    let earned = 0;
    let deductions = 0;
    for (const item of allItems) {
      if (item.points > 0) earned += item.points;
      else deductions += Math.abs(item.points);
    }
    return {
      totalEarned: earned,
      totalDeductions: deductions,
      netPoints: earned - deductions,
      entryCount: allItems.length,
    };
  }, [externalSummary, allItems]);

  const filteredItems = useMemo(() => {
    if (selectedRole === "all") return allItems;
    if (selectedRole === "corrections") return allItems.filter((e) => e.points < 0 || Boolean(e.correctedAt));
    return allItems.filter((e) => e.role.toLowerCase() === selectedRole.toLowerCase() && e.points > 0);
  }, [allItems, selectedRole]);

  return (
    <section
      aria-labelledby="ledger-heading"
      className="rounded-panel border border-zk-border bg-zk-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="ledger-heading" className="text-base font-semibold text-zk-text">
            Ziks history · Itemized Points Ledger
          </h2>
          <p className="mt-0.5 text-xs text-zk-text2">
            Your workspace ledger showing verified task bounties, review rewards, and adjustments.
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-zk-border bg-zk-chip/40 p-3">
          <span className="text-2xs font-semibold uppercase tracking-wider text-zk-muted">
            Total Earned
          </span>
          <p className="mt-1 text-lg font-bold tabular-nums text-teal-600 dark:text-teal-400">
            +{formatZ(summary.totalEarned)}
          </p>
        </div>
        <div className="rounded-xl border border-zk-border bg-zk-chip/40 p-3">
          <span className="text-2xs font-semibold uppercase tracking-wider text-zk-muted">
            Adjustments
          </span>
          <p className="mt-1 text-lg font-bold tabular-nums text-rose-600 dark:text-rose-400">
            {summary.totalDeductions > 0 ? `-${formatZ(summary.totalDeductions)}` : formatZ(0)}
          </p>
        </div>
        <div className="col-span-2 rounded-xl border border-zk-border bg-zk-chip/40 p-3 sm:col-span-1">
          <span className="text-2xs font-semibold uppercase tracking-wider text-zk-muted">
            Net in Period
          </span>
          <p className="mt-1 text-lg font-bold tabular-nums text-zk-text">
            {formatZ(summary.netPoints)}
          </p>
        </div>
      </div>

      {/* Date Filter Form (when profileId is present) */}
      {profileId ? (
        <form method="get" className="my-4 flex flex-wrap items-end gap-3 text-xs">
          <label className="text-zk-text2">
            From (UTC)
            <input
              type="date"
              name="from"
              defaultValue={from?.slice(0, 10)}
              className="mt-1 block rounded-xl border border-zk-border bg-zk-surface px-2.5 py-1.5 text-zk-text"
            />
          </label>
          <label className="text-zk-text2">
            To (UTC)
            <input
              type="date"
              name="to"
              defaultValue={to?.slice(0, 10)}
              className="mt-1 block rounded-xl border border-zk-border bg-zk-surface px-2.5 py-1.5 text-zk-text"
            />
          </label>
          <button
            className="rounded-full border border-zk-border bg-zk-surface px-3 py-1.5 font-medium text-zk-text hover:bg-zk-chip transition-colors"
            type="submit"
          >
            Apply dates
          </button>
          <Link
            href={`/users/${profileId}#ledger-heading`}
            className="rounded px-2 py-1.5 text-zk-accent underline"
          >
            Reset
          </Link>
        </form>
      ) : null}

      {/* Role Filter Tabs */}
      <div
        className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-zk-border/60 pt-3"
        role="tablist"
        aria-label="Filter ledger entries"
      >
        {[
          { id: "all", label: "All Activity" },
          { id: "solver", label: "Solver" },
          { id: "reviewer", label: "Reviewer" },
          { id: "reporter", label: "Reporter" },
          { id: "triager", label: "Triager" },
          { id: "corrections", label: "Adjustments" },
        ].map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={selectedRole === tab.id}
            onClick={() => setSelectedRole(tab.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              selectedRole === tab.id
                ? "bg-zk-text text-zk-surface shadow-xs"
                : "bg-zk-chip text-zk-text2 hover:bg-zk-border/80"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Entries List / Table */}
      {error ? (
        <p role="alert" className="mt-4 text-sm text-zk-bad-fg">
          Invalid dates or page cursor. Reset the filters and try again.
        </p>
      ) : filteredItems.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-sm font-medium text-zk-text">No ledger entries found</p>
          <p className="mt-1 text-xs text-zk-muted">
            {selectedRole === "all"
              ? "Verified task bounties, peer reviews, and adjustments will appear here."
              : `No entries matching the "${selectedRole}" role filter.`}
          </p>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-zk-border/60">
          {filteredItems.map((entry) => {
            const isNegative = entry.points < 0;
            const isCorrected = Boolean(entry.correctedAt);

            return (
              <li
                key={entry.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 hover:bg-zk-chip/30 px-2 rounded-lg transition-colors"
              >
                {/* Left: Task reference, Role badge, Reason description */}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {entry.issue ? (
                      <Link
                        href={entry.issue.path ?? `/issues/${entry.issue.id}`}
                        className="text-sm font-semibold text-zk-text hover:text-zk-accent underline transition-colors truncate max-w-md"
                      >
                        <span className="text-zk-muted font-normal">#{entry.issue.number}</span>{" "}
                        {entry.issue.title}
                      </Link>
                    ) : entry.idea ? (
                      <Link
                        href={entry.idea.path}
                        className="text-sm font-semibold text-zk-text hover:text-zk-accent underline transition-colors truncate max-w-md"
                      >
                        <span className="text-zk-muted font-normal">Idea #{entry.idea.number}</span>{" "}
                        {entry.idea.title}
                      </Link>
                    ) : (
                      <span className="text-sm font-semibold text-zk-text">
                        {entry.source}
                      </span>
                    )}

                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider ${
                        roleBadgeClasses[entry.role.toLowerCase()] ?? "bg-zk-chip text-zk-text2"
                      }`}
                    >
                      {pointRoleLabels[entry.role as PointRole] ?? entry.role}
                    </span>

                    {isCorrected && (
                      <span className="rounded-full bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 text-2xs font-medium text-rose-600 dark:text-rose-400">
                        Corrected
                      </span>
                    )}

                  </div>

                  {entry.description ? (
                    <p className="text-xs text-zk-text2">{entry.description}</p>
                  ) : null}

                  <div className="text-2xs text-zk-muted">
                    <LocalTime date={entry.createdAt} />
                  </div>
                </div>

                {/* Right: the point value */}
                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                  <div className="text-right">
                    <span
                      className={`text-base font-bold tabular-nums ${
                        isNegative
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-teal-600 dark:text-teal-400"
                      }`}
                    >
                      {entry.points > 0 ? "+" : ""}{formatZ(entry.points)}
                    </span>
                  </div>

                </div>
              </li>
            );
          })}
        </ul>
      )}

      {page?.nextCursor && profileId ? (
        <Link
          className="mt-4 inline-block rounded text-sm text-zk-accent underline"
          href={`/users/${profileId}?${query}#ledger-heading`}
        >
          Older entries
        </Link>
      ) : null}
    </section>
  );
}
