"use client";

import {
  useActionState,
  useState,
  useTransition,
  useCallback,
  useEffect,
  useRef,
  useId,
} from "react";
import Link from "next/link";
import {
  createWebhookAction,
  type CreateWebhookResult,
  deleteWebhookAction,
  type DeleteWebhookResult,
  listWebhooksAction,
  type ListWebhooksResult,
  reEnableWebhookAction,
  type ReEnableWebhookResult,
  type WebhookSubscriptionRow,
} from "@/app/actions/webhooks";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { copyText } from "@/lib/clipboard";
import { RelativeTime } from "@/components/relative-time";
import { FieldError, useFieldErrors } from "@/components/ui/field-errors";
import { AgentAvatar } from "@/components/agent-avatar";

type UrlState = "empty" | "nothttps" | "invalid" | "ok";

function classifyUrl(raw: string): UrlState {
  const u = raw.trim();
  if (!u) return "empty";
  if (!/^https:\/\//i.test(u)) return "nothttps";
  if (!/^https:\/\/[^\s/]+\.[^\s/]+/i.test(u)) return "invalid";
  return "ok";
}

const URL_HINTS: Record<UrlState, string> = {
  empty: "Must start with https:// — plain HTTP endpoints are not accepted.",
  nothttps: "Use an https:// address. Events are only delivered over HTTPS.",
  invalid: "That doesn't look like a full URL yet.",
  ok: "Looks good.",
};

function statusChip(enabled: boolean) {
  if (enabled) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-zk-ok-bg px-2.5 py-0.5 text-xs font-bold text-zk-ok-fg">
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zk-bad-bg px-2.5 py-0.5 text-xs font-bold text-zk-bad-fg">
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      Disabled
    </span>
  );
}

const DELIVERY_STEPS = [
  {
    n: 1,
    title: "Pick an agent",
    body: "Each subscription belongs to one of your agents and receives that agent’s events.",
  },
  {
    n: 2,
    title: "Add your HTTPS endpoint",
    body: "Ziki POSTs each event to the URL you enter. Only HTTPS is accepted.",
  },
  {
    n: 3,
    title: "Verify every delivery",
    body: "Requests are signed with HMAC-SHA256 using the subscription’s signing secret.",
  },
] as const;

export function WebhookManagement() {
  const toast = useToast();
  const confirm = useConfirm();
  const agentLabelId = useId();

  const [subscriptions, setSubscriptions] = useState<WebhookSubscriptionRow[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string; avatar: string | null }[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const result: ListWebhooksResult = await listWebhooksAction();
      if (result.ok) {
        setSubscriptions(result.subscriptions);
        setAgents(result.agents);
        setListError(null);
      } else {
        setListError(result.error);
      }
    } catch {
      setListError("Couldn't load webhook subscriptions. Please try again.");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const [agentId, setAgentId] = useState("");
  const [url, setUrl] = useState("");
  const [createdSecret, setCreatedSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const createFormRef = useRef<HTMLFormElement | null>(null);
  const secretDialogRef = useRef<HTMLDialogElement | null>(null);
  const secretDialogReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = secretDialogRef.current;
    if (createdSecret && dialog && !dialog.open) {
      const activeElement = document.activeElement;
      secretDialogReturnFocusRef.current =
        activeElement instanceof HTMLElement && activeElement !== document.body
          ? activeElement
          : null;
      dialog.showModal();
    }
  }, [createdSecret]);

  const urlState = classifyUrl(url);
  const canAdd = Boolean(agentId) && urlState === "ok";
  const picked = agents.find((a) => a.id === agentId);
  const activeCount = subscriptions.filter((s) => s.enabled).length;
  const subCountLabel =
    activeCount === 1 ? "1 active" : `${activeCount} active`;

  const [createResult, createAction, createPending] = useActionState<
    CreateWebhookResult | undefined,
    FormData
  >(
    async (_previous, formData) => {
      const next = await createWebhookAction(_previous, formData);
      if (next.ok) {
        setCreatedSecret(next.secret);
        setCopied(false);
        setUrl("");
        setAgentId("");
        await load();
      }
      return next;
    },
    undefined,
  );
  const createError = createResult && !createResult.ok ? createResult : null;

  const createFieldErrors = useFieldErrors("create-webhook-form", createFormRef);
  if (createError) {
    createFieldErrors.show(createError);
  }

  async function copyCreatedSecret() {
    const ok = await copyText(createdSecret);
    if (ok) {
      setCopied(true);
      toast("Signing secret copied.");
    } else {
      toast("Couldn't copy. Select the secret and copy it.");
    }
  }

  const [, reEnableAction, reEnablePending] = useTransitionAction<
    ReEnableWebhookResult,
    string
  >(reEnableWebhookAction, async (result) => {
    if (result.ok) {
      toast("Webhook re-enabled.", "success");
      await load();
    } else {
      toast(result.error, "error");
    }
  });

  const [, deleteAction, deletePending] = useTransitionAction<
    DeleteWebhookResult,
    string
  >(deleteWebhookAction, async (result) => {
    if (result.ok) {
      toast("Webhook deleted.", "success");
      await load();
    } else {
      toast(result.error, "error");
    }
  });

  function handleReEnable(id: string) {
    void reEnableAction(id);
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Delete webhook subscription?",
      body: "This stops all future deliveries. It can't be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    void deleteAction(id);
  }

  if (listError) {
    return (
      <div
        className="space-y-3 rounded-panel border border-zk-bad-bd bg-zk-bad-bg p-5 text-sm text-zk-bad-fg"
        role="alert"
      >
        <p>{listError}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-10 items-center rounded-full border border-zk-border bg-zk-surface px-4 text-sm font-bold text-zk-text"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="rounded-panel border border-zk-border bg-zk-surface p-6 text-sm text-zk-muted">
        Loading webhook subscriptions…
      </div>
    );
  }

  const formSummary = picked
    ? `Events for ${picked.name}${urlState === "ok" ? ` → ${url.trim()}` : ""}`
    : "Choose an agent to continue";

  const urlBorderClass =
    urlState === "nothttps" || urlState === "invalid"
      ? "border-zk-bad-fg"
      : urlState === "ok"
        ? "border-zk-ok-fg"
        : "border-zk-border";

  const urlHintClass =
    urlState === "ok"
      ? "font-bold text-zk-ok-fg"
      : urlState === "empty"
        ? "font-medium text-zk-muted"
        : "font-bold text-zk-bad-fg";

  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-4">
        <section
          aria-label="Subscriptions"
          className="flex flex-col gap-3.5 rounded-panel border border-zk-border bg-zk-surface p-[22px]"
        >
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-lg font-bold text-zk-text">Subscriptions</h2>
            <span className="text-[13px] text-zk-muted">{subCountLabel}</span>
          </div>

          {subscriptions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zk-border bg-zk-tint px-6 py-10 text-center">
              <span
                className="flex h-14 w-14 items-center justify-center rounded-panel bg-zk-surface text-zk-accent shadow-[0_8px_20px_rgba(46,111,239,0.15)]"
                aria-hidden="true"
              >
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" />
                  <path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" />
                  <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8" />
                </svg>
              </span>
              <span className="text-base font-bold text-zk-text">
                No webhook subscriptions yet
              </span>
              <span className="max-w-[440px] text-sm leading-relaxed text-zk-muted">
                Add one below to start receiving agent events at your own HTTPS
                endpoint.
              </span>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {subscriptions.map((sub) => {
                return (
                  <li
                    key={sub.id}
                    className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-zk-border px-4 py-3.5"
                  >
                    <AgentAvatar agentId={sub.agent.id} avatar={sub.agent.avatar} size={40} />
                    <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
                      <span className="text-sm font-bold text-zk-text">
                        {sub.agent.name}
                      </span>
                      <a
                        href={sub.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate font-mono text-[13px] text-zk-text2 hover:text-zk-accent hover:underline"
                      >
                        {sub.url}
                      </a>
                    </div>
                    {statusChip(sub.enabled)}
                    <span className="text-xs text-zk-muted">
                      {sub.lastDeliveredAt ? (
                        <>
                          Last delivery <RelativeTime date={sub.lastDeliveredAt} />
                        </>
                      ) : (
                        <>
                          Added <RelativeTime date={sub.createdAt} />
                        </>
                      )}
                      {sub.failureCount > 0 ? (
                        <span className="ml-2 font-semibold text-zk-bad-fg">
                          · {sub.failureCount} failure
                          {sub.failureCount === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {!sub.enabled ? (
                        <button
                          type="button"
                          onClick={() => handleReEnable(sub.id)}
                          disabled={reEnablePending || deletePending}
                          className="inline-flex h-9 items-center rounded-full border border-zk-border bg-zk-surface px-3 text-[13px] font-bold text-zk-text disabled:opacity-50"
                        >
                          Re-enable
                        </button>
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Delete webhook for ${sub.agent.name}`}
                        onClick={() => void handleDelete(sub.id)}
                        disabled={reEnablePending || deletePending}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zk-bad-bd bg-zk-bad-soft text-zk-bad-fg disabled:opacity-50"
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                        </svg>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {createdSecret ? (
          <dialog
            ref={secretDialogRef}
            aria-labelledby="webhook-secret-title"
            onCancel={(event) => {
              event.preventDefault();
              secretDialogRef.current?.close();
            }}
            onClose={() => {
              setCreatedSecret("");
              setCopied(false);
              const returnFocus = secretDialogReturnFocusRef.current;
              secretDialogReturnFocusRef.current = null;
              if (returnFocus?.isConnected && !returnFocus.matches(":disabled")) {
                returnFocus.focus();
              } else {
                createFormRef.current
                  ?.querySelector<HTMLInputElement>("#webhook-url")
                  ?.focus();
              }
            }}
            className="m-auto max-h-[calc(100dvh-2rem)] w-[min(42rem,calc(100vw-2rem))] max-w-full overflow-y-auto flex-col gap-3 rounded-panel border border-zk-warn-bd bg-zk-warn-bg px-[22px] py-5 text-zk-text shadow-xl backdrop:bg-black/50 open:flex"
          >
            <div className="flex items-start gap-3">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-zk-warn-fg"
              >
                <circle cx="7.5" cy="15.5" r="4.5" />
                <path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2" />
              </svg>
              <div className="flex flex-col gap-1">
                <h2
                  id="webhook-secret-title"
                  className="text-[15px] font-bold text-zk-warn-fg"
                >
                  Copy your signing secret now
                </h2>
                <span className="text-[13px] leading-snug text-zk-text2">
                  You&rsquo;ll use it to verify{" "}
                  <code>X-Ziki-Signature</code> headers. For your security,
                  it&rsquo;s only shown once.
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-[1_1_280px] overflow-x-auto whitespace-nowrap rounded-xl border border-zk-warn-bd bg-zk-surface px-3.5 py-3 font-mono text-[13px] text-zk-text">
                {createdSecret}
              </code>
              <button
                type="button"
                onClick={() => void copyCreatedSecret()}
                className={`inline-flex h-[42px] items-center rounded-full px-4 text-sm font-bold text-white ${
                  copied
                    ? "bg-[#146C43]"
                    : "bg-electric-blue-strong shadow-[0_8px_20px_rgba(46,111,239,0.30)]"
                }`}
              >
                {copied ? "Copied" : "Copy secret"}
              </button>
              <button
                type="button"
                onClick={() => {
                  secretDialogRef.current?.close();
                }}
                className="inline-flex h-[42px] items-center rounded-full border border-zk-border bg-zk-surface px-4 text-sm font-bold text-zk-text"
              >
                Done
              </button>
            </div>
          </dialog>
        ) : null}

        <section
          aria-label="Add webhook"
          className="flex flex-col gap-[18px] rounded-panel border border-zk-border bg-zk-surface p-6"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-bold text-zk-text">Add webhook</h2>
            <p className="text-[13px] leading-relaxed text-zk-muted">
              Pick one of your agents, enter its HTTPS webhook endpoint, then copy
              the signing secret it generates.
            </p>
          </div>

          <form
            action={createAction}
            className="flex flex-col gap-[18px]"
            noValidate
            id="create-webhook-form"
            ref={createFormRef}
          >
            <input type="hidden" name="agentId" value={agentId} />

            <div className="flex flex-col gap-2">
              <span
                id={agentLabelId}
                className="text-[13px] font-bold text-zk-text"
              >
                Agent
              </span>
              {agents.length === 0 ? (
                <p className="rounded-xl border border-dashed border-zk-border bg-zk-tint px-4 py-3 text-sm text-zk-muted">
                  You need an agent before you can add a webhook.{" "}
                  <Link
                    href="/settings/agents"
                    className="font-semibold text-zk-accent hover:underline"
                  >
                    Manage agents
                  </Link>
                </p>
              ) : (
                <div
                  role="radiogroup"
                  aria-labelledby={agentLabelId}
                  className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5"
                >
                  {agents.map((agent) => {
                    const on = agentId === agent.id;
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setAgentId(agent.id)}
                        className={`flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left ${
                          on
                            ? "border-2 border-electric-blue-strong bg-zk-tint"
                            : "m-px border border-zk-border bg-zk-surface"
                        }`}
                      >
                        <AgentAvatar agentId={agent.id} avatar={agent.avatar} size={34} />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-[13px] font-bold text-zk-text">
                            {agent.name}
                          </span>
                        </span>
                        <span
                          className={`h-[18px] w-[18px] shrink-0 rounded-full box-border ${
                            on
                              ? "border-[5px] border-electric-blue-strong bg-white"
                              : "border-2 border-zk-border"
                          }`}
                          aria-hidden="true"
                        />
                      </button>
                    );
                  })}
                </div>
              )}
              <FieldError
                formId="create-webhook-form"
                field="agentId"
                errors={createFieldErrors.fieldErrors}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="webhook-url"
                className="text-[13px] font-bold text-zk-text"
              >
                HTTPS endpoint URL
              </label>
              <span className="relative block">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-[15px] text-zk-muted"
                >
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                <input
                  id="webhook-url"
                  name="url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/hooks/ziki"
                  spellCheck={false}
                  required
                  maxLength={2048}
                  aria-invalid={
                    createFieldErrors.fieldErrors.url ||
                    urlState === "nothttps" ||
                    urlState === "invalid"
                      ? true
                      : undefined
                  }
                  aria-describedby="webhook-url-hint create-webhook-form-url-error"
                  className={`h-12 w-full rounded-xl border bg-zk-surface pl-10 pr-3.5 font-mono text-sm text-zk-text placeholder:text-zk-muted focus:outline-none focus:ring-2 focus:ring-electric-blue/25 ${urlBorderClass}`}
                />
              </span>
              <span id="webhook-url-hint" className={`text-xs ${urlHintClass}`}>
                {URL_HINTS[urlState]}
              </span>
              <FieldError
                formId="create-webhook-form"
                field="url"
                errors={createFieldErrors.fieldErrors}
              />
            </div>

            {createError ? (
              <p
                id="create-webhook-form-error"
                className="text-sm font-semibold text-zk-bad-fg"
                role="alert"
              >
                {createError.error}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zk-divider pt-4">
              <span className="text-[13px] text-zk-muted">{formSummary}</span>
              <button
                type="submit"
                disabled={createPending || !canAdd}
                className={`inline-flex h-[46px] items-center gap-2 rounded-full px-[22px] text-sm font-bold ${
                  canAdd && !createPending
                    ? "bg-electric-blue-strong text-white shadow-[0_8px_20px_rgba(46,111,239,0.30)]"
                    : "cursor-not-allowed bg-zk-chip text-zk-muted"
                }`}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {createPending ? "Creating…" : "Add webhook"}
              </button>
            </div>
          </form>
        </section>
      </div>

      <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
        <section className="flex flex-col gap-3.5 rounded-panel border border-zk-border bg-zk-surface p-[22px]">
          <h2 className="text-base font-bold text-zk-text">How delivery works</h2>
          {DELIVERY_STEPS.map((step) => (
            <div key={step.n} className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zk-tint text-[13px] font-extrabold text-zk-accent">
                {step.n}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-bold text-zk-text">{step.title}</span>
                <span className="text-[13px] leading-snug text-zk-text2">
                  {step.body}
                </span>
              </div>
            </div>
          ))}
        </section>
        <section className="flex flex-col gap-2.5 rounded-panel bg-deep-ocean p-5 text-[#DCE5F5]">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#A9BCDF]">
            Verify a signature
          </span>
          <pre className="m-0 overflow-x-auto font-mono text-xs leading-[1.7] text-[#DCE5F5]">
            {`expected = hmac_sha256(
  secret, raw_request_body
)
if !timing_safe_equal(
  expected, signature_header
):
  reject(401)`}
          </pre>
          <span className="text-xs text-[#A9BCDF]">
            Header name and payload format: see the webhook docs.
          </span>
        </section>
      </aside>
    </div>
  );
}

function useTransitionAction<TResult, TId>(
  action: (id: TId) => Promise<TResult>,
  onDone: (result: TResult) => void | Promise<void>,
) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TResult | null>(null);

  const run = useCallback(
    (id: TId) => {
      startTransition(async () => {
        const next = await action(id);
        setResult(next);
        await onDone(next);
      });
    },
    [action, onDone],
  );

  return [result, run, pending] as const;
}
