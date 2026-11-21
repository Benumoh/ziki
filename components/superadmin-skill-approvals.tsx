"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { reviewSkillSubmissionAction } from "@/app/actions/skill-submissions";

export interface SkillApprovalItem {
  id: string;
  title: string;
  slug?: string;
  category?: string;
  categoryLabel?: string;
  summary?: string;
  tags?: string[];
  prompt: string;
  checklist?: string[];
  sampleCommand?: string | null;
  documentationUrl?: string | null;
  status: "pending" | "approved" | "rejected";
  authorName: string;
  authorImage?: string | null;
  reviewedByName?: string;
  rejectionReason?: string | null;
  submittedAt?: string;
  reviewedAt?: string;
}

export interface SkillApprovalsManagerProps {
  initialSubmissions?: SkillApprovalItem[];
}

export function SkillApprovalsManager({ initialSubmissions = [] }: SkillApprovalsManagerProps) {
  const [activeItems, setActiveItems] = useState<SkillApprovalItem[]>(() => {
    return initialSubmissions.filter((s: SkillApprovalItem) => s.status === "pending");
  });

  const [historyItems, setHistoryItems] = useState<SkillApprovalItem[]>(() => {
    return initialSubmissions.filter((s: SkillApprovalItem) => s.status !== "pending");
  });

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [inspectingItem, setInspectingItem] = useState<SkillApprovalItem | null>(null);
  const [selectedHistoryNote, setSelectedHistoryNote] = useState<SkillApprovalItem | null>(null);
  const [rejectPromptItem, setRejectPromptItem] = useState<SkillApprovalItem | null>(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }

  async function handleApprove(item: SkillApprovalItem) {
    setIsSubmitting(true);
    try {
      const res = await reviewSkillSubmissionAction(item.id, "approved");
      if (!res.ok) {
        showToast(res.error);
        return;
      }
      const updated: SkillApprovalItem = {
        ...item,
        status: "approved",
        reviewedByName: "Super Admin",
      };
      setActiveItems((prev) => prev.filter((i) => i.id !== item.id));
      setHistoryItems((prev) => [updated, ...prev]);
      if (inspectingItem?.id === item.id) setInspectingItem(null);
      showToast(`Approved "${item.title}". Published to Skills Library!`);
    } catch {
      showToast("Network error updating submission.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmReject() {
    if (!rejectPromptItem) return;
    const reason = rejectionReasonInput.trim() || "Changes requested.";
    setIsSubmitting(true);
    try {
      const res = await reviewSkillSubmissionAction(rejectPromptItem.id, "rejected", reason);
      if (!res.ok) {
        showToast(res.error);
        return;
      }
      const updated: SkillApprovalItem = {
        ...rejectPromptItem,
        status: "rejected",
        reviewedByName: "Super Admin",
        rejectionReason: reason,
      };
      setActiveItems((prev) => prev.filter((i) => i.id !== rejectPromptItem.id));
      setHistoryItems((prev) => [updated, ...prev]);
      if (inspectingItem?.id === rejectPromptItem.id) setInspectingItem(null);
      setRejectPromptItem(null);
      setRejectionReasonInput("");
      showToast(`Marked "${rejectPromptItem.title}" for revision.`);
    } catch {
      showToast("Network error updating submission.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-full space-y-8 overflow-hidden">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-2xl border border-zk-border bg-zk-surface px-5 py-3 text-sm font-semibold text-zk-text shadow-2xl transition-all"
        >
          <span className="size-2 rounded-full bg-emerald-500" />
          {toastMessage}
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-zk-border pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-zk-text sm:text-2xl">Skill Approvals</h1>
            {activeItems.length > 0 && (
              <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 border border-blue-500/20">
                {activeItems.length} waiting
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-zk-text2">
            Audit system prompts, verify contributor test assertions, and approve skills for the public directory.
          </p>
        </div>

        <div>
          <Link
            href="/skills"
            className="inline-flex items-center gap-2 rounded-xl border border-zk-border bg-zk-surface px-4 py-2 text-xs font-semibold text-zk-text hover:bg-zk-tint transition shadow-xs"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
              <path d="M6 6h10" />
              <path d="M6 10h10" />
            </svg>
            View Skills Library
          </Link>
        </div>
      </div>

      {/* SECTION 1: ACTIVE ENTRIES */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zk-text flex items-center gap-2">
            Active Entries
            <span className="text-xs font-normal text-zk-muted">({activeItems.length})</span>
          </h2>
        </div>

        {activeItems.length === 0 ? (
          <div className="rounded-panel border border-zk-border bg-zk-surface/50 p-8 text-center">
            <p className="text-sm font-medium text-zk-text">Review queue is clear</p>
            <p className="mt-1 text-xs text-zk-muted">No pending skill submissions waiting for approval.</p>
          </div>
        ) : (
          <div className="rounded-panel border border-zk-border bg-zk-surface shadow-xs overflow-hidden w-full">
            <table className="table-fixed w-full text-left text-sm divide-y divide-zk-border">
              <colgroup>
                <col className="w-[36%]" />
                <col className="w-[18%]" />
                <col className="w-[16%]" />
                <col className="w-[30%]" />
              </colgroup>
              <thead className="bg-zk-tint text-xs font-semibold uppercase tracking-wide text-zk-muted">
                <tr>
                  <th className="px-4 py-3">Skill Name</th>
                  <th className="px-4 py-3">Submitted By</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Audit & Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zk-divider">
                {activeItems.map((item) => (
                  <tr key={item.id} className="hover:bg-zk-tint/60 transition-colors">
                    {/* Skill Name */}
                    <td className="px-4 py-3.5 pr-2">
                      <button
                        type="button"
                        onClick={() => setInspectingItem(item)}
                        className="text-left font-medium text-zk-text hover:text-zk-accent transition hover:underline line-clamp-1 break-words"
                        title="Click to audit prompt"
                      >
                        {item.title}
                      </button>
                      <div className="text-[11px] text-zk-muted truncate mt-0.5">
                        {item.categoryLabel || item.category || "General"}
                      </div>
                    </td>

                    {/* Submitted By */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Avatar name={item.authorName} image={item.authorImage} size="sm" />
                        <span className="text-xs font-medium text-zk-text truncate">{item.authorName}</span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 border border-blue-500/20">
                        <span className="size-1.5 rounded-full bg-blue-500 animate-pulse" />
                        Pending
                      </span>
                    </td>

                    {/* Decision Buttons */}
                    <td className="px-4 py-3.5 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={() => setInspectingItem(item)}
                        className="rounded-lg border border-zk-border bg-zk-surface px-3 py-1.5 text-xs font-semibold text-zk-accent hover:bg-zk-tint transition shadow-xs"
                      >
                        Review Submission →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* SECTION 2: DECISION HISTORY */}
      <section className="space-y-3 pt-4 border-t border-zk-border">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zk-text flex items-center gap-2">
            Decision History
            <span className="text-xs font-normal text-zk-muted">({historyItems.length})</span>
          </h2>
        </div>

        {historyItems.length === 0 ? (
          <div className="rounded-panel border border-zk-border bg-zk-surface/50 p-6 text-center text-xs text-zk-muted">
            No reviewed skill history yet.
          </div>
        ) : (
          <div className="rounded-panel border border-zk-border bg-zk-surface shadow-xs overflow-hidden w-full">
            <table className="table-fixed w-full text-left text-sm divide-y divide-zk-border">
              <colgroup>
                <col className="w-[44%]" />
                <col className="w-[22%]" />
                <col className="w-[18%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead className="bg-zk-tint text-xs font-semibold uppercase tracking-wide text-zk-muted">
                <tr>
                  <th className="px-4 py-3">Skill Name</th>
                  <th className="px-4 py-3">Submitted By</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zk-divider">
                {historyItems.map((item) => (
                  <tr key={item.id} className="hover:bg-zk-tint/60 transition-colors">
                    {/* Skill Name */}
                    <td className="px-4 py-3.5 pr-2">
                      <button
                        type="button"
                        onClick={() => setInspectingItem(item)}
                        className="text-left font-medium text-zk-text hover:text-zk-accent transition hover:underline line-clamp-1 break-words"
                        title="Click to view details"
                      >
                        {item.title}
                      </button>
                    </td>

                    {/* Submitted By */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Avatar name={item.authorName} image={item.authorImage} size="sm" />
                        <span className="text-xs font-medium text-zk-text truncate">{item.authorName}</span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                          item.status === "approved"
                            ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                            : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                        }`}
                      >
                        <span
                          className={`size-1.5 rounded-full ${
                            item.status === "approved" ? "bg-emerald-500" : "bg-amber-500"
                          }`}
                        />
                        {item.status === "approved" ? "Approved" : "Changes Requested"}
                      </span>
                    </td>

                    {/* Details */}
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => {
                          if (item.status === "rejected") {
                            setSelectedHistoryNote(item);
                          } else {
                            setInspectingItem(item);
                          }
                        }}
                        className="rounded-lg border border-zk-border bg-zk-surface px-3 py-1 text-xs font-semibold text-zk-text2 hover:text-zk-text hover:bg-zk-tint transition shadow-xs"
                      >
                        {item.status === "rejected" ? "Feedback" : "Inspect"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* MODAL 1: FULL PROMPT & ASSERTION INSPECTOR */}
      {inspectingItem && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setInspectingItem(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-zk-border bg-zk-surface shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zk-border px-6 py-4">
              <div>
                <h3 className="text-base font-semibold text-zk-text">{inspectingItem.title}</h3>
                <p className="text-xs text-zk-muted mt-0.5">
                  Submitted by {inspectingItem.authorName} • {inspectingItem.categoryLabel || inspectingItem.category || "General"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingItem(null)}
                className="text-zk-muted hover:text-zk-text text-sm font-bold p-1 rounded-lg hover:bg-zk-tint"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-xs text-zk-text">
              {/* Summary */}
              {inspectingItem.summary && (
                <div>
                  <h4 className="font-semibold text-zk-muted uppercase tracking-wider text-[11px] mb-1">Summary</h4>
                  <p className="text-zk-text text-xs leading-relaxed">{inspectingItem.summary}</p>
                </div>
              )}

              {/* Full Agent System Prompt */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <h4 className="font-semibold text-zk-muted uppercase tracking-wider text-[11px]">
                    Agent System Prompt (Audit for Prompt Injection)
                  </h4>
                  <span className="text-[11px] text-zk-muted font-mono">{inspectingItem.prompt.length} chars</span>
                </div>
                <pre className="max-h-64 overflow-y-auto rounded-xl border border-zk-border bg-zk-canvas p-3.5 font-mono text-xs leading-relaxed text-zk-text whitespace-pre-wrap select-text">
                  {inspectingItem.prompt}
                </pre>
              </div>

              {/* Verification Assertions (Checklist) */}
              {inspectingItem.checklist && inspectingItem.checklist.length > 0 && (
                <div>
                  <h4 className="font-semibold text-zk-muted uppercase tracking-wider text-[11px] mb-1.5">
                    Contributor Assertions ({inspectingItem.checklist.length})
                  </h4>
                  <ul className="space-y-1.5 rounded-xl border border-zk-border bg-zk-surface/50 p-3">
                    {inspectingItem.checklist.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-zk-text text-xs">
                        <span className="text-zk-muted font-bold shrink-0">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Sample Command & Documentation URL */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {inspectingItem.sampleCommand && (
                  <div>
                    <h4 className="font-semibold text-zk-muted uppercase tracking-wider text-[11px] mb-1">
                      Sample Command
                    </h4>
                    <code className="block rounded-lg border border-zk-border bg-zk-canvas px-2.5 py-1.5 font-mono text-[11px] text-zk-text truncate">
                      {inspectingItem.sampleCommand}
                    </code>
                  </div>
                )}
                {inspectingItem.documentationUrl && (
                  <div>
                    <h4 className="font-semibold text-zk-muted uppercase tracking-wider text-[11px] mb-1">
                      Documentation Link
                    </h4>
                    <a
                      href={inspectingItem.documentationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-zk-accent hover:underline truncate py-1 text-xs"
                    >
                      {inspectingItem.documentationUrl} ↗
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-between border-t border-zk-border px-6 py-4 bg-zk-surface/80">
              <span className="text-[11px] text-zk-muted">
                Status: <span className="font-semibold capitalize">{inspectingItem.status}</span>
              </span>
              <div className="flex items-center gap-2">
                {inspectingItem.status === "pending" && (
                  <>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => {
                        setRejectPromptItem(inspectingItem);
                        setRejectionReasonInput("");
                      }}
                      className="rounded-xl border border-zk-border px-3.5 py-1.5 text-xs font-semibold text-zk-muted hover:text-zk-text hover:bg-zk-tint transition"
                    >
                      Request Changes
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => handleApprove(inspectingItem)}
                      className="rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition shadow-xs"
                    >
                      Approve & Publish
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setInspectingItem(null)}
                  className="rounded-xl border border-zk-border bg-zk-surface px-3 py-1.5 text-xs font-medium text-zk-text hover:bg-zk-tint transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: REJECT WITH REASON PROMPT */}
      {rejectPromptItem && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRejectPromptItem(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-zk-border bg-zk-surface p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-zk-text">Request Changes</h3>
              <button
                type="button"
                onClick={() => setRejectPromptItem(null)}
                className="text-zk-muted hover:text-zk-text text-sm font-bold p-1 rounded-lg hover:bg-zk-tint"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div>
              <p className="text-xs text-zk-muted mb-2 font-medium">
                Provide constructive feedback for <span className="text-zk-text font-semibold">{rejectPromptItem.title}</span>:
              </p>
              <textarea
                rows={3}
                value={rejectionReasonInput}
                onChange={(e) => setRejectionReasonInput(e.target.value)}
                placeholder="E.g., Please add unit test assertions or tighten prompt instructions..."
                className="w-full rounded-xl border border-zk-border bg-zk-canvas p-3 text-xs text-zk-text focus:outline-hidden focus:ring-1 focus:ring-zk-accent"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRejectPromptItem(null)}
                className="rounded-xl border border-zk-border px-3.5 py-1.5 text-xs font-semibold text-zk-muted hover:text-zk-text"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={confirmReject}
                className="rounded-xl bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 transition shadow-xs"
              >
                Send Feedback
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: REVIEWER NOTE DETAIL MODAL (HISTORY) */}
      {selectedHistoryNote && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedHistoryNote(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-zk-border bg-zk-surface p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-zk-text">Reviewer Feedback</h3>
              <button
                type="button"
                onClick={() => setSelectedHistoryNote(null)}
                className="text-zk-muted hover:text-zk-text text-sm font-bold p-1 rounded-lg hover:bg-zk-tint"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div>
              <p className="text-xs text-zk-muted mb-1.5 font-medium">
                Skill: <span className="text-zk-text font-semibold">{selectedHistoryNote.title}</span>
              </p>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 font-medium leading-relaxed">
                {selectedHistoryNote.rejectionReason || "Changes requested."}
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedHistoryNote(null)}
                className="rounded-control bg-zk-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
