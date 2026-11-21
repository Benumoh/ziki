import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth-helpers";
import { firstProjectRefFor } from "@/lib/project-route";
import { orgPath } from "@/lib/project-paths";
import { openInvitesFor, viewInvite } from "@/lib/invites";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin } from "@/lib/roles";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import {
  MEMBERSHIP_ROLE_LABELS,
  ORGANISATION_NAME_MAX,
  organisationsForUser,
  zeduNeedsOwner,
} from "@/lib/organisations";
import { selectOrganisationAction, setOrganisationArchivedAction } from "./actions";
import { securityReturnPath } from "@/lib/security-return-path";
import { AcceptInviteForm } from "./accept-invite-form";
import { InviteCard } from "./invite-card";
import { OrganisationActions } from "./organisation-actions";
import { ZeduOwnerForm } from "./zedu-owner-form";
import { LocalTime } from "@/components/local-time";
import { TILE_TONES, toneForName } from "@/lib/pill-tones";

/* Distinct browser-tab title; the root layout appends the site name. */
export const metadata = { title: "Organisations" };


/**
 * A person's own memberships (#444): pick the organisation to work in, accept an
 * invite or open an invite link, create a organisation, or restore an archived
 * one. Nothing here administers a organisation; that is /org, for the current one.
 */
export default async function OrganisationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    invite?: string | string[];
    error?: string | string[];
    notice?: string | string[];
    next?: string | string[];
    view?: string | string[];
  }>;
}) {
  const user = await requireUser();
  const projectSlug = await firstProjectRefFor(user.id);
  // In-app invite notifications (#443) link here with the invite's id.
  const {
    invite: inviteParam,
    error: errorParam,
    notice: noticeParam,
    next: nextParam,
    view: viewRaw,
  } = await searchParams;
  const viewParam = typeof viewRaw === "string" ? viewRaw : "";
  // From Security with a scanned site: after creating the organisation, go back there.
  const next = (securityReturnPath(typeof nextParam === "string" ? nextParam : null)) ?? undefined;
  const inviteId = typeof inviteParam === "string" ? inviteParam : "";
  const error = typeof errorParam === "string" ? errorParam : "";
  const notice = typeof noticeParam === "string" ? noticeParam : "";

  const [organisations, currentOrganisationId, invite, zeduOwnerNeeded, openInvites] = await Promise.all([
    organisationsForUser(prisma, user.id, user.role),
    currentOrganisationIdFor(user.id),
    inviteId ? viewInvite(prisma, { inviteId }, user) : null,
    isSuperAdmin(user.role) ? zeduNeedsOwner(prisma) : false,
    openInvitesFor(prisma, user),
  ]);
  const listedInvites = openInvites.filter((row) => row.id !== inviteId);
  const activeOrganisations = organisations.filter((organisation) => !organisation.archivedAt);
  const archivedOrganisations = organisations.filter(
    (organisation) => organisation.archivedAt && (organisation.role === "owner" || isSuperAdmin(user.role)),
  );
  const hasOrganisations = activeOrganisations.length > 0;
  // #537: names shared by two of your organisations, so their buttons say which is which.
  const nameCounts = new Map<string, number>();
  for (const organisation of activeOrganisations) {
    const key = organisation.name.toLocaleLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const sharesName = (name: string) => (nameCounts.get(name.toLocaleLowerCase()) ?? 0) > 1;

  // The list's tabs, like the Overview's (#organisations-look): all of them, the ones you own, the ones you joined,
  // and archived ones while there are any. Each counts what it holds.
  const ownedOrganisations = activeOrganisations.filter((organisation) => organisation.role === "owner");
  const joinedOrganisations = activeOrganisations.filter((organisation) => organisation.role !== "owner");
  const tabs = [
    { key: "all", label: "All", count: activeOrganisations.length },
    { key: "owned", label: "Yours", count: ownedOrganisations.length },
    { key: "joined", label: "Joined", count: joinedOrganisations.length },
    ...(archivedOrganisations.length > 0 ? [{ key: "archived", label: "Archived", count: archivedOrganisations.length }] : []),
  ] as const;
  const view = tabs.find((tab) => tab.key === viewParam)?.key ?? "all";
  const shown = view === "owned" ? ownedOrganisations : view === "joined" ? joinedOrganisations : activeOrganisations;
  const tabHref = (key: string) => (key === "all" ? "/organisations" : `/organisations?view=${key}`);
  const tabClass = (current: boolean) =>
    `inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue ${
      current ? "bg-zk-surface font-semibold text-zk-accent shadow-[0_1px_2px_rgba(16,24,40,0.08)]" : "font-medium text-zk-muted hover:text-zk-text"
    }`;
  const tile = (name: string) => (
    <span
      aria-hidden="true"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] text-[17px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
      style={TILE_TONES[toneForName(name)]}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
  const ROW = "flex flex-wrap items-center gap-4 rounded-2xl border border-zk-border bg-zk-surface px-4 py-3.5 transition hover:bg-zk-bg sm:px-5";

  return (
    <div className="mx-auto w-full max-w-[920px] space-y-4">
      {/* At the top, a gray card about where you are, as the Overview's card about the app: what organisations are,
          with Join and Create at the right. */}
      <section
        aria-labelledby="organisations-title"
        className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zk-border bg-zk-text/[0.045] px-5 py-4"
      >
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-zk-text text-zk-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M15 10h.01" />
            </svg>
          </span>
          <div className="min-w-0">
            <h1 id="organisations-title" className="m-0 text-[17px] font-semibold text-zk-text">
              {hasOrganisations ? "Choose an organisation" : "Join or create an organisation"}
            </h1>
            <p className="m-0 mt-0.5 text-[13px] text-zk-muted">
              {hasOrganisations
                ? "An organisation is your team. A project is one product inside it."
                : "You're not in an organisation yet. Accept an invite, or create one of your own."}
            </p>
          </div>
        </div>
        <OrganisationActions nameMax={ORGANISATION_NAME_MAX} next={next} />
      </section>

      {error ? (
        <p role="alert" className="rounded-xl border border-zk-bad-bd bg-zk-bad-bg px-4 py-2.5 text-sm text-zk-bad-fg">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-xl border border-zk-border bg-zk-ok-bg px-4 py-2.5 text-sm text-zk-ok-fg">
          {notice}
        </p>
      ) : null}

      {inviteId ? (
        <InviteCard invite={invite} accept={{ inviteId }} accountEmail={user.email} />
      ) : null}

      {/* The white card holding the lists, as the Overview's card holding the Work Feed. */}
      <div className="space-y-5 rounded-2xl border border-zk-border bg-zk-surface p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-5">
        {hasOrganisations ? (
          <nav aria-label="Organisation lists" className="flex w-fit max-w-full flex-wrap gap-0.5 rounded-2xl bg-zk-bg p-1 sm:rounded-full">
            {tabs.map((tab) => (
              <Link key={tab.key} href={tabHref(tab.key)} aria-current={view === tab.key ? "page" : undefined} className={tabClass(view === tab.key)}>
                {tab.label}
                <span className="tabular-nums text-[12px] text-zk-muted">{tab.count}</span>
              </Link>
            ))}
          </nav>
        ) : null}

        {listedInvites.length > 0 && view !== "archived" ? (
          <section aria-labelledby="your-invites" className="space-y-2.5">
            <h2 id="your-invites" className="m-0 flex items-baseline gap-2 text-[15px] font-semibold text-zk-text">
              Invitations <span className="tabular-nums text-[13px] font-medium text-zk-muted">{listedInvites.length}</span>
            </h2>
            <ul className="space-y-2.5">
              {listedInvites.map((row) => (
                <li key={row.id} className={`${ROW} border-zk-accent/30 bg-zk-tint/30`}>
                  {tile(row.organisation.name)}
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-[15px] font-semibold text-zk-text">{row.organisation.name}</p>
                    <p className="m-0 mt-0.5 text-[13px] text-zk-muted">
                      {row.invitedByName} invited you · expires <LocalTime date={row.expiresAt} />
                    </p>
                  </div>
                  <AcceptInviteForm inviteId={row.id} organisationName={row.organisation.name} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {view === "archived" ? (
          <section aria-labelledby="archived-organisations" className="space-y-2.5">
            <div className="space-y-0.5">
              <h2 id="archived-organisations" className="m-0 flex items-baseline gap-2 text-[15px] font-semibold text-zk-text">
                Archived organisations <span className="tabular-nums text-[13px] font-medium text-zk-muted">{archivedOrganisations.length}</span>
              </h2>
              <p className="m-0 text-[13px] text-zk-muted">
                Hidden from the switcher and can&apos;t be opened. Restore one to work in it again.
              </p>
            </div>
            <ul className="space-y-2.5">
              {archivedOrganisations.map((organisation) => (
                <li key={organisation.id} className={ROW}>
                  <span className="opacity-60">{tile(organisation.name)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-[15px] font-semibold text-zk-text">{organisation.name}</p>
                    <p className="m-0 mt-0.5 text-[13px] text-zk-muted">
                      <span className="font-mono">{organisation.slug}</span> · Archived · {MEMBERSHIP_ROLE_LABELS[organisation.role]}
                    </p>
                  </div>
                  <form action={setOrganisationArchivedAction}>
                    <input type="hidden" name="organisationId" value={organisation.id} />
                    <input type="hidden" name="archived" value="false" />
                    <Button type="submit" variant="secondary">
                      Restore {organisation.name}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ) : hasOrganisations ? (
          <section aria-labelledby="your-organisations" className="space-y-2.5">
            <div>
              <h2 id="your-organisations" className="m-0 flex items-baseline gap-2 text-[15px] font-semibold text-zk-text">
                {view === "owned" ? "Organisations you own" : view === "joined" ? "Organisations you joined" : "Your organisations"}
                <span className="tabular-nums text-[13px] font-medium text-zk-muted">{shown.length}</span>
              </h2>
            </div>
            {shown.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-zk-border px-5 py-6 text-center text-sm text-zk-muted">
                {view === "owned" ? "You don't own an organisation yet. Create one to start your own." : "You haven't joined anyone else's organisation yet."}
              </p>
            ) : (
              <ul className="space-y-2.5">
                {shown.map((organisation) => {
                  const current = organisation.id === currentOrganisationId;
                  return (
                    <li key={organisation.id} className={`${ROW} ${current ? "border-zk-accent/40" : ""}`}>
                      {tile(organisation.name)}
                      <div className="min-w-0 flex-1">
                        <p className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-zk-text">
                          <span className="truncate">{organisation.name}</span>
                          {current ? (
                            <Badge className="rounded-full bg-zk-tint text-zk-accent ring-1 ring-zk-border">Current</Badge>
                          ) : null}
                        </p>
                        <p className="m-0 mt-0.5 text-[13px] text-zk-muted">
                          {/* #537: the slug tells organisations with the same name apart. */}
                          <span className="font-mono">{organisation.slug}</span> · {MEMBERSHIP_ROLE_LABELS[organisation.role]}
                          {current && projectSlug ? (
                            <>
                              {" · "}
                              <Link href={orgPath(projectSlug)} className="text-zk-accent hover:underline">
                                {organisation.role === "member" ? "Members and projects" : "Manage organisation"}
                              </Link>
                            </>
                          ) : null}
                        </p>
                      </div>
                      {/* On a phone the button takes its own line, so the name keeps its room. */}
                      <form action={selectOrganisationAction} className="max-sm:basis-full">
                        <input type="hidden" name="organisationId" value={organisation.id} />
                        <Button type="submit" variant={current ? "secondary" : "primary"} className="max-sm:w-full">
                          Open {organisation.name}
                          {sharesName(organisation.name) ? <span className="sr-only"> ({organisation.slug})</span> : null}
                        </Button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

        {!hasOrganisations && !inviteId ? (
          // #641: a newcomer's first step is their own organisation, explained.
          <section aria-labelledby="how-ziki-works" className="space-y-3">
            <h2 id="how-ziki-works" className="m-0 text-[15px] font-semibold text-zk-text">How Ziki is organised</h2>
            <ul className="space-y-2.5">
              <li className={ROW}>
                {tile("Organisation")}
                <p className="m-0 min-w-0 flex-1 text-sm text-zk-text2">
                  <span className="font-semibold text-zk-text">An organisation</span> is your team or company. Its people, projects and issues stay inside it.
                </p>
              </li>
              <li className={ROW}>
                {tile("Project")}
                <p className="m-0 min-w-0 flex-1 text-sm text-zk-text2">
                  <span className="font-semibold text-zk-text">A project</span> is one product in that organisation, such as a web app or a mobile app. The switcher chooses which project&apos;s issues you see.
                </p>
              </li>
            </ul>
          </section>
        ) : null}

        {/* Contributing elsewhere, as the highlighted card at the foot of the Overview's feed. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zk-warn-bd/60 bg-zk-warn-bg/50 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="text-2xl leading-none">🔎</span>
            <div className="min-w-0">
              <p className="m-0 text-[14px] font-semibold text-zk-text">Looking for projects to contribute to?</p>
              <p className="m-0 mt-0.5 text-[13px] text-zk-muted">Browse public projects and open products accepting contributors.</p>
            </div>
          </div>
          <Link
            href="/discover"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-zk-text px-4 text-[13px] font-bold text-zk-surface transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue"
          >
            Discover projects
          </Link>
        </div>
      </div>

      {zeduOwnerNeeded ? (
        <section aria-labelledby="zedu-owner" className="rounded-2xl border border-zk-warn-bd bg-zk-warn-bg p-4 sm:p-5">
          <h2 id="zedu-owner" className="text-base font-semibold text-zk-warn-fg">
            Ziki has no owner yet
          </h2>
          <p className="mt-1 text-sm text-zk-warn-fg">
            Everyone moved into Ziki is a member, so nobody can invite people. As the site&apos;s
            super admin, choose its first owner from its existing members.
          </p>
          <ZeduOwnerForm />
        </section>
      ) : null}
    </div>
  );
}
