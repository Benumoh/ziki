import type { WorkspaceCheckRow } from "@/lib/security-checks/entry";
import { FlashNote } from "./flash-note";
import { ScansArea } from "./scan-list";

function PrivacyNote() {
  return (
    <p className="m-0 flex items-start gap-2 text-xs text-zk-muted">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-px shrink-0"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
      Agents only look. They never log in as you, change anything, or use what they find. Results stay private to you.
    </p>
  );
}

/**
 * The Security page (#security-checks, 14 Nov plan and call): one page, no
 * wizard and no proof step. As Marketing's (23 Nov, Chloe): the chat box on top,
 * the person's targets under it, and an empty card when nothing is checked yet.
 */
export function SecurityChecksPanel({
  checks,
  highlight,
  startWith,
  show,
  page,
  me,
}: {
  checks: WorkspaceCheckRow[];
  highlight?: { checkId: string; unlocked: number };
  /** An address brought from the public page after sign-up: its scan starts on arrival. */
  startWith?: string;
  /** Which scans to show (?show=): all, scanning, report or in_app. */
  show?: string;
  /** Which page of scans (?page=). */
  page?: number;
  /** Who is typing, for their picture in the chat. */
  me?: { name: string | null; image: string | null };
}) {
  return (
    <ScansArea
      checks={checks}
      highlightId={highlight?.checkId}
      show={show}
      page={page}
      startWith={startWith}
      me={me}
      top={
        highlight?.unlocked ? (
          <FlashNote>
            {highlight.unlocked === 1 ? "1 fix unlocked." : `${highlight.unlocked} fixes unlocked.`} Open the report to read each one in full, with how to fix it.
          </FlashNote>
        ) : null
      }
      bottom={
        <div className="rounded-b-panel border-t border-zk-border bg-zk-bg px-4 py-3 sm:px-6">
          <PrivacyNote />
        </div>
      }
    />
  );
}
