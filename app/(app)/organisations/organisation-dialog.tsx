"use client";

import { useEffect, useRef } from "react";
import { ORGANISATION_NAME_MAX } from "@/lib/organisation-name-limits";
import { CreateOrganisationForm } from "./create-organisation-form";
import { InviteLinkForm } from "./invite-link-form";

export type OrganisationDialogMode = "join" | "create";

const COPY: Record<OrganisationDialogMode, { title: string; subtitle: string }> = {
  create: {
    title: "Create an organisation",
    subtitle: "Your team or company. Add projects and invite people once it's made.",
  },
  join: {
    title: "Join an organisation",
    subtitle: "Organisations are invite-only. Paste the link an owner or admin sent you.",
  },
};

/**
 * The window that joins or creates an organisation, over whatever page you're on.
 * The organisations page's Join and Create buttons and the header switcher's
 * Add organisation all open this one window, so there is one way to make an organisation.
 * Styled like the Overview (#organisations-look): a dark icon tile, the title and one line under it.
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
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // showModal focuses the first control, the close button; start in the field to fill instead.
    dialog.querySelector<HTMLInputElement>("input:not([type=hidden])")?.focus();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="organisation-action-title"
      aria-describedby="organisation-action-subtitle"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] overflow-hidden rounded-[20px] border border-zk-border bg-zk-surface p-0 text-zk-text shadow-[0_24px_60px_rgba(11,23,51,0.22)] backdrop:bg-[#0b1733]/45 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-start gap-3.5 px-6 pb-1 pt-6">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-zk-text text-zk-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
        >
          {mode === "create" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M15 10h.01" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="organisation-action-title" className="m-0 text-[17px] font-semibold text-zk-text">
            {COPY[mode].title}
          </h2>
          <p id="organisation-action-subtitle" className="m-0 mt-0.5 text-[13px] text-zk-muted">
            {COPY[mode].subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zk-muted transition hover:bg-zk-chip hover:text-zk-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      {mode === "join" ? (
        <InviteLinkForm onCancel={onClose} />
      ) : (
        <CreateOrganisationForm nameMax={ORGANISATION_NAME_MAX} next={next} onCancel={onClose} />
      )}
    </dialog>
  );
}
