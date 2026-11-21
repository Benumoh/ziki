import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { issueHref } from "@/lib/issue-ref";
import { ownerQuestion, parseEscalationBody } from "@/lib/agent-questions";
import { LocalTime } from "@/components/local-time";
import {
  EscalationTypeBadge,
  QuickResolveButtons,
  EscalationAnswerForm,
} from "../../escalation-controls";

export const metadata = { title: "Resolve Agent Escalation" };

export default async function EscalationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) notFound();
  const { id } = await params;
  const question = await ownerQuestion(user.id, organisationId, id);
  if (!question) notFound();

  const parsed = parseEscalationBody(question.body);
  const escalationType = parsed.type;

  return (
    <article className="mx-auto max-w-2xl space-y-6">
      <Link href="/inbox?tab=escalations" className="inline-flex items-center text-sm font-semibold text-zk-accent hover:underline">
        ← Back to Escalations
      </Link>

      <div className="space-y-4 rounded-panel border border-zk-border bg-zk-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zk-divider pb-4">
          <div className="flex items-center gap-2">
            <EscalationTypeBadge type={escalationType} />
            <h1 className="text-xl font-extrabold tracking-tight text-zk-text">{question.agent.name}</h1>
          </div>
          <LocalTime date={question.createdAt} className="text-xs text-zk-muted" />
        </div>

        <div className="space-y-1">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.06em] text-zk-accent">
            Escalation Details
          </h2>
          <p className="whitespace-pre-wrap rounded-panel border border-zk-border bg-zk-chip/50 p-4 text-sm leading-relaxed text-zk-text">
            {parsed.cleanBody}
          </p>
        </div>

        {question.bug ? (
          <div className="rounded-panel border border-zk-border bg-zk-tint p-3 text-xs">
            <span className="text-zk-muted">Associated issue: </span>
            <Link
              href={issueHref(question.bug)}
              className="font-semibold text-zk-accent hover:underline"
            >
              #{question.bug.number} {question.bug.title}
            </Link>
          </div>
        ) : null}

        <div className="pt-2">
          <h2 id="response-heading" className="mb-3 text-sm font-extrabold text-zk-text">
            {question.answeredAt ? "Resolution Provided" : "Respond to Agent"}
          </h2>

          {question.answeredAt ? (
            <div className="space-y-2 rounded-panel border border-zk-border bg-zk-ok-bg/60 p-4">
              <div className="flex items-center justify-between text-xs font-semibold text-zk-ok-fg">
                <span>✓ Resolved</span>
                <LocalTime date={question.answeredAt} className="text-zk-muted" />
              </div>
              <p className="whitespace-pre-wrap text-sm text-zk-text">{question.answer}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-panel border border-zk-border bg-zk-chip/50 p-3">
                <span className="mb-2 block text-xs font-semibold text-zk-muted">
                  Quick Actions:
                </span>
                <QuickResolveButtons escalationId={question.id} />
              </div>
              <EscalationAnswerForm escalationId={question.id} labelledBy="response-heading" />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
