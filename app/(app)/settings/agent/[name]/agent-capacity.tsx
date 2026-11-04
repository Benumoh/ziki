"use client";

import { useState, useTransition } from "react";
import { setAgentBurstAction } from "@/app/(app)/settings/agents/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { LocalTime } from "@/components/local-time";
import { agentsInputClass, agentsMutedClass, agentsSecondaryBtn } from "@/app/(app)/settings/agents/agents-ui";

type ExpiryChoice = "keep" | "none" | "2h" | "8h" | "24h" | "custom";

function expiryHours(choice: ExpiryChoice): number | null {
  if (choice === "2h") return 2;
  if (choice === "8h") return 8;
  if (choice === "24h") return 24;
  return null;
}

/**
 * How often the agent may call Ziki (the high-volume budget, #596), on its
 * own page: 600 times an hour normally, 4,000 with extra capacity, which an
 * admin can turn on for a while or with no end. Others only see whether it is
 * on.
 */
export function AgentCapacity({
  agentId,
  agentName,
  burst,
  burstUntil,
  now,
  canSetBurst,
}: {
  agentId: string;
  agentName: string;
  /** Whether this agent uses the higher hourly budget. */
  burst: boolean;
  /** When the higher budget lapses; null means no expiry. */
  burstUntil: string | null;
  /** Server request time, used to label an expired grant without reading the clock during render. */
  now: string;
  /** Admins may raise the budget. */
  canSetBurst: boolean;
}) {
  const toast = useToast();
  const [burstOn, setBurstOn] = useState(burst);
  const [savedUntil, setSavedUntil] = useState<string | null>(burstUntil);
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>(burstUntil ? "keep" : "none");
  const [customUntil, setCustomUntil] = useState("");
  const [pending, startTransition] = useTransition();

  /** The chosen end as an ISO timestamp: `keep` leaves the grant alone; `custom` needs a time in the future. */
  function resolvedUntil(choice: ExpiryChoice): string | null | "invalid" {
    if (choice === "none") return null;
    if (choice === "keep") return savedUntil;
    if (choice === "custom") {
      if (!customUntil) return "invalid";
      const date = new Date(customUntil);
      return Number.isFinite(date.getTime()) && date.getTime() > Date.now() ? date.toISOString() : "invalid";
    }
    const hours = expiryHours(choice);
    return hours ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() : null;
  }

  function save(next: boolean, choice: ExpiryChoice = expiryChoice) {
    let until: string | null = null;
    if (next) {
      const resolved = resolvedUntil(choice);
      if (resolved === "invalid") {
        toast("Choose an end time in the future, or no end.", "error");
        return;
      }
      until = resolved;
    }
    const previous = { on: burstOn, until: savedUntil };
    setBurstOn(next);
    setSavedUntil(until);
    startTransition(async () => {
      const result = await setAgentBurstAction(agentId, next, until);
      if (result.ok) {
        setExpiryChoice(until ? "keep" : "none");
        setCustomUntil("");
        toast(
          !next
            ? `${agentName} is back to 600 calls an hour.`
            : until
              ? `${agentName} can make 4,000 calls an hour until ${new Date(until).toLocaleString()}.`
              : `${agentName} can make 4,000 calls an hour, with no end.`,
          "success",
        );
      } else {
        setBurstOn(previous.on);
        setSavedUntil(previous.until);
        toast(result.error, "error");
      }
    });
  }

  function changeExpiry(next: ExpiryChoice) {
    setExpiryChoice(next);
    if (next === "keep" || next === "custom") return;
    if (burstOn) save(true, next);
  }

  const expiresAt = savedUntil ? Date.parse(savedUntil) : null;
  const expired = burstOn && expiresAt !== null && expiresAt <= new Date(now).getTime();
  const state = !burstOn || expired ? (
    "Normal: up to 600 calls to Ziki an hour."
  ) : savedUntil ? (
    <>
      Extra capacity: up to 4,000 calls an hour, until <LocalTime date={savedUntil} />.
    </>
  ) : (
    "Extra capacity: up to 4,000 calls an hour, with no end."
  );

  return (
    <div className="space-y-3">
      <p className={agentsMutedClass} suppressHydrationWarning>
        {state}
      </p>
      {canSetBurst ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-10 items-center gap-2 rounded-full bg-zk-chip px-3.5 text-sm font-semibold text-zk-text">
            <input type="checkbox" checked={burstOn} disabled={pending} onChange={(event) => save(event.target.checked)} />
            Extra capacity
          </label>
          {burstOn ? (
            <>
              <label htmlFor={`capacity-end-${agentId}`} className="sr-only">
                When extra capacity ends for {agentName}
              </label>
              <Select
                id={`capacity-end-${agentId}`}
                value={expiryChoice}
                disabled={pending}
                onChange={(event) => changeExpiry(event.target.value as ExpiryChoice)}
                className={`${agentsInputClass} w-auto`}
              >
                {savedUntil ? <option value="keep">Keep the current end</option> : null}
                <option value="none">No end</option>
                <option value="2h">For 2 hours</option>
                <option value="8h">For 8 hours</option>
                <option value="24h">For 24 hours</option>
                <option value="custom">Until a time…</option>
              </Select>
              {expiryChoice === "custom" ? (
                <>
                  <label htmlFor={`capacity-custom-${agentId}`} className="sr-only">
                    End time for {agentName}&apos;s extra capacity
                  </label>
                  <Input
                    id={`capacity-custom-${agentId}`}
                    type="datetime-local"
                    value={customUntil}
                    disabled={pending}
                    onChange={(event) => setCustomUntil(event.target.value)}
                    className={`${agentsInputClass} w-auto text-xs`}
                  />
                  <Button type="button" disabled={pending || !customUntil} onClick={() => save(true, "custom")} className={agentsSecondaryBtn}>
                    Save end time
                  </Button>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
