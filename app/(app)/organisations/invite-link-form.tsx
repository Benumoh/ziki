"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FieldError, useFieldErrors } from "@/components/ui/field-errors";
import { openInviteLinkAction, type OrganisationFormResult } from "./actions";
import { WINDOW_FIELD, WindowFooter } from "./window-parts";

const FORM_ID = "invite-link";

/** Paste the invite link someone sent you, to open it here (#444). Laid out like the create window. */
export function InviteLinkForm({ onCancel }: { onCancel: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const { fieldErrors, show, clear, attrs } = useFieldErrors(FORM_ID, formRef);
  const [link, setLink] = useState("");
  const [result, action, pending] = useActionState<OrganisationFormResult | undefined, FormData>(
    openInviteLinkAction,
    undefined,
  );

  useEffect(() => {
    if (!result) return;
    if (result.field) show(result);
    else clear();
  }, [result, show, clear]);

  return (
    <form ref={formRef} action={action} noValidate>
      <div className="space-y-1.5 px-6 pb-6 pt-5">
        <label htmlFor="invite-link-input" className="block text-[13px] font-semibold text-zk-text">
          Invite link
        </label>
        <input
          id="invite-link-input"
          name="link"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="https://ziki.dev/join/…"
          autoComplete="off"
          spellCheck={false}
          required
          disabled={pending}
          className={`${WINDOW_FIELD} w-full`}
          {...attrs("link")}
        />
        <FieldError formId={FORM_ID} field="link" errors={fieldErrors} />
      </div>
      <WindowFooter
        onCancel={onCancel}
        submitDisabled={pending || !link.trim()}
        submitLabel={pending ? "Opening…" : "Open invite"}
      />
    </form>
  );
}
