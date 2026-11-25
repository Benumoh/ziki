"use client";

import { useActionState } from "react";
import Link from "next/link";
import { googleTwoFactorAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function GoogleTwoFactorForm() {
  const [result, action, pending] = useActionState(googleTwoFactorAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm text-zk-text2">Google confirmed your account. Enter your authenticator or backup code to finish signing in.</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="google-code" className="text-sm font-medium">Authentication code</label>
        <Input id="google-code" name="code" autoComplete="one-time-code" required maxLength={32}
          aria-describedby={result?.error ? "google-code-error" : undefined}
          className="h-9 rounded-control border-zk-border bg-zk-surface text-zk-text shadow-none" />
      </div>
      {result?.error ? <p id="google-code-error" role="alert" className="rounded-panel bg-zk-bad-bg p-3 text-sm text-zk-bad-fg">{result.error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Verifying…" : "Verify and sign in"}</Button>
      <Link href="/login" className="text-center text-sm text-zk-accent hover:underline">Start again</Link>
    </form>
  );
}
