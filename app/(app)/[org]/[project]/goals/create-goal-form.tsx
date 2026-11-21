"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldError, useFieldErrors } from "@/components/ui/field-errors";
import { useToast } from "@/components/ui/toast";
import { createGoalAction, type GoalActionResult } from "@/app/actions/goals";

const FORM_ID = "create-goal";

/**
 * The goals list's create form: a title and a pool of credits (#616). The
 * server action validates through `createGoalSchema`, so the field errors it
 * returns land beside their inputs.
 */
export function CreateGoalForm({ org, slug }: { org: string; slug: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const [state, action, pending] = useActionState<GoalActionResult | undefined, FormData>(
    createGoalAction,
    undefined,
  );
  const { fieldErrors, show, clear, attrs } = useFieldErrors(FORM_ID, formRef);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      clear();
      formRef.current?.reset();
      toast(state.message ?? "Goal created.", "success");
      return;
    }
    show(state);
  }, [state, show, clear, toast]);

  return (
    <form
      ref={formRef}
      action={action}
      id={FORM_ID}
      className="space-y-4 rounded-panel border border-zk-border bg-zk-surface px-5 py-4"
      noValidate
      data-testid="create-goal-form"
    >
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="slug" value={slug} />
      <div>
        <h2 className="text-base font-bold text-zk-text">New goal</h2>
        <p className="mt-0.5 text-[13px] text-zk-text2">Give the goal a pool of credits to split.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <div>
          <label htmlFor={`${FORM_ID}-title`} className="block text-sm font-medium text-zk-text">
            Title
          </label>
          <Input
            id={`${FORM_ID}-title`}
            name="title"
            required
            minLength={3}
            maxLength={200}
            placeholder="Launch week security fixes"
            className="mt-1"
            {...attrs("title")}
          />
          <FieldError formId={FORM_ID} field="title" errors={fieldErrors} />
        </div>
        <div>
          <label htmlFor={`${FORM_ID}-pool`} className="block text-sm font-medium text-zk-text">
            Budget pool (credits)
          </label>
          <Input
            id={`${FORM_ID}-pool`}
            name="budgetPool"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            required
            placeholder="1200"
            className="mt-1"
            {...attrs("budgetPool")}
          />
          <FieldError formId={FORM_ID} field="budgetPool" errors={fieldErrors} />
        </div>
      </div>
      <div>
        <label htmlFor={`${FORM_ID}-description`} className="block text-sm font-medium text-zk-text">
          Description <span className="font-normal text-zk-muted">(optional)</span>
        </label>
        <Textarea
          id={`${FORM_ID}-description`}
          name="description"
          rows={2}
          maxLength={4000}
          placeholder="What this pool funds, and when it is done."
          className="mt-1"
          {...attrs("description")}
        />
        <FieldError formId={FORM_ID} field="description" errors={fieldErrors} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create goal"}
      </Button>
    </form>
  );
}
