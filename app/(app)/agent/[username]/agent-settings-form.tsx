"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AgentLevel } from "@prisma/client";
import { AGENT_LEVEL_LABELS } from "@/lib/agents/levels";
import { useToast } from "@/components/ui/toast";
import { setAgentLevelAction } from "@/app/(app)/settings/agents/actions";
import { agentsInputClass, agentsLabelClass } from "@/app/(app)/settings/agents/agents-ui";

/** The agent's level on its edit page. It saves as soon as you pick one; a level the viewer may not set is shown but disabled. */
export function AgentLevelForm({
  agentId,
  name,
  level,
  levels,
}: {
  agentId: string;
  name: string;
  level: AgentLevel;
  /** The levels this viewer may set. */
  levels: AgentLevel[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState(level);
  const [pending, startTransition] = useTransition();

  function changeLevel(next: AgentLevel) {
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      const result = await setAgentLevelAction(agentId, next);
      if (!result.ok) {
        setCurrent(previous);
        toast(result.error, "error");
        return;
      }
      toast(`${name} is now a ${AGENT_LEVEL_LABELS[next].toLowerCase()}.`, "success");
      router.refresh();
    });
  }

  return (
    <div className="max-w-xs space-y-1.5">
      <label htmlFor={`agent-level-${agentId}`} className={agentsLabelClass}>
        Level
      </label>
      <select
        id={`agent-level-${agentId}`}
        value={current}
        disabled={pending}
        onChange={(event) => changeLevel(event.target.value as AgentLevel)}
        className={agentsInputClass}
      >
        {[...new Set([current, ...levels])].map((option) => (
          <option key={option} value={option} disabled={!levels.includes(option)}>
            {AGENT_LEVEL_LABELS[option]}
          </option>
        ))}
      </select>
    </div>
  );
}
