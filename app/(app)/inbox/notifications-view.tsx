import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { currentOrganisationIdFor, notificationInOrganisation } from "@/lib/organisation-context";
import { requireUser } from "@/lib/auth-helpers";
import { LocalTime } from "@/components/local-time";
import { MarkAllReadButton } from "@/components/mark-all-read-button";
import { PaginationControls } from "@/components/pagination-controls";
import { calculatePagination } from "@/lib/pagination";
import { BASE_PATH } from "@/lib/base-path";
import type { WorkTrack } from "@prisma/client";
import { notificationTrackWhere } from "@/lib/my-work-filter";

const PAGE_SIZE = 50;

/** The Inbox's notifications (#216); older pages are reachable with ?page= (#569). */
export async function NotificationsView({
  searchParams,
}: {
  searchParams?: Promise<{ scope?: string | string[]; page?: string | string[]; track?: WorkTrack | "all" }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const allOrganisations = params?.scope === "all";
  const organisationId = await currentOrganisationIdFor(user.id);
  const scope = notificationInOrganisation(organisationId, allOrganisations);
  const track = params?.track ?? "all";
  const trackQuery = track === "all" ? "" : `track=${track}`;
  const listed = { userId: user.id, ...scope, ...notificationTrackWhere(track) };
  const totalCount = await prisma.notification.count({ where: listed });
  const pagination = calculatePagination({ page: params?.page, pageSize: PAGE_SIZE, totalCount });
  const [notifications, unread, organisationCount] = await Promise.all([
    prisma.notification.findMany({
      where: listed,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: pagination.skip,
      take: pagination.take,
      select: { id: true, title: true, organisation: { select: { name: true } }, readAt: true, createdAt: true },
    }),
    prisma.notification.count({ where: { ...listed, readAt: null } }),
    prisma.membership.count({ where: { userId: user.id } }),
  ]);

  const scopePill = (active: boolean) =>
    `inline-flex h-9 items-center rounded-full px-3.5 text-sm font-semibold transition-colors ${
      active
        ? "bg-zk-info-bg font-bold text-zk-info-fg"
        : "text-zk-muted hover:bg-zk-chip hover:text-zk-text"
    }`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-zk-text">Notifications</h2>
          <p className="mt-1 text-sm text-zk-muted">
            {unread === 0 ? "You're all caught up." : `${unread} unread`}
          </p>
        </div>
        {unread > 0 ? <MarkAllReadButton allOrganisations={allOrganisations} track={track} /> : null}
      </div>

      {organisationCount > 1 ? (
        <nav className="flex gap-1.5" aria-label="Notification organisations">
          <Link
            href={trackQuery ? `/inbox?${trackQuery}` : "/inbox"}
            aria-current={!allOrganisations ? "page" : undefined}
            className={scopePill(!allOrganisations)}
          >
            This organisation
          </Link>
          <Link
            href={`/inbox?scope=all${trackQuery ? `&${trackQuery}` : ""}`}
            aria-current={allOrganisations ? "page" : undefined}
            className={scopePill(allOrganisations)}
          >
            All organisations
          </Link>
        </nav>
      ) : null}

      {notifications.length === 0 ? (
        <div className="rounded-panel border border-dashed border-zk-border bg-zk-surface p-6 text-sm text-zk-muted">
          <p className="font-semibold text-zk-text">
            {track === "all" ? "No notifications yet" : `No ${track} notifications`}
          </p>
          <p className="mt-1">
            New comments, mentions, assignments and status changes on issues
            you&apos;re watching will show up here.
          </p>
          <Link href="/home" className="mt-3 inline-flex text-sm font-semibold text-zk-accent hover:underline">
            Go to issues
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-zk-divider overflow-hidden rounded-panel border border-zk-border bg-zk-surface">
          {notifications.map((n) => {
            const unreadItem = !n.readAt;
            return (
              <li key={n.id}>
                {/* A plain link, not <Link>: prefetching would mark it read. */}
                <a
                  href={`${BASE_PATH}/inbox/notifications/${n.id}`}
                  className={`flex items-start gap-3 px-4 py-3 text-sm transition-colors hover:bg-zk-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-electric-blue ${
                    unreadItem ? "bg-zk-tint/50" : ""
                  }`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unreadItem ? "bg-electric-blue-strong" : "bg-transparent"}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block break-words ${unreadItem ? "font-semibold text-zk-text" : "text-zk-text2"}`}>
                      {unreadItem ? <span className="sr-only">Unread: </span> : null}
                      {n.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-zk-muted">
                      <LocalTime date={n.createdAt} />
                    </span>
                    {organisationCount > 1 && n.organisation ? (
                      <span className="mt-1 block text-xs text-zk-muted">{n.organisation.name}</span>
                    ) : null}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {pagination.totalCount > 0 ? (
        <PaginationControls
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalCount={pagination.totalCount}
          from={pagination.from}
          to={pagination.to}
          queryParams={{ scope: allOrganisations ? "all" : undefined, track: track === "all" ? undefined : track }}
          basePath="/inbox"
          itemLabel="notification"
        />
      ) : null}
    </div>
  );
}
