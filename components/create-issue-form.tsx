"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { newIssuePath, type ProjectRef } from "@/lib/project-paths";
import { createBugAction, type ActionResult } from "@/app/actions/issues";
import { submitFailureMessage } from "@/lib/submit-error";
import { ErrorSummary, FieldError, useFieldErrors } from "@/components/ui/field-errors";
import type { AppRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CharacterCounter } from "@/components/ui/character-counter";
import { AttachmentPicker } from "@/components/attachment-picker";
import { SimilarIssues } from "@/components/similar-issues";
import { isIssueCreatedRedirect } from "@/lib/issue-created-redirect";
import { MarkdownEditor } from "@/components/markdown-editor";
import { useFormDraft } from "@/components/use-form-draft";
import { buildDraftKey, saveDraftToStorage } from "@/lib/form-drafts";
import { reportedFromLine } from "@/lib/reported-from";
import { DraftBanner } from "@/components/draft-banner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ClaudeWorking } from "@/components/claude-working";
import { initialDescription, templateSwitch } from "@/lib/issue-templates";
import { SECURITY_SEVERITIES, SEVERITY_GUIDE, SEVERITY_LABEL } from "@/lib/security-severity";
import "@/components/security-finding.css";
import type { SecuritySeverity } from "@prisma/client";

/** Must match the title limit enforced by createBugSchema. */
const TITLE_MAX_LENGTH = 200;

type UserOption = { id: string; name: string; role: AppRole; image?: string | null };
type TypeOption = {
  id: string;
  name: string;
  description?: string | null;
  /** Pre-fills the description (#307). */
  template?: string | null;
};

/** Field names as the person sees them, for the error summary. */
const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  typeId: "Type",
  description: "Description",
  proofLinks: "GitHub PR",
  severity: "Severity",
};

export function CreateIssueForm({
  users,
  types = [],
  currentUserId,
  projectId,
  projectSlug,
  variant = "page",
  reportedFrom = null,
  onCancel,
  onDirtyChange,
  defaultSecurity = false,
  defaultTypeId: requestedTypeId,
}: {
  users: UserOption[];
  assigneeUsers?: UserOption[];
  types?: TypeOption[];
  isAdmin: boolean;
  currentUserId?: string;
  projectId?: string | null;
  /** The project the form was opened in, for the full report page link. */
  projectSlug: ProjectRef;
  /**
   * "page": the full report page (detailed by default, with a link to a
   * quick report). "modal": the quick report opened over the current page.
   */
  variant?: "page" | "modal";
  /** The in-app page a modal report was opened from, already validated. */
  reportedFrom?: string | null;
  /** Modal only: Cancel asks the modal to close. */
  onCancel?: () => void;
  /** Modal only: whether anything has been typed or attached, for the discard prompt. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Open with "This is a security vulnerability" ticked (the Security page's report button). */
  defaultSecurity?: boolean;
  /** The type to start at, e.g. from a section's Add Feature button; otherwise Fix. */
  defaultTypeId?: string;
}) {
  const inModal = variant === "modal";
  const defaultTypeId =
    (requestedTypeId && types.some((t) => t.id === requestedTypeId) ? requestedTypeId : null) ??
    types.find((t) => t.name.toLowerCase() === "fix")?.id ?? types[0]?.id ?? "";
  const templateOf = (id: string) => types.find((t) => t.id === id)?.template ?? null;
  const confirm = useConfirm();

  // #307: changing type offers that type's template. An untouched template
  // or a blank field is swapped silently; anything typed is only replaced
  // after asking.
  async function changeType(nextTypeId: string) {
    const current = values.description;
    const decision = templateSwitch(current, templateOf(values.typeId), templateOf(nextTypeId));
    setValue("typeId", nextTypeId);
    if (decision.kind === "replace") {
      setValue("description", decision.text);
    } else if (decision.kind === "confirm") {
      const typeName = types.find((t) => t.id === nextTypeId)?.name ?? "this type";
      const ok = await confirm({
        title: `Use the ${typeName} template?`,
        body: "It replaces what you've written in the description. Keep your text to change only the type.",
        confirmLabel: "Replace with template",
        cancelLabel: "Keep my text",
      });
      if (ok) setValue("description", decision.text);
    }
  }

  const draftKey = buildDraftKey({
    userId: currentUserId,
    formType: "create-bug",
    projectId,
  });

  const { values, setValue, isRestored, clearDraft, discardDraft } = useFormDraft(
    draftKey,
    {
      title: "",
      typeId: defaultTypeId,
      description: initialDescription(templateOf(defaultTypeId)),
      proofLinks: "",
    },
  );
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"report" | "detailed">(inModal ? "report" : "detailed");
  // #security-findings: a private report. Its details stay hidden until authorized disclosure.
  const [security, setSecurity] = useState(defaultSecurity);
  const [severity, setSeverity] = useState<SecuritySeverity | "">("");
  const [includeFrom, setIncludeFrom] = useState(Boolean(reportedFrom));
  const [editorUploading, setEditorUploading] = useState(false);
  const [pickerUploading, setPickerUploading] = useState(false);
  const isUploading = editorUploading || pickerUploading;
  const [error, setError] = useState<string | null>(null);
  // True when the request itself failed (network / server error), so the
  // person can simply retry; validation errors from the server aren't retryable.
  const [canRetry, setCanRetry] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const errs = useFieldErrors("report", formRef);
  const mentionUsers = users.map((user) => ({ id: user.id, name: user.name }));
  const untouchedDescription = initialDescription(templateOf(values.typeId));
  const dirty =
    values.title.trim() !== "" ||
    (values.description.trim() !== "" && values.description !== untouchedDescription) ||
    attachmentIds.length > 0;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // Similar issues are matched as you type: on the title, or in a quick
  // report (where the title is optional) on the start of the description.
  // A private security report is never matched against public issues as you type.
  const similarQuery = security
    ? ""
    : values.title.trim() || (mode === "report" ? values.description.trim().slice(0, 160) : "");
  const sideHasFields =
    !inModal && mode === "detailed";

  return (
    <form
      ref={formRef}
      className="create-issue-form space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || isUploading) return;
        setError(null);
        setCanRetry(false);
        errs.clear();
        const formData = new FormData();
        formData.set("title", values.title);
        formData.set(
          "description",
          mode === "report" && includeFrom && reportedFrom
            ? `${values.description.trimEnd()}\n\n${reportedFromLine(reportedFrom)}`
            : values.description,
        );
        formData.set("attachmentIds", attachmentIds.join(","));
        formData.set("isReport", mode === "report" ? "true" : "false");
        // The project the form was opened in (#project-urls); the action checks it is in the organisation.
        if (projectId) formData.set("projectId", projectId);
        if (mode === "detailed") {
          formData.set("typeId", values.typeId);
          formData.set("proofLinks", values.proofLinks);
        }
        if (security) {
          formData.set("security", "true");
          formData.set("severity", severity);
        }
        startTransition(async () => {
          try {
            const result: ActionResult = await createBugAction(formData);
            if (result.error) {
              // A field-specific error goes beside its control and takes
              // focus there; only an error about no field in particular
              // stays as the form-level alert at the bottom.
              if (result.field || result.fieldErrors) errs.show(result);
              else setError(result.error);
            } else {
              clearDraft();
            }
          } catch (error) {
            if (isIssueCreatedRedirect(error)) clearDraft();
            unstable_rethrow(error);
            setError(submitFailureMessage(navigator.onLine));
            setCanRetry(true);
          }
        });
      }}
    >
      {isRestored ? (
        <DraftBanner
          onDiscard={discardDraft}
          message="Restored unsaved draft from this browser"
        />
      ) : null}

      {inModal ? null : mode === "detailed" ? (
        <p className="create-mode-note text-sm text-zk-text2">
          Short on time?{" "}
          <button type="button" onClick={() => setMode("report")} className="create-mode-link">
            Send a quick report
          </button>
        </p>
      ) : (
        <p className="create-mode-note text-sm text-zk-text2">
          Quick report: tell us what happened. We&apos;ll sort out the details.{" "}
          <button type="button" onClick={() => setMode("detailed")} className="create-mode-link">
            Add more detail
          </button>
        </p>
      )}

      <ErrorSummary errors={errs.fieldErrors} labels={FIELD_LABELS} />

      <div className={sideHasFields ? "create-layout" : "create-layout create-layout--single"}>
        <div className="create-main create-fields space-y-4">
          {inModal ? null : (
              <div className="space-y-1.5">
                <label htmlFor="title" className="text-sm font-medium text-slate-700">
                  Title
                </label>
                <Input
                  id="title"
                  name="title"
                  required={mode === "detailed"}
                  minLength={mode === "detailed" ? 3 : undefined}
                  maxLength={TITLE_MAX_LENGTH}
                  placeholder={
                    mode === "report"
                      ? "Short summary (optional — auto-generated from description if empty)"
                      : "Short summary of the issue"
                  }
                  value={values.title}
                  onChange={(event) => setValue("title", event.target.value)}
                  {...errs.attrs("title")}
                />
                <CharacterCounter
                  length={values.title.length}
                  max={TITLE_MAX_LENGTH}
                  className="text-right"
                />
                <FieldError formId={errs.formId} field="title" errors={errs.fieldErrors} />
                <SimilarIssues title={similarQuery} />
              </div>
          )}
          <div className="create-description space-y-1.5">
            <label
              id="description-label"
              htmlFor="description"
              className="text-sm font-medium text-slate-700"
            >
              {mode === "report" ? "What happened?" : "Description"}
            </label>
            <MarkdownEditor
              id="description"
              labelId="description-label"
              name="description"
              required
              minLength={10}
              maxLength={5000}
              rows={6}
              placeholder={
                mode === "report"
                  ? "Describe what happened in your own words. What were you doing, and what went wrong?"
                  : "Steps to reproduce, expected vs actual, environment…"
              }
              value={values.description}
              onChange={(val) => setValue("description", val)}
              onUploadingChange={setEditorUploading}
              users={mentionUsers}
              {...errs.attrs("description")}
              footer={
                <p className="text-xs text-slate-500">
                  {mode === "report"
                    ? "Markdown is supported. Plain language is welcome; our agents will structure the report."
                    : "Markdown is supported. Be specific: what should happen, what actually happens, and how to reproduce it."}
                </p>
              }
            />
            <FieldError formId={errs.formId} field="description" errors={errs.fieldErrors} />
          </div>
          {inModal ? <SimilarIssues title={similarQuery} /> : null}
          <fieldset className="create-attachments space-y-1.5">
            <legend className="text-sm font-medium text-slate-700">
              Screenshots and files
            </legend>
            <p className="text-xs text-slate-500">
              Optional. No GitHub account needed: attach a screenshot, console log
              or recording export straight to the report.
            </p>
            <AttachmentPicker
              name="attachmentIdsPicker"
              onChange={setAttachmentIds}
              onUploadingChange={setPickerUploading}
              disabled={pending}
            />
          </fieldset>
          <fieldset className="create-security space-y-2 rounded-xl border border-zk-line bg-zk-bg px-3 py-3">
            <legend className="sr-only">Security</legend>
            <label className="flex items-start gap-2 text-sm font-medium text-zk-text">
              <input
                type="checkbox"
                name="security"
                className="mt-0.5"
                checked={security}
                onChange={(event) => setSecurity(event.target.checked)}
              />
              <span>
                This is a security vulnerability: keep it private
                <span className="block text-xs font-normal text-zk-text2">
                  Only you, this workspace&apos;s owners and admins, and agents cleared for security work will see the details.
                  Everyone else sees &quot;Private security finding&quot; until a workspace owner or admin publishes it.
                </span>
              </span>
            </label>
            {security ? (
              <div role="radiogroup" aria-labelledby="severity-label" className="space-y-1.5 pl-6">
                <p id="severity-label" className="text-sm font-medium text-zk-text">How serious is it?</p>
                {SECURITY_SEVERITIES.map((level) => (
                  <label key={level} className="flex items-start gap-2 text-sm text-zk-text">
                    <input
                      type="radio"
                      name="severity"
                      value={level}
                      className="mt-0.5"
                      checked={severity === level}
                      onChange={() => setSeverity(level)}
                      {...(level === "critical" ? errs.attrs("severity") : {})}
                    />
                    <span>
                      <span className={`security-severity security-severity--text security-severity--${level} font-semibold`}>{SEVERITY_LABEL[level]}</span>
                      <span className="block text-xs text-zk-text2">{SEVERITY_GUIDE[level]}</span>
                    </span>
                  </label>
                ))}
                <FieldError formId={errs.formId} field="severity" errors={errs.fieldErrors} />
              </div>
            ) : null}
          </fieldset>
          {inModal && reportedFrom && includeFrom ? (
            <div className="create-from flex flex-wrap items-center gap-2 rounded-xl bg-zk-bg px-3 py-2 text-sm text-zk-text2">
              <span className="min-w-0 flex-1">
                We&apos;ll include the page you were on:{" "}
                <span className="font-semibold text-zk-text break-all">{reportedFrom}</span>
              </span>
              <button
                type="button"
                onClick={() => setIncludeFrom(false)}
                className="create-mode-link"
                aria-label={`Remove ${reportedFrom} from the report`}
              >
                Remove
              </button>
            </div>
          ) : null}
        </div>
        {sideHasFields ? (
          <aside className="create-side create-fields space-y-4" aria-label="Issue details">
            {mode === "detailed" && types.length > 0 ? (
              <div className="space-y-1.5">
                <label htmlFor="typeId" className="text-sm font-medium text-slate-700">
                  Type
                </label>
                <Select
                  id="typeId"
                  name="typeId"
                  value={values.typeId}
                  onChange={(event) => void changeType(event.target.value)}
                  {...errs.attrs("typeId")}
                >
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </Select>
                <FieldError formId={errs.formId} field="typeId" errors={errs.fieldErrors} />
              </div>
            ) : null}
          {mode === "detailed" ? (
            <div className="space-y-1.5">
              <label
                htmlFor="proofLinks"
                className="text-sm font-medium text-slate-700"
              >
                GitHub PR
              </label>
              <Textarea
                id="proofLinks"
                name="proofLinks"
                rows={3}
                placeholder={
                  "https://github.com/organisation/repo/pull/123"
                }
                value={values.proofLinks}
                onChange={(event) => setValue("proofLinks", event.target.value)}
                {...errs.attrs("proofLinks")}
              />
              <FieldError formId={errs.formId} field="proofLinks" errors={errs.fieldErrors} />
              <p className="text-xs text-zk-muted">
                Optional. One GitHub link per line (e.g. https://github.com/organisation/repo/pull/123).
              </p>
            </div>
          ) : null}

          </aside>
        ) : null}
      </div>
      {error ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" role="alert">
          <p className="text-sm text-red-600">{error}</p>
          {canRetry ? (
            <button
              type="button"
              disabled={pending || isUploading}
              onClick={() => formRef.current?.requestSubmit()}
              className="text-sm font-medium text-teal-700 underline-offset-2 hover:underline disabled:opacity-50"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
      {inModal ? (
        <div className="create-modal-actions flex flex-wrap items-center gap-3">
          {/* A full page load on purpose: a client-side navigation would be
              intercepted again and keep the modal open. The draft is saved
              first (it normally saves after a pause), so the full form opens
              with what was typed. */}
          <a
            href={newIssuePath(projectSlug)}
            className="create-mode-link create-more-detail"
            onClick={() => saveDraftToStorage(draftKey, values)}
          >
            Add more detail
          </a>
          <span className="flex-1" />
          <Button type="button" variant="secondary" className="create-cancel" onClick={() => onCancel?.()}>
            Cancel
          </Button>
          <Button className="create-submit" type="submit" disabled={pending || isUploading}>
            {pending ? "Sending…" : isUploading ? "Uploading…" : "Send report"}
          </Button>
        </div>
      ) : (
        <Button className="create-submit" type="submit" disabled={pending || isUploading}>
          {pending ? "Creating…" : isUploading ? "Uploading…" : "Create issue"}
        </Button>
      )}
      {/* While the idea goes to Claude to be written up, show the work happening. */}
      {pending && !security ? <ClaudeWorking className="mt-3" /> : null}
    </form>
  );
}

export { CreateIssueForm as CreateBugForm };
