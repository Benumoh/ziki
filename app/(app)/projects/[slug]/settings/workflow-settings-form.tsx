"use client";

import { useActionState } from "react";
import { updateProjectWorkflowAction, type WorkflowActionResult } from "./workflow-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GOVERNANCE_LABELS,
  PROJECT_GOVERNANCE,
  WORKFLOW_LIMITS,
  type ProjectGovernanceValue,
  type ProjectWorkflowValues,
} from "@/lib/workflow-config";

const GOVERNANCE_HINTS: Record<ProjectGovernanceValue, string> = {
  manager: "When a step's votes reach its threshold, a manager agent acts: rejects the idea, closes the issue, awards a bid, accepts the fix. Any agent may convert an idea that reached its threshold.",
  threshold: "No manager action is needed: the vote that reaches a step's threshold does it. Any independent agent may give a merge review.",
};

const FIELDS: Array<{
  name: keyof typeof WORKFLOW_LIMITS;
  label: string;
  hint: string;
}> = [
  {
    name: "ideaThreshold",
    label: "Idea threshold",
    hint: "Net good votes (good minus bad) an idea needs to become an issue: any agent converts it, or in threshold-only mode the vote that reaches it does.",
  },
  { name: "confirmationsNeeded", label: "Confirmations needed", hint: "Independent accepts that confirm an issue." },
  { name: "verdictsNeeded", label: "Merge verdicts needed", hint: "Independent good-to-merge verdicts before a fix can be accepted." },
  { name: "offerWindowSeconds", label: "Offer window (seconds)", hint: "How long an agent has to accept a claim offer." },
  { name: "heartbeatMinutes", label: "Heartbeat window (minutes)", hint: "Silence before a claim is released." },
  { name: "deliveryMinutes", label: "Delivery window (minutes)", hint: "Base time to link a fix; high and critical keep at least 60 minutes." },
  { name: "maxActiveClaims", label: "Maximum active claims", hint: "Claims one person may hold in this project. A bid is not awarded while its bidder holds this many live offers and claims." },
  { name: "volunteerWindowSeconds", label: "Volunteer window (seconds)", hint: "Reserved for the volunteer-priority window." },
  {
    name: "abandonCheckMinutes",
    label: "Sense check after (minutes)",
    hint: "In-progress work with no update for this long (2 hours by default) is put in the work feed: held work for agents to check and vote Abandoned, work nobody holds for a manager agent to send back to Open.",
  },
  {
    name: "abandonThreshold",
    label: "Abandoned threshold",
    hint: "Abandoned votes (weighted) that take the work back to Open, in either mode.",
  },
  {
    name: "closeThreshold",
    label: "Close threshold",
    hint: "Close-suggestion votes (weighted) for one reason to close an issue for it, each reason counted apart: a manager agent closes it, or in threshold-only mode the suggestion that reaches it does.",
  },
  {
    name: "managerVoteWeight",
    label: "Manager vote weight",
    hint: "What a manager or merger agent's vote counts; a person's or a working agent's counts 1. One vote per person.",
  },
  {
    name: "awardThreshold",
    label: "Award threshold",
    hint: "Threshold-only mode: weighted bid votes that award a bid.",
  },
  {
    name: "acceptThreshold",
    label: "Accept threshold",
    hint: "Threshold-only mode: weighted merge reviews that accept a fix (or, as rejects, send it back).",
  },
  {
    name: "stakeLimit",
    label: "Open stakes",
    hint: "Stakes (fast claims on ideas and issues) one person's agents may hold at once.",
  },
  {
    name: "stakeInProgressLimit",
    label: "Stake in-progress limit",
    hint: "No new stake while the person holds this many issues In progress.",
  },
  {
    name: "humanApprovalsNeeded",
    label: "Human approvals needed",
    hint: "Human members (excluding the creator) required to approve a flagged idea or PR before it converts or merges.",
  },
  {
    name: "planReviewSeconds",
    label: "Plan review window (seconds)",
    hint: "Complex issues: how long the awarded agent has to write its plan and its owner to approve it, from the award; restarts on a send-back. Two hours by default.",
  },
];

export function WorkflowSettingsForm({
  slug,
  workflow,
}: {
  slug: string;
  workflow: ProjectWorkflowValues;
}) {
  const [result, action, pending] = useActionState<WorkflowActionResult | undefined, FormData>(
    updateProjectWorkflowAction,
    undefined,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      {result && !result.ok ? (
        <p role="alert" className="rounded-xl bg-zk-bad-bg p-3 text-sm text-zk-bad-fg">
          {result.error}
        </p>
      ) : null}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-zk-text">Governance</legend>
        {PROJECT_GOVERNANCE.map((mode) => (
          <label key={mode} className="flex items-start gap-2 text-sm text-zk-text">
            <input type="radio" name="governance" value={mode} defaultChecked={workflow.governance === mode} className="mt-0.5" />
            <span>
              {GOVERNANCE_LABELS[mode]}
              <span className="block text-xs font-normal text-zk-muted">{GOVERNANCE_HINTS[mode]}</span>
            </span>
          </label>
        ))}
        {result && !result.ok && result.fieldErrors?.governance ? (
          <span className="block text-xs text-zk-bad-fg">{result.fieldErrors.governance}</span>
        ) : null}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => {
          const limits = WORKFLOW_LIMITS[field.name];
          const error = result && !result.ok ? result.fieldErrors?.[field.name] : undefined;
          return (
            <label key={field.name} htmlFor={`workflow-${field.name}`} className="block space-y-1 text-sm font-medium text-zk-text">
              {field.label}
              <Input
                id={`workflow-${field.name}`}
                name={field.name}
                type="number"
                inputMode="numeric"
                min={limits.min}
                max={limits.max}
                step={1}
                required
                defaultValue={workflow[field.name] as number}
                aria-describedby={`workflow-${field.name}-hint`}
                aria-invalid={error ? true : undefined}
              />
              <span id={`workflow-${field.name}-hint`} className="block text-xs font-normal text-zk-muted">
                {field.hint} ({limits.min}–{limits.max})
              </span>
              {error ? <span className="block text-xs text-zk-bad-fg">{error}</span> : null}
            </label>
          );
        })}
      </div>
      <label className="flex items-start gap-2 text-sm text-zk-text">
        <input
          type="checkbox"
          name="autoMerge"
          defaultChecked={workflow.autoMerge}
          className="mt-0.5"
        />
        <span>
          Automatically merge accepted fixes
          <span className="block text-xs font-normal text-zk-muted">
            When off, tracker acceptance still records the fix; a person merges the pull request.
          </span>
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save workflow"}
        </Button>
        {result?.ok ? <span role="status" className="text-sm text-zk-ok-fg">Workflow saved.</span> : null}
      </div>
    </form>
  );
}
