"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { type SkillCategory } from "@/app/(app)/skills/skills-data";

export interface EarnSkillsPortalProps {
  user: {
    id: string;
    name: string;
    email: string;
  };
  initialSubmissions?: ContributorSubmission[];
  loadError?: string | null;
}

export interface ContributorSubmission {
  id: string;
  title: string;
  category: SkillCategory;
  categoryLabel: string;
  summary: string;
  status: "pending" | "approved" | "changes_requested";
  submittedAt: string;
  tags?: string[];
  prompt?: string;
  checklist?: string[];
  sampleCommand?: string;
  docUrl?: string;
  maintainerFeedback?: string;
  catalogSlug?: string;
}

const CATEGORY_OPTIONS: { id: SkillCategory; label: string }[] = [
  { id: "testing", label: "Testing & QA" },
  { id: "security", label: "Security" },
  { id: "design", label: "Design & UI" },
  { id: "backend", label: "Backend & Database" },
  { id: "marketing", label: "SEO & Marketing" },
];

export function EarnSkillsPortal({ user, initialSubmissions = [], loadError }: EarnSkillsPortalProps) {
  const [activeTab, setActiveTab] = useState<"submit" | "submissions">("submit");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<ContributorSubmission | null>(null);

  // Form State
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<SkillCategory>("testing");
  const [summary, setSummary] = useState("");
  const [tags, setTags] = useState("");
  const [prompt, setPrompt] = useState("");
  const [checklist, setChecklist] = useState("");
  const [sampleCommand, setSampleCommand] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [revisingSubmissionId, setRevisingSubmissionId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Close modal on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedSubmission(null);
      }
    }
    if (selectedSubmission) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [selectedSubmission]);

  // Submissions State (seeded with realistic past activities + user additions)
  const [submissions, setSubmissions] = useState<ContributorSubmission[]>(initialSubmissions);
  const activeCategoryConfig = CATEGORY_OPTIONS.find((c) => c.id === category) || CATEGORY_OPTIONS[0];

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 4000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !summary.trim() || !prompt.trim()) {
      showToast("Please fill in the title, summary, and agent instructions.");
      return;
    }

    setIsSubmitting(true);

    try {
      const assertionsList = checklist
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      const parsedTags = tags
        .split(",")
        .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ""))
        .filter(Boolean);

      const res = await fetch("/api/v1/skills/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          category,
          summary: summary.trim(),
          tags: parsedTags,
          prompt: prompt.trim(),
          checklist: assertionsList,
          sampleCommand: sampleCommand.trim() || undefined,
          documentationUrl: docUrl.trim() || undefined,
          revisionOfId: revisingSubmissionId || undefined,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        let errorMsg = "Submission failed. Please check your inputs.";
        if (data?.error) {
          if (typeof data.error === "string") {
            errorMsg = data.error;
          } else if (typeof data.error === "object") {
            const firstKey = Object.keys(data.error)[0];
            const firstVal = data.error[firstKey];
            errorMsg = Array.isArray(firstVal) ? firstVal[0] : `${firstKey}: ${firstVal}`;
          }
        }
        showToast(errorMsg);
        return;
      }

      if (data?.submission) {
        const sub = data.submission;
        const formattedSub: ContributorSubmission = {
          id: sub.id,
          title: sub.title,
          category: sub.category,
          categoryLabel: sub.categoryLabel,
          summary: sub.summary,
          status: sub.status || "pending",
          submittedAt: "Just now",
          tags: sub.tags || [],
          prompt: sub.prompt,
          checklist: sub.checklist || assertionsList,
          sampleCommand: sub.sampleCommand || undefined,
          docUrl: sub.documentationUrl || undefined,
        };

        if (revisingSubmissionId) {
          setSubmissions((prev) =>
            prev.map((s) => (s.id === revisingSubmissionId ? formattedSub : s))
          );
        } else {
          setSubmissions((prev) => [formattedSub, ...prev]);
        }
      }

      // Reset form ONLY on verified success
      setTitle("");
      setSummary("");
      setTags("");
      setPrompt("");
      setChecklist("");
      setSampleCommand("");
      setDocUrl("");
      setRevisingSubmissionId(null);

      showToast(
        revisingSubmissionId
          ? "Revision resubmitted successfully! Queued for review."
          : "Skill submitted successfully! Queued for superadmin review."
      );
      setActiveTab("submissions");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const approvedCount = submissions.filter((s) => s.status === "approved").length;
  const inReviewCount = submissions.filter((s) => s.status === "pending").length;

  return (
    <div className="mx-auto w-full max-w-[1040px] space-y-8 pb-12">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border border-zk-border bg-zk-surface px-5 py-3.5 text-sm font-semibold text-zk-text shadow-2xl transition-all"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zk-ok-bg text-zk-ok-fg text-xs font-bold">
            ✓
          </span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Heading & Navigation */}
      <div className="space-y-3">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <h1 className="text-[28px] md:text-[30px] font-extrabold tracking-[-0.025em] text-zk-text leading-tight">
              Skill Contributions Hub
            </h1>
            <p className="text-sm text-zk-text2 leading-relaxed max-w-[640px]">
              Engineer, test, and publish AI agent skills. Once reviewed and accepted by a maintainer, your skill is published to the official catalog.
            </p>
          </div>

          {/* Action Button: Direct sync back to the Skills Library */}
          <Link
            href="/skills"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-zk-border bg-zk-surface px-6 py-2.5 text-sm font-bold text-zk-text shadow-2xs hover:bg-zk-chip hover:text-zk-accent transition active:scale-[0.98] shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            <span>View Skills Library</span>
          </Link>
        </div>
      </div>

      {/* Pill Button Tabs */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={() => setActiveTab("submit")}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition shadow-xs ${
            activeTab === "submit"
              ? "bg-blue-600 text-white"
              : "border border-zk-border bg-zk-surface text-zk-text2 hover:bg-zk-chip"
          }`}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
          </svg>
          <span>Submit a Skill</span>
        </button>

        <button
          onClick={() => setActiveTab("submissions")}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition shadow-xs ${
            activeTab === "submissions"
              ? "bg-blue-600 text-white"
              : "border border-zk-border bg-zk-surface text-zk-text2 hover:bg-zk-chip"
          }`}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span>My Submissions</span>
          <span
            className={`rounded-full px-1.5 py-0.2 text-[10px] ${
              activeTab === "submissions" ? "bg-white/25 text-white" : "bg-zk-chip text-zk-muted"
            }`}
          >
            {submissions.length}
          </span>
        </button>
      </div>

      {/* TAB 1: SUBMIT A SKILL */}
      {activeTab === "submit" && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
          {/* Main Form Container */}
          <div className="rounded-panel border border-zk-border bg-zk-surface p-7 md:p-8 shadow-xs">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <h2 className="text-base font-bold text-zk-text">Skill Specification</h2>
                <p className="mt-1 text-xs text-zk-muted leading-relaxed">
                  Provide clear instructions and deterministic assertions so agents can execute this skill reliably.
                </p>
              </div>

              {/* Title & Category Grid */}
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="skill-title" className="block text-sm font-semibold text-zk-text2">
                    Skill Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="skill-title"
                    type="text"
                    required
                    placeholder="e.g. Next.js App Router Auditor"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-zk-border bg-zk-surface px-3.5 py-2.5 text-sm text-zk-text placeholder-zk-muted focus-visible:outline-2 focus-visible:outline-zk-accent focus-visible:outline-offset-2 transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="skill-category" className="block text-sm font-semibold text-zk-text2">
                    Category <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="skill-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as SkillCategory)}
                    className="w-full min-h-[44px] rounded-xl border border-zk-border bg-zk-surface px-3.5 py-2.5 text-sm font-semibold text-zk-text focus-visible:outline-2 focus-visible:outline-zk-accent focus-visible:outline-offset-2 transition-all"
                  >
                    {CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Short Summary */}
              <div className="space-y-2">
                <label htmlFor="skill-summary" className="block text-sm font-semibold text-zk-text2">
                  Short Summary <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="skill-summary"
                  required
                  rows={2}
                  placeholder="One or two sentences explaining what capabilities this skill gives an AI agent..."
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  className="w-full rounded-xl border border-zk-border bg-zk-surface px-3.5 py-2.5 text-sm text-zk-text placeholder-zk-muted focus-visible:outline-2 focus-visible:outline-zk-accent focus-visible:outline-offset-2 leading-relaxed transition-all"
                />
              </div>

              {/* Tags */}
              <div className="space-y-2">
                <label htmlFor="skill-tags" className="block text-sm font-semibold text-zk-text2">
                  Tags <span className="text-zk-muted font-normal">(comma-separated)</span>
                </label>
                <input
                  id="skill-tags"
                  type="text"
                  placeholder="e.g. nextjs, app-router, server-components, audit"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-zk-border bg-zk-surface px-3.5 py-2.5 text-sm text-zk-text placeholder-zk-muted focus-visible:outline-2 focus-visible:outline-zk-accent focus-visible:outline-offset-2 transition-all"
                />
              </div>

              {/* Agent System Instructions (Prompt) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="skill-prompt" className="block text-sm font-semibold text-zk-text2">
                    Agent System Instructions (Prompt) <span className="text-red-500">*</span>
                  </label>
                  <span className="text-xs text-zk-muted">Injected into agent context</span>
                </div>
                <textarea
                  id="skill-prompt"
                  required
                  rows={5}
                  placeholder={`You have the Next.js App Router Auditor skill equipped.
1. Strictly separate client and server boundary declarations.
2. Verify dynamic route segment parameters are safely awaited.
3. Assert zero hydration mismatch warnings during local build.`}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="w-full rounded-xl border border-zk-border bg-zk-chip p-3.5 font-mono text-xs text-zk-text placeholder-zk-muted focus-visible:outline-2 focus-visible:outline-zk-accent focus-visible:outline-offset-2 leading-relaxed transition-all"
                />
              </div>

              {/* Verification Assertions */}
              <div className="space-y-2">
                <label htmlFor="skill-checklist" className="block text-sm font-semibold text-zk-text2">
                  Contributor&apos;s Checklist <span className="text-zk-muted font-normal">(one per line)</span>
                </label>
                <textarea
                  id="skill-checklist"
                  rows={3}
                  placeholder={`Run tsc --noEmit with 0 errors
Verify layout constraints and zero overflow warnings
Confirm passing test suite`}
                  value={checklist}
                  onChange={(e) => setChecklist(e.target.value)}
                  className="w-full rounded-xl border border-zk-border bg-zk-surface px-3.5 py-2.5 text-xs font-mono text-zk-text placeholder-zk-muted focus-visible:outline-2 focus-visible:outline-zk-accent focus-visible:outline-offset-2 leading-relaxed transition-all"
                />
              </div>

              {/* Sample Command & Documentation URL */}
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="skill-sample-command" className="block text-sm font-semibold text-zk-text2">Sample Execution Command</label>
                  <input
                    id="skill-sample-command"
                    type="text"
                    placeholder="e.g. npx tsc --noEmit"
                    value={sampleCommand}
                    onChange={(e) => setSampleCommand(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-zk-border bg-zk-surface px-3.5 py-2.5 text-xs font-mono text-zk-text placeholder-zk-muted focus-visible:outline-2 focus-visible:outline-zk-accent focus-visible:outline-offset-2 transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="skill-doc-url" className="block text-sm font-semibold text-zk-text2">Documentation / Source URL</label>
                  <input
                    id="skill-doc-url"
                    type="url"
                    placeholder="https://..."
                    value={docUrl}
                    onChange={(e) => setDocUrl(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-zk-border bg-zk-surface px-3.5 py-2.5 text-sm text-zk-text placeholder-zk-muted focus-visible:outline-2 focus-visible:outline-zk-accent focus-visible:outline-offset-2 transition-all"
                  />
                </div>
              </div>

              {/* Submit CTA */}
              <div className="pt-4 flex items-center justify-end border-t border-zk-divider">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-control bg-blue-600 px-8 py-3 text-sm font-bold text-white shadow-none transition-all hover:brightness-105 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <span>Submitting...</span>
                  ) : (
                    <>
                      <span>Submit for Review</span>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <div className="rounded-panel border border-zk-border bg-zk-bg p-6 space-y-4">
              <h3 className="text-sm font-bold text-zk-text">Contributor Standards</h3>
              <ul className="space-y-3 text-xs text-zk-text2 leading-relaxed">
                <li className="flex items-start gap-2.5">
                  <span className="text-zk-accent font-bold mt-0.5">•</span>
                  <span><strong>Zero git bloat:</strong> Never include large binary screenshots or vendor artifacts.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="text-zk-accent font-bold mt-0.5">•</span>
                  <span><strong>Checklist items:</strong> Provide actionable checklist steps for maintainers to verify.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="text-zk-accent font-bold mt-0.5">•</span>
                  <span><strong>Originality check:</strong> Review the directory to ensure a duplicate skill does not already exist.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: MY SUBMISSIONS */}
      {activeTab === "submissions" && (
        <div className="rounded-panel border border-zk-border bg-zk-surface shadow-xs overflow-hidden">
          <div className="border-b border-zk-border bg-zk-chip px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-zk-text">
                Your Submitted Skills ({submissions.length})
              </h2>
              <p className="text-xs text-zk-muted mt-0.5">
                Click any submission to view review progress, maintainer feedback, and full specifications.
              </p>
            </div>
            <button
              onClick={() => setActiveTab("submit")}
              className="text-xs font-bold text-zk-accent hover:underline shrink-0"
            >
              + New Submission
            </button>
          </div>

          {loadError ? (
            <div className="p-12 text-center space-y-2">
              <h3 className="text-sm font-semibold text-rose-600 dark:text-rose-400">Failed to load submissions</h3>
              <p className="text-xs text-zk-muted max-w-sm mx-auto">
                {loadError}
              </p>
            </div>
          ) : submissions.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-zk-chip text-zk-muted">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-zk-text">No skill submissions yet</h3>
              <p className="text-xs text-zk-muted max-w-sm mx-auto">
                Once you submit a skill above, it will appear here with its review status and maintainer notes.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab("submit")}
                className="inline-flex items-center gap-2 rounded-control bg-zk-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition"
              >
                Submit Your First Skill
              </button>
            </div>
          ) : (
            <div className="divide-y divide-zk-divider">
              {submissions.map((sub) => (
              <div
                key={sub.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedSubmission(sub)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedSubmission(sub);
                  }
                }}
                className="group p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:bg-zk-chip/50 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/50"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zk-accent">
                      {sub.categoryLabel}
                    </span>
                    <span className="text-xs text-zk-muted">•</span>
                    <span className="text-xs text-zk-muted">Submitted {sub.submittedAt}</span>
                  </div>
                  <h3 className="text-sm font-bold text-zk-text group-hover:text-zk-accent transition-colors">
                    {sub.title}
                  </h3>
                  <p className="text-xs text-zk-text2 max-w-xl leading-relaxed">{sub.summary}</p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                      sub.status === "approved"
                        ? "bg-zk-ok-bg text-zk-ok-fg"
                        : sub.status === "pending"
                        ? "bg-zk-tint text-zk-accent"
                        : "bg-zk-bad-bg text-zk-bad-fg"
                    }`}
                  >
                    {sub.status === "approved"
                      ? "✓ Approved"
                      : sub.status === "pending"
                      ? "⏳ In Review"
                      : "⚠️ Changes Requested"}
                  </span>
                  <svg
                    className="h-4 w-4 text-zk-muted transition-transform group-hover:translate-x-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      )}

      {/* Submission Detail Modal */}
      {selectedSubmission && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedSubmission(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="submission-modal-title"
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-panel border border-zk-border bg-zk-surface p-6 sm:p-8 shadow-2xl space-y-6 focus:outline-none"
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 border-b border-zk-divider pb-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zk-accent">
                    {selectedSubmission.categoryLabel}
                  </span>
                  <span className="text-xs text-zk-muted">•</span>
                  <span className="text-xs text-zk-muted">Submitted {selectedSubmission.submittedAt}</span>
                </div>
                <h3 id="submission-modal-title" className="text-xl sm:text-2xl font-extrabold text-zk-text leading-tight">
                  {selectedSubmission.title}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setSelectedSubmission(null)}
                aria-label="Close modal"
                className="rounded-full p-2 text-zk-muted hover:bg-zk-chip hover:text-zk-text transition"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Status Banner & Maintainer Notes */}
            {selectedSubmission.status === "approved" && (
              <div className="rounded-2xl border border-zk-ok-fg/30 bg-zk-ok-bg/15 p-4 flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zk-ok-bg text-zk-ok-fg font-bold text-xs">
                  ✓
                </span>
                <div className="space-y-1 text-xs">
                  <p className="font-bold text-zk-ok-fg text-sm">Approved &amp; Live in Catalog</p>
                  <p className="text-zk-text2 leading-relaxed">
                    {selectedSubmission.maintainerFeedback || "This skill was reviewed and approved by a superadmin. It is published live in the Skills Library."}
                  </p>
                </div>
              </div>
            )}

            {selectedSubmission.status === "pending" && (
              <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-600 dark:text-blue-400 font-bold text-xs">
                  ⏳
                </span>
                <div className="space-y-1 text-xs">
                  <p className="font-bold text-blue-600 dark:text-blue-400 text-sm">Under Maintainer Review</p>
                  <p className="text-zk-text2 leading-relaxed">
                    This submission is waiting for superadmin review in the approvals queue.
                  </p>
                </div>
              </div>
            )}

            {selectedSubmission.status === "changes_requested" && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold text-xs">
                  ⚠️
                </span>
                <div className="space-y-1 text-xs">
                  <p className="font-bold text-amber-600 dark:text-amber-400 text-sm">Revisions Requested by Maintainer</p>
                  <p className="text-zk-text2 leading-relaxed">
                    {selectedSubmission.maintainerFeedback || "Please review the assertion checklist and provide additional unit tests."}
                  </p>
                </div>
              </div>
            )}

            {/* Summary & Tags */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zk-muted">Summary</h4>
              <p className="text-sm text-zk-text leading-relaxed">{selectedSubmission.summary}</p>
              {selectedSubmission.tags && selectedSubmission.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {selectedSubmission.tags.map((t) => (
                    <span key={t} className="rounded-full bg-zk-chip px-2.5 py-0.5 text-[11px] font-mono text-zk-muted">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Agent Instructions (Prompt) */}
            {selectedSubmission.prompt && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zk-muted">Agent System Instructions</h4>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(selectedSubmission.prompt!);
                      showToast("Copied skill prompt to clipboard!");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-zk-border bg-zk-chip px-3 py-1 text-xs font-semibold text-zk-text hover:bg-zk-border transition"
                  >
                    <svg className="h-3 w-3 text-zk-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span>Copy Prompt</span>
                  </button>
                </div>
                <pre className="max-h-44 overflow-y-auto rounded-xl border border-zk-border bg-zk-bg p-3.5 font-mono text-xs text-zk-text leading-relaxed whitespace-pre-wrap">
                  {selectedSubmission.prompt}
                </pre>
              </div>
            )}

            {/* Verification Assertions */}
            {selectedSubmission.checklist && selectedSubmission.checklist.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zk-muted">Contributor&apos;s Checklist</h4>
                <ul className="space-y-1.5 rounded-xl border border-zk-border bg-zk-bg p-3.5 text-xs text-zk-text">
                  {selectedSubmission.checklist.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-zk-muted font-bold mt-0.5">•</span>
                      <span className="font-mono text-zk-text2">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Execution Details: Command & Documentation */}
            {(selectedSubmission.sampleCommand || selectedSubmission.docUrl) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {selectedSubmission.sampleCommand && (
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zk-muted">Test Command</span>
                    <code className="block rounded-lg bg-zk-chip px-2.5 py-1.5 font-mono text-zk-text truncate">
                      {selectedSubmission.sampleCommand}
                    </code>
                  </div>
                )}
                {selectedSubmission.docUrl && (
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zk-muted">Documentation</span>
                    <div>
                      <a
                        href={selectedSubmission.docUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-zk-accent hover:underline font-semibold pt-1"
                      >
                        <span>External Source</span>
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Modal Action Footer */}
            <div className="pt-4 flex items-center justify-between border-t border-zk-divider">
              <button
                type="button"
                onClick={() => setSelectedSubmission(null)}
                className="rounded-full border border-zk-border bg-zk-surface px-5 py-2 text-xs font-bold text-zk-text hover:bg-zk-chip transition"
              >
                Close
              </button>

              <div className="flex items-center gap-2">
                {selectedSubmission.status === "approved" && (
                  <Link
                    href={selectedSubmission.catalogSlug ? `/skills/${selectedSubmission.catalogSlug}` : "/skills"}
                    className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:brightness-105 transition"
                  >
                    <span>View in Catalog</span>
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </Link>
                )}

                {selectedSubmission.status === "changes_requested" && (
                  <button
                    type="button"
                    onClick={() => {
                      setTitle(selectedSubmission.title);
                      setCategory(selectedSubmission.category);
                      setSummary(selectedSubmission.summary);
                      setTags((selectedSubmission.tags || []).join(", "));
                      setPrompt(selectedSubmission.prompt || "");
                      setChecklist((selectedSubmission.checklist || []).join("\n"));
                      setSampleCommand(selectedSubmission.sampleCommand || "");
                      setDocUrl(selectedSubmission.docUrl || "");
                      setSelectedSubmission(null);
                      setRevisingSubmissionId(selectedSubmission.id);
                      setActiveTab("submit");
                      showToast("Loaded submission into form for revision.");
                    }}
                    className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:brightness-105 transition"
                  >
                    <span>Revise &amp; Resubmit</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
