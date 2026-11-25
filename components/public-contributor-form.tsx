"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FeedbackPageHeader } from "@/components/feedback-page-header";
import { feedbackPrimaryAction, feedbackSecondaryAction, feedbackTextLink } from "@/components/feedback-portal-styles";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CharacterCounter } from "@/components/ui/character-counter";
import { copyText } from "@/lib/clipboard";
import { publicFeedbackPath, publicIssueDetailPath } from "@/lib/public-project-paths";
import { rememberPublicSubmission } from "@/lib/saved-public-submissions";
import type { PublicIdeaMatch } from "@/lib/public-idea-intake";

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

type ScreenshotFile = {
  filename: string;
  data: string; // base64 data url or base64
  size: number;
  previewUrl: string;
};

type FormState = {
  error: string | null;
  fieldErrors: Record<string, string[]>;
  matches: PublicIdeaMatch[];
};

const EMPTY_STATE: FormState = { error: null, fieldErrors: {}, matches: [] };

function trackingToken(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function cleanText(raw: string): string {
  return raw.replace(/<[^>]*>/g, "").trim();
}

function draftTitle(desc: string): string {
  const clean = cleanText(desc).replace(/[#*`>|]/g, "").trim();
  if (!clean) return "";
  const firstLine = clean.split(/[\r\n]+/)[0]?.trim() ?? "";
  const match = firstLine.match(/^(.+?[.!?])(\s|$)/);
  let title = match ? match[1] : firstLine;
  if (title.length > 100) {
    title = title.slice(0, 97) + "…";
  }
  return title.trim().slice(0, 200);
}

function draftSummary(desc: string): string {
  let clean = cleanText(desc).replace(/[#*`>|]/g, "").trim();
  if (!clean) return "";
  clean = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3).join("\n");
  if (clean.length > 300) {
    clean = clean.slice(0, 297) + "…";
  }
  if (clean.length < 20) {
    clean = `Issue reported: ${clean}`;
    if (clean.length < 20) {
      clean = clean.padEnd(20, ".");
    }
  }
  return clean;
}

export function PublicContributorForm({
  project,
  orgSlug,
  projectSlug,
  returnHref,
  signedIn = false,
  initialSubmission,
  privateTracking = true,
}: {
  project: { name: string; slug: string; goal?: string | null; visibility?: "public" | "private" };
  orgSlug: string;
  projectSlug: string;
  kind?: "problem" | "improvement";
  returnHref?: string;
  signedIn?: boolean;
  initialSubmission?: { title: string; trackingPath: string; status?: string };
  privateTracking?: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const token = useRef<string | null>(null);

  const [description, setDescription] = useState("");
  const title = draftTitle(description);
  const summary = draftSummary(description);

  const [showDetails, setShowDetails] = useState(false);
  const [stepsToReproduce, setStepsToReproduce] = useState("");
  const [expectedBehavior, setExpectedBehavior] = useState("");

  const [screenshot, setScreenshot] = useState<ScreenshotFile | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);

  const [state, setState] = useState<FormState>(EMPTY_STATE);
  const [pending, setPending] = useState(false);
  const [searching, setSearching] = useState(false);
  const [acknowledgeSimilar, setAcknowledgeSimilar] = useState(false);

  // Submitted tracking confirmation state
  const [submittedData, setSubmittedData] = useState<{
    title: string;
    trackingPath: string;
    status?: string;
  } | null>(initialSubmission ?? null);
  const [copiedTrackingLink, setCopiedTrackingLink] = useState(false);

  const endpoint = `/api/public/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}/ideas`;
  const projectHome = returnHref ?? publicFeedbackPath({ orgSlug, projectSlug });

  // Debounced search for similar items
  const searchQuery = (title.trim().length >= 8 ? title : description).trim();
  useEffect(() => {
    if (searchQuery.length < 8) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const result = await fetch(`${endpoint}?q=${encodeURIComponent(searchQuery.slice(0, 200))}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        const body = (await result.json()) as { matches?: PublicIdeaMatch[] };
        if (result.ok) {
          setState((cur) => ({ ...cur, matches: body.matches ?? [] }));
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setState((cur) => ({ ...cur, matches: [] }));
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 400);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [endpoint, searchQuery]);

  useEffect(() => {
    return () => { if (screenshot?.previewUrl) URL.revokeObjectURL(screenshot.previewUrl); };
  }, [screenshot]);

  function handleDescriptionChange(value: string) {
    setDescription(value);
    setAcknowledgeSimilar(false);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setScreenshotError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.includes(file.type) && !/\.(png|jpe?g|gif|webp)$/i.test(file.name)) {
      setScreenshotError("Only image files (PNG, JPEG, GIF, WebP) are supported for screenshots.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (file.size > MAX_SCREENSHOT_BYTES) {
      setScreenshotError("Screenshot must be 5 MB or smaller.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setScreenshot({
        filename: file.name,
        data: result,
        size: file.size,
        previewUrl: URL.createObjectURL(file),
      });
    };
    reader.onerror = () => {
      setScreenshotError("Failed to read image file.");
    };
    reader.readAsDataURL(file);
  }

  function removeScreenshot() {
    if (screenshot?.previewUrl) {
      URL.revokeObjectURL(screenshot.previewUrl);
    }
    setScreenshot(null);
    setScreenshotError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setState((cur) => ({ ...cur, error: null, fieldErrors: {} }));

    const data = new FormData(event.currentTarget);
    token.current ??= trackingToken();

    const finalTitle = title.trim() || draftTitle(description);
    const finalSummary = summary.trim() || draftSummary(description);

    try {
      const result = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          title: finalTitle,
          summary: finalSummary,
          description: description.trim(),
          stepsToReproduce: stepsToReproduce.trim(),
          expectedBehavior: expectedBehavior.trim(),
          actualBehavior: "",
          website: data.get("website") ?? "",
          acknowledgeSimilar,
          trackingToken: token.current,
          screenshot: screenshot
            ? {
                filename: screenshot.filename,
                data: screenshot.data,
              }
            : undefined,
        }),
      });

      const body = (await result.json()) as {
        message?: string;
        fieldErrors?: Record<string, string[]>;
        matches?: PublicIdeaMatch[];
        trackingPath?: string;
      };

      if (result.ok && body.trackingPath) {
        if (token.current) rememberPublicSubmission({ orgSlug, projectSlug, token: token.current });
        const confirmation = { title: finalTitle, trackingPath: body.trackingPath };
        setSubmittedData(confirmation);
        router.replace(`${body.trackingPath}?view=confirmation`);
        return;
      }

      if (result.status === 409 && body.matches?.length) {
        setAcknowledgeSimilar(true);
        setState({
          error: body.message ?? "Review the possible matches below.",
          fieldErrors: {},
          matches: body.matches,
        });
        return;
      }

      setState({
        error: body.message ?? "The report could not be submitted.",
        fieldErrors: body.fieldErrors ?? {},
        matches: [],
      });
    } catch {
      setState({
        error: "The report could not be submitted. Check your connection and try again.",
        fieldErrors: {},
        matches: [],
      });
    } finally {
      setPending(false);
    }
  }

  const fieldError = (field: string) => state.fieldErrors[field]?.[0];

  // Screen 2: Confirmation & Tracking
  if (submittedData) {
    const fullTrackingUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}${submittedData.trackingPath}`
        : submittedData.trackingPath;

    return (
      <div className="mx-auto w-full max-w-[920px] space-y-3">
        <FeedbackPageHeader compact title="Feedback received" identity={project.name} description={`${project.name} · Your feedback has been submitted.`} />
        <section aria-label="Submission confirmation" className="mx-auto w-full max-w-[920px] overflow-hidden rounded-panel border border-zk-border bg-zk-surface">
          <div role="status" className="flex items-center gap-3 px-5 pt-5 text-sm sm:px-6"><span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zk-ok-bg text-zk-ok-fg">✓</span><p>Your feedback is now an Idea in the {project.name} project.</p></div>

        <div className="space-y-4 px-5 py-4 sm:px-6">
          <div className="space-y-2 rounded-panel bg-zk-chip/50 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-zk-muted">Your feedback</h3>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-zk-tint px-2.5 py-1 text-xs font-medium text-zk-accent"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{submittedData.status ?? "Awaiting review"}</span>
            </div>
            <p className="break-words text-sm font-medium leading-6 text-zk-text">{submittedData.title}</p>
          </div>

          <div className="rounded-panel border border-zk-border bg-zk-chip/50 p-4 sm:p-5">
            <label htmlFor="tracking-link-input" className="block text-sm font-medium text-zk-text">{privateTracking ? "Your private tracking link" : "Your submission link"}</label>
            <p className="mt-1 text-sm leading-6 text-zk-text2">{privateTracking ? "Keep this link to check progress. Anyone with it can view your report." : "Return to your submission while signed in to check its progress."}</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Input id="tracking-link-input" readOnly value={fullTrackingUrl} className="min-w-0 flex-1 border-zk-border bg-zk-surface font-mono text-xs text-zk-text2 shadow-none! focus:border-zk-accent focus:ring-zk-accent/20" />
              <Button variant="secondary" type="button" aria-label={copiedTrackingLink ? "Tracking link copied" : "Copy tracking link"} onClick={async () => { setCopiedTrackingLink(await copyText(fullTrackingUrl)); setTimeout(() => setCopiedTrackingLink(false), 2000); }} className="shrink-0">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4" /></svg>
                <span role="status">{copiedTrackingLink ? "Link copied" : "Copy link"}</span>
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href={submittedData.trackingPath} className={feedbackPrimaryAction}>Track your report <span aria-hidden="true">→</span></Link>
            <Link href={projectHome} className={feedbackSecondaryAction}>Back to product</Link>
          </div>
        </div>

        {project.visibility === "public" ? <section className="space-y-2 border-t border-zk-divider px-5 py-4 sm:px-6"><h2 className="text-sm font-medium text-zk-text">Want to contribute to {project.name}?</h2><p className="text-sm leading-6 text-zk-text2">Request access to this project to work on it. Projects open for contributors let you join immediately.</p><Link href={`${publicFeedbackPath({ orgSlug, projectSlug })}?view=join`} className={feedbackTextLink}>Request to join this project →</Link></section> : null}

        <footer className="border-t border-zk-divider px-5 py-4 text-sm sm:px-6">
          <Link href={signedIn ? "/my-submissions" : "/login?callbackUrl=%2Fmy-submissions"} className={feedbackTextLink}>{signedIn ? "View My submissions" : "Sign in to view My submissions"}</Link>
          {!signedIn ? <p className="mt-1 text-xs leading-5 text-zk-muted">Optional. You can track this report without an account.</p> : null}
        </footer>
        </section>
      </div>
    );
  }

  // Screen 1: Share feedback
  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-[920px] space-y-3" noValidate>
      {/* Honeypot field */}
      <div className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="contributor-report-website">Website</label>
        <input id="contributor-report-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <FeedbackPageHeader compact title="Share feedback" identity={project.name} description={`${project.name} · Found a problem or have an idea? Tell us about it.`} />

      {state.error ? (
        <div role="alert" className="rounded-xl border border-zk-bad-bd bg-zk-bad-bg p-3.5 text-sm text-zk-bad-fg">
          {state.error}
        </div>
      ) : null}

      <div className="w-full space-y-5 rounded-panel border border-zk-border bg-zk-surface p-5 sm:p-6">
        {/* Required Description */}
        <div className="space-y-3">
          <label htmlFor="contributor-description" className="block text-sm font-medium text-zk-text">
            Your feedback <span className="text-zk-accent">*</span>
          </label>
          <Textarea
            id="contributor-description"
            name="description"
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            rows={6}
            required
            minLength={10}
            maxLength={2400}
            placeholder="Describe the problem you noticed or the improvement you’d like."
            className="min-h-40 w-full border-zk-border text-sm leading-6 shadow-none! focus:border-zk-accent focus:ring-zk-accent/20"
          />
          <div className="flex items-center justify-between text-sm text-zk-muted">
            <CharacterCounter length={description.length} max={2400} />
          </div>
          {fieldError("description") ? (
            <span className="block text-sm text-zk-bad-fg">{fieldError("description")}</span>
          ) : null}
        </div>

        {/* Screenshot Upload */}
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              id="contributor-screenshot"
            />
            <Button
              variant="secondary"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              Add a screenshot (optional)
            </Button>
            <span className="text-sm text-zk-muted">PNG, JPG, GIF or WebP · up to 5 MB</span>
          </div>

          {screenshotError ? (
            <p className="text-sm text-zk-bad-fg">{screenshotError}</p>
          ) : null}
          {fieldError("screenshot") ? (
            <p className="text-sm text-zk-bad-fg">{fieldError("screenshot")}</p>
          ) : null}

          {screenshot ? (
            <div className="flex items-center gap-3 rounded-panel border border-zk-border bg-zk-chip/50 p-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={screenshot.previewUrl}
                alt="Screenshot preview"
                className="h-12 w-12 rounded object-cover border border-zk-border"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zk-text">{screenshot.filename}</p>
                <p className="text-sm text-zk-muted">
                  {(screenshot.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <button
                type="button"
                onClick={removeScreenshot}
                className="rounded-lg p-1 text-zk-muted hover:bg-zk-surface hover:text-zk-text"
                aria-label="Remove screenshot"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ) : null}
        </div>

        <div className="border-t border-zk-border pt-5">
          <button type="button" onClick={() => setShowDetails(!showDetails)} aria-expanded={showDetails} aria-controls="feedback-details" className="flex min-h-8 items-center gap-2 text-sm font-medium text-zk-text hover:text-zk-accent">
            <span aria-hidden="true">{showDetails ? "−" : "+"}</span>
            Add more details (optional)
          </button>
          {showDetails ? (
            <div id="feedback-details" className="mt-4 grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="contributor-steps" className="block text-sm font-medium text-zk-text">Where does this happen?</label>
                <Textarea id="contributor-steps" value={stepsToReproduce} onChange={(e) => setStepsToReproduce(e.target.value)} maxLength={1000} rows={4} placeholder="For example, on the Reports page after saving changes." />
              </div>
              <div className="space-y-2">
                <label htmlFor="contributor-expected" className="block text-sm font-medium text-zk-text">What would you like to happen?</label>
                <Textarea id="contributor-expected" value={expectedBehavior} onChange={(e) => setExpectedBehavior(e.target.value)} maxLength={700} rows={4} placeholder="Describe the result or improvement you have in mind." />
              </div>
            </div>
          ) : null}
        </div>

        {/* Duplicate suggestions */}
        {state.matches.length > 0 ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
            <h2 className="text-sm font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">
              Has this already been reported?
            </h2>
            <ul className="divide-y divide-amber-500/20">
              {state.matches.map((match) => (
                <li key={`${match.kind}-${match.number}`} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={publicIssueDetailPath({ orgSlug, projectSlug }, match.number)} className="block truncate text-sm font-medium text-zk-accent hover:underline">
                        {match.title}
                      </Link>
                      <p className="text-sm text-zk-muted">
                        Existing public issue
                      </p>
                    </div>
                    <svg className="h-4 w-4 shrink-0 text-zk-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {searching ? (
          <p className="text-sm text-zk-muted">Checking for similar reports…</p>
        ) : null}

        {/* Submission Button */}
        <div className="flex flex-col gap-3 border-t border-zk-border pt-6">
          <Button
            type="submit"
            disabled={pending}
            className="w-full sm:ml-auto sm:w-auto"
          >
            {pending ? "Sending…" : "Send feedback"}
          </Button>
          <p className="text-center text-sm text-zk-muted">
            Your feedback is submitted directly as an Idea in this project.
          </p>
        </div>
      </div>
    </form>
  );
}
