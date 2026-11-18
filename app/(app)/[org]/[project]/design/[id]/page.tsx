import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireProject } from "@/lib/project-route";
import { issuePath } from "@/lib/issue-ref";
import { loadDesignProposal } from "@/lib/redesign-read";
import { designDecisionsFor, designWaitingNote } from "@/lib/design-view";
import { LocalTime } from "@/components/local-time";
import { RichText } from "@/components/rich-text";
import { DesignDecisionButtons } from "@/components/design-decision-buttons";
import { DesignStatusChip, PreviewLink, mockupSrc } from "../design-ui";

export const metadata = { title: "Design proposal" };

type Props = { params: Promise<{ org: string; project: string; id: string }> };

/**
 * `/<org>/<project>/design/<id>` (#9): one redesign proposal, its preview and
 * its mockups at full size, and the decision. An organisation owner or admin
 * approves or rejects one with no issue, and chooses or rejects one for an
 * issue; never the owner of the agent that proposed it (`designDecisionsFor`,
 * the rule `decideRedesign` enforces). Old `/redesigns/<id>` links land here.
 */
export default async function DesignProposalPage({ params }: Props) {
  const { org, project: slug, id } = await params;
  const { user, organisationId, project, isOrgMember } = await requireProject(org, slug);
  if (!isOrgMember) notFound();
  const [proposal, membership] = await Promise.all([
    loadDesignProposal({ organisationId, projectId: project.id }, id),
    prisma.membership.findUnique({ where: { organisationId_userId: { organisationId, userId: user.id } }, select: { role: true } }),
  ]);
  if (!proposal) notFound();

  const viewer = { userId: user.id, membershipRole: membership?.role ?? null };
  const author = { authorOwnerId: proposal.authorAgent.ownerUserId };
  const decisions = designDecisionsFor({ status: proposal.status, bugId: proposal.bugId, ...author }, viewer);
  const waiting = proposal.status === "proposed";
  // A proposal only takes images (lib/redesigns.ts), so every attachment is a mockup.
  const mockups = proposal.attachments;
  const issueLink = proposal.bug ? issuePath(project.ref, proposal.bug.number) : null;

  return (
    <article className="mx-auto w-full max-w-6xl space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <DesignStatusChip status={proposal.status} linked={Boolean(proposal.bugId)} />
          <span className="text-xs text-zk-muted">
            Proposed <LocalTime date={proposal.createdAt} />
          </span>
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-zk-text [overflow-wrap:anywhere]">{proposal.title}</h1>
        <p className="text-sm text-zk-text2">
          By {proposal.authorAgent.name} for {proposal.onBehalfOf.name}
        </p>
      </header>

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        {/* The decision and the facts come first on a phone, beside the design on a wide screen. */}
        <aside className="space-y-4 lg:col-start-2 lg:row-start-1">
          <section aria-labelledby="design-decision-heading" className="space-y-3 rounded-[20px] border border-zk-border bg-zk-surface p-4 sm:p-5">
            <h2 id="design-decision-heading" className="text-sm font-bold text-zk-text">Decision</h2>
            {waiting ? (
              decisions.length ? (
                <>
                  <p className="text-sm text-zk-text2">
                    {proposal.bugId
                      ? "Choosing it makes it the design for its issue, and the issue's other waiting designs are superseded. The issue can't be claimed until a design is chosen or every one is rejected."
                      : "Approve it to tell the agent to go ahead, or reject it."}
                  </p>
                  <DesignDecisionButtons id={proposal.id} decisions={decisions} />
                </>
              ) : (
                <p className="text-sm text-zk-text2">{designWaitingNote(author, viewer)}</p>
              )
            ) : proposal.status === "approved" ? (
              <p className="text-sm text-zk-text2">
                {proposal.bugId ? "Chosen for its issue" : "Approved"} by {proposal.approver?.name ?? "an organisation admin"}
                {proposal.approvedAt ? <> <LocalTime date={proposal.approvedAt} /></> : null}.
              </p>
            ) : proposal.status === "rejected" ? (
              <p className="text-sm text-zk-text2">Rejected <LocalTime date={proposal.updatedAt} />.</p>
            ) : (
              <p className="text-sm text-zk-text2">
                Superseded <LocalTime date={proposal.updatedAt} />: another design was chosen for its issue.
              </p>
            )}
          </section>

          <section aria-label="About this design" className="space-y-3 rounded-[20px] border border-zk-border bg-zk-surface p-4 text-sm sm:p-5">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">Issue</h2>
              {proposal.bug && issueLink ? (
                <>
                  <Link href={issueLink} className="mt-1 block font-semibold text-zk-accent hover:underline [overflow-wrap:anywhere]">
                    #{proposal.bug.number} {proposal.bug.title}
                  </Link>
                  <p className="mt-1 text-xs text-zk-muted">The issue page compares every design proposed for it.</p>
                </>
              ) : (
                <p className="mt-1 text-zk-text2">Not linked to an issue.</p>
              )}
            </div>
            <div>
              <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">Preview</h2>
              {proposal.previewUrl ? <PreviewLink url={proposal.previewUrl} className="mt-1 inline-flex max-w-full items-center gap-1 font-semibold text-zk-accent hover:underline" /> : <p className="mt-1 text-zk-text2">No live preview.</p>}
            </div>
          </section>
        </aside>

        <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-start-1">
          <section aria-label="Proposal" className="rounded-[20px] border border-zk-border bg-zk-surface p-5 sm:p-6">
            <RichText content={proposal.body} className="mt-0! max-w-[75ch] text-zk-text" />
          </section>

          <section aria-labelledby="design-mockups-heading" className="space-y-3">
            <h2 id="design-mockups-heading" className="text-base font-bold text-zk-text">
              Mockups <span className="font-mono text-xs font-normal text-zk-muted">{mockups.length}</span>
            </h2>
            {mockups.length ? (
              <ul className="m-0 flex list-none flex-col gap-4 p-0">
                {mockups.map((file) => (
                  <li key={file.id}>
                    <figure className="m-0 overflow-hidden rounded-[20px] border border-zk-border bg-zk-surface">
                      <a href={mockupSrc(file.id)} target="_blank" rel="noreferrer" className="block bg-zk-chip">
                        {/* eslint-disable-next-line @next/next/no-img-element -- served by our own auth-checked route */}
                        <img src={mockupSrc(file.id)} alt={`Mockup: ${file.filename}`} loading="lazy" className="mx-auto h-auto max-h-[80vh] w-auto max-w-full object-contain" />
                      </a>
                      <figcaption className="flex items-center justify-between gap-3 border-t border-zk-divider px-4 py-2 text-xs text-zk-muted">
                        <span className="truncate">{file.filename}</span>
                        <a href={mockupSrc(file.id)} target="_blank" rel="noreferrer" className="shrink-0 font-semibold text-zk-accent hover:underline">
                          Open full size ↗
                        </a>
                      </figcaption>
                    </figure>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-[20px] border border-zk-border bg-zk-surface p-5 text-sm text-zk-text2">The agent added no mockups.</p>
            )}
          </section>
        </div>
      </div>
    </article>
  );
}
