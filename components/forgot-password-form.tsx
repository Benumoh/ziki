"use client";

import { useRef, useState, useTransition } from "react";
import { forgotPasswordAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { FieldError, useFieldErrors } from "@/components/ui/field-errors";
import { Input } from "@/components/ui/input";

const fieldClass =
  "h-9 rounded-control border-zk-border bg-zk-surface text-zk-text shadow-none placeholder:text-zk-muted focus:border-electric-blue focus:ring-electric-blue focus:ring-offset-2";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const errs = useFieldErrors("forgot", formRef);

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        errs.clear();
        setSuccess(null);
        const formData = new FormData();
        formData.set("email", email);
        startTransition(async () => {
          const result = await forgotPasswordAction(undefined, formData);
          if (result?.error) {
            if (result.field) errs.show(result);
            else setError(result.error);
            return;
          }
          if (result?.success) {
            setSuccess(result.success);
          }
        });
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-zk-text2">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={fieldClass}
          {...errs.attrs("email")}
        />
        <FieldError formId={errs.formId} field="email" errors={errs.fieldErrors} />
      </div>
      {error ? (
        <p className="rounded-panel bg-zk-bad-bg p-3 text-sm text-zk-bad-fg" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-panel bg-zk-ok-bg p-3 text-sm text-zk-ok-fg" role="status">
          {success}
        </p>
      ) : null}
      <Button
        type="submit"
        className="w-full"
        disabled={pending}
      >
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
