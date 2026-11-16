"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { pairAgentAction, type PairingActionResult } from "../actions";
import { AGENT_LEVEL_LABELS } from "@/lib/agents/levels";
import type { AgentLevel } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WorkModeFields } from "../work-mode-fields";
import {
  agentsDangerBtn,
  agentsInputClass,
  agentsLabelClass,
  agentsLink,
  agentsMutedClass,
  agentsPrimaryBtn,
  agentsSecondaryBtn,
  agentsSurface,
  formatPairingCode,
  isValidPairingCode,
} from "../agents-ui";

/**
 * Approve an agent that asked to join (#427). A link from the agent opens
 * straight on the confirm step. The agent then collects its own key.
 */
export function PairForm({
  initialCode,
  pending,
  unknownCode,
  organisationName,
  instructionsMaxLength,
}: {
  initialCode: string;
  pending: { name: string; model: string | null; level: AgentLevel | null; instructions: string | null } | null;
  unknownCode: boolean;
  /** Where it is approved: the agent is activated here, in every project (#user-agents). */
  organisationName: string;
  instructionsMaxLength: number;
}) {
  const [code, setCode] = useState(() => formatPairingCode(initialCode));
  const [denied, setDenied] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState<{ code: string; value: string } | null>(null);
  const [result, action, pendingAction] = useActionState<PairingActionResult | undefined, FormData>(
    pairAgentAction,
    undefined,
  );

  if (denied) {
    return (
      <div className={`mt-4 flex flex-col items-center gap-4 ${agentsSurface} p-6 text-center`} role="status">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-zk-bad-bg text-zk-bad-fg" aria-hidden>
          <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path strokeLinecap="round" d="M18 6 6 18M6 6l12 12" />
          </svg>
        </span>
        <div className="space-y-1">
          <p className="text-lg font-extrabold text-zk-text">Request denied</p>
          <p className={agentsMutedClass}>
            The agent won&apos;t get a key. The code can&apos;t be reused — start pairing again if this was a mistake.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className={agentsSecondaryBtn}
            onClick={() => {
              setDenied(false);
              setCode("");
            }}
          >
            Use a different code
          </button>
          <Link href="/settings/agents/connect" className={agentsPrimaryBtn}>
            Back to setup
          </Link>
        </div>
      </div>
    );
  }

  if (result?.ok && result.step === "done") {
    return (
      <div className={`mt-4 flex flex-col items-center gap-4 ${agentsSurface} p-6 text-center`} role="status">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-zk-ok-bg text-zk-ok-fg" aria-hidden>
          <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <div className="space-y-1">
          <p className="text-lg font-extrabold text-zk-text">Agent approved</p>
          <p className="text-sm text-zk-text2">
            {result.name} is approved. The key has been sent to your agent. Head back to setup and run Test
            connection to finish.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/settings/agents/connect" className={agentsPrimaryBtn}>
            Back to setup
          </Link>
          <Link href="/settings/agents" className={agentsSecondaryBtn}>
            View your agents
          </Link>
        </div>
      </div>
    );
  }

  const confirm =
    result?.ok && result.step === "confirm"
      ? result
      : pending && !result?.ok
        ? {
            code: formatPairingCode(initialCode),
            name: pending.name,
            model: pending.model,
            level: pending.level ?? "working",
            instructions: pending.instructions,
          }
        : null;
  const error =
    result && !result.ok
      ? result.error
      : unknownCode && !result
        ? "That code doesn't match a waiting agent. It may have expired; ask the agent for a new one."
        : null;

  if (confirm) {
    const instructionsValue =
      instructionsDraft?.code === confirm.code ? instructionsDraft.value : (confirm.instructions ?? "");
    return (
      <form action={action} className={`mt-4 space-y-4 ${agentsSurface} p-4 sm:p-6`}>
        <input type="hidden" name="code" value={confirm.code} />
        <input type="hidden" name="intent" value="approve" />
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-zk-muted">
            Pairing request · {confirm.code}
          </p>
          <p className="text-xl font-extrabold text-zk-text">{confirm.name}</p>
          <p className="text-sm text-zk-text2">
            {confirm.model ? `${confirm.model} · ` : ""}
            wants to join as {AGENT_LEVEL_LABELS[confirm.level]}
          </p>
        </div>
        <p className="rounded-2xl bg-zk-tint px-4 py-3 text-sm text-zk-text2">
          Only approve if you started this pairing yourself and the name matches your agent.
        </p>
        <WorkModeFields />
        <div className="space-y-1.5">
          <label htmlFor="pair-instructions" className={agentsLabelClass}>
            Standing instructions <span className="font-normal text-zk-muted">(optional)</span>
          </label>
          <Textarea
            id="pair-instructions"
            name="instructions"
            rows={4}
            maxLength={instructionsMaxLength}
            value={instructionsValue}
            onChange={(event) => setInstructionsDraft({ code: confirm.code, value: event.target.value })}
            className={`${agentsInputClass} min-h-[96px]`}
            aria-describedby="pair-instructions-help"
          />
          <p id="pair-instructions-help" className="text-xs text-zk-muted">
            {confirm.instructions
              ? "Suggested by the agent. Edit or clear it. The agent gets only what you approve here."
              : "A standing brief the agent reads from GET /api/v1/agents/me, such as focus areas. You can change it later in settings."}
          </p>
        </div>
        <p className="text-sm text-zk-text2">
          It works in every project of <span className="font-semibold text-zk-text">{organisationName}</span>. You can bring it into your other organisations from their Agents settings.
        </p>
        {error ? (
          <p className="text-sm font-medium text-zk-bad-fg" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={agentsDangerBtn} onClick={() => setDenied(true)} disabled={pendingAction}>
            Deny
          </button>
          <Button type="submit" disabled={pendingAction} className={agentsPrimaryBtn}>
            {pendingAction ? "Approving…" : "Approve agent"}
          </Button>
          <Link href="/settings/agents/pair" className={`${agentsLink} inline-flex min-h-11 items-center px-2 text-sm`}>
            Use a different code
          </Link>
        </div>
      </form>
    );
  }

  const codeValid = isValidPairingCode(code);
  const codePartial = code.length > 0 && !codeValid;

  return (
    <form action={action} className="mt-4 space-y-4" noValidate>
      <div className="space-y-2">
        <label htmlFor="pair-code" className={agentsLabelClass}>
          Pairing code
        </label>
        <p className={agentsMutedClass}>Enter the code from your agent. It looks like ABCD-2345.</p>
        <Input
          id="pair-code"
          name="code"
          value={code}
          onChange={(event) => setCode(formatPairingCode(event.target.value))}
          placeholder="ABCD-2345"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className={`h-16 rounded-2xl border-2 text-center font-mono text-[26px] font-bold tracking-[0.3em] uppercase ${
            codeValid
              ? "border-zk-ok-fg focus:border-zk-ok-fg focus:ring-zk-ok-fg/20"
              : "border-zk-border focus:border-electric-blue focus:ring-electric-blue/20"
          } bg-zk-surface text-zk-text shadow-none`}
          aria-invalid={error ? true : undefined}
          aria-describedby="pair-code-hint"
          required
        />
        <p
          id="pair-code-hint"
          className={`text-center text-xs ${codeValid ? "font-bold text-zk-ok-fg" : "font-medium text-zk-muted"}`}
        >
          {codeValid
            ? "Code looks right."
            : codePartial
              ? "Keep going — 8 letters or numbers."
              : "Letters and numbers only. The dash is added for you."}
        </p>
      </div>
      {error ? (
        <p id="pair-error" className="text-sm font-medium text-zk-bad-fg" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pendingAction || !codeValid} className={`w-full sm:w-auto ${agentsPrimaryBtn}`}>
        {pendingAction ? "Checking…" : "Continue"}
      </Button>
    </form>
  );
}
