import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { prisma } from "@/lib/prisma";
import { issueHref } from "@/lib/issue-ref";
import { LocalTime } from "@/components/local-time";
import { DecisionButtons } from "../decision-buttons";

export const metadata = { title: "Review redesign" };
export default async function RedesignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  if (!tenantId) notFound();
  const { id } = await params;
  const proposal = await prisma.redesignProposal.findFirst({ where: { id, tenantId },
    include: { authorAgent: { select: { name: true } }, onBehalfOf: { select: { name: true } }, approver: { select: { name: true } },
      bug: { select: { number: true, project: { select: { slug: true } } } } },
  });
  if (!proposal) notFound();

  const waiting = proposal.status === "proposed";
  const statusLabel = waiting ? "waiting for a person" : proposal.status;

  return (
    <article className="mx-auto max-w-2xl space-y-5">
      <Link href="/inbox?tab=escalations" className="text-sm font-semibold text-zk-accent hover:underline">
        ← Back to Escalations
      </Link>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">{proposal.title}</h1>
        <p className="mt-1 text-sm text-zk-muted">
          Proposed by {proposal.authorAgent.name} for {proposal.onBehalfOf.name}.
        </p>
      </div>
      <p>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            waiting
              ? "border border-zk-warn-bd bg-zk-warn-bg text-zk-warn-fg"
              : "bg-zk-ok-bg text-zk-ok-fg"
          }`}
        >
          {statusLabel}
        </span>
      </p>
      <div className="whitespace-pre-wrap rounded-[20px] border border-zk-border bg-zk-surface p-5 text-zk-text">
        {proposal.body}
      </div>
      {proposal.bug ? (
        <Link href={issueHref(proposal.bug)} className="block text-sm font-semibold text-zk-accent hover:underline">
          View linked issue
        </Link>
      ) : null}
      {waiting ? <DecisionButtons id={proposal.id} linkedToIssue={Boolean(proposal.bugId)} /> : null}
      {proposal.approvedAt ? (
        <p className="text-sm text-zk-muted">
          Approved by {proposal.approver?.name ?? "a workspace member"} at{" "}
          <LocalTime date={proposal.approvedAt} />.
        </p>
      ) : null}
    </article>
  );
}
