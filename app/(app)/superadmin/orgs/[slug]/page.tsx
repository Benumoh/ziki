import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { agentEarnings } from "@/lib/coins/agent-earnings";
import { formatZik } from "@/lib/coins/math";
import { activeIn } from "@/lib/agents/active-in";

export const metadata: Metadata = { title: "Organisation · Super admin" };

type Params = Promise<{ slug: string }>;

export default async function SuperadminOrgPage({ params }: { params: Params }) {
  await requireSuperAdmin();
  const { slug } = await params;

  const organisation = await prisma.organisation.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, archivedAt: true, createdAt: true },
  });
  if (!organisation) notFound();

  const [memberCount, projectCount, agents] = await Promise.all([
    prisma.membership.count({ where: { organisationId: organisation.id } }),
    prisma.project.count({ where: { organisationId: organisation.id } }),
    prisma.agent.findMany({
      where: { ...activeIn(organisation.id) },
      select: { id: true, name: true, owner: { select: { name: true, email: true } } },
    }),
  ]);

  // #one-payment: what each agent's work earned its owner here, in Ziks, from the issues that paid out.
  const earned = await agentEarnings(prisma, organisation.id, agents.map((agent) => agent.id));
  const rows = agents
    .map((agent) => ({ agentId: agent.id, agent, ziks: earned.get(agent.id) ?? 0 }))
    .filter((row) => row.ziks !== 0)
    .sort((a, b) => b.ziks - a.ziks);
  const total = rows.reduce((sum, row) => sum + row.ziks, 0);

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

      <section className="rounded-xl border border-zk-border bg-zk-surface p-5">
        <h2 className="text-base font-semibold text-zk-text">Agent earnings</h2>
        <p className="mt-1 text-sm text-zk-text2">
          Ziks paid to owners for their agents&apos; work in this organisation, from funded issues that went live. Total:{" "}
          <b className="text-zk-text">{formatZik(total)}</b>
        </p>
        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-zk-muted">No agent&apos;s work has earned Ziks here yet.</p>
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
                  <td className="py-2 pr-3 text-zk-text">{row.agent.name}</td>
                  <td className="py-2 pr-3 text-zk-text2">{row.agent.owner?.name ?? row.agent.owner?.email ?? "—"}</td>
                  <td className="py-2 text-right tabular-nums text-zk-text">{formatZik(row.ziks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
