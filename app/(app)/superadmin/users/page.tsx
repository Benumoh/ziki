import Link from "next/link";
import { Suspense } from "react";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { toSingleQueryParam } from "@/lib/search";
import { buildUserSearchWhere } from "@/lib/user-search";
import { LocalTime } from "@/components/local-time";
import { Avatar } from "@/components/avatar";
import { SiteRoleActions } from "@/components/site-role-actions";
import { UserSearch } from "@/components/user-search";
import { PaginationControls } from "@/components/pagination-controls";
import { calculatePagination } from "@/lib/pagination";

/* Distinct browser-tab title; the root layout appends the site name. */
export const metadata = { title: "Site admin" };

/**
 * Site staff only: every account on the site and its site-wide role. An
 * organisation's members, their roles and their agents are managed by that
 * organisation's owners and admins in /org, not here.
 */
const USERS_PER_PAGE = 25;

type SearchParams = Promise<{
  q?: string | string[];
  page?: string | string[];
  [key: string]: string | string[] | undefined;
}>;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const actor = await requireSuperAdmin();

  const params = searchParams ? await searchParams : {};
  const query = toSingleQueryParam(params.q)?.trim() ?? "";

  const where = buildUserSearchWhere(query);
  const totalCount = await prisma.user.count({ where });
  const pagination = calculatePagination({
    page: params.page,
    pageSize: USERS_PER_PAGE,
    totalCount,
  });

  const users = await prisma.user.findMany({
    where,
    // Staff first (the Role enum is declared user, admin, super_admin), then by name.
    orderBy: [{ role: "desc" }, { name: "asc" }],
    skip: pagination.skip,
    take: pagination.take,
    select: { id: true, name: true, email: true, image: true, role: true, createdAt: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zk-text sm:text-2xl">Site admin</h1>
          <p className="mt-1 max-w-2xl text-sm text-zk-text2">
            Every account on the site and its site role, which applies across all organisations.
            Organisation roles, members and agents are managed by each organisation&apos;s owners
            and admins on its Organisation page.
          </p>
          <p className="mt-2 text-sm">
            <Link href="/superadmin/rewards" className="font-medium text-zk-accent hover:underline">
              Platform rewards
            </Link>
          </p>
        </div>
        <div className="w-full sm:w-auto">
          <Suspense
            fallback={<div className="h-9 w-full animate-pulse rounded-lg bg-slate-100 sm:w-64" />}
          >
            <UserSearch />
          </Suspense>
        </div>
      </div>

      <div className="overflow-x-auto rounded-panel border border-zk-border bg-zk-surface">
        {users.length > 0 ? (
          <table className="min-w-full divide-y divide-zk-border text-sm">
            <thead className="bg-zk-tint text-left text-xs font-semibold uppercase tracking-wide text-zk-muted">
              <tr>
                <th className="whitespace-nowrap px-4 py-3">User</th>
                <th className="whitespace-nowrap px-4 py-3">Site role</th>
                <th className="whitespace-nowrap px-4 py-3">Signed up</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zk-divider">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-zk-tint/80">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={user.name} image={user.image} size="md" />
                      <div className="min-w-0">
                        <div className="font-medium text-zk-text">{user.name}</div>
                        <div className="break-all text-xs text-zk-muted sm:text-sm">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <SiteRoleActions
                      userId={user.id}
                      userName={user.name}
                      siteRole={user.role}
                      disabled={user.id === actor.id || user.role === "super_admin"}
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-zk-text2">
                    <LocalTime date={user.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : query ? (
          <div className="px-4 py-12 text-center">
            <p className="font-medium text-zk-text">No account matching &ldquo;{query}&rdquo;</p>
            <Link
              href="/superadmin/users"
              className="mt-3 inline-flex text-sm font-medium text-zk-accent hover:underline"
            >
              Clear search
            </Link>
          </div>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-zk-muted">No accounts yet.</p>
        )}
      </div>

      <PaginationControls
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalCount={pagination.totalCount}
        from={pagination.from}
        to={pagination.to}
        queryParams={{ q: query || undefined }}
        basePath="/superadmin/users"
        itemLabel="user"
      />
    </div>
  );
}
