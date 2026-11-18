"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CharacterCounter } from "@/components/ui/character-counter";
import { copyText } from "@/lib/clipboard";
import { publicProjectPath } from "@/lib/public-project-paths";
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
  kind,
  returnHref,
}: {
  project: { name: string; slug: string; goal?: string | null };
  orgSlug: string;
  projectSlug: string;
  kind?: "problem" | "improvement";
  returnHref?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const token = useRef<string | null>(null);

  const [description, setDescription] = useState("");
  const title = draftTitle(description);
  const summary = draftSummary(description);
  const isImprovement = kind === "improvement";

  const [improvementLocation, setImprovementLocation] = useState("");
  const [improvementReason, setImprovementReason] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [stepsToReproduce, setStepsToReproduce] = useState("");
  const [expectedBehavior, setExpectedBehavior] = useState("");
  const [actualBehavior, setActualBehavior] = useState("");

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
  } | null>(null);
  const [copiedTrackingLink, setCopiedTrackingLink] = useState(false);

  const endpoint = `/api/public/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}/ideas`;
  const projectHome = returnHref ?? publicProjectPath({ orgSlug, projectSlug });

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
          description: isImprovement
            ? [description.trim(), improvementLocation.trim() && `Where to add it: ${improvementLocation.trim()}`, improvementReason.trim() && `Why it helps: ${improvementReason.trim()}`].filter(Boolean).join("\n\n")
            : description.trim(),
          stepsToReproduce: stepsToReproduce.trim(),
          expectedBehavior: expectedBehavior.trim(),
          actualBehavior: actualBehavior.trim(),
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
        setSubmittedData({
          title: finalTitle,
          trackingPath: body.trackingPath,
        });
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
      <div className="space-y-6">
        <div className="rounded-2xl border border-zk-border bg-zk-surface p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10 text-blue-500">
            <svg
              className="h-8 w-8 text-blue-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-zk-text sm:text-4xl">Report received</h2>
          <p className="mt-1 text-sm text-zk-muted">
            Thank you for contributing to {project.name}.
          </p>

          <div className="mt-6 rounded-xl border border-zk-border bg-zk-chip/40 p-4 text-left">
            <h3 className="font-semibold text-zk-text">{submittedData.title}</h3>
            <div className="mt-2">
              <span className="inline-flex items-center rounded-full bg-blue-500/15 px-2.5 py-0.5 text-sm font-semibold text-blue-600 dark:text-blue-400">
                Awaiting review
              </span>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-zk-border bg-zk-chip/40 p-4 text-left space-y-2">
            <label htmlFor="tracking-link-input" className="block text-sm font-bold uppercase tracking-wider text-zk-text2">
              Your private tracking link
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="tracking-link-input"
                readOnly
                value={submittedData.trackingPath}
                className="bg-zk-surface font-mono text-sm text-zk-text"
              />
              <Button
                type="button"
                variant="primary"
                onClick={async () => {
                  setCopiedTrackingLink(await copyText(fullTrackingUrl));
                  setTimeout(() => setCopiedTrackingLink(false), 2000);
                }}
                className="shrink-0"
              >
                {copiedTrackingLink ? "Copied" : "Copy link"}
              </Button>
            </div>
            <p className="text-sm text-zk-muted">Save this link to check progress. Keep it private.</p>
            <Link href={submittedData.trackingPath} className="text-sm font-semibold text-zk-accent hover:underline">Track your report</Link>
          </div>

          <p className="mt-6 text-sm text-zk-muted">
            Open your private tracking link to see the current status of your report.
          </p>

          <div className="mt-6">
            <Link
              href={projectHome}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-zk-chip px-6 text-sm font-semibold text-zk-text transition hover:bg-zk-border"
            >
              Back to project
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Screen 1: Share feedback
  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {/* Honeypot field */}
      <div className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="contributor-report-website">Website</label>
        <input id="contributor-report-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="max-w-3xl space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-zk-text sm:text-4xl">{isImprovement ? "Suggest an improvement" : "Report a problem"}</h1>
        <p className="text-base leading-relaxed text-zk-muted">
          {isImprovement ? "Tell us what would make this project better and who it would help." : "Tell us what went wrong, what you did, and what you expected to happen."}
        </p>
      </div>

      {state.error ? (
        <div role="alert" className="rounded-xl border border-zk-bad-bd bg-zk-bad-bg p-3.5 text-sm text-zk-bad-fg">
          {state.error}
        </div>
      ) : null}

      <div className="space-y-7 rounded-2xl border border-zk-border bg-zk-surface p-5 shadow-sm sm:p-7">
        {/* Required Description */}
        <div className="space-y-3">
          <label htmlFor="contributor-description" className="block text-base font-semibold leading-relaxed text-zk-text">
            {isImprovement ? "What would you like to improve?" : "Summary of what went wrong"} <span className="text-zk-accent">*</span>
          </label>
          <Textarea
            id="contributor-description"
            name="description"
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            rows={7}
            required
            minLength={10}
            maxLength={isImprovement ? 1800 : 2400}
            placeholder={isImprovement ? "I would like to export reports as CSV so I can share them with my team." : "When I tap Save on my phone, nothing happens and my changes are lost."}
            className="min-h-44 w-full text-base leading-relaxed"
          />
          <div className="flex items-center justify-between text-sm text-zk-muted">
            <CharacterCounter length={description.length} max={isImprovement ? 1800 : 2400} />
          </div>
          {fieldError("description") ? (
            <span className="block text-sm text-zk-bad-fg">{fieldError("description")}</span>
          ) : null}
        </div>

        {isImprovement ? (
          <div className="space-y-5 border-t border-zk-border pt-5">
            <button type="button" onClick={() => setShowDetails(!showDetails)} aria-expanded={showDetails} aria-controls="improvement-details" className="flex min-h-10 items-center gap-2 text-base font-semibold text-zk-text hover:text-zk-accent">
              <span aria-hidden="true">{showDetails ? "−" : "+"}</span>
              Add more detail (optional)
            </button>
            {showDetails ? <div id="improvement-details" className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-3">
              <label htmlFor="improvement-location" className="block text-sm font-semibold text-zk-text">
                Where should this be added? <span className="font-normal text-zk-muted">(optional)</span>
              </label>
              <Textarea id="improvement-location" value={improvementLocation} onChange={(e) => setImprovementLocation(e.target.value)} maxLength={200} rows={4} placeholder="For example, on the Reports page, next to Download." className="text-base leading-relaxed" />
            </div>
            <div className="space-y-3">
              <label htmlFor="improvement-reason" className="block text-sm font-semibold text-zk-text">
                Why would it help? <span className="font-normal text-zk-muted">(optional)</span>
              </label>
              <Textarea id="improvement-reason" value={improvementReason} onChange={(e) => setImprovementReason(e.target.value)} maxLength={300} rows={4} placeholder="For example, my team could share reports without copying the data by hand." className="text-base leading-relaxed" />
            </div>
            </div> : null}
          </div>
        ) : null}

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
              type="button"
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 text-sm"
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
            <div className="flex items-center gap-3 rounded-xl border border-zk-border bg-zk-chip/50 p-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={screenshot.previewUrl}
                alt="Screenshot preview"
                className="h-12 w-12 rounded object-cover border border-zk-border"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zk-text">{screenshot.filename}</p>
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

        {/* Optional troubleshooting details for problems only. */}
        {!isImprovement ? (
          <div className="pt-2 border-t border-zk-border">
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1.5 text-sm font-semibold text-zk-text hover:text-zk-accent"
            >
              <svg
                className={`h-4 w-4 transition-transform ${showDetails ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              Add steps and details (optional)
            </button>

            {showDetails ? (
              <div className="mt-3 space-y-3 pl-5 border-l-2 border-zk-border">
                <div className="space-y-2">
                  <label htmlFor="contributor-steps" className="block text-sm font-medium text-zk-text">
                    How can we repeat the problem? <span className="text-zk-muted">(optional)</span>
                  </label>
                  <Textarea
                    id="contributor-steps"
                    value={stepsToReproduce}
                    onChange={(e) => setStepsToReproduce(e.target.value)}
                    maxLength={1000}
                    rows={3}
                    placeholder="1. Open app&#10;2. Click Save&#10;3. Notice no action"
                    className="text-base leading-relaxed"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="contributor-expected" className="block text-sm font-medium text-zk-text">
                      What should have happened? <span className="text-zk-muted">(optional)</span>
                    </label>
                    <Textarea
                      id="contributor-expected"
                      value={expectedBehavior}
                      onChange={(e) => setExpectedBehavior(e.target.value)}
                      maxLength={700}
                      rows={3}
                      placeholder="Changes should save immediately"
                      className="text-base leading-relaxed"
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="contributor-actual" className="block text-sm font-medium text-zk-text">
                      What happened instead? <span className="text-zk-muted">(optional)</span>
                    </label>
                    <Textarea
                      id="contributor-actual"
                      value={actualBehavior}
                      onChange={(e) => setActualBehavior(e.target.value)}
                      maxLength={700}
                      rows={3}
                      placeholder="Button is unresponsive"
                      className="text-base leading-relaxed"
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Duplicate suggestions */}
        {state.matches.length > 0 ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              Has this already been reported?
            </h2>
            <ul className="divide-y divide-amber-500/20">
              {state.matches.map((match) => (
                <li key={`${match.kind}-${match.number}`} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zk-text">
                        {match.title}
                      </p>
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
            variant="primary"
            disabled={pending}
            className="min-h-12 w-full text-base font-semibold sm:ml-auto sm:w-auto sm:min-w-52"
          >
            {pending ? "Sending…" : isImprovement ? "Send suggestion" : "Send report"}
          </Button>
          <p className="text-center text-sm text-zk-muted">
            Only the project team can see your submission until it becomes an issue.
          </p>
        </div>
      </div>
    </form>
  );
}
