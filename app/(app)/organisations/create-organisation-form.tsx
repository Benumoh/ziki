"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FieldError, useFieldErrors } from "@/components/ui/field-errors";
import { TILE_TONES, toneForName } from "@/lib/pill-tones";
import { createOrganisationAction, type OrganisationFormResult } from "./actions";

const FORM_ID = "create-organisation";

const FOOT_BTN =
  "inline-flex h-10 items-center justify-center rounded-full px-5 text-[13px] font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Create a organisation you own (#444), in the create window. It starts with no projects: they are
 * created from the organisation's Projects page. `nameMax` comes from the client-safe limits.
 * The tile beside the name shows the organisation's mark as it will look in the switcher.
 */
export function CreateOrganisationForm({
  nameMax,
  next,
  onCancel,
}: {
  nameMax: number;
  next?: string;
  onCancel: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const { fieldErrors, show, clear, attrs } = useFieldErrors(FORM_ID, formRef);
  // Controlled, so a failed submit keeps what was typed.
  const [name, setName] = useState("");
  const [result, action, pending] = useActionState<OrganisationFormResult | undefined, FormData>(
    createOrganisationAction,
    undefined,
  );

  useEffect(() => {
    if (!result) return;
    if (result.field) show(result);
    else clear();
  }, [result, show, clear]);

  const formError = result?.error && !result.field ? result.error : null;
  // #537: the server warned about a duplicate name. Submitting the same name
  // again confirms it; changing the name asks again.
  const confirmingDuplicate =
    Boolean(result?.duplicateName) && result?.duplicateName === name.replace(/\s+/g, " ").trim();
  const trimmed = name.trim();
  const fieldAttrs = attrs("name");

  return (
    <form ref={formRef} action={action} noValidate>
      {/* Where to go once it's made: back to Security with the scanned site (checked again on the server). */}
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="space-y-1.5 px-6 pb-6 pt-5">
        <label htmlFor="organisation-name" className="block text-[13px] font-semibold text-zk-text">
          Organisation name
        </label>
        <div className="flex items-center gap-3">
          {/* The mark it will have: the first letter on its colour, the same tile the organisations page shows. */}
          <span
            aria-hidden="true"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] text-[17px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition ${
              trimmed ? "" : "border border-dashed border-zk-border bg-zk-bg text-zk-muted"
            }`}
            style={trimmed ? TILE_TONES[toneForName(trimmed)] : undefined}
          >
            {trimmed ? trimmed.charAt(0).toUpperCase() : "?"}
          </span>
          <input
            id="organisation-name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Acme"
            autoComplete="organization"
            required
            maxLength={nameMax + 20}
            disabled={pending}
            className="h-11 min-w-0 flex-1 rounded-xl border border-zk-border bg-zk-surface px-3.5 text-[15px] text-zk-text placeholder:text-zk-muted focus:border-electric-blue focus:outline-none focus:ring-4 focus:ring-electric-blue/15 disabled:opacity-60 aria-[invalid=true]:border-zk-bad-bd"
            {...fieldAttrs}
          />
        </div>
        <FieldError formId={FORM_ID} field="name" errors={fieldErrors} />
        {formError ? (
          <p role="alert" className="m-0 rounded-xl border border-zk-bad-bd bg-zk-bad-bg px-3.5 py-2 text-[13px] text-zk-bad-fg">
            {formError}
          </p>
        ) : null}
      </div>
      {confirmingDuplicate ? <input type="hidden" name="confirmDuplicate" value={result?.duplicateName} /> : null}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zk-divider bg-zk-bg/60 px-6 py-4">
        <button type="button" onClick={onCancel} className={`${FOOT_BTN} text-zk-text hover:bg-zk-chip`}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || !trimmed}
          className={`${FOOT_BTN} bg-zk-text text-zk-surface hover:opacity-90`}
        >
          {pending ? "Creating…" : confirmingDuplicate ? "Create anyway" : "Create organisation"}
        </button>
      </div>
    </form>
  );
}
