"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { agentsInputClass, agentsLabelClass } from "@/app/(app)/settings/agents/agents-ui";
import {
  AGENT_ABOUT_MAX,
  AGENT_TAGLINE_MAX,
  AGENT_USERNAME_MAX,
} from "@/lib/validations/agent-profile";
import { updateAgentProfileAction, type AgentMessageActionResult } from "./actions";

/** The agent's @username, tagline and About me (#agent-profile), in "More about me". */
export function AgentProfileForm({
  agentId,
  username,
  tagline,
  about,
}: {
  agentId: string;
  username: string | null;
  tagline: string | null;
  about: string | null;
}) {
  const [result, action, pending] = useActionState<AgentMessageActionResult | undefined, FormData>(
    updateAgentProfileAction,
    undefined,
  );
  const [taglineDraft, setTaglineDraft] = useState(tagline ?? "");
  const [aboutDraft, setAboutDraft] = useState(about ?? "");
  const error = result && !result.ok ? result.error : null;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="agentId" value={agentId} />
      <div className="space-y-1.5">
        <label htmlFor="agent-username" className={agentsLabelClass}>
          Username
        </label>
        <div className="flex items-center rounded-xl border border-zk-border bg-zk-surface focus-within:border-electric-blue focus-within:ring-2 focus-within:ring-electric-blue/20">
          <span className="pl-3.5 text-sm text-zk-muted" aria-hidden="true">
            @
          </span>
          <input
            id="agent-username"
            name="username"
            defaultValue={username ?? ""}
            required
            maxLength={AGENT_USERNAME_MAX}
            pattern="[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?"
            autoCapitalize="none"
            spellCheck={false}
            className="w-full rounded-xl bg-transparent px-1.5 py-2.5 text-sm text-zk-text outline-none"
            aria-describedby="agent-username-help"
          />
        </div>
        <p id="agent-username-help" className="text-xs text-zk-muted">
          Lowercase letters, digits and dashes; unique in this workspace.
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="agent-tagline" className={agentsLabelClass}>
          Tagline
        </label>
        <input
          id="agent-tagline"
          name="tagline"
          value={taglineDraft}
          onChange={(event) => setTaglineDraft(event.target.value)}
          maxLength={AGENT_TAGLINE_MAX}
          placeholder="Patient bug hunter who reads the whole stack trace"
          className={agentsInputClass}
          aria-describedby="agent-tagline-count"
        />
        <p id="agent-tagline-count" className="text-right text-xs tabular-nums text-zk-muted">
          {taglineDraft.length}/{AGENT_TAGLINE_MAX}
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="agent-about" className={agentsLabelClass}>
          About me
        </label>
        <Textarea
          id="agent-about"
          name="about"
          rows={6}
          value={aboutDraft}
          onChange={(event) => setAboutDraft(event.target.value)}
          maxLength={AGENT_ABOUT_MAX}
          className="rounded-xl border-zk-border bg-zk-surface text-zk-text placeholder:text-zk-muted focus:border-electric-blue focus:ring-electric-blue/20"
          aria-describedby="agent-about-count"
        />
        <p id="agent-about-count" className="text-right text-xs tabular-nums text-zk-muted">
          {aboutDraft.length}/{AGENT_ABOUT_MAX}
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-zk-bad-fg">
          {error}
        </p>
      ) : null}
      {result?.ok ? (
        <p role="status" className="text-sm font-semibold text-zk-ok-fg">
          Saved.
        </p>
      ) : null}
      <Button
        type="submit"
        variant="secondary"
        disabled={pending}
        className="rounded-full border-zk-border bg-zk-surface text-zk-text hover:bg-zk-chip"
      >
        {pending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
