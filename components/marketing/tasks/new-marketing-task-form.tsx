"use client";

import { useId, useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { createBugAction } from "@/app/actions/issues";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 5000;
const RATIONALE_MAX = 2000;

function FieldLabel({ htmlFor, id, children }: { htmlFor: string; id?: string; children: string }) {
  return (
    <label id={id} htmlFor={htmlFor} className="mb-2 block text-sm font-semibold text-zk-text">
      {children}
    </label>
  );
}

function Counter({ value, max }: { value: number; max: number }) {
  return (
    <span className="font-mono text-xs tabular-nums text-zk-text2" aria-hidden="true">
      {value}/{max}
    </span>
  );
}

/**
 * The fields a marketing proposal needs (plan M-UI-3): title, description, task
 * type and rationale. There are no points, because pay comes from each task's
 * own reward (D5). Saving files a marketing idea in this project, then the
 * action opens its page.
 */
export function NewMarketingTaskForm({ projectId, types, defaultTypeId }: { projectId: string; types: { id: string; name: string }[]; defaultTypeId?: string }) {
  const router = useRouter();
  const uid = useId();
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const ids = {
    title: `${uid}-title`,
    rationale: `${uid}-rationale`,
    rationaleHelp: `${uid}-rationale-help`,
    description: `${uid}-description`,
    descriptionLabel: `${uid}-description-label`,
    type: `${uid}-type`,
  };

  return (
    <form
      className="space-y-7 rounded-3xl border border-zk-border bg-zk-surface p-6 sm:p-8"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        formData.set("track", "marketing");
        formData.set("projectId", projectId);
        formData.set("description", description);
        setError("");
        startTransition(async () => {
          try {
            const result = await createBugAction(formData);
            if (result.error) setError(result.error);
          } catch (failure) {
            // The action redirects to the new idea, which arrives here as a throw.
            unstable_rethrow(failure);
            setError("Your idea couldn't be sent. Check your connection and try again.");
          }
        });
      }}
    >
      <div>
        <FieldLabel htmlFor={ids.title}>Title</FieldLabel>
        <Input
          id={ids.title}
          name="title"
          required
          minLength={3}
          maxLength={TITLE_MAX}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. Write a launch post for the new issue list"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-sm text-zk-text2">Be concise and focus on the expected outcome.</p>
          <Counter value={title.length} max={TITLE_MAX} />
        </div>
      </div>

      <div>
        <FieldLabel htmlFor={ids.type}>Task type</FieldLabel>
        {types.length > 0 ? (
          <Select id={ids.type} name="typeId" required defaultValue={types.some((type) => type.id === defaultTypeId) ? defaultTypeId : undefined}>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </Select>
        ) : (
          <>
            <Select id={ids.type} name="typeId" required disabled>
              <option value="">No task types yet</option>
            </Select>
            <p className="mt-2 text-sm text-zk-text2">
              An organisation owner or admin can add task types in the marketing settings.
            </p>
          </>
        )}
      </div>

      <div>
        <FieldLabel htmlFor={ids.rationale}>Rationale</FieldLabel>
        <p id={ids.rationaleHelp} className="mb-2 text-sm text-zk-text2">
          How does this serve the current focus?
        </p>
        <Textarea
          id={ids.rationale}
          name="rationale"
          required
          maxLength={RATIONALE_MAX}
          rows={4}
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          aria-describedby={ids.rationaleHelp}
        />
        <div className="mt-2 flex justify-end">
          <Counter value={rationale.length} max={RATIONALE_MAX} />
        </div>
      </div>

      <div>
        <FieldLabel htmlFor={ids.description} id={ids.descriptionLabel}>Description</FieldLabel>
        <MarkdownEditor
          id={ids.description}
          labelId={ids.descriptionLabel}
          name="description"
          required
          minLength={10}
          maxLength={DESCRIPTION_MAX}
          rows={10}
          allowUploads={false}
          value={description}
          onChange={setDescription}
          placeholder="What should happen, who it's for, and how to do it."
          footer={<Counter value={description.length} max={DESCRIPTION_MAX} />}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-zk-bad-fg">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={types.length === 0 || isPending}>
          {isPending ? "Proposing…" : "Propose task"}
        </Button>
        <Button type="button" variant="ghost" className="ml-auto" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
