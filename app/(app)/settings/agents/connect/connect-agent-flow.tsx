"use client";

import Link from "next/link";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { copyText } from "@/lib/clipboard";
import { agentPageHref } from "@/lib/header-nav";
import { checkAgentConnectedAction, startAgentConnectAction } from "./actions";
import {
  agentsInputClass,
  agentsLabelClass,
  agentsMutedClass,
  agentsPrimaryBtn,
  agentsSecondaryBtn,
} from "../agents-ui";

type Step = "name" | "copy" | "connected";

/** How often the dialog asks whether the new agent has called in. */
const POLL_MS = 2000;
/** How long the dancing agent stays up before the page moves on to the agent. */
const CLOSE_AFTER_MS = 2500;

/**
 * Connect agent in three beats: name it, copy one piece of text into the
 * agent, and watch it connect. There is nothing to press after pasting: the
 * dialog waits from the moment the text is ready and, once the agent calls
 * in, goes on to the agent's own page. The text holds the agent's key, so it
 * is copied, never shown in full.
 */
export function ConnectAgentFlow({ ready, next }: { /** False until you are in an organisation: the agent is created active there. */ ready: boolean; /** Where to go once connected instead of the agent's page (Earn: My agents). */ next?: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<{ id: string; name: string; setupText: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // showModal() gives the focus trap, inert background and Escape handling.
  useEffect(() => {
    if (open) dialogRef.current?.showModal();
  }, [open]);

  // From the moment the text is ready, keep asking whether the agent has called in.
  const agentId = agent?.id;
  useEffect(() => {
    if (step !== "copy" || !open || !agentId) return;
    let cancelled = false;
    const check = async () => {
      const result = await checkAgentConnectedAction(agentId);
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
  }, [step, open, agentId]);

  // Connected: let the robot dance, then go on to the agent's page (or where the caller asked).
  const destination = next ?? (username ? agentPageHref(username) : null);
  useEffect(() => {
    if (step !== "connected") return;
    const timer = setTimeout(() => {
      if (destination) {
        router.push(destination);
        return;
      }
      setOpen(false);
      router.refresh();
    }, CLOSE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [step, router, destination]);

  /** Every opening starts from a blank name. */
  function openDialog() {
    setStep("name");
    setName("");
    setError(null);
    setAgent(null);
    setCopied(false);
    setUsername(null);
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const result = await startAgentConnectAction({ name: name.trim() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAgent({ id: result.agentId, name: result.name, setupText: result.setupText });
      setStep("copy");
    });
  }

  async function handleCopy() {
    if (!agent) return;
    const ok = await copyText(agent.setupText);
    setCopied(ok);
    setError(ok ? null : "Couldn't copy. Check your browser's clipboard permission and try again.");
  }

  return (
    <>
      <button type="button" onClick={openDialog} disabled={!ready} className={agentsPrimaryBtn}>
        Connect agent
      </button>

      {open ? (
        <dialog
          ref={dialogRef}
          aria-labelledby="connect-agent-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-panel border border-zk-border bg-zk-surface p-6 text-zk-text shadow-xl backdrop:bg-black/50"
        >
          {step === "name" ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <h2 id="connect-agent-title" className="text-lg font-extrabold">
                Name your agent
              </h2>
              <div className="space-y-1.5">
                <label htmlFor="connect-agent-name" className={agentsLabelClass}>
                  Agent name
                </label>
                <input
                  id="connect-agent-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Claude"
                  required
                  // The dialog opens for this one field.
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  className={agentsInputClass}
                />
              </div>
              {error ? <p role="alert" className="text-sm font-semibold text-zk-bad-fg">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={close} className={agentsSecondaryBtn}>
                  Cancel
                </button>
                <button type="submit" disabled={isPending || !name.trim()} className={agentsPrimaryBtn}>
                  {isPending ? "Creating…" : "Continue"}
                </button>
              </div>
            </form>
          ) : null}

          {step === "copy" && agent ? (
            <div className="space-y-4">
              <h2 id="connect-agent-title" className="text-lg font-extrabold">
                Copy this into {agent.name}
              </h2>
              <div className="flex items-center gap-2 rounded-2xl border border-zk-border bg-zk-chip p-2 pl-3.5">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-zk-text2" aria-hidden="true">
                  {agent.setupText.split("\n")[0]}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className={`inline-flex h-9 shrink-0 items-center rounded-full px-4 text-xs font-bold text-white ${
                    copied ? "bg-zk-ok-fg" : "bg-electric-blue-strong hover:bg-[#2552af]"
                  }`}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className={agentsMutedClass}>
                Paste it into your agent and send it. It holds your agent&apos;s key, so it is only shown here once.
              </p>
              {error ? <p role="alert" className="text-sm font-semibold text-zk-bad-fg">{error}</p> : null}
              <WaitingLine name={agent.name} />
              <div className="flex justify-end">
                <button type="button" onClick={close} className={agentsSecondaryBtn}>
                  Close
                </button>
              </div>
            </div>
          ) : null}

          {step === "connected" && agent ? (
            <div className="zk-dance-pop space-y-3 py-2 text-center" role="status">
              <DancingAgent />
              <div className="space-y-1">
                <h2 id="connect-agent-title" className="text-xl font-extrabold">
                  Agent Successfully Connected
                </h2>
                <p className={agentsMutedClass}>{agent.name} is ready to work.</p>
              </div>
              {/* Earn (#earn-drafts): what the agent can earn is on My agents. */}
              {destination ? (
                <Link href={destination} className={agentsPrimaryBtn}>
                  {next ? "Go to My agents" : `Go to ${agent.name}`}
                </Link>
              ) : null}
            </div>
          ) : null}
        </dialog>
      ) : null}
    </>
  );
}

/** Shown under the text while Ziki waits for the agent's first call: nothing to press, it moves on by itself. */
export function WaitingLine({ name }: { name: string }) {
  return (
    <p role="status" className="flex items-center gap-2.5 rounded-2xl bg-zk-tint px-3.5 py-2.5 text-sm text-zk-text2">
      <span
        className="block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zk-border border-t-electric-blue-strong motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span>
        Waiting for {name} to connect. This moves on by itself.
      </span>
    </p>
  );
}

/** A little robot dancing on the success screen. The moves live in globals.css (zk-dance-*). */
export function DancingAgent() {
  return (
    <svg viewBox="0 0 120 140" width="150" height="175" className="mx-auto overflow-visible" aria-hidden="true">
      <g className="fill-zk-accent text-[15px] font-bold">
        <text x="8" y="52" className="zk-dance-note">♪</text>
        <text x="100" y="40" className="zk-dance-note [animation-delay:600ms]">♫</text>
        <text x="104" y="84" className="zk-dance-note [animation-delay:1200ms]">♪</text>
        <text x="2" y="96" className="zk-dance-note [animation-delay:1800ms]">♫</text>
      </g>
      <ellipse cx="60" cy="133" rx="26" ry="4" className="zk-dance-shadow fill-zk-chip" />

      <g className="zk-dance-body">
        <g className="zk-dance-leg-l">
          <rect x="45" y="100" width="9" height="24" rx="4.5" className="fill-zk-accent" />
          <ellipse cx="48" cy="126" rx="8" ry="4.5" className="fill-zk-text" />
        </g>
        <g className="zk-dance-leg-r">
          <rect x="66" y="100" width="9" height="24" rx="4.5" className="fill-zk-accent" />
          <ellipse cx="72" cy="126" rx="8" ry="4.5" className="fill-zk-text" />
        </g>

        <g className="zk-dance-arm-l">
          <rect x="22" y="66" width="9" height="26" rx="4.5" className="fill-zk-accent" />
          <circle cx="26.5" cy="94" r="5.5" className="fill-zk-text" />
        </g>
        <g className="zk-dance-arm-r">
          <rect x="89" y="66" width="9" height="26" rx="4.5" className="fill-zk-accent" />
          <circle cx="93.5" cy="94" r="5.5" className="fill-zk-text" />
        </g>

        <rect x="32" y="62" width="56" height="42" rx="12" className="fill-electric-blue-strong" />
        <rect x="47" y="72" width="26" height="16" rx="5" fill="#0B1733" />
        <circle cx="60" cy="80" r="4" fill="#5EEAD4" className="zk-dance-glow" />
        <rect x="54" y="55" width="12" height="9" rx="3" className="fill-zk-accent" />

        <g className="zk-dance-head">
          <line x1="60" y1="18" x2="60" y2="8" strokeWidth="2.5" strokeLinecap="round" className="stroke-zk-accent" />
          <circle cx="60" cy="7" r="4.5" fill="#5EEAD4" className="zk-dance-glow" />
          <rect x="25" y="31" width="6" height="14" rx="3" className="fill-zk-accent" />
          <rect x="89" y="31" width="6" height="14" rx="3" className="fill-zk-accent" />
          <rect x="30" y="18" width="60" height="40" rx="14" className="fill-electric-blue-strong" />
          <rect x="37" y="25" width="46" height="26" rx="9" fill="#0B1733" />
          <rect x="46" y="31" width="8" height="10" rx="4" fill="#5EEAD4" className="zk-dance-eye" />
          <rect x="66" y="31" width="8" height="10" rx="4" fill="#5EEAD4" className="zk-dance-eye" />
          <path d="M52 44 Q60 50 68 44" fill="none" stroke="#5EEAD4" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="42" cy="45" r="2.5" fill="#F9A8C0" opacity="0.7" />
          <circle cx="78" cy="45" r="2.5" fill="#F9A8C0" opacity="0.7" />
        </g>
      </g>
    </svg>
  );
}
