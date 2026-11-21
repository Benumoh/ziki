"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { editPullRequestUrlAction } from "@/app/actions/issues";
import { formatProofLinkLabel } from "@/lib/proof-links";
import { ideaPath, type ProjectRef } from "@/lib/project-paths";

export type IssueLinksProps = {
  links: string[];
  /** The issue's attached pull request, shown here even when it is not in the link list. */
  linkedPullRequestUrl?: string | null;
  /** False on work with no pull request (marketing): the row shows only if a link was given. */
  pullRequests?: boolean;
  /**
   * Live work's live link (#live-link): where it can be seen running; null shows that none was added yet, undefined
   * (work that isn't live) leaves the row out.
   */
  liveUrl?: string | null;
  /** The idea the issue was converted from. */
  idea?: { number: number; slug: ProjectRef } | null;
  /** Repaired old links (#pr-link-repair): the verified canonical PR or commit, or that the old repository can't be read. */
  repairs?: { originalUrl: string; canonicalUrl: string | null; inaccessible: boolean; agentName: string }[];
  /** The issue id, passed when the viewer can edit the submitted pull request link (#edit-pr-link). */
  bugId?: string;
  /** True when the viewer is the contributor/assignee/holder or editor who can update a submitted PR link (#edit-pr-link). */
  canEditPullRequest?: boolean;
};

function ExternalLinkIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
      />
    </svg>
  );
}

/**
 * The issue's Links, in the side rail: its GitHub pull request links and the
 * idea it came from. The agent delivering the work links its pull request, and
 * the contributor or claim holder can edit the submitted pull request link (#edit-pr-link).
 */
export function IssueLinks({
  links: proofLinks,
  linkedPullRequestUrl,
  liveUrl,
  pullRequests = true,
  idea = null,
  repairs = [],
  bugId,
  canEditPullRequest = false,
}: IssueLinksProps) {
  const inputId = useId();
  const [savedPrUrl, setSavedPrUrl] = useState<string | null>(null);
  const effectiveLinkedPr = savedPrUrl ?? linkedPullRequestUrl ?? null;
  const effectiveProofLinks =
    savedPrUrl && linkedPullRequestUrl
      ? proofLinks.map((url) => (url === linkedPullRequestUrl ? savedPrUrl : url))
      : proofLinks;
  const repairFor = new Map(repairs.map((repair) => [repair.originalUrl, repair]));
  const links =
    effectiveLinkedPr && !effectiveProofLinks.includes(effectiveLinkedPr)
      ? [effectiveLinkedPr, ...effectiveProofLinks]
      : effectiveProofLinks;

  const currentPrUrl = effectiveLinkedPr ?? links[0] ?? "";
  const [editing, setEditing] = useState(false);
  const [draftUrl, setDraftUrl] = useState(currentPrUrl);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canEdit = Boolean(canEditPullRequest && bugId && links.length > 0);

  const handleStartEdit = () => {
    setDraftUrl(effectiveLinkedPr ?? links[0] ?? "");
    setError(null);
    setEditing(true);
  };

  const handleCancel = () => {
    setDraftUrl(effectiveLinkedPr ?? links[0] ?? "");
    setError(null);
    setEditing(false);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!bugId || pending) return;
    const trimmed = draftUrl.trim();
    if (!trimmed) {
      setError("Enter a GitHub pull request URL");
      return;
    }
    setError(null);
    const data = new FormData();
    data.set("pullRequestUrl", trimmed);
    startTransition(async () => {
      const result = await editPullRequestUrlAction(bugId, data);
      const message = result.fieldErrors?.pullRequestUrl ?? result.error;
      if (message) {
        setError(message);
        return;
      }
      setSavedPrUrl(trimmed);
      setEditing(false);
    });
  };

  return (
    <section aria-label="Links" className="rounded-panel border border-zk-border bg-zk-surface px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">Links</h2>
        {canEdit && !editing ? (
          <button
            type="button"
            onClick={handleStartEdit}
            aria-label="Edit pull request link"
            className="text-xs font-bold text-zk-accent hover:underline print:hidden"
          >
            Edit
          </button>
        ) : null}
      </div>
      <dl className="mt-3 flex flex-col gap-2.5">
        {pullRequests || links.length > 0 ? (
          <div className="flex min-w-0 items-baseline gap-3">
            <dt className="w-16 shrink-0 whitespace-nowrap text-xs leading-5 text-zk-muted">GitHub PR</dt>
            <dd className="m-0 min-w-0 flex-1">
              {editing ? (
                <form onSubmit={handleSubmit} aria-label="Edit pull request link" className="flex flex-col gap-1.5 print:hidden">
                  <label htmlFor={inputId} className="sr-only">
                    Pull request URL
                  </label>
                  <input
                    id={inputId}
                    type="url"
                    name="pullRequestUrl"
                    value={draftUrl}
                    onChange={(event) => setDraftUrl(event.target.value)}
                    placeholder="https://github.com/owner/repo/pull/123"
                    className="w-full rounded-xl border border-zk-border bg-zk-surface px-2.5 py-1.5 text-xs text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong"
                  />
                  {error ? (
                    <p role="alert" className="m-0 text-xs font-medium text-red-700">
                      {error}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={pending}
                      className="inline-flex h-7 items-center rounded-full bg-electric-blue-strong px-3 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                    >
                      {pending ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancel}
                      className="inline-flex h-7 items-center rounded-full px-2.5 text-xs font-medium text-zk-text2 hover:bg-zk-chip"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : links.length === 0 ? (
                <span className="text-xs leading-5 text-zk-muted">None linked yet.</span>
              ) : (
                <ul className="m-0 list-none space-y-1.5 p-0">
                  {links.map((url, index) => (
                    <li key={`${index}-${url}`}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={url}
                        className="inline-flex items-center gap-1.5 break-all text-xs font-medium leading-5 text-zk-accent hover:underline"
                      >
                        <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0 text-zk-muted" />
                        <span>{formatProofLinkLabel(url)}</span>
                      </a>
                      {repairFor.get(url) ? (
                        <span data-testid="pr-link-repair" className="mt-0.5 flex flex-col gap-0.5 pl-5 text-[11px] leading-4 text-zk-muted">
                          {repairFor.get(url)!.inaccessible ? (
                            <span className="font-semibold text-zk-warn-fg">Old repository can&apos;t be read</span>
                          ) : null}
                          {repairFor.get(url)!.canonicalUrl ? (
                            <span>
                              Now{" "}
                              <a href={repairFor.get(url)!.canonicalUrl!} target="_blank" rel="noopener noreferrer" className="font-medium text-zk-accent hover:underline">
                                {formatProofLinkLabel(repairFor.get(url)!.canonicalUrl!)}
                              </a>
                            </span>
                          ) : null}
                          <span>Verified by {repairFor.get(url)!.agentName}</span>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        ) : null}
        {/* Where it runs, on live work (#live-link), or that nobody has added it yet. */}
        {liveUrl !== undefined ? (
          <div className="flex min-w-0 items-baseline gap-3">
            <dt className="w-16 shrink-0 whitespace-nowrap text-xs leading-5 text-zk-muted">Live</dt>
            <dd className="m-0 min-w-0 flex-1">
              {liveUrl ? (
                <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium leading-5 text-zk-accent hover:underline">
                  <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{liveUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>
                </a>
              ) : (
                <span className="text-xs leading-5 text-zk-muted">Not added yet</span>
              )}
            </dd>
          </div>
        ) : null}
        {idea ? (
          <div className="flex min-w-0 items-baseline gap-3">
            <dt className="w-16 shrink-0 whitespace-nowrap text-xs leading-5 text-zk-muted">Idea</dt>
            <dd className="m-0 min-w-0">
              <Link href={ideaPath(idea.slug, idea.number)} data-testid="source-idea-link" className="text-xs font-medium leading-5 text-zk-accent hover:underline">
                Idea #{idea.number}
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
