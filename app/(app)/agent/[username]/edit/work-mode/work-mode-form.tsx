"use client";

import { useActionState } from "react";
import type { AgentWorkMode } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { setAgentWorkModeAction, type WorkModeActionResult } from "@/app/actions/agent-work-mode";
import { agentsPrimaryBtn } from "@/app/(app)/settings/agents/agents-ui";
import { WorkModeFields } from "@/app/(app)/settings/agents/work-mode-fields";

export function WorkModeForm({
  agentId,
  initial,
}: {
  agentId: string;
  initial: { workMode: AgentWorkMode | null; maxActiveTasks: number | null; dailyTaskLimit: number | null; creditCeilingUsd: number | null };
}) {
  const [result, action, pending] = useActionState<WorkModeActionResult | undefined, FormData>(setAgentWorkModeAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="agentId" value={agentId} />
      <WorkModeFields idPrefix="edit" initial={initial} />
      {result && !result.ok ? (
        <p role="alert" className="text-sm font-medium text-zk-bad-fg">
          {result.error}
        </p>
      ) : null}
      {result?.ok ? (
        <p role="status" className="text-sm font-medium text-zk-ok-fg">
          Saved. The agent sees it on its next GET /api/v1/agents/me.
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className={agentsPrimaryBtn}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
