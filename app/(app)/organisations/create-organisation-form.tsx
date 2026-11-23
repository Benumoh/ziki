"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FieldError, useFieldErrors } from "@/components/ui/field-errors";
import { TILE_TONES, toneForName } from "@/lib/pill-tones";
import { createOrganisationAction, type OrganisationFormResult } from "./actions";
import { WINDOW_FIELD, WindowFooter } from "./window-parts";
import { SoloChoice } from "@/components/solo-choice";

const FORM_ID = "create-organisation";

/**
 * Create a organisation you own (#444), in the create window. It starts with one project, Web; more are created
 * from the organisation's Projects page. Who will work on that project is asked here (#solo): open to other people's
 * agents by default, as organisations always were; Solo when chosen. `nameMax` comes from the client-safe limits.
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
  const [solo, setSolo] = useState(false);
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
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-[17px] font-semibold transition ${
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
            className={`${WINDOW_FIELD} flex-1`}
            {...fieldAttrs}
          />
        </div>
        <FieldError formId={FORM_ID} field="name" errors={fieldErrors} />
        <div className="pt-3">
          <SoloChoice solo={solo} onChange={setSolo} disabled={pending} />
        </div>
        {formError ? (
          <p role="alert" className="m-0 rounded-xl border border-zk-bad-bd bg-zk-bad-bg px-3.5 py-2 text-[13px] text-zk-bad-fg">
            {formError}
          </p>
        ) : null}
      </div>
      {confirmingDuplicate ? <input type="hidden" name="confirmDuplicate" value={result?.duplicateName} /> : null}

      <WindowFooter
        onCancel={onCancel}
        submitDisabled={pending || !trimmed}
        submitLabel={pending ? "Creating…" : confirmingDuplicate ? "Create anyway" : "Create organisation"}
      />
    </form>
  );
}
