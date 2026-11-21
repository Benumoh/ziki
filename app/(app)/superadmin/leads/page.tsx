import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { LocalTime } from "@/components/local-time";
import { PaginationControls } from "@/components/pagination-controls";
import { calculatePagination } from "@/lib/pagination";

/* Distinct browser-tab title; the root layout appends the site name. */
export const metadata = { title: "Leads" };

const LEADS_PER_PAGE = 50;

/** Site staff only: the people who left their details on a public page (#how-it-works-leads), newest first. */
export default async function LeadsPage({ searchParams }: { searchParams?: Promise<{ page?: string | string[] }> }) {
  await requireSuperAdmin();
  const params = searchParams ? await searchParams : {};
  const totalCount = await prisma.lead.count();
  const pagination = calculatePagination({ page: params.page, pageSize: LEADS_PER_PAGE, totalCount });
  const leads = await prisma.lead.findMany({
    orderBy: { updatedAt: "desc" },
    skip: pagination.skip,
    take: pagination.take,
    select: { id: true, email: true, name: true, goal: true, source: true, updatedAt: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zk-text sm:text-2xl">Leads</h1>
        <p className="mt-1 max-w-2xl text-sm text-zk-text2">
          People who left their details on a public page. A later form from the same email updates their row.
        </p>
      </div>

      <div className="overflow-x-auto rounded-panel border border-zk-border bg-zk-surface">
        {leads.length > 0 ? (
          <table className="min-w-full divide-y divide-zk-border text-sm">
            <thead className="bg-zk-tint text-left text-xs font-semibold uppercase tracking-wide text-zk-muted">
              <tr>
                <th className="whitespace-nowrap px-4 py-3">Person</th>
                <th className="px-4 py-3">What they want</th>
                <th className="whitespace-nowrap px-4 py-3">Form</th>
                <th className="whitespace-nowrap px-4 py-3">Last sent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zk-divider">
              {leads.map((lead) => (
                <tr key={lead.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-zk-text">{lead.name ?? "No name given"}</div>
                    <a href={`mailto:${lead.email}`} className="break-all text-xs text-zk-accent hover:underline sm:text-sm">{lead.email}</a>
                  </td>
                  <td className="max-w-md whitespace-pre-wrap px-4 py-3 text-zk-text2">{lead.goal ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-zk-muted">{lead.source}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-zk-text2"><LocalTime date={lead.updatedAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-zk-muted">No leads yet.</p>
        )}
      </div>

      <PaginationControls
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalCount={pagination.totalCount}
        from={pagination.from}
        to={pagination.to}
        queryParams={{}}
        basePath="/superadmin/leads"
        itemLabel="lead"
      />
    </div>
  );
}
