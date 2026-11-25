import { EntrySummary } from "@/components/entry-summary";
import { BASE_PATH } from "@/lib/base-path";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { StepDate, StepTitle } from "@/components/issue-timeline";
import { AddConfirmationDialog } from "@/components/add-confirmation-dialog";
import { EntryReplyForm } from "@/components/entry-reply-form";
import { EntryReplies, type EntryReplyView } from "@/components/entry-replies";
import type { ConfirmationVerdictName } from "@/components/confirmation-form";
import { issuePath } from "@/lib/issue-ref";
import { projectRef } from "@/lib/project-paths";
import { EvidenceFilesList } from "@/components/evidence-files";
import type { EvidenceFile } from "@/lib/agent-api/evidence-files";

export type ConfirmationReplyView = EntryReplyView;

export type ConfirmationEntryView = {
  id: string;
  verdict: ConfirmationVerdictName;
  summary: string;
  description: string;
  duplicateOf: { id: string; number: number; projectSlug: string; orgSlug: string } | null;
  onBehalfOfUserId: string;
  by: string;
  agentName: string | null;
  counted: boolean;
  /** What it counts for: a manager agent's the project's managerVoteWeight, others 1 (#confirmation-weights). */
  weight?: number;
  undone: boolean;
  updatedAt: Date | string;
  /** Evidence: screenshots and other files, served at /api/attachments/{id}. */
  attachments?: { id: string; filename: string; contentType: string }[];
  replies: ConfirmationReplyView[];
  /** Where it was found (#confirmation-files); null while hidden from this viewer. */
  files?: EvidenceFile[] | null;
  filesHidden?: boolean;
  fileCount?: number;
  /** A penalty another confirmer gave it (#confirmation-penalties). */
  penalty?: { id: string; reason: string; byAgentName: string } | null;
  /** The agent's reputation (#agent-reputation). */
  agentReputation?: number | null;
};

const PENALTY_REASONS: Record<string, string> = {
  irrelevant: "files not relevant",
  missing: "files don't exist",
  empty: "files empty",
};

export type ConfirmationsData = {
  confirmations: number;
  confirmationsNeeded: number;
  entries: ConfirmationEntryView[];
};

/** Why the viewer can't give an entry, or null when they can. */
export type ConfirmationBlock = "deleted" | null;

const BLOCK_REASON: Record<Exclude<ConfirmationBlock, null>, string> = {
  deleted: "This issue is deleted.",
};

export const confirmationVerdictLabels: Record<ConfirmationVerdictName, string> = {
  confirm: "Confirm",
  reject: "Reject",
  neutral: "Neutral",
};

const verdictChipClass: Record<ConfirmationVerdictName, string> = {
  confirm: "bg-zk-ok-bg text-zk-ok-fg",
  reject: "bg-zk-bad-bg text-zk-bad-fg",
  neutral: "bg-zk-chip text-zk-text2",
};

/**
 * Whether the issue is confirmed, at the top of its confirmations: the status
 * decides (an issue past Requires confirmation was confirmed); the people are
 * the confirms that count, the date the one that confirmed it.
 */
/** The confirms that count, oldest first, and the one that confirmed the issue. */
function countedConfirms(data: ConfirmationsData) {
  const confirms = data.entries
    .filter((entry) => entry.verdict === "confirm" && entry.counted && !entry.undone)
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
  return { confirms, deciding: confirms[Math.min(data.confirmationsNeeded, confirms.length) - 1] ?? null };
}

function ConfirmationBanner({ data, confirmed }: { data: ConfirmationsData; confirmed: boolean }) {
  const { confirms, deciding } = countedConfirms(data);
  if (confirmed) {
    return (
      <div data-testid="confirmation-banner" data-confirmed="true" className="mb-4 flex items-start gap-3 rounded-2xl border-2 border-zk-ok-fg/40 bg-zk-ok-bg px-4 py-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zk-ok-fg text-white">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="m-0 text-[15px] font-extrabold text-zk-text">Confirmed</p>
          <p className="m-0 mt-0.5 text-[13px] text-zk-text2">
            {confirms.length > 0 ? (
              <>
                By {confirms.map((entry) => entry.by).join(", ")}
                {deciding ? (
                  <>
                    {" "}· <LocalTime date={deciding.updatedAt} />
                  </>
                ) : null}
              </>
            ) : (
              "Confirmed before confirmations were recorded as entries."
            )}
          </p>
        </div>
      </div>
    );
  }
  return null;
}

/**
 * The Requires confirmation stage (#issue-confirmations), in place of the
 * conversation's "Add comment": each person's entry — confirm, neutral or
 * reject — with its summary, its full description behind a toggle, and its
 * replies. "Add confirmation" opens the form.
 */
export function IssueConfirmationsPanel({
  bugId,
  data,
  viewerId,
  block,
  summaryMaxChars,
  history = false,
  confirmed,
  at,
}: {
  bugId: string;
  data: ConfirmationsData;
  viewerId: string | null;
  block: ConfirmationBlock;
  summaryMaxChars: number;
  /** The read-only record once the issue is confirmed (#entry-replies-only): no new entries, no replies. */
  history?: boolean;
  /** The issue is past Requires confirmation (its status says so). */
  confirmed: boolean;
  /** When this step started, at the far right of its title (#issue-timeline). */
  at?: Date | string | null;
}) {
  const mine = viewerId ? data.entries.find((entry) => entry.onBehalfOfUserId === viewerId) ?? null : null;

  const list = (
    <>
      {data.entries.length === 0 ? (
        <p className="m-0 text-[13px] text-zk-muted">No confirmations yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {data.entries.map((entry) => (
            // A lighter shade of the banner's beige sets confirmations apart from comments.
            <li
              key={entry.id}
              id={`confirmation-${entry.id}`}
              className="relative flex items-start gap-3 rounded-xl border border-zk-warn-bd/50 bg-zk-warn-bg/40 px-3 py-2.5"
            >
              <span
                data-testid="confirmation-verdict"
                className={`flex w-[72px] shrink-0 items-center justify-center rounded-lg px-2 py-1.5 text-xs font-bold ${verdictChipClass[entry.verdict]}`}
              >
                {confirmationVerdictLabels[entry.verdict]}
              </span>
              <div className="min-w-0 flex-1">
              <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 pr-8 text-[13px]">
                <b className="font-semibold text-zk-text">{entry.by}</b>
                {entry.agentName ? <span className="text-zk-muted">via {entry.agentName}</span> : null}
                {entry.agentName && entry.agentReputation != null ? (
                  <span
                    className={`whitespace-nowrap text-xs ${entry.agentReputation < 0 ? "font-semibold text-zk-bad-fg" : "text-zk-muted"}`}
                    title="The agent's reputation: down for penalties on its confirmations, up for upvotes on its comments."
                    data-testid="confirmation-reputation"
                  >
                    · reputation {entry.agentReputation}
                  </span>
                ) : null}
                {entry.penalty ? (
                  <span className="whitespace-nowrap rounded-md bg-zk-bad-bg px-1.5 py-0.5 text-[11px] font-bold text-zk-bad-fg" data-testid="confirmation-penalised">
                    Penalised: {PENALTY_REASONS[entry.penalty.reason] ?? entry.penalty.reason}
                  </span>
                ) : null}
                {entry.duplicateOf ? (
                  <span className="text-zk-muted">
                    · duplicate of{" "}
                    <Link href={issuePath(projectRef(entry.duplicateOf.orgSlug, entry.duplicateOf.projectSlug), entry.duplicateOf.number)} className="font-bold text-zk-accent hover:underline">
                      #{entry.duplicateOf.number}
                    </Link>
                  </span>
                ) : null}
                <span className="whitespace-nowrap text-xs text-zk-muted">
                  · <LocalTime date={entry.updatedAt} />
                </span>
                {entry.counted && entry.weight && entry.weight > 1 ? (
                  <span className="whitespace-nowrap text-xs text-zk-muted" data-testid="confirmation-weight">
                    · counts {entry.weight}
                  </span>
                ) : null}
              </p>
              <EntrySummary summary={entry.summary} description={entry.description} />
              <EvidenceFilesList
                files={entry.files}
                filesHidden={entry.filesHidden}
                fileCount={entry.fileCount}
                hiddenUntil="you confirm too"
                testId="confirmation-files"
              />
              {entry.attachments?.length ? (
                <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0" data-testid="confirmation-attachments">
                  {entry.attachments.map((file) => (
                    <li key={file.id}>
                      <a href={`${BASE_PATH}/api/attachments/${file.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-zk-border hover:border-zk-accent">
                        {file.contentType.startsWith("image/") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`${BASE_PATH}/api/attachments/${file.id}`} alt={file.filename} className="h-20 w-28 object-cover" />
                        ) : (
                          <span className="block px-2 py-1 text-xs text-zk-accent">{file.filename}</span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
              {entry.verdict !== "neutral" && !entry.counted ? (
                <p className="mb-0 mt-1 text-xs text-zk-muted" data-testid="confirmation-not-counted">
                  {entry.undone
                    ? "Undone by an organisation admin, so it doesn't count."
                    : "Doesn't count: given before the latest edit."}
                </p>
              ) : null}
              <EntryReplies replies={entry.replies} />
              {!history && viewerId && block !== "deleted" ? (
                <EntryReplyForm bugId={bugId} target={{ confirmationId: entry.id }} label="Reply to this confirmation" icon />
              ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  if (history) {
    // Past Requires confirmation: one compact card, the full entries behind it.
    const { confirms, deciding } = countedConfirms(data);
    return (
      <section id="confirmations" aria-labelledby="confirmations-heading" className="mb-4 scroll-mt-24" data-testid="confirmations-collapsed">
        <StepTitle id="confirmations-heading" title="Confirmations" count={data.entries.length} at={at} />
        <details className="group/conf rounded-xl border border-zk-divider bg-zk-surface">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[13px] text-zk-text2 [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="inline-block text-zk-muted transition-transform group-open/conf:rotate-90">›</span>
            <span>
            {confirmed ? "Confirmed" : "Not confirmed"}
            {confirms.length > 0 ? ` by ${confirms.map((entry) => entry.by).join(", ")}` : ""}
            {deciding ? (
              <>
                {" "}· <LocalTime date={deciding.updatedAt} />
              </>
            ) : null}
          </span>
          </summary>
          <div className="px-3 pb-3">{list}</div>
        </details>
      </section>
    );
  }

  return (
    <section id="confirmations" aria-labelledby="confirmations-heading" className="mb-4 scroll-mt-24">
      {/* Not confirmed yet is said by the next-step bar above (#next-step). */}
      {confirmed ? <ConfirmationBanner data={data} confirmed /> : null}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 id="confirmations-heading" className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">
          Confirmations
          <span className="font-mono font-normal normal-case tracking-normal">{data.entries.length}</span>
        </h3>
        <div className="flex items-center gap-2">
          {history || block || !viewerId ? null : (
            <AddConfirmationDialog
              bugId={bugId}
              summaryMaxChars={summaryMaxChars}
              mine={
                mine
                  ? {
                      verdict: mine.verdict,
                      summary: mine.summary,
                      description: mine.description,
                      duplicateOfNumber: mine.duplicateOf?.number ?? null,
                      files: mine.files ?? [],
                    }
                  : null
              }
            />
          )}
          <StepDate at={at} />
        </div>
      </div>
      {block && !history ? (
        <p className="mb-3 text-[13px] text-zk-muted" data-testid="confirmation-blocked">
          {BLOCK_REASON[block]}
        </p>
      ) : null}

      {list}
    </section>
  );
}
