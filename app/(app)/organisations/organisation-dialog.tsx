"use client";

import { useEffect, useRef } from "react";
import { ORGANISATION_NAME_MAX } from "@/lib/organisation-name-limits";
import { CreateOrganisationForm } from "./create-organisation-form";
import { InviteLinkForm } from "./invite-link-form";

export type OrganisationDialogMode = "join" | "create";

/**
 * The window that joins or creates an organisation, over whatever page you're on.
 * The organisations page's Join and Create buttons and the header switcher's
 * Add organisation all open this one window, so there is one way to make an organisation.
 */
export function OrganisationDialog({
  mode,
  next,
  onClose,
}: {
  mode: OrganisationDialogMode;
  next?: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="organisation-action-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-[20px] border border-zk-border bg-zk-surface p-6 text-zk-text shadow-xl backdrop:bg-black/50"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="organisation-action-title" className="text-lg font-extrabold">
          {mode === "join" ? "Join an organisation" : "Create an organisation"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-zk-muted hover:bg-zk-chip hover:text-zk-text focus-visible:outline-2 focus-visible:outline-electric-blue"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      {mode === "join" ? (
        <>
          <p className="mt-1 text-sm text-zk-text2">
            Organisations are invite-only. Paste the link an owner or admin sent you.
          </p>
          <InviteLinkForm />
        </>
      ) : (
        <CreateOrganisationForm nameMax={ORGANISATION_NAME_MAX} next={next} />
      )}
    </dialog>
  );
}
