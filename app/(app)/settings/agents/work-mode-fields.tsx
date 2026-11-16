"use client";

import { useState } from "react";
import type { AgentWorkMode } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { WORK_CAP_MAX, WORK_MODES, WORK_MODE_HINTS, WORK_MODE_LABELS } from "@/lib/agents/work-mode";
import { agentsInputClass, agentsLabelClass } from "./agents-ui";

/**
 * How the agent takes work, and its spending caps (#agent-work-mode): one step,
 * asked when the agent first connects (the pairing form) and changeable later
 * from the agent's settings. The mode is required; there is no "never" (pause
 * the agent for that). Each cap is optional, empty for no cap.
 */
export function WorkModeFields({
  idPrefix = "pair",
  initial,
}: {
  idPrefix?: string;
  initial?: {
    workMode: AgentWorkMode | null;
    maxActiveTasks: number | null;
    dailyTaskLimit: number | null;
    creditCeilingUsd: number | null;
  };
}) {
  // Held in state, so a failed approval (React resets an action form's own fields) keeps the owner's choice.
  const [mode, setMode] = useState<AgentWorkMode | null>(initial?.workMode ?? null);
  const [values, setValues] = useState<Record<string, string>>(() => ({
    maxActiveTasks: initial?.maxActiveTasks?.toString() ?? "",
    dailyTaskLimit: initial?.dailyTaskLimit?.toString() ?? "",
    creditCeilingUsd: initial?.creditCeilingUsd?.toString() ?? "",
  }));
  const caps = [
    { name: "maxActiveTasks", label: "Max tasks at once", hint: "In progress together" },
    { name: "dailyTaskLimit", label: "Daily limit", hint: "Tasks taken in 24 hours" },
    { name: "creditCeilingUsd", label: "Credit ceiling ($)", hint: "Model spend a day" },
  ] as const;
  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className={agentsLabelClass}>How should it work?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {WORK_MODES.map((value) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-3 rounded-2xl border border-zk-border bg-zk-surface p-3 has-[:checked]:border-electric-blue has-[:checked]:bg-zk-tint"
            >
              <input
                type="radio"
                name="workMode"
                value={value}
                required
                checked={mode === value}
                onChange={() => setMode(value)}
                // React resets an action form after a failed submit, and a radio resets to
                // defaultChecked, which React doesn't keep in step with `checked`: keep it here.
                ref={(input) => {
                  if (input) input.defaultChecked = mode === value;
                }}
                className="mt-1 h-4 w-4 accent-electric-blue"
              />
              <span className="space-y-0.5">
                <span className="block text-sm font-bold text-zk-text">{WORK_MODE_LABELS[value]}</span>
                <span className="block text-xs text-zk-text2">{WORK_MODE_HINTS[value]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className={agentsLabelClass}>
          Spending caps <span className="font-normal text-zk-muted">(optional, empty for no cap)</span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {caps.map((cap) => (
            <div key={cap.name} className="space-y-1">
              <label htmlFor={`${idPrefix}-${cap.name}`} className="block text-xs font-semibold text-zk-text2">
                {cap.label}
              </label>
              <Input
                id={`${idPrefix}-${cap.name}`}
                name={cap.name}
                type="number"
                inputMode="numeric"
                min={1}
                max={WORK_CAP_MAX}
                step={1}
                value={values[cap.name]}
                onChange={(event) => setValues((current) => ({ ...current, [cap.name]: event.target.value }))}
                placeholder="No cap"
                className={agentsInputClass}
                aria-describedby={`${idPrefix}-${cap.name}-hint`}
              />
              <p id={`${idPrefix}-${cap.name}-hint`} className="text-[11px] text-zk-muted">
                {cap.hint}
              </p>
            </div>
          ))}
        </div>
        <p className="text-xs text-zk-muted">
          Ziki holds it to the task caps. It can&apos;t see model spend, so the agent reads the credit ceiling and stops at it.
        </p>
      </fieldset>
    </div>
  );
}
