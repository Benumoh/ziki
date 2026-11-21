"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { switchIssueWorkspaceAction } from "@/app/(app)/organisations/issue-switch-action";
import type { IssueOrganisationHint } from "@/lib/issue-organisation-hint";
import { stateLabel } from "@/lib/labels";

// Keep the notice in the app's Tailwind pipeline: its Turbopack CSS loader
// does not export CSS-module class names.
const styles = {
  notice: "mx-auto my-10 flex max-w-[684px] flex-col gap-[22px] rounded-2xl bg-zk-surface p-8 text-sm leading-normal text-zk-text max-[560px]:mx-0 max-[560px]:my-5 max-[560px]:px-4 max-[560px]:py-[22px] [&_h1]:m-0 [&_h1]:text-[clamp(22px,4vw,28px)] [&_h1]:leading-tight [&_h1]:tracking-[-.015em] [&_h1]:text-balance",
  eyebrow: "self-start rounded-full bg-zk-warn-bg px-2.5 py-1 text-[11.5px] font-semibold uppercase tracking-[.06em] text-zk-warn-fg",
  lede: "m-0 text-[15px] text-zk-text2 [&_strong]:font-semibold [&_strong]:text-zk-text",
  route: "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 max-[560px]:grid-cols-1",
  workspace: "flex min-w-0 items-center gap-2.5 rounded-xl border border-zk-border bg-zk-bg px-3.5 py-3 break-words [&_strong]:font-semibold [&_small]:block [&_small]:text-xs [&_small]:text-zk-muted",
  avatar: "grid size-[30px] shrink-0 place-items-center rounded-lg bg-zk-chip text-[13px] font-bold text-zk-text2",
  target: "!border-zk-accent !bg-zk-info-bg [&_small]:!text-zk-info-fg [&>span]:bg-zk-surface [&>span]:text-zk-info-fg",
  arrow: "text-2xl text-zk-muted max-[560px]:rotate-90 max-[560px]:justify-self-center",
  preview: "flex flex-col gap-2 rounded-xl border border-zk-border bg-zk-bg px-[18px] py-4 break-words [&>strong]:text-[15px] [&>strong]:font-semibold [&>small]:text-xs [&>small]:text-zk-muted",
  metadata: "flex flex-wrap items-center gap-2 text-xs text-zk-text2",
  status: "rounded-full bg-zk-chip px-[9px] py-[3px] text-[11px] font-semibold text-zk-text2",
  actions: "flex flex-wrap gap-2.5",
  primary: "inline-flex cursor-pointer items-center justify-center gap-2 rounded-control border border-zk-accent bg-zk-info-bg px-[18px] py-3 text-sm leading-[1.3] font-semibold text-zk-info-fg no-underline hover:bg-zk-tint focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-zk-accent disabled:cursor-wait disabled:opacity-65 max-[560px]:w-full",
  secondary: "inline-flex items-center justify-center gap-2 rounded-control border border-zk-border bg-transparent px-[18px] py-3 text-sm leading-[1.3] font-semibold text-zk-text2 no-underline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-zk-accent max-[560px]:w-full",
  error: "m-0 text-[13px] text-zk-bad-fg",
  fine: "m-0 text-xs text-zk-muted",
};

export function IssueOrganisationSwitch({issueId, organisation, currentWorkspace, destination}: {issueId: string; organisation: IssueOrganisationHint; currentWorkspace?: string; destination: string}) {
  const [state, action, pending] = useActionState(switchIssueWorkspaceAction, {});
  const returnTo = useRef<HTMLInputElement>(null);
  return <section className={styles.notice} aria-labelledby="workspace-switch-title">
    <span className={styles.eyebrow}>⇄ Different workspace</span>
    <h1 id="workspace-switch-title">This issue is in the {organisation.name} workspace</h1>
    <p className={styles.lede}>{currentWorkspace ? <>You&apos;re in <strong>{currentWorkspace}</strong> right now. </> : <>A different workspace is active. </>}Issue <strong>#{organisation.issue.number}</strong> belongs to <strong>{organisation.name}</strong>, another workspace you&apos;re a member of. Switch to open it.</p>
    <div className={styles.route} aria-label="Workspace change">
      <div className={styles.workspace}><span className={styles.avatar}>{currentWorkspace?.slice(0, 1) ?? "W"}</span><div><strong>{currentWorkspace ?? "Current workspace"}</strong><small>You&apos;re here</small></div></div>
      <span className={styles.arrow} aria-hidden="true">→</span>
      <div className={`${styles.workspace} ${styles.target}`}><span className={styles.avatar}>{organisation.name.slice(0, 1)}</span><div><strong>{organisation.name}</strong><small>The issue is here</small></div></div>
    </div>
    <div className={styles.preview}><div className={styles.metadata}><span>#{organisation.issue.number}</span><span>{organisation.name} · {organisation.issue.projectName}</span><span className={styles.status}>{stateLabel(organisation.issue.substatus)}</span></div><strong>{organisation.issue.title}</strong><small>Shown because you&apos;re a member of {organisation.name}.</small></div>
    <form action={action} className={styles.actions} onSubmit={() => { if (returnTo.current) returnTo.current.value = destination + window.location.hash; }}>
      <input type="hidden" name="issueId" value={issueId}/><input type="hidden" name="organisationId" value={organisation.id}/><input ref={returnTo} type="hidden" name="returnTo" defaultValue={destination}/>
      <button className={styles.primary} type="submit" disabled={pending}>{pending ? "Switching workspace…" : `Switch to ${organisation.name} and open #${organisation.issue.number}`} <span aria-hidden="true">→</span></button>
      <Link href="/home" className={styles.secondary}>{currentWorkspace ? `Stay in ${currentWorkspace}` : "Back to my workspace"}</Link>
    </form>
    {state.error ? <p role="alert" className={styles.error}>{state.error}</p> : null}
    <p className={styles.fine}>Workspace access is checked again when you switch. If your access changes, the issue remains private.</p>
  </section>;
}
