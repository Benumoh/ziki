"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { copyText } from "@/lib/clipboard";
import { agentBootstrapMessage } from "@/lib/agents/bootstrap-message";
import { agentPageHref } from "@/lib/header-nav";
import { regenerateAgentKeyAction } from "../actions";
import { checkAgentConnectedAction } from "./actions";
import { DancingAgent, WaitingLine } from "./connect-agent-flow";
import { agentsMutedClass, agentsPrimaryBtn, agentsSecondaryBtn } from "../agents-ui";

type Step = "copy" | "connected";

/** How often the modal asks whether the agent has called in. */
const POLL_MS = 2000;
/** How long the dancing agent stays up before the page moves on to the agent. */
const CLOSE_AFTER_MS = 2500;

/**
 * Connect agent for an agent that already exists (#427), on My agents and on its
 * own page: a modal with the instructions in a text box to copy into your local
 * AI. It waits for the agent to call in from the moment the text is ready
 * (nothing to press after pasting), shows the dancing robot, then goes on to
 * the agent's page. An agent with no key gets one when the modal opens.
 */
export function ConnectAgentModalButton({
  agentId,
  agentName,
  apiKey,
  organisationName,
  label = "Connect agent",
  className = agentsSecondaryBtn,
  startOpen = false,
}: {
  agentId: string;
  agentName: string;
  /** Its live key when it can still be shown; null gets a new one on opening. */
  apiKey: string | null;
  /** The organisation its key works in: the one you are in (#user-agents). */
  organisationName: string | null;
  label?: string;
  className?: string;
  /** Open on arrival (the agent's page from a Connect agent link). */
  startOpen?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("copy");
  const [key, setKey] = useState<string | null>(apiKey);
  const [text, setText] = useState("");
  const [since, setSince] = useState("");
  const [copied, setCopied] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) dialogRef.current?.showModal();
  }, [open]);

  // From the moment the text is ready, ask every couple of seconds whether the agent has used its key since this modal opened.
  useEffect(() => {
    if (step !== "copy" || !open || !text) return;
    let cancelled = false;
    const check = async () => {
      const result = await checkAgentConnectedAction(agentId, since);
      if (cancelled || !result.connected) return;
      setUsername(result.username);
      setStep("connected");
    };
    void check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [step, open, text, agentId, since]);

  // Connected: let the robot dance, then go on to the agent's page (or just refresh it if it's already open).
  useEffect(() => {
    if (step !== "connected") return;
    const timer = setTimeout(() => {
      setOpen(false);
      const destination = username ? agentPageHref(username) : null;
      if (destination && destination !== pathname) router.push(destination);
      else router.refresh();
    }, CLOSE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [step, router, username, pathname]);

  function show(rawKey: string) {
    setText(agentBootstrapMessage({ origin: window.location.origin, apiKey: rawKey, organisationName }));
  }

  function openModal() {
    setStep("copy");
    setCopied(false);
    setUsername(null);
    setError(null);
    setSince(new Date().toISOString());
    setOpen(true);
    if (key) {
      show(key);
      return;
    }
    // No key to show: get one now (nothing stops working, it had none).
    setText("");
    startTransition(async () => {
      const result = await regenerateAgentKeyAction(agentId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setKey(result.rawKey);
      show(result.rawKey);
    });
  }

  // Opened from a Connect agent link: open once, on arrival.
  const opened = useRef(false);
  useEffect(() => {
    if (!startOpen || opened.current) return;
    opened.current = true;
    openModal();
    // openModal reads the current props; this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startOpen]);

  async function copy() {
    const ok = await copyText(text);
    setCopied(ok);
    setError(ok ? null : "Couldn't copy. Select the text and copy it yourself.");
  }

  return (
    <>
      <button type="button" onClick={openModal} className={className}>
        {label}
      </button>

      {open ? (
        <dialog
          ref={dialogRef}
          aria-labelledby="connect-modal-title"
          onCancel={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
          className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-panel border border-zk-border bg-zk-surface p-6 text-zk-text shadow-xl backdrop:bg-black/50"
        >
          {step === "copy" ? (
            <div className="space-y-4">
              <div>
                <h2 id="connect-modal-title" className="text-lg font-extrabold">
                  Connect {agentName}
                </h2>
                <p className={`mt-1 ${agentsMutedClass}`}>
                  Copy this and paste it into your AI coding assistant, such as Claude Code or Cursor.
                </p>
              </div>
              <textarea
                readOnly
                value={pending ? "Getting a key…" : text}
                aria-label={`Instructions for ${agentName}`}
                onFocus={(event) => event.currentTarget.select()}
                rows={8}
                className="w-full resize-none rounded-2xl border border-zk-border bg-zk-chip p-3 font-mono text-[11px] leading-relaxed text-zk-text2 focus-visible:outline-2 focus-visible:outline-electric-blue"
              />
              <p className="text-xs text-zk-muted">It holds your agent&apos;s key: keep it to yourself.</p>
              {error ? <p role="alert" className="text-sm font-semibold text-zk-bad-fg">{error}</p> : null}
              {text ? <WaitingLine name={agentName} /> : null}
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className={agentsSecondaryBtn}>
                  Close
                </button>
                <button type="button" onClick={copy} disabled={!text} className={agentsPrimaryBtn}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ) : null}

          {step === "connected" ? (
            <div className="zk-dance-pop space-y-3 py-2 text-center" role="status">
              <DancingAgent />
              <div className="space-y-1">
                <h2 id="connect-modal-title" className="text-xl font-extrabold">
                  Agent Successfully Connected
                </h2>
                <p className={agentsMutedClass}>{agentName} is ready to work.</p>
              </div>
            </div>
          ) : null}
        </dialog>
      ) : null}
    </>
  );
}
