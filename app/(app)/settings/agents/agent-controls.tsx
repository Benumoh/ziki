"use client";

import type { AgentLevel } from "@prisma/client";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteAgentAction, regenerateAgentKeyAction, revokeAgentAction, setAgentLevelAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { AGENT_LEVEL_LABELS } from "@/lib/agents/levels";
import type { AgentProjectChoice } from "./create-agent-form";
import {
  agentsDangerBtn,
  agentsInputClass,
  agentsPrimaryBtn,
} from "./agents-ui";

/**
 * An agent's row controls on My agents, as its owner or a team admin (#427):
 * its class, and a More menu to get a new key, revoke or delete it. How often
 * it may call Ziki (the high-volume budget) is set on the agent's own page.
 */
export function AgentControls({
  agentId,
  agentName,
  level,
  levels,
  projects,
  currentProjectId,
  revoked = false,
  personal = false,
}: {
  agentId: string;
  agentName: string;
  level: AgentLevel;
  /** The levels this person may set. */
  levels: AgentLevel[];
  projects: AgentProjectChoice[];
  /** The project the live key is limited to, when it has one. */
  currentProjectId?: string | null;
  /** A revoked agent only offers delete. */
  revoked?: boolean;
  /** The automatic personal agent is created again on the next visit. */
  personal?: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [current, setCurrent] = useState(level);
  // A regenerated key stays on the project the current key is limited to.
  const projectId = currentProjectId || projects[0]?.id || "";
  const [issued, setIssued] = useState<{ rawKey: string; prefix: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function changeLevel(next: AgentLevel) {
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      const result = await setAgentLevelAction(agentId, next);
      if (result.ok) {
        toast(`${agentName} is now a ${AGENT_LEVEL_LABELS[next].toLowerCase()}.`, "success");
      } else {
        setCurrent(previous);
        toast(result.error, "error");
      }
    });
  }

  async function regenerate() {
    const projectName = projects.find((project) => project.id === projectId)?.name ?? "the chosen project";
    const ok = await confirm({
      title: `Get a new key for ${agentName}?`,
      body: `The current key stops working immediately. The new key only works in ${projectName}, and it stays on this agent's row.`,
      confirmLabel: "Get a new key",
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await regenerateAgentKeyAction(agentId, projectId);
      if (result.ok) {
        setIssued({ rawKey: result.rawKey, prefix: result.prefix });
        toast("New key issued. Copy it now.", "success");
      } else {
        toast(result.error, "error");
      }
    });
  }

  async function copyIssued() {
    if (!issued) return;
    toast((await copyText(issued.rawKey)) ? "Key copied." : "Couldn't copy. Select the key and copy it.");
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete ${agentName}?`,
      body: personal
        ? "The agent is removed from this list and its key stops working. A new personal agent is created the next time its owner opens Agents. Issues it filed stay. This can't be undone."
        : "The agent is removed from this list. Its key stops working, and any offer, claim, or bid it held is handed back. Issues it filed stay. This can't be undone.",
      confirmLabel: "Delete agent",
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await deleteAgentAction(agentId);
      toast(result.ok ? `${agentName} was deleted.` : result.error, result.ok ? "success" : "error");
    });
  }

  async function revoke() {
    const ok = await confirm({
      title: `Revoke ${agentName}?`,
      body: "Its keys stop working immediately. This can't be undone; register a new agent to replace it.",
      confirmLabel: "Revoke agent",
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await revokeAgentAction(agentId);
      toast(result.ok ? `${agentName} was revoked.` : result.error, result.ok ? "success" : "error");
    });
  }

  if (revoked) {
    return (
      <Button type="button" onClick={remove} disabled={pending} className={agentsDangerBtn}>
        Delete
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-3 sm:items-end">
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <label htmlFor={`level-${agentId}`} className="sr-only">
          Agent class for {agentName}
        </label>
        <Select
          id={`level-${agentId}`}
          value={current}
          disabled={pending}
          onChange={(event) => changeLevel(event.target.value as AgentLevel)}
          className={`${agentsInputClass} !w-auto min-w-[9rem]`}
        >
          {[...new Set([current, ...levels])].map((option) => (
            <option key={option} value={option} disabled={!levels.includes(option)}>
              {AGENT_LEVEL_LABELS[option]}
            </option>
          ))}
        </Select>
        <MoreMenu
          agentName={agentName}
          disabled={pending}
          items={[
            { label: "Get a new key", onSelect: regenerate, disabled: !projectId },
            { label: "Revoke", onSelect: revoke, danger: true },
            { label: "Delete", onSelect: remove, danger: true },
          ]}
        />
      </div>
      {issued ? (
        <div
          className="w-full space-y-2 rounded-[16px] border border-zk-warn-bd bg-zk-warn-bg/40 p-3 sm:max-w-md"
          role="status"
        >
          <p className="text-sm font-semibold text-zk-text">
            New key for {agentName} ({issued.prefix}…). Copy it now. It stays on this agent&apos;s row.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              readOnly
              value={issued.rawKey}
              aria-label={`New key for ${agentName}`}
              className={`${agentsInputClass} font-mono text-xs`}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button type="button" onClick={copyIssued} className={agentsPrimaryBtn}>
              Copy key
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The row's less frequent actions, behind one button so the row stays quiet. */
function MoreMenu({
  agentName,
  disabled,
  items,
}: {
  agentName: string;
  disabled: boolean;
  items: { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More for ${agentName}`}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-zk-border bg-zk-surface px-4 text-sm font-bold text-zk-text transition hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        More
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`motion-safe:transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div role="menu" aria-label={`More for ${agentName}`} className="absolute right-0 top-full z-30 mt-2 w-48 rounded-2xl border border-zk-border bg-zk-surface p-1.5 shadow-[0_12px_32px_rgba(11,23,51,0.16)]">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue disabled:cursor-not-allowed disabled:opacity-50 ${
                item.danger ? "text-zk-bad-fg hover:bg-zk-bad-bg" : "text-zk-text hover:bg-zk-chip"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
