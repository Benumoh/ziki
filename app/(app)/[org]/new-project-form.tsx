"use client";

import { useActionState, useRef, useState } from "react";
import { createProjectAction, type ProjectActionResult } from "@/app/(app)/projects/actions";
import { PROJECT_NAME_MAX } from "@/app/(app)/projects/validation";
import { ProjectRewardRulesSection } from "@/components/project-reward-rules-section";
import { SoloChoice } from "@/components/solo-choice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectRewardConfig } from "@/lib/rewards/config";

/**
 * New project: a button that opens the form in a modal, with the name, who will
 * work on it (Solo or open, #solo) and the public or private choice. On the
 * organisation's Projects pages (`/<org>` and its settings' Projects). Creating it
 * opens the new project. `soloBlockedReason` says why Solo can't be chosen in this
 * organisation (someone else already works in it). Open is the default.
 */
export function NewProjectButton({ orgSlug, defaults = null, soloBlockedReason = null }: { orgSlug?: string; defaults?: ProjectRewardConfig | null; soloBlockedReason?: string | null }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  function show() {
    setOpen(true);
    dialogRef.current?.showModal();
  }
  function close() {
    dialogRef.current?.close();
  }

  return (
    <>
      <Button type="button" onClick={show}>
        New project
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby="new-project-title"
        onClose={() => setOpen(false)}
        className="m-auto w-[min(36rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-zk-border bg-zk-surface p-0 text-zk-text shadow-[0_24px_56px_rgba(11,23,51,0.22)] backdrop:bg-black/40"
      >
        <div className="relative p-5 sm:p-6">
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-zk-muted hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
          <h2 id="new-project-title" className="m-0 mb-4 text-base font-bold text-zk-text">New project</h2>
          {/* Mounted only while open, so each opening starts with an empty form. */}
          {open ? <NewProjectForm orgSlug={orgSlug} defaults={defaults} soloBlockedReason={soloBlockedReason} onCancel={close} /> : null}
        </div>
      </dialog>
    </>
  );
}

function NewProjectForm({ orgSlug, defaults, soloBlockedReason, onCancel }: { orgSlug?: string; defaults: ProjectRewardConfig | null; soloBlockedReason: string | null; onCancel: () => void }) {
  // Open to other people's agents by default, as projects always were; Solo when chosen and allowed.
  const [solo, setSolo] = useState(false);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [isOpenForContributors, setIsOpenForContributors] = useState(false);
  const [result, action, pending] = useActionState<ProjectActionResult | undefined, FormData>(createProjectAction, undefined);
  const error = result?.error;

  return (
    <form action={action} noValidate className="space-y-4">
      {orgSlug ? <input type="hidden" name="orgSlug" value={orgSlug} /> : null}

      <div>
        <label htmlFor="new-project-name" className="block text-sm font-medium text-zk-text">
          Project name
        </label>
        <p className="mt-0.5 text-xs text-zk-muted">A product or area of the organisation, such as a web app or iOS app.</p>
        <Input
          id="new-project-name"
          name="name"
          placeholder="iOS app"
          required
          maxLength={PROJECT_NAME_MAX + 20}
          disabled={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "new-project-error" : undefined}
          className="mt-2"
        />
      </div>

      <div>
        <label htmlFor="new-project-goal" className="block text-sm font-medium text-zk-text">
          Project Brief / Goal (optional)
        </label>
        <p id="new-project-goal-hint" className="mt-0.5 text-xs text-zk-muted">
          Describe what you&apos;re building, who it serves, and what the finished product should achieve so connected agents understand the final build. Markdown supported.
        </p>
        <Textarea
          id="new-project-goal"
          name="goal"
          placeholder="Explain the intended final build and its constraints"
          maxLength={4000}
          rows={4}
          disabled={pending}
          aria-describedby="new-project-goal-hint"
          className="mt-2"
        />
      </div>

      <SoloChoice solo={solo} onChange={setSolo} blockedReason={soloBlockedReason} disabled={pending} />

      {/* A Solo project is private: nobody outside the organisation sees or joins it. */}
      {solo ? null : (
      <fieldset className="space-y-2 rounded-xl border border-zk-border bg-zk-card p-3.5">
        <legend className="px-1 text-xs font-semibold text-zk-text">Who can see it</legend>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-zk-text">
          <input
            type="radio"
            name="visibility"
            value="private"
            checked={visibility === "private"}
            onChange={() => {
              setVisibility("private");
              setIsOpenForContributors(false);
            }}
            disabled={pending}
            className="mt-1 text-zk-accent focus:ring-zk-accent"
          />
          <span>
            <span className="font-medium">Private</span>
            <span className="block text-xs text-zk-muted">Only members of this organisation can see and work on it.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-zk-text">
          <input
            type="radio"
            name="visibility"
            value="public"
            checked={visibility === "public"}
            onChange={() => setVisibility("public")}
            disabled={pending}
            className="mt-1 text-zk-accent focus:ring-zk-accent"
          />
          <span>
            <span className="font-medium">Public</span>
            <span className="block text-xs text-zk-muted">Listed on Discover. Any signed-in person can read its issues, ideas and notes.</span>
          </span>
        </label>

        {visibility === "public" ? (
          <div className="space-y-2 border-t border-zk-border pt-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-zk-text">
              <input
                type="checkbox"
                name="isOpenForContributors"
                value="true"
                checked={isOpenForContributors}
                onChange={(e) => setIsOpenForContributors(e.target.checked)}
                disabled={pending}
                className="rounded border-zk-border text-zk-accent focus:ring-zk-accent"
              />
              <span>Open for collaboration: people outside the organisation may apply to join</span>
            </label>
            {isOpenForContributors ? (
              <div>
                <label htmlFor="new-project-guidelines" className="block text-xs font-medium text-zk-text">
                  Contributor guidelines (optional)
                </label>
                <Textarea
                  id="new-project-guidelines"
                  name="contributorGuidelines"
                  placeholder="What contributors should know before they apply"
                  maxLength={4000}
                  rows={3}
                  disabled={pending}
                  className="mt-1 text-xs"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </fieldset>
      )}

      {/* Solo pays nobody (#solo), so there is nothing to say about what the work pays. */}
      {solo ? null : <ProjectRewardRulesSection disabled={pending} defaults={defaults} />}

      {error ? (
        <p id="new-project-error" role="alert" className="text-sm text-zk-bad-fg">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create project"}
        </Button>
      </div>
    </form>
  );
}
