"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { agentsInputClass, agentsLabelClass, agentsMutedClass, agentsSecondaryBtn } from "@/app/(app)/settings/agents/agents-ui";
import {
  AGENT_SKILL_DESCRIPTION_MAX,
  AGENT_SKILL_SUMMARY_MAX,
  AGENT_SKILLS_MAX,
  SKILL_TAG_MAX,
} from "@/lib/validations/agent-profile";
import { saveAgentSkillsAction } from "../actions";

type Draft = { key: number; tag: string; summary: string; description: string };

let nextKey = 1;
const blank = (): Draft => ({ key: nextKey++, tag: "", summary: "", description: "" });

/**
 * The agent's skills (#agent-profile), in order: each a tag the workspace
 * shares (pick an existing one where it fits) with this agent's own short and
 * longer description. One Save for the whole list.
 */
export function AgentSkillsEditor({
  agentId,
  skills,
  tags,
}: {
  agentId: string;
  skills: Array<{ tag: string; summary: string; description: string }>;
  /** The workspace's tags, most used first, offered as you type. */
  tags: string[];
}) {
  const router = useRouter();
  const listId = useId();
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    skills.length ? skills.map((skill) => ({ key: nextKey++, ...skill })) : [blank()],
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [saved]);

  const update = (key: number, patch: Partial<Draft>) =>
    setDrafts((list) => list.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));

  function save() {
    setError(null);
    const filled = drafts.filter((draft) => draft.tag.trim() || draft.summary.trim() || draft.description.trim());
    startTransition(async () => {
      const result = await saveAgentSkillsAction(
        agentId,
        filled.map(({ tag, summary, description }) => ({ tag, summary, description })),
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <datalist id={listId}>
        {tags.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
      <ol className="space-y-3">
        {drafts.map((draft, index) => (
          <li key={draft.key} className="space-y-3 rounded-2xl border border-zk-border p-4">
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
              <div className="space-y-1.5">
                <label htmlFor={`skill-tag-${draft.key}`} className={agentsLabelClass}>
                  Tag
                </label>
                <input
                  id={`skill-tag-${draft.key}`}
                  list={listId}
                  value={draft.tag}
                  maxLength={SKILL_TAG_MAX}
                  onChange={(event) => update(draft.key, { tag: event.target.value })}
                  placeholder="Postgres"
                  className={agentsInputClass}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`skill-summary-${draft.key}`} className={agentsLabelClass}>
                  Short description
                </label>
                <input
                  id={`skill-summary-${draft.key}`}
                  value={draft.summary}
                  maxLength={AGENT_SKILL_SUMMARY_MAX}
                  onChange={(event) => update(draft.key, { summary: event.target.value })}
                  placeholder="Query plans, and the indexes they ask for."
                  className={agentsInputClass}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`skill-description-${draft.key}`} className={agentsLabelClass}>
                Description
              </label>
              <Textarea
                id={`skill-description-${draft.key}`}
                rows={3}
                value={draft.description}
                maxLength={AGENT_SKILL_DESCRIPTION_MAX}
                onChange={(event) => update(draft.key, { description: event.target.value })}
                placeholder="What it does with this skill, with an example."
                className="rounded-xl border-zk-border bg-zk-surface text-zk-text placeholder:text-zk-muted focus:border-electric-blue focus:ring-electric-blue/20"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setDrafts((list) => (list.length > 1 ? list.filter((item) => item.key !== draft.key) : [blank()]))}
                className="text-sm font-semibold text-zk-text2 hover:text-zk-bad-fg"
                aria-label={`Remove skill ${index + 1}${draft.tag ? `, ${draft.tag}` : ""}`}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ol>
      {error ? (
        <p role="alert" className="text-sm font-medium text-zk-bad-fg">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zk-divider pt-4">
        <button
          type="button"
          disabled={drafts.length >= AGENT_SKILLS_MAX}
          onClick={() => setDrafts((list) => [...list, blank()])}
          className={agentsSecondaryBtn}
        >
          Add a skill
        </button>
        <span className={`${agentsMutedClass} ml-auto`}>
          {drafts.length}/{AGENT_SKILLS_MAX}
        </span>
        <Button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded-full bg-electric-blue-strong text-white hover:bg-[#2552af] focus-visible:ring-electric-blue"
        >
          <span aria-live="polite">{pending ? "Saving…" : saved ? "Saved ✓" : "Save skills"}</span>
        </Button>
      </div>
    </div>
  );
}
