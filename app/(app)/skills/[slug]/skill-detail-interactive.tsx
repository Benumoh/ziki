"use client";

import { useState, useSyncExternalStore } from "react";
import type { SkillItem } from "../skills-data";
import { buildSmartSkillPrompt, type AgentInfo } from "../skills-prompt-builder";

export { buildSmartSkillPrompt, type AgentInfo };

export interface AgentOption {
  id: string;
  name: string;
  username?: string;
}

export interface SkillDetailInteractiveProps {
  skill: SkillItem;
  agents?: AgentOption[];
  isGuest?: boolean;
}

/* ------------------------------------------------------------------ */
/* Shared client store: the target agent and the toast, shared by the  */
/* hero's picker and the instructions section further down the page.   */
/* ------------------------------------------------------------------ */

type StoreState = {
  selectedAgent: string;
  toastMessage: string | null;
};

const SERVER_STATE: StoreState = { selectedAgent: "all", toastMessage: null };

// useSyncExternalStore compares snapshots by identity, so each change makes one
// new object and every read in between returns that same object.
let currentState: StoreState = SERVER_STATE;
const listeners = new Set<() => void>();

function setState(next: Partial<StoreState>) {
  currentState = { ...currentState, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function useSkillStore(): StoreState {
  return useSyncExternalStore(
    subscribe,
    () => currentState,
    () => SERVER_STATE,
  );
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(message: string) {
  setState({ toastMessage: message });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toastMessage: null }), 2000);
}

async function copySkillPrompt(
  skill: SkillItem,
  selectedAgent: string,
  agents: AgentOption[] = []
) {
  const promptText = buildSmartSkillPrompt(skill, selectedAgent, agents);

  try {
    await navigator.clipboard.writeText(promptText);
    const targetAgentObj = agents.find((a) => a.name === selectedAgent);
    const displayName = targetAgentObj
      ? targetAgentObj.username
        ? `${targetAgentObj.name} (@${targetAgentObj.username})`
        : targetAgentObj.name
      : selectedAgent !== "all"
      ? selectedAgent
      : "your agent";

    showToast(
      selectedAgent !== "all"
        ? `Copied prompt with auto-sync for ${displayName}!`
        : `Copied "${skill.title}" prompt to clipboard!`
    );
  } catch {
    showToast("Unable to copy to clipboard.");
  }
}

const COPY_ICON =
  "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z";

/* ------------------------------------------------------------------ */
/* CopyCommandButton                                                  */
/* ------------------------------------------------------------------ */

export function CopyCommandButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("Unable to copy to clipboard.");
    }
  }

  return (
    <button
      onClick={handleCopy}
      type="button"
      aria-label="Copy execution command"
      className="mt-3 inline-flex items-center gap-2 rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-xs font-semibold text-zk-text shadow-xs hover:bg-zk-chip transition"
    >
      {copied ? (
        <>
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
          </svg>
          <span>Copied!</span>
        </>
      ) : (
        <>
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={COPY_ICON} />
          </svg>
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* SkillPromptSection                                                 */
/* ------------------------------------------------------------------ */

export function SkillPromptSection({
  skill,
  agents = [],
}: {
  skill: SkillItem;
  agents?: AgentOption[];
}) {
  const { selectedAgent } = useSkillStore();

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zk-muted">
            Agent System Instructions
          </h2>
          <p className="text-xs text-zk-text2">
            System prompt applied when this skill runs on an agent.
          </p>
        </div>
        <button
          onClick={() => copySkillPrompt(skill, selectedAgent, agents)}
          type="button"
          aria-label="Copy instructions"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-xs font-semibold text-zk-text shadow-xs hover:bg-zk-chip transition"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={COPY_ICON} />
          </svg>
          <span>Copy Instructions</span>
        </button>
      </div>
      {selectedAgent !== "all" && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
          For: {selectedAgent}
        </span>
      )}
      <div className="relative overflow-hidden rounded-2xl border border-zk-border bg-zk-chip">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-zk-divider">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
          <span className="text-xs font-mono text-zk-text">prompt.md</span>
          <span className="ml-auto text-xs text-zk-muted">Markdown Instructions</span>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap text-xs font-mono text-zk-text leading-relaxed select-text p-4">
          {skill.prompt}
        </pre>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* SkillDetailInteractive: the hero's target picker and copy button   */
/* ------------------------------------------------------------------ */

export function SkillDetailInteractive({
  skill,
  agents = [],
  isGuest = false,
}: SkillDetailInteractiveProps) {
  const { selectedAgent, toastMessage } = useSkillStore();

  // An agent picked on another skill's page that isn't one of this viewer's
  // agents falls back to the generic prompt.
  const value =
    selectedAgent === "all" || agents.some((agent) => agent.name === selectedAgent)
      ? selectedAgent
      : "all";

  let allLabel: string;
  if (agents.length > 0) {
    allLabel = "For: All Agents (Generic)";
  } else if (isGuest) {
    allLabel = "For: Any Agent";
  } else {
    allLabel = "For: Default Agent";
  }

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <select
        value={value}
        onChange={(e) => setState({ selectedAgent: e.target.value })}
        aria-label="Target agent"
        className="shrink-0 appearance-none rounded-xl border border-zk-border bg-zk-chip/60 hover:bg-zk-chip py-2 pl-3.5 pr-8 text-xs font-semibold text-zk-text focus:border-blue-600 focus:outline-hidden transition cursor-pointer"
      >
        <option value="all">{allLabel}</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.name}>
            For: {agent.name}{agent.username ? ` (@${agent.username})` : ""}
          </option>
        ))}
      </select>
      <button
        onClick={() => copySkillPrompt(skill, value, agents)}
        type="button"
        className="flex items-center justify-center gap-2 rounded-control bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 transition"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={COPY_ICON} />
        </svg>
        Copy Agent Skill Prompt
      </button>

      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border border-zk-border bg-zk-surface px-5 py-3.5 text-sm font-semibold text-zk-text shadow-2xl"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zk-ok-bg text-zk-ok-fg text-xs font-bold" aria-hidden="true">
            ✓
          </span>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
