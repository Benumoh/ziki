"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { agentsInputClass, agentsLabelClass } from "@/app/(app)/settings/agents/agents-ui";
import {
  AGENT_ABOUT_MAX,
  AGENT_SERVICES_MAX,
  AGENT_TAGLINE_MAX,
  AGENT_USERNAME_MAX,
} from "@/lib/validations/agent-profile";
import { checkAgentUsernameAction, updateAgentProfileAction, type ProfileActionResult, type UsernameCheck } from "./actions";

const textareaClass =
  "rounded-xl border-zk-border bg-zk-surface text-zk-text placeholder:text-zk-muted focus:border-electric-blue focus:ring-electric-blue/20";

/** Wait this long after the last keystroke before asking whether a username is free. */
const CHECK_DELAY_MS = 350;

/**
 * The agent's public profile (#agent-profile) in "Setup Profile" / "Edit
 * Profile": @username (checked against the workspace as you type), tagline,
 * About me and What I can do for you.
 */
export function AgentProfileForm({
  agentId,
  name,
  username,
  tagline,
  about,
  services,
}: {
  agentId: string;
  name: string;
  username: string;
  tagline: string | null;
  about: string | null;
  services: string | null;
}) {
  const [result, action, pending] = useActionState<ProfileActionResult | undefined, FormData>(
    updateAgentProfileAction,
    undefined,
  );
  const [nameDraft, setNameDraft] = useState(name);
  const [usernameDraft, setUsernameDraft] = useState(username);
  // "Saved" shows on the button itself for a moment after a save, then it reads "Save profile" again.
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!result?.ok) return;
    const show = setTimeout(() => setJustSaved(true), 0);
    const hide = setTimeout(() => setJustSaved(false), 2500);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [result]);
  const [check, setCheck] = useState<{ for: string; result: UsernameCheck } | null>(null);
  const [taglineDraft, setTaglineDraft] = useState(tagline ?? "");
  const [aboutDraft, setAboutDraft] = useState(about ?? "");
  const [servicesDraft, setServicesDraft] = useState(services ?? "");
  const error = result && !result.ok ? result.error : null;


  // Ask whether the username is free once typing pauses; the agent's own is always fine.
  const wanted = usernameDraft.trim().toLowerCase();
  useEffect(() => {
    if (!wanted || wanted === username) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      checkAgentUsernameAction(agentId, wanted)
        .then((answer) => {
          if (!cancelled) setCheck({ for: wanted, result: answer });
        })
        .catch(() => undefined);
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [agentId, wanted, username]);

  const current = wanted && wanted !== username && check?.for === wanted ? check.result : null;
  const taken = Boolean(current && (!current.ok || !current.available));
  const checking = Boolean(wanted && wanted !== username && check?.for !== wanted);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="agentId" value={agentId} />
      {/* The save redirects to the new address when this changes. */}
      <input type="hidden" name="currentUsername" value={username} />
      <div className="space-y-1.5">
        <label htmlFor="agent-name" className={agentsLabelClass}>
          Name
        </label>
        <input
          id="agent-name"
          name="name"
          value={nameDraft}
          onChange={(event) => setNameDraft(event.target.value)}
          required
          className={agentsInputClass}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="agent-username" className={agentsLabelClass}>
          Username
        </label>
        <div
          className={`flex items-center rounded-xl border bg-zk-surface focus-within:ring-2 focus-within:ring-electric-blue/20 ${
            taken ? "border-zk-bad-fg" : "border-zk-border focus-within:border-electric-blue"
          }`}
        >
          <span className="pl-3.5 text-sm text-zk-muted" aria-hidden="true">
            @
          </span>
          <input
            id="agent-username"
            name="username"
            value={usernameDraft}
            onChange={(event) => setUsernameDraft(event.target.value.toLowerCase())}
            required
            maxLength={AGENT_USERNAME_MAX}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-xl bg-transparent px-1.5 py-2.5 text-sm text-zk-text outline-none"
            aria-invalid={taken || undefined}
            aria-describedby="agent-username-help"
          />
        </div>
        <p
          id="agent-username-help"
          aria-live="polite"
          className={`text-xs ${taken ? "font-semibold text-zk-bad-fg" : current?.ok && current.available ? "text-zk-ok-fg" : "text-zk-muted"}`}
        >
          {checking
            ? "Checking…"
            : current
              ? current.ok
                ? current.message
                : current.error
              : "Its public address and @handle: lowercase letters, digits and dashes, unique across Ziki."}
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
          rows={5}
          value={aboutDraft}
          onChange={(event) => setAboutDraft(event.target.value)}
          maxLength={AGENT_ABOUT_MAX}
          className={textareaClass}
          aria-describedby="agent-about-count"
        />
        <p id="agent-about-count" className="text-right text-xs tabular-nums text-zk-muted">
          {aboutDraft.length}/{AGENT_ABOUT_MAX}
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="agent-services" className={agentsLabelClass}>
          What I can do for you
        </label>
        <Textarea
          id="agent-services"
          name="services"
          rows={4}
          value={servicesDraft}
          onChange={(event) => setServicesDraft(event.target.value)}
          maxLength={AGENT_SERVICES_MAX}
          placeholder={"Find and fix flaky end-to-end tests\nReview database migrations before they ship"}
          className={textareaClass}
          aria-describedby="agent-services-count"
        />
        <p id="agent-services-count" className="text-right text-xs tabular-nums text-zk-muted">
          {servicesDraft.length}/{AGENT_SERVICES_MAX}
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-zk-bad-fg">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end border-t border-zk-divider pt-4">
        <Button
          type="submit"
          disabled={pending || taken || checking}
          className="rounded-full bg-electric-blue-strong text-white hover:bg-[#2552af] focus-visible:ring-electric-blue"
        >
          <span aria-live="polite">{pending ? "Saving…" : justSaved ? "Saved ✓" : "Save profile"}</span>
        </Button>
      </div>
    </form>
  );
}
