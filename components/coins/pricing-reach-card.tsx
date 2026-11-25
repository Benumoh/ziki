import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { payerIds } from "@/lib/coins/payers";
import { OpenToAgentsButton } from "./open-to-agents-button";
import { SoloButton } from "./solo-button";

/**
 * Whether anyone can price this project's issues (#price-lock). The organisation's payers (#payers) pay for its issues,
 * so they and their agents don't estimate them; a price needs a member who doesn't pay (an admin who doesn't included),
 * or an agent whose owner doesn't, or the project open to agents on Ziki, who find it on Discover and join.
 */
export async function nobodyCanPrice(projectId: string): Promise<boolean> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { organisationId: true, visibility: true, isOpenForContributors: true } });
  if (!project || (project.visibility === "public" && project.isOpenForContributors)) return false;
  const payers = await payerIds(prisma, project.organisationId);
  const [member, agent] = await Promise.all([
    prisma.membership.findFirst({ where: { organisationId: project.organisationId, userId: { notIn: payers } }, select: { id: true } }),
    prisma.agentActivation.findFirst({
      where: {
        organisationId: project.organisationId,
        deactivatedAt: null,
        guestEndedAt: null,
        agent: { revokedAt: null, ownerUserId: { notIn: payers } },
      },
      select: { id: true },
    }),
  ]);
  return !member && !agent;
}

/**
 * On the Overview, for an owner or admin, once the project has work in it and nobody else can work on it: asks who will
 * (#solo). Just them and their own agents (Solo: tasks start at once, no prices or funding), or agents on Ziki (the
 * project opens, other people's agents price each task, the owner funds it). A Solo project shows a short line saying
 * so instead. Draws nothing otherwise.
 */
export async function PricingReachCard({ projectId }: { projectId: string }) {
  const [hasWork, unreachable, project] = await Promise.all([
    Promise.all([
      prisma.bug.findFirst({ where: { projectId, isDeleted: false }, select: { id: true } }),
      prisma.idea.findFirst({ where: { projectId, isDeleted: false }, select: { id: true } }),
    ]).then(([bug, idea]) => Boolean(bug || idea)),
    nobodyCanPrice(projectId),
    prisma.project.findUnique({ where: { id: projectId }, select: { solo: true } }),
  ]);
  if (project?.solo) {
    return (
      <section aria-label="Solo project" className="mx-auto mb-4 flex w-full max-w-[920px] flex-wrap items-center justify-between gap-3 rounded-xl border border-zk-border bg-zk-surface px-5 py-3" data-testid="solo-project">
        <p className="m-0 text-sm text-zk-text2">
          <b className="font-semibold text-zk-text">Solo</b> · just you and your own agents. Tasks start straight away, with no prices or funding.
        </p>
        <SoloButton projectId={projectId} solo={false} label="Turn off Solo" primary={false} />
      </section>
    );
  }
  if (!hasWork || !unreachable) return null;
  return (
    <section aria-label="Who works on this project" className="mx-auto mb-4 flex w-full max-w-[920px] flex-col gap-4 rounded-xl border border-zk-border bg-zk-surface px-5 py-4" data-testid="pricing-reach">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[15px] font-bold text-zk-text">Who will work on your tasks?</h2>
        <p className="m-0 text-sm text-zk-text2">This project is private, so nobody else can see it yet. Choose how you want to work.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-lg border border-zk-border px-4 py-3">
          <p className="m-0 text-sm font-bold text-zk-text">Just me and my agents</p>
          <p className="m-0 text-sm text-zk-text2">
            Solo: your own agent checks each task and starts on it straight away. No prices, no funding, nothing to pay.
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
            <SoloButton projectId={projectId} solo label="Work Solo" />
            <Link href="/settings/connect" className="text-sm font-semibold text-zk-accent hover:underline">Connect your agent</Link>
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-zk-border px-4 py-3">
          <p className="m-0 text-sm font-bold text-zk-text">Agents on Ziki</p>
          <p className="m-0 text-sm text-zk-text2">
            Other people&apos;s agents find your project, price each task, and once you fund it, one of them does the work.
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
            <OpenToAgentsButton projectId={projectId} />
          </div>
        </div>
      </div>
    </section>
  );
}
