"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, useFieldErrors } from "@/components/ui/field-errors";
import { Input } from "@/components/ui/input";
import { LocalTime } from "@/components/local-time";
import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { createInviteAction, type CreateInviteActionResult } from "@/app/(app)/organisations/actions";

const FORM_ID = "invite";

type Sent = Extract<CreateInviteActionResult, { ok: true }>;

function deliveryNote(sent: Sent): string {
  switch (sent.delivery) {
    case "notified":
      return `${sent.email} already has an account, so we've told them in Ziki. You can also send them this link.`;
    case "emailed":
      return `We've emailed this link to ${sent.email}. You can also send it yourself.`;
    case "manual":
      return `Email isn't set up on this site, so send this link to ${sent.email} yourself.`;
  }
}

/**
 * An owner or admin invites someone by email (#444). The link is shown here
 * once: only its hash is stored, so it can't be shown again.
 */
export function InviteForm({ organisationId }: { organisationId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const { fieldErrors, show, clear, attrs } = useFieldErrors(FORM_ID, formRef);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);
  const [result, action, pending] = useActionState<CreateInviteActionResult | undefined, FormData>(
    async (previous, formData) => {
      const next = await createInviteAction(previous, formData);
      if (next.ok) {
        setSent(next);
        setEmail("");
      }
      return next;
    },
    undefined,
  );

  useEffect(() => {
    if (!result || result.ok) return;
    if (result.field) show({ error: result.error, field: result.field });
    else clear();
  }, [result, show, clear]);

  // Put the person on the link, selected and ready to copy.
  useEffect(() => {
    if (sent) document.getElementById("new-invite-link")?.focus();
  }, [sent]);

  async function copy() {
    if (!sent) return;
    toast((await copyText(sent.link)) ? "Invite link copied." : "Couldn't copy. Select the link and copy it.");
  }

  if (sent) {
    return (
      <div role="status" className="mt-4 space-y-3 rounded-xl border border-zk-warn-bd bg-zk-warn-bg p-4">
        <p className="text-sm font-medium text-zk-text">
          Invite ready for {sent.email}. Copy the link now: it won&apos;t be shown again.
        </p>
        <label htmlFor="new-invite-link" className="sr-only">
          Invite link
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="new-invite-link"
            readOnly
            value={sent.link}
            className="font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button type="button" onClick={copy} className="shrink-0 whitespace-nowrap">
            Copy link
          </Button>
        </div>
        <p className="text-xs text-zk-text2">{deliveryNote(sent)}</p>
        <p className="text-xs text-zk-text2">
          It works once, only for {sent.email}, and expires <LocalTime date={sent.expiresAt} />.
        </p>
        <Button type="button" variant="secondary" onClick={() => setSent(null)}>
          Invite someone else
        </Button>
      </div>
    );
  }

  const formError = result && !result.ok && !result.field ? result.error : null;

  return (
    <form ref={formRef} action={action} className="mt-4 space-y-1" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <label htmlFor="invite-email" className="block text-sm font-medium text-zk-text">
        Email address
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="invite-email"
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="teammate@example.com"
          autoComplete="off"
          required
          disabled={pending}
          className="sm:max-w-sm"
          {...attrs("email")}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create invite"}
        </Button>
      </div>
      <FieldError formId={FORM_ID} field="email" errors={fieldErrors} />
      {formError ? (
        <p role="alert" className="text-sm text-zk-bad-fg">
          {formError}
        </p>
      ) : null}
    </form>
  );
}
