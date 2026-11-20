import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { agentPointsToReverse } from "@/lib/points/reset-agent-points";
import { ResetAgentPointsForm } from "@/components/superadmin-reset-points-form";
import { resetAgentPointsAction } from "../actions";

import { formatZ } from "@/lib/points/rules";
import { activeIn } from "@/lib/agents/active-in";

export const metadata: Metadata = { title: "Organisation · Super admin" };

/** $, Ziki's one currency (#z-currency). */
const formatPoints = formatZ;

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<{ reversed?: string }>;

export default async function SuperadminOrgPage({ params, searchParams }: { params: Params; searchParams?: SearchParams }) {
  await requireSuperAdmin();
  const { slug } = await params;
  const query = searchParams ? await searchParams : {};

  const organisation = await prisma.organisation.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, archivedAt: true, createdAt: true },
  });
  if (!organisation) notFound();

  const [memberCount, projectCount, agents, earnings, reversible] = await Promise.all([
    prisma.membership.count({ where: { organisationId: organisation.id } }),
    prisma.project.count({ where: { organisationId: organisation.id } }),
    prisma.agent.findMany({
      where: { ...activeIn(organisation.id) },
      select: { id: true, name: true, owner: { select: { name: true, email: true } } },
    }),
    prisma.pointEntry.groupBy({
      by: ["agentId"],
      where: { organisationId: organisation.id, agentId: { not: null } },
      _sum: { points: true },
    }),
    prisma.pointEntry.aggregate({
      where: agentPointsToReverse(organisation.id),
      _count: { _all: true },
      _sum: { points: true },
    }),
  ]);

  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const rows = earnings
    .map((row) => ({
      agentId: row.agentId as string,
      agent: agentById.get(row.agentId as string),
      balance: Number(row._sum.points ?? 0),
    }))
    .sort((a, b) => b.balance - a.balance);
  const totalBalance = rows.reduce((sum, row) => sum + row.balance, 0);
  const reversibleCount = reversible._count._all;
  const justReversed = query.reversed !== undefined ? Number(query.reversed) : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-zk-muted">
          <Link href="/superadmin/orgs" className="hover:underline">Organisations</Link> / {organisation.name}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-zk-text sm:text-2xl">
          {organisation.name}
          {organisation.archivedAt ? <span className="ml-2 align-middle text-sm font-normal text-zk-muted">(archived)</span> : null}
        </h1>
        <p className="mt-1 text-sm text-zk-text2"><code>{organisation.slug}</code></p>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Users", value: memberCount },
          { label: "Agents", value: agents.length },
          { label: "Projects", value: projectCount },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-zk-border bg-zk-surface px-4 py-3">
            <dt className="text-sm text-zk-muted">{stat.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-zk-text">{stat.value}</dd>
          </div>
        ))}
      </dl>

      {justReversed !== null ? (
        <p role="status" className="rounded-lg border border-zk-ok-fg bg-zk-ok-bg px-4 py-3 text-sm text-zk-ok-fg">
          Reset done: {justReversed} {justReversed === 1 ? "entry was" : "entries were"} reversed.
        </p>
      ) : null}

      <section className="rounded-xl border border-zk-border bg-zk-surface p-5">
        <h2 className="text-base font-semibold text-zk-text">Agent $</h2>
        <p className="mt-1 text-sm text-zk-text2">
          $ earned by agents&apos; work in this organisation, corrections included. Total: <b className="text-zk-text">{formatPoints(totalBalance)}</b>
        </p>
        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-zk-muted">No agent has earned $ here.</p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-zk-divider text-left text-zk-muted">
                <th className="py-2 pr-3 font-medium">Agent</th>
                <th className="py-2 pr-3 font-medium">Owner</th>
                <th className="py-2 text-right font-medium">Ziks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.agentId} className="border-b border-zk-divider last:border-0">
                  <td className="py-2 pr-3 text-zk-text">{row.agent?.name ?? "Deleted agent"}</td>
                  <td className="py-2 pr-3 text-zk-text2">{row.agent?.owner?.name ?? row.agent?.owner?.email ?? "—"}</td>
                  <td className="py-2 text-right tabular-nums text-zk-text">{formatPoints(row.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-xl border border-zk-bad-bd bg-zk-bad-bg p-5">
        <h2 className="text-base font-semibold text-zk-bad-fg">Reset all agent $</h2>
        <p className="mt-1 text-sm text-zk-text2">
          Reverses all the $ an agent earned in {organisation.name}: {reversibleCount} {reversibleCount === 1 ? "entry" : "entries"},{" "}
          {formatPoints(Number(reversible._sum.points ?? 0))}. Nothing is deleted: each entry gets a correcting entry, so the
          history stays and running it again changes nothing. People&apos;s own $ is not touched.
        </p>
        <ResetAgentPointsForm action={resetAgentPointsAction} slug={organisation.slug} name={organisation.name} disabled={reversibleCount === 0} />
      </section>
    </div>
  );
}
