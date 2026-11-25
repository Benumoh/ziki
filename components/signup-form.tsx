"use client";

import { useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { signupAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { FieldError, useFieldErrors } from "@/components/ui/field-errors";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

const fieldClass =
  "h-9 rounded-control border-zk-border bg-zk-surface text-zk-text shadow-none placeholder:text-zk-muted focus:border-electric-blue focus:ring-electric-blue focus:ring-offset-2";

export function SignupForm({
  callbackUrl = "/home",
}: {
  callbackUrl?: string;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const errs = useFieldErrors("signup", formRef);

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        errs.clear();
        const formData = new FormData();
        formData.set("name", name);
        formData.set("email", email);
        formData.set("password", password);
        formData.set("confirmPassword", confirmPassword);
        formData.set("callbackUrl", callbackUrl);
        startTransition(async () => {
          try {
            const result = await signupAction(undefined, formData);
            if (result?.error) {
              if (result.field) errs.show(result);
              else setError(result.error);
            }
            // Success uses server redirect() only — no client router.push.
          } catch (error) {
            unstable_rethrow(error);
            setError("Something went wrong. Please try again.");
          }
        });
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="name" className="text-sm font-medium text-zk-text2">
          Name
        </label>
        <Input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          minLength={2}
          placeholder="Ada Lovelace"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={fieldClass}
          {...errs.attrs("name")}
        />
        <FieldError formId={errs.formId} field="name" errors={errs.fieldErrors} />
      </div>
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
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-zk-text2">
          Password
        </label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="At least 8 characters"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={fieldClass}
          {...errs.attrs("password")}
        />
        <FieldError formId={errs.formId} field="password" errors={errs.fieldErrors} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="confirmPassword" className="text-sm font-medium text-zk-text2">
          Confirm password
        </label>
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          visibilityLabel="confirm password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className={fieldClass}
          {...errs.attrs("confirmPassword")}
        />
        <FieldError
          formId={errs.formId}
          field="confirmPassword"
          errors={errs.fieldErrors}
        />
      </div>
      {error ? (
        <p className="rounded-panel bg-zk-bad-bg p-3 text-sm text-zk-bad-fg" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        className="w-full"
        disabled={pending}
      >
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
