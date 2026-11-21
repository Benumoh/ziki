import Link from "next/link";
import type { LoginHistoryView } from "@/lib/user-sessions";

export type LoginHistoryProps = {
  items: LoginHistoryView[];
  totalCount: number;
  /** When true (default on `/settings`), shows the "View full history →" link. */
  compact?: boolean;
  /** Custom range summary on paginated views (e.g. "Showing 1–25 of 48"). */
  rangeLabel?: string;
};

export function LoginHistory({
  items,
  totalCount,
  compact = true,
  rangeLabel,
}: LoginHistoryProps) {
  const summaryText = rangeLabel ?? `Showing ${items.length} of ${totalCount}`;

  return (
    <section className="flex flex-col gap-4 rounded-panel border border-zk-border bg-zk-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="login-history-heading" className="m-0 text-lg font-bold text-zk-text">
            Login history
          </h2>
          <span className="text-[13px] text-zk-muted">
            Recent successful and failed sign-in attempts on your account.
          </span>
        </div>
        <a
          href="/api/user/login-history"
          download
          className="inline-flex h-[38px] items-center rounded-full border border-zk-border bg-zk-surface px-4 text-[13px] font-bold text-zk-text transition hover:bg-zk-chip"
        >
          Download CSV
        </a>
      </div>

      {/* Focusable so a keyboard can scroll the table on narrow screens (scrollable-region-focusable). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div role="region" aria-labelledby="login-history-heading" tabIndex={0} className="-mx-6 overflow-x-auto px-6 focus-visible:rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zk-accent/40">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className="border-b border-zk-divider">
              <th
                scope="col"
                className="pb-2.5 pr-4 text-[11px] font-bold uppercase tracking-[0.05em] text-zk-muted"
              >
                Date &amp; time
              </th>
              <th
                scope="col"
                className="pb-2.5 pr-4 text-[11px] font-bold uppercase tracking-[0.05em] text-zk-muted"
              >
                Status
              </th>
              <th
                scope="col"
                className="pb-2.5 pr-4 text-[11px] font-bold uppercase tracking-[0.05em] text-zk-muted"
              >
                Device
              </th>
              <th
                scope="col"
                className="pb-2.5 pr-4 text-[11px] font-bold uppercase tracking-[0.05em] text-zk-muted"
              >
                IP address
              </th>
              <th
                scope="col"
                className="pb-2.5 text-[11px] font-bold uppercase tracking-[0.05em] text-zk-muted"
              >
                Location
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zk-divider">
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-[13px] text-zk-muted">
                  No sign-in attempts recorded yet.
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const isSuccess = item.status === "successful";
                return (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap py-3.5 pr-4 text-[13px] font-medium text-zk-text">
                      {item.dateTime}
                    </td>
                    <td className="whitespace-nowrap py-3.5 pr-4">
                      <span
                        className={
                          isSuccess
                            ? "inline-flex items-center rounded-full bg-zk-ok-bg px-2.5 py-0.5 text-[11px] font-bold leading-4 text-zk-ok-fg"
                            : "inline-flex items-center rounded-full bg-zk-bad-bg px-2.5 py-0.5 text-[11px] font-bold leading-4 text-zk-bad-fg"
                        }
                      >
                        {item.statusLabel}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-3.5 pr-4 text-[13px] text-zk-text2">
                      {item.device}
                    </td>
                    <td className="whitespace-nowrap py-3.5 pr-4 font-mono text-xs text-zk-text2">
                      {item.ipAddress}
                    </td>
                    <td className="whitespace-nowrap py-3.5 text-[13px] text-zk-muted">
                      {item.location}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zk-divider pt-3">
        <span className="text-xs text-zk-muted">
          {summaryText} &middot; Locations are approximate, based on IP address.
        </span>
        {compact ? (
          <Link
            href="/settings/login-history"
            className="inline-flex items-center gap-1 text-xs font-bold text-zk-accent hover:underline"
          >
            View full history <span aria-hidden="true">&rarr;</span>
          </Link>
        ) : null}
      </div>
    </section>
  );
}

