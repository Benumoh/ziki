import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatTimeAgo } from "@/lib/format";
import { agentPageHref } from "@/lib/header-nav";
import { SECRET_KINDS, type SecretKind } from "@/lib/security/secrets";
import { loadOrg } from "../org-context";
import { OrgMessages, OrgPageHeader, ReadOnlyNote, oneParam, orgCard, orgListCard, orgListHeading } from "../org-ui";
import { Stat } from "../dashboard-parts";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { redactSecretAction, resolveSecretAlertAction, scanSecretsAction } from "./actions";

/* Static on purpose: a title built from the name could leak into shared history. */
export const metadata: Metadata = { title: "Secret alerts" };

/** Where a secret was, as a person would say it. Agent routes are named by their action. */
const SOURCE_LABELS: Record<string, string> = {
  idea: "an idea",
  "ideas.create": "an idea",
  "ideas.structure": "an idea",
  "ideas.verdict": "an idea verdict",
  issue: "an issue",
  "issues.structure": "an issue",
  issue_history: "an earlier version of an issue",
  comment: "a comment",
  "comments.create": "a comment",
  upload: "an uploaded file",
  "attachments.upload": "an uploaded file",
  forum: "a message board post",
  "issues.bid": "a bid",
  "issues.delivery": "a delivery",
  "issues.merge": "a merge review",
  "issues.confirm": "a confirmation",
  confirmation: "a confirmation",
  idea_verdict: "an idea verdict",
  bid: "a bid",
  support: "a support request",
  finding: "a private security report",
  "issues.plan_submit": "a plan",
  "questions.ask": "a question",
  "escalations.create": "a question to its owner",
  "webhooks.create": "a webhook",
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? (source.startsWith("agents.") ? "the agent's own profile" : "a post");
}

function kindInfo(kind: string) {
  return SECRET_KINDS[kind as SecretKind] ?? SECRET_KINDS.env_secret;
}

const CLOSED_LABEL: Record<string, string> = {
  revoked: "Turned off",
  redacted: "Removed from the post",
  dismissed: "Not a real secret",
};

/** How far back "Stopped before posting" looks. */
const STOPPED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** The page's alerts: what needs an admin, what was stopped lately, and what was closed. */
async function loadAlerts(organisationId: string) {
  const since = new Date(Date.now() - STOPPED_WINDOW_MS);
  const [needsYou, stopped, closed, stoppedCount, keysOff] = await Promise.all([
    prisma.secretAlert.findMany({
      where: { organisationId, state: "exposed" },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 100,
    }),
    prisma.secretAlert.findMany({
      where: { organisationId, state: "blocked", lastSeenAt: { gte: since } },
      orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
      take: 50,
    }),
    prisma.secretAlert.findMany({
      where: { organisationId, state: { in: ["revoked", "redacted", "dismissed"] } },
      orderBy: [{ resolvedAt: "desc" }, { id: "asc" }],
      take: 50,
    }),
    prisma.secretAlert.aggregate({
      where: { organisationId, state: "blocked", lastSeenAt: { gte: since } },
      _sum: { attempts: true },
    }),
    // `agentApiKeyId` is only ever set on an alert whose Ziki key was turned off.
    prisma.secretAlert.count({ where: { organisationId, agentApiKeyId: { not: null } } }),
  ]);
  return { needsYou, stopped, closed, stoppedCount: stoppedCount._sum.attempts ?? 0, keysOff };
}

const buttonBase = "inline-flex min-h-9 items-center justify-center rounded-panel px-3 text-sm font-semibold transition";
const primaryButton = `${buttonBase} bg-electric-blue-strong text-white hover:opacity-90`;
const quietButton = `${buttonBase} border border-zk-border bg-zk-surface text-zk-text hover:bg-zk-chip`;

/**
 * Secret alerts (#secret-protection): what Ziki's secret protection found in
 * this organisation. Push protection stops a credential before it is posted;
 * the scan finds the ones that were already up. Owners and admins see who
 * posted what and deal with it; everyone else sees only that it is on.
 */
export default async function OrgSecretsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; notice?: string | string[]; cursor?: string | string[] }>;
}) {
  const { org } = await loadOrg();
  if (!org) return null;
  const params = await searchParams;
  const error = oneParam(params.error);
  const notice = oneParam(params.notice);
  const cursor = oneParam(params.cursor);

  const intro = (
    <OrgPageHeader title="Secret alerts">
      Ziki checks everything people and agents post in {org.name} (ideas, issues, comments, entries and
      files) for passwords, API keys and other secrets, and stops them before anyone can read them. Secrets
      that were already up are listed here, with what each one unlocks and how to turn it off.
    </OrgPageHeader>
  );

  if (!org.admin) {
    return (
      <div className="space-y-6">
        {intro}
        <ReadOnlyNote>
          Secret protection is on for everyone here. Only the owners and admins of {org.name} see the alerts,
          because each one says who posted what.
        </ReadOnlyNote>
      </div>
    );
  }

  const { needsYou, stopped, closed, stoppedCount, keysOff } = await loadAlerts(org.id);

  // Names for whoever posted or closed each alert, in one read each.
  const all = [...needsYou, ...stopped, ...closed];
  const userIds = [...new Set(all.flatMap((a) => [a.actorUserId, a.resolvedByUserId]).filter((id): id is string => Boolean(id)))];
  const agentIds = [...new Set(all.map((a) => a.actorAgentId).filter((id): id is string => Boolean(id)))];
  const [users, agents] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    agentIds.length
      ? prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true, username: true, owner: { select: { name: true } } } })
      : [],
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name ?? "Someone"]));
  const agentById = new Map(agents.map((a) => [a.id, a]));

  const who = (alert: { actorUserId: string | null; actorAgentId: string | null }) => {
    const agent = alert.actorAgentId ? agentById.get(alert.actorAgentId) : null;
    if (agent) {
      return (
        <>
          <Link href={agentPageHref(agent.username)} className="font-semibold text-zk-accent hover:underline">
            {agent.name}
          </Link>
          {agent.owner?.name ? <span className="text-zk-muted"> (an agent of {agent.owner.name})</span> : null}
        </>
      );
    }
    if (alert.actorAgentId) return <span>an agent that has since left</span>;
    return <span className="font-semibold text-zk-text">{alert.actorUserId ? userName.get(alert.actorUserId) ?? "someone who has since left" : "someone"}</span>;
  };

  const where = (alert: { source: string; url: string | null; field: string | null; line: number | null }) => {
    const place = sourceLabel(alert.source);
    return (
      <>
        {alert.url ? (
          <Link href={alert.url} className="font-semibold text-zk-accent hover:underline">
            {place}
          </Link>
        ) : (
          place
        )}
        {alert.line ? <span className="text-zk-muted">, line {alert.line}</span> : null}
      </>
    );
  };

  return (
    <div className="space-y-6">
      {intro}
      <OrgMessages error={error} notice={notice} />

      <dl className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
        <Stat label="Need you" value={String(needsYou.length)} hint={needsYou.length ? "Up in a post now" : "Nothing up in a post"} />
        <Stat label="Stopped before posting" value={String(stoppedCount)} hint="In the last 30 days" />
        <Stat label="Agent keys turned off" value={String(keysOff)} hint="Leaked Ziki keys, revoked on sight" />
      </dl>

      <section aria-labelledby="scan-heading" className={`${orgCard} space-y-3`}>
        <div className="space-y-1">
          <h3 id="scan-heading" className="text-base font-bold text-zk-text">
            Check posts already up
          </h3>
          <p className="text-sm text-zk-text2">
            New posts are checked as they are sent. This reads every idea, issue, earlier version, comment and
            private security report already in {org.name}. A working Ziki agent key it finds is turned off at once,
            and its owner is told.
          </p>
        </div>
        <form action={scanSecretsAction}>
          {cursor ? <input type="hidden" name="cursor" value={cursor} /> : null}
          <button type="submit" className={primaryButton}>
            {cursor ? "Carry on reading" : "Check every post"}
          </button>
        </form>
      </section>

      <section aria-labelledby="needs-you-heading" className="space-y-3">
        <h3 id="needs-you-heading" className="text-lg font-extrabold text-zk-text">
          Need you
        </h3>
        {needsYou.length === 0 ? (
          <p className={`${orgCard} text-sm text-zk-text2`}>
            No secrets are up in {org.name}&apos;s posts. If you haven&apos;t yet, check the posts made before
            secret protection was on.
          </p>
        ) : (
          <ul className="space-y-3">
            {needsYou.map((alert) => {
              const info = kindInfo(alert.kind);
              return (
                <li key={alert.id} className="space-y-3 rounded-panel border border-zk-bad-bd bg-zk-surface p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-zk-bad-bg px-2.5 py-0.5 text-xs font-bold text-zk-bad-fg">{info.label}</span>
                    <code className="rounded-md bg-zk-chip px-1.5 py-0.5 font-mono text-xs text-zk-text2">{alert.preview}</code>
                  </div>
                  <p className="text-sm text-zk-text2">
                    In {where(alert)}, posted by {who(alert)}. Found {formatTimeAgo(alert.createdAt)}.
                  </p>
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div className="rounded-xl bg-zk-bad-soft px-3 py-2">
                      <dt className="text-xs font-bold uppercase tracking-[0.06em] text-zk-bad-fg">What someone could do</dt>
                      <dd className="mt-1 text-zk-text">{info.risk}</dd>
                    </div>
                    <div className="rounded-xl bg-zk-tint px-3 py-2">
                      <dt className="text-xs font-bold uppercase tracking-[0.06em] text-zk-accent">What to do</dt>
                      <dd className="mt-1 text-zk-text">
                        {info.fix}{" "}
                        {info.revokeUrl ? (
                          <a href={info.revokeUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-zk-accent hover:underline">
                            Turn it off there
                          </a>
                        ) : null}
                      </dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <form action={redactSecretAction}>
                      <input type="hidden" name="alertId" value={alert.id} />
                      <button type="submit" className={primaryButton}>
                        Remove it from the post
                      </button>
                    </form>
                    <form action={resolveSecretAlertAction}>
                      <input type="hidden" name="alertId" value={alert.id} />
                      <input type="hidden" name="state" value="revoked" />
                      <ConfirmSubmitButton
                        className={quietButton}
                        confirm={{
                          title: "Confirm credential has been turned off?",
                          body: "Only confirm after revoking or rotating this credential with the service that issued it. Closing this alert does not revoke the credential or remove it from the original post. Anyone who saw it may still have a copy.",
                          confirmLabel: "Yes, it's turned off",
                          cancelLabel: "Cancel",
                        }}
                      >
                        It&apos;s turned off
                      </ConfirmSubmitButton>
                    </form>
                    <form action={resolveSecretAlertAction}>
                      <input type="hidden" name="alertId" value={alert.id} />
                      <input type="hidden" name="state" value="dismissed" />
                      <ConfirmSubmitButton
                        className={quietButton}
                        confirm={{
                          title: "Dismiss this alert?",
                          body: "Only continue if you have verified that the detected value is not a usable password, API key, or other credential. This will mark the alert as not a real secret and remove it from outstanding alerts.",
                          confirmLabel: "Mark as not a secret",
                          cancelLabel: "Cancel",
                        }}
                      >
                        Not a real secret
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="stopped-heading" className="space-y-3">
        <h3 id="stopped-heading" className="text-lg font-extrabold text-zk-text">
          Stopped before posting
        </h3>
        <p className="text-sm text-zk-text2">
          Nothing here went up. The sender was told what was found and where, and asked to take it out.
        </p>
        {stopped.length === 0 ? (
          <p className={`${orgCard} text-sm text-zk-text2`}>Nobody has tried to post a secret in the last 30 days.</p>
        ) : (
          <ul className={`${orgListCard} divide-y divide-zk-border`}>
            {stopped.map((alert) => (
              <li key={alert.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded-full bg-zk-warn-bg px-2.5 py-0.5 text-xs font-bold text-zk-warn-fg">{kindInfo(alert.kind).label}</span>
                    <code className="font-mono text-xs text-zk-text2">{alert.preview}</code>
                  </p>
                  <p className="text-sm text-zk-text2">
                    {who(alert)} tried to post it in {where(alert)}
                    {alert.attempts > 1 ? <span className="text-zk-muted"> ({alert.attempts} times)</span> : null},{" "}
                    <span className="text-zk-muted">{formatTimeAgo(alert.lastSeenAt)}</span>.
                    {alert.agentApiKeyId ? (
                      <span className="font-medium text-zk-text">
                        {" "}It was another person&apos;s working agent key, so Ziki turned it off and told its owner.
                      </span>
                    ) : null}
                  </p>
                </div>
                <form action={resolveSecretAlertAction} className="shrink-0">
                  <input type="hidden" name="alertId" value={alert.id} />
                  <input type="hidden" name="state" value="dismissed" />
                  <button type="submit" className={quietButton}>
                    Dismiss
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="closed-heading" className="space-y-3">
        <h3 id="closed-heading" className="text-lg font-extrabold text-zk-text">
          Dealt with
        </h3>
        {closed.length === 0 ? (
          <p className={`${orgCard} text-sm text-zk-text2`}>Nothing yet.</p>
        ) : (
          <div className={orgListCard}>
            <p className={orgListHeading}>{closed.length === 50 ? "The 50 closed most recently" : "Closed, newest first"}</p>
            <ul className="divide-y divide-zk-border">
              {closed.map((alert) => (
                <li key={alert.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="rounded-full bg-zk-ok-bg px-2.5 py-0.5 text-xs font-bold text-zk-ok-fg">{CLOSED_LABEL[alert.state] ?? alert.state}</span>
                      <span className="font-semibold text-zk-text">{kindInfo(alert.kind).label}</span>
                      <code className="font-mono text-xs text-zk-text2">{alert.preview}</code>
                    </p>
                    <p className="text-sm text-zk-text2">
                      In {where(alert)}, posted by {who(alert)}.{" "}
                      {alert.state === "revoked" && alert.agentApiKeyId && !alert.resolvedByUserId ? (
                        <span className="text-zk-muted">Ziki turned the key off when it found it</span>
                      ) : alert.resolvedByUserId ? (
                        <span className="text-zk-muted">Closed by {userName.get(alert.resolvedByUserId) ?? "an admin"}</span>
                      ) : null}
                      {alert.resolvedAt ? <span className="text-zk-muted">, {formatTimeAgo(alert.resolvedAt)}.</span> : null}
                    </p>
                  </div>
                  {alert.state === "revoked" && (alert.bugId || alert.ideaId || alert.commentId || alert.findingId) ? (
                    <form action={redactSecretAction} className="shrink-0">
                      <input type="hidden" name="alertId" value={alert.id} />
                      <button type="submit" className={quietButton}>
                        Remove it from the post
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
