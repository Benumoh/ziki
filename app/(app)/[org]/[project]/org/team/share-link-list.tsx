import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { CopyLinkButton } from "@/components/copy-link-button";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { joinedSummary, shareLinkStatusLabel, type ManagedShareLink } from "@/lib/share-invites";
import { revokeShareLinkAction } from "@/app/(app)/organisations/actions";
import { orgListCard, orgListHeading } from "../org-ui";

/**
 * The organisation's invite links (#team-page): who joined with each, how many uses are left,
 * and when it stops. Links are made from the Team page's Invite panel.
 */
export function ShareLinkList({ links }: { links: ManagedShareLink[] }) {
  return (
    <section aria-labelledby="invite-links" className={orgListCard}>
      <h3 id="invite-links" className={orgListHeading}>
        Invite links
      </h3>
      {links.length === 0 ? (
        <p className="px-4 py-4 text-sm text-zk-text2 sm:px-6">
          No invite links yet. Use Invite people → Invite link to make one for several people.
        </p>
      ) : (
        <ul className="divide-y divide-zk-border">
          {links.map((link) => {
            const who = joinedSummary(link.joinedNames, link.useCount);
            const statusClass =
              link.state === "open"
                ? "bg-zk-tint text-zk-accent ring-1 ring-zk-border"
                : link.state === "revoked"
                  ? "bg-zk-bad-bg text-zk-bad-fg"
                  : "bg-zk-chip text-zk-text2";
            const name = link.label || "Invite link";
            return (
              <li key={link.id} className="flex flex-wrap items-start gap-3 px-4 py-3 sm:px-6">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zk-text">
                    <span className="truncate">{name}</span>
                    <Badge className={statusClass}>{shareLinkStatusLabel(link.state)}</Badge>
                  </p>
                  <p className="text-xs text-zk-muted">
                    {link.useCount} joined{link.maxUses != null ? ` of ${link.maxUses}` : ""}
                    {who ? ` · ${who}` : ""}
                    {" · "}
                    {link.state === "expired" ? "expired" : "expires"} <LocalTime date={link.expiresAt} />
                    {" · "}
                    {link.invitedByName}
                  </p>
                  {link.url ? (
                    <p className="truncate font-mono text-xs text-zk-text2">{link.url}</p>
                  ) : (
                    <p className="text-xs text-zk-muted">This link can&apos;t be shown. Revoke it and create another.</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {link.url ? <CopyLinkButton url={link.url} label="invite" /> : null}
                  {link.state === "open" ? (
                    <form action={revokeShareLinkAction}>
                      <input type="hidden" name="linkId" value={link.id} />
                      <ConfirmSubmitButton
                        aria-label={`Revoke invite link${link.label ? ` ${link.label}` : ""}`}
                        confirm={{
                          title: `Revoke ${name}?`,
                          body: "Nobody else can join with it. People who already joined stay members.",
                          confirmLabel: "Revoke link",
                        }}
                      >
                        Revoke
                      </ConfirmSubmitButton>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
