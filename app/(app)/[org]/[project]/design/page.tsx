import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProject } from "@/lib/project-route";
import { designPath } from "@/lib/project-paths";
import { issuePath } from "@/lib/issue-ref";
import { loadDesignList } from "@/lib/redesign-read";
import { DESIGN_VIEWS, designViewOf } from "@/lib/design-view";
import { LocalTime } from "@/components/local-time";
import { DesignStatusChip, PreviewLink, mockupSrc } from "./design-ui";

export const metadata = { title: "Design" };

type Props = {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ view?: string | string[]; cursor?: string | string[] }>;
};

/**
 * `/<org>/<project>/design` (#9): the redesigns agents proposed for this
 * project, with their status, linked issue, preview and mockups. Waiting,
 * Decided and All, as on Escalations. Only members of the project's
 * organisation see it, as only they may open the mockups; anyone else gets the
 * project's 404.
 */
export default async function DesignPage({ params, searchParams }: Props) {
  const { org, project: slug } = await params;
  const { organisationId, project, isOrgMember } = await requireProject(org, slug);
  if (!isOrgMember) notFound();
  const query = await searchParams;
  const view = designViewOf(query.view);
  const cursor = Array.isArray(query.cursor) ? query.cursor[0] : query.cursor;
  const { items, nextCursor, counts } = await loadDesignList({ organisationId, projectId: project.id }, view, cursor);
  const viewHref = (value: string, next?: string) =>
    designPath(project.ref, undefined, new URLSearchParams({ ...(value === "waiting" ? {} : { view: value }), ...(next ? { cursor: next } : {}) }));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div>
        <h1 className="text-lg font-extrabold tracking-tight text-zk-text">Design</h1>
        <p className="mt-1 max-w-3xl text-sm text-zk-text2">
          Redesigns your organisation&apos;s agents proposed for {project.name}. An organisation owner or admin approves or rejects each one,
          or chooses the design for an issue, but never the owner of the agent that proposed it.
        </p>
      </div>

      <nav aria-label="Filter designs" className="flex flex-wrap items-center gap-1.5">
        {DESIGN_VIEWS.map(({ value, label }) => {
          const on = view === value;
          return (
            <Link
              key={value}
              href={viewHref(value)}
              aria-current={on ? "page" : undefined}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent ${
                on ? "border-electric-blue-strong bg-electric-blue-strong text-white" : "border-zk-border bg-zk-surface text-zk-text2 hover:text-zk-text"
              }`}
            >
              {label}
              <span className={`font-mono text-[11px] tabular-nums ${on ? "text-white/80" : "text-zk-muted"}`}>{counts[value]}</span>
            </Link>
          );
        })}
      </nav>

      {items.length ? (
        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2">
          {items.map((proposal) => {
            const href = designPath(project.ref, proposal.id);
            const mockups = proposal.attachments.filter((file) => file.contentType.startsWith("image/"));
            return (
              <li key={proposal.id} className="flex min-w-0 flex-col gap-3 rounded-[20px] border border-zk-border bg-zk-surface p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <DesignStatusChip status={proposal.status} linked={Boolean(proposal.bugId)} />
                  <LocalTime date={proposal.createdAt} className="text-xs text-zk-muted" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-zk-text [overflow-wrap:anywhere]">
                    <Link href={href} className="hover:text-zk-accent hover:underline">{proposal.title}</Link>
                  </h2>
                  <p className="mt-0.5 text-xs text-zk-muted">
                    By {proposal.authorAgent.name} for {proposal.onBehalfOf.name}
                  </p>
                </div>
                {mockups.length ? (
                  <Link href={href} aria-label={`${proposal.title}: ${mockups.length === 1 ? "1 mockup" : `${mockups.length} mockups`}`} className="grid grid-cols-3 gap-2">
                    {mockups.slice(0, 3).map((file) => (
                      // eslint-disable-next-line @next/next/no-img-element -- served by our own auth-checked route
                      <img key={file.id} src={mockupSrc(file.id)} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-lg border border-zk-border bg-zk-chip object-cover" />
                    ))}
                  </Link>
                ) : (
                  <p className="m-0 text-xs text-zk-muted">No mockups.</p>
                )}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-zk-divider pt-3 text-xs">
                  {proposal.bug ? (
                    <Link href={issuePath(project.ref, proposal.bug.number)} className="min-w-0 truncate font-semibold text-zk-accent hover:underline">
                      Issue #{proposal.bug.number} {proposal.bug.title}
                    </Link>
                  ) : (
                    <span className="text-zk-muted">Not linked to an issue</span>
                  )}
                  <PreviewLink url={proposal.previewUrl} className="inline-flex shrink-0 items-center gap-1 font-semibold text-zk-accent hover:underline" />
                </div>
                <Link href={href} className="text-sm font-semibold text-zk-accent hover:underline">
                  {proposal.status === "proposed" ? "Review the design →" : "Open the design →"}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-[20px] border border-zk-border bg-zk-surface px-4 py-12 text-center">
          <p className="font-bold text-zk-text">
            {view === "waiting" ? "No design is waiting for a decision." : view === "decided" ? "No design has been decided yet." : "No designs yet."}
          </p>
          <p className="mx-auto mt-1.5 max-w-xl text-sm text-zk-muted">
            Agents propose redesigns with a preview and mockups through the agent API (<code>POST /api/v1/redesigns</code>); they show here for people to decide.
          </p>
        </div>
      )}

      {nextCursor || cursor ? (
        <div className="flex flex-wrap gap-4 text-sm">
          {nextCursor ? <Link href={viewHref(view, nextCursor)} className="font-semibold text-zk-accent hover:underline">Older designs →</Link> : null}
          {cursor ? <Link href={viewHref(view)} className="text-zk-accent hover:underline">Newest designs</Link> : null}
        </div>
      ) : null}
    </div>
  );
}
