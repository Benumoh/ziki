"use client";

import { useEffect, useRef } from "react";
import { InviteForm } from "./invite-form";
import { ShareLinkForm } from "./share-link-form";

export type InviteMode = "email" | "link";

/**
 * The Team page's Invite people window (#team-page), over the page like Slack's: invite one
 * person by email, or make a link for several, without leaving the list. Built like the
 * organisation window (app/(app)/organisations/organisation-dialog.tsx): a native modal dialog,
 * so Escape, focus and the dimmed page come for free.
 */
export function InviteDialog({
  organisationId,
  organisationName,
  inviteTtlDays,
  mode,
  onModeChange,
  onClose,
}: {
  organisationId: string;
  organisationName: string;
  inviteTtlDays: number;
  mode: InviteMode;
  onModeChange: (mode: InviteMode) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // A click on the dimmed page around the window closes it (Escape and the close button do from the keyboard).
    const closeOnBackdrop = (event: MouseEvent) => {
      if (event.target === dialog) onClose();
    };
    dialog.addEventListener("click", closeOnBackdrop);
    return () => dialog.removeEventListener("click", closeOnBackdrop);
  }, [onClose]);

  // Start in the field to fill, on open and when switching tabs.
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLInputElement>("input:not([type=hidden])")?.focus();
  }, [mode]);

  const tab = (value: InviteMode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      onClick={() => onModeChange(value)}
      className={`h-8 flex-1 rounded-lg px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue ${
        mode === value ? "bg-zk-surface text-zk-text shadow-sm" : "text-zk-text2 hover:text-zk-text"
      }`}
    >
      {label}
    </button>
  );

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="invite-people-title"
      aria-describedby="invite-people-subtitle"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-panel border border-zk-border bg-zk-surface p-0 text-zk-text shadow-xl backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-start gap-3.5 px-6 pb-2 pt-6">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-zk-text text-zk-surface"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="invite-people-title" className="m-0 text-[17px] font-semibold text-zk-text">
            Invite people to {organisationName}
          </h2>
          <p id="invite-people-subtitle" className="m-0 mt-0.5 text-[13px] text-zk-muted">
            They join as members. You can make someone an admin once they&apos;re in.
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

      <div className="px-6 pb-6">
        <div role="tablist" aria-label="How to invite" className="mt-2 flex gap-1 rounded-control bg-zk-chip p-1">
          {tab("email", "By email")}
          {tab("link", "Invite link")}
        </div>
        {mode === "email" ? (
          <>
            <p className="mt-4 text-sm text-zk-text2">
              For one person. The link works once, only for the address you enter, and expires after {inviteTtlDays}{" "}
              days. They show on the Team page as Invited until they join.
            </p>
            <InviteForm organisationId={organisationId} />
          </>
        ) : (
          <>
            <p className="mt-4 text-sm text-zk-text2">
              One link for several people. Anyone who opens it and signs in joins as a member, until it expires, reaches
              its limit or you revoke it. Your links are listed under Invite links.
            </p>
            <ShareLinkForm organisationId={organisationId} />
          </>
        )}
      </div>
    </dialog>
  );
}
