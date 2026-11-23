import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { listOwnerQuestions, parseEscalationBody } from "@/lib/agent-questions";
import { issueHref } from "@/lib/issue-ref";
import type { WorkTrack } from "@prisma/client";
import { escalationOnTrack, escalationTrackWhere } from "@/lib/my-work-filter";
import { LocalTime } from "@/components/local-time";
import { EscalationTypeBadge, QuickResolveButtons } from "./escalation-controls";

const VIEWS = [
  { value: "waiting", label: "Waiting" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
] as const;
type View = (typeof VIEWS)[number]["value"];

/**
 * Where agents stop for a person: questions your agents ask you, and redesign
 * proposals waiting on a decision. Opened from the envelope in the top bar.
 */
export async function EscalationsView({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; track?: WorkTrack | "all" }>;
}) {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  const params = searchParams ? await searchParams : {};
  const track = params.track ?? "all";
  const [questions, proposals] = organisationId
    ? await Promise.all([
        listOwnerQuestions(user.id, organisationId, track),
        prisma.redesignProposal.findMany({
          where: { organisationId, ...escalationTrackWhere(track) },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 50,
          select: {
            id: true,
            title: true,
            body: true,
            status: true,
            createdAt: true,
            bug: { select: { number: true, title: true, track: true, project: { select: { slug: true, organisation: { select: { slug: true } } } } } },
            authorAgent: { select: { name: true } },
          },
        }),
      ])
    : [[], []];

  const view: View = VIEWS.some((v) => v.value === params.status) ? (params.status as View) : "waiting";
  const trackQuery = track === "all" ? "" : `&track=${track}`;

  const rows = [
    ...questions.map((q) => {
      const parsed = parseEscalationBody(q.body);
      return {
        id: q.id,
        kind: "question" as const,
        type: parsed.type as string,
        title: q.agent.name,
        byline: null as string | null,
        body: parsed.cleanBody,
        createdAt: q.createdAt,
        waiting: !q.answeredAt,
        answer: q.answer,
        bug: q.bug,
        href: `/inbox/escalations/${q.id}`,
      };
    }),
    ...proposals.map((p) => ({
      id: p.id,
      kind: "redesign" as const,
      type: "Redesign",
      title: p.title,
      byline: p.authorAgent.name as string | null,
      body: p.body,
      createdAt: p.createdAt,
      waiting: p.status === "proposed",
      answer: null,
      bug: p.bug,
      // Designs are compared and chosen on their issue's page.
      href: p.bug ? issueHref(p.bug, "#redesigns") : "/inbox?tab=escalations",
    })),
  ]
    .filter((row) => escalationOnTrack(row.bug, track))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));

  const waitingCount = rows.filter((row) => row.waiting).length;
  const counts: Record<View, number> = { waiting: waitingCount, resolved: rows.length - waitingCount, all: rows.length };
  const shown = rows.filter((row) => (view === "waiting" ? row.waiting : view === "resolved" ? !row.waiting : true));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-bold text-zk-text">Escalations</h2>
        <p className="mt-1 text-sm text-zk-muted">Questions your agents need answered, and redesign proposals waiting on a decision.</p>
      </div>

      <nav aria-label="Filter escalations" className="flex flex-wrap items-center gap-1.5">
        {VIEWS.map(({ value, label }) => {
          const on = view === value;
          return (
            <Link
              key={value}
              href={value === "waiting" ? `/inbox?tab=escalations${trackQuery}` : `/inbox?tab=escalations&status=${value}${trackQuery}`}
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

      {shown.length > 0 ? (
        <ul className="m-0 flex list-none flex-col divide-y divide-zk-divider overflow-hidden rounded-panel border border-zk-border bg-zk-surface p-0">
          {shown.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="flex flex-col gap-3 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <EscalationTypeBadge type={item.type} />
                  <Link href={item.href} className="font-semibold text-zk-accent hover:underline">
                    {item.title}
                  </Link>
                  {item.byline ? <span className="text-xs text-zk-muted">{item.byline}</span> : null}
                  <span className="text-xs text-zk-muted">·</span>
                  <LocalTime date={item.createdAt} className="text-xs text-zk-muted" />
                </div>
                {item.waiting ? (
                  <span className="inline-flex items-center rounded-full border border-zk-warn-bd bg-zk-warn-bg px-2.5 py-0.5 text-xs font-semibold text-zk-warn-fg">
                    Waiting on you
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-zk-ok-bg px-2.5 py-0.5 text-xs font-semibold text-zk-ok-fg">Resolved</span>
                )}
              </div>

              <p className="m-0 whitespace-pre-wrap text-sm text-zk-text">{item.body}</p>

              {item.bug ? (
                <p className="m-0 text-xs">
                  <span className="text-zk-muted">Issue: </span>
                  <Link href={issueHref(item.bug)} className="font-semibold text-zk-accent hover:underline">
                    #{item.bug.number} {item.bug.title}
                  </Link>
                </p>
              ) : null}

              {item.waiting && item.kind === "question" ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zk-divider pt-2">
                  <QuickResolveButtons escalationId={item.id} />
                  <Link href={item.href} className="text-xs font-semibold text-zk-accent hover:underline">
                    Write a response →
                  </Link>
                </div>
              ) : item.waiting ? (
                <div className="border-t border-zk-divider pt-2">
                  <Link href={item.href} className="text-xs font-semibold text-zk-accent hover:underline">
                    Review proposal →
                  </Link>
                </div>
              ) : item.answer ? (
                <div className="rounded-panel border border-zk-border bg-zk-chip/60 p-3 text-xs text-zk-text2">
                  <span className="font-semibold text-zk-muted">Your answer:</span>
                  <p className="m-0 mt-1 whitespace-pre-wrap">{item.answer}</p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-panel border border-zk-border bg-zk-surface px-4 py-12 text-center">
          <p className="font-bold text-zk-text">{view === "waiting" ? "Nothing is waiting on you." : "No escalations here."}</p>
          <p className="mt-1.5 text-sm text-zk-muted">Agents stop here when they need a person: to answer a question or decide on a redesign.</p>
        </div>
      )}
    </div>
  );
}
