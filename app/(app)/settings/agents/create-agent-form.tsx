"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { createAgentAction, type CreateAgentActionResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import {
  AGENT_LEVEL_DESCRIPTIONS,
  AGENT_LEVEL_LABELS,
  SELF_REGISTRATION_LEVELS,
} from "@/lib/agents/levels";
import type { AgentLevel } from "@prisma/client";
import { AGENT_MODEL_MAX, AGENT_NAME_MAX } from "@/lib/agents/registry-limits";
import {
  agentsInputClass,
  agentsLabelClass,
  agentsMutedClass,
  agentsPrimaryBtn,
  agentsSurface,
} from "./agents-ui";

const LEVEL_ICONS: Partial<Record<AgentLevel, ReactNode>> = {
  working: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  manager: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />
    </svg>
  ),
  merger: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path strokeLinecap="round" d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  ),
};

const ADMIN_ONLY: ReadonlySet<AgentLevel> = new Set(["manager", "merger"]);

/** Register an agent; its key is shown here once and never again (#427). */
export function CreateAgentForm({
  organisationName,
  levels = SELF_REGISTRATION_LEVELS,
}: {
  /** Where it is created: active here, in every project (#user-agents). */
  organisationName: string;
  levels?: readonly AgentLevel[];
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [chosenLevel, setLevel] = useState<AgentLevel>(levels[0] ?? "working");
  // Fall back to the first offered level when the choice is no longer offered.
  const level = levels.includes(chosenLevel) ? chosenLevel : (levels[0] ?? "working");
  const [issued, setIssued] = useState<Extract<CreateAgentActionResult, { ok: true }> | null>(null);
  const [result, action, pending] = useActionState<CreateAgentActionResult | undefined, FormData>(
    async (previous, formData) => {
      const next = await createAgentAction(previous, formData);
      if (next.ok) {
        setIssued(next);
        setName("");
        setModel("");
      }
      return next;
    },
    undefined,
  );
  const error = result && !result.ok ? result : null;
  const selectedLevel = levels.includes(level) ? level : levels[0] ?? "working";

  useEffect(() => {
    if (issued) document.getElementById("new-agent-key")?.focus();
  }, [issued]);

  async function copy() {
    if (!issued) return;
    toast((await copyText(issued.rawKey)) ? "Key copied." : "Couldn't copy. Select the key and copy it.");
  }

  if (issued) {
    return (
      <div className={`mt-4 space-y-3 ${agentsSurface} border-zk-warn-bd bg-zk-warn-bg/40 p-4`} role="status">
        <p className="text-sm font-semibold text-zk-text">
          {issued.name} is registered. Copy its key now. It stays on this page with the agent.
        </p>
        <label htmlFor="new-agent-key" className="sr-only">
          Agent key
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="new-agent-key"
            readOnly
            value={issued.rawKey}
            className={`${agentsInputClass} font-mono text-xs`}
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button type="button" onClick={copy} className={agentsPrimaryBtn}>
            Copy key
          </Button>
        </div>
        <p className={agentsMutedClass}>
          The agent sends it as <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>. If
          it&apos;s lost, regenerate the key on this page. The current key stops working immediately.
        </p>
        <Button type="button" variant="secondary" onClick={() => setIssued(null)} className="rounded-full">
          I&apos;ve saved it
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="mt-4 space-y-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="agent-name" className={agentsLabelClass}>
            Name
          </label>
          <Input
            id="agent-name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ada's Claude"
            maxLength={AGENT_NAME_MAX + 20}
            required
            className={agentsInputClass}
            aria-invalid={error?.field === "name" || undefined}
            aria-describedby={error ? "agent-form-error" : undefined}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="agent-model" className={agentsLabelClass}>
            Model <span className="font-normal text-zk-muted">(optional)</span>
          </label>
          <Input
            id="agent-model"
            name="model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Claude, GPT, …"
            maxLength={AGENT_MODEL_MAX + 20}
            className={agentsInputClass}
            aria-invalid={error?.field === "model" || undefined}
          />
        </div>
      </div>

      <p className="text-xs text-zk-muted">It works in every project of {organisationName}.</p>

      <fieldset className="space-y-3">
        <legend className={agentsLabelClass}>Agent class</legend>
        <p className="text-xs text-zk-muted">Every agent can read, comment and do the work. A team admin can make an agent a manager or merger.</p>
        <input type="hidden" name="level" value={selectedLevel} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Agent class">
          {levels.map((option) => {
            const on = selectedLevel === option;
            const admin = ADMIN_ONLY.has(option);
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setLevel(option)}
                className={`flex flex-col gap-2 rounded-2xl p-4 text-left transition ${
                  on
                    ? "border-2 border-electric-blue-strong bg-zk-tint shadow-[0_8px_20px_rgba(46,111,239,0.15)]"
                    : "m-px border border-zk-border bg-zk-surface hover:border-electric-blue/40"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-control ${
                      on ? "bg-electric-blue-strong text-white" : "bg-zk-tint text-zk-accent"
                    }`}
                  >
                    {LEVEL_ICONS[option]}
                  </span>
                  <span
                    className={`mt-0.5 h-[18px] w-[18px] shrink-0 rounded-full box-border ${
                      on ? "border-[5px] border-electric-blue-strong bg-white" : "border-2 border-zk-border"
                    }`}
                    aria-hidden
                  />
                </div>
                <span className="text-sm font-bold text-zk-text">{AGENT_LEVEL_LABELS[option]}</span>
                <span className="text-xs text-zk-muted">{AGENT_LEVEL_DESCRIPTIONS[option]}</span>
                {admin ? (
                  <span className="text-[11px] font-semibold text-zk-warn-fg">Needs organisation admin grant</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-zk-muted">
          Registering as {AGENT_LEVEL_LABELS[selectedLevel]}
          {` in ${organisationName}`}
        </p>
      </fieldset>

      {error ? (
        <p id="agent-form-error" className="text-sm font-medium text-zk-bad-fg" role="alert">
          {error.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className={agentsPrimaryBtn}>
        {pending ? "Registering…" : "Register agent"}
      </Button>
    </form>
  );
}
