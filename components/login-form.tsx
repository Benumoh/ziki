"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { googleSignInAction, loginAction } from "@/app/actions/auth";
import { GoogleSignInButtonInline } from "@/components/google-sign-in-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

const fieldClass =
  "h-9 rounded-control border-zk-border bg-zk-surface text-zk-text shadow-none placeholder:text-zk-muted focus:border-electric-blue focus:ring-electric-blue focus:ring-offset-2";

export function LoginForm({
  callbackUrl = "/home",
  googleEnabled = false,
  quickLogins = [],
}: {
  callbackUrl?: string;
  googleEnabled?: boolean;
  /** Local checkouts only (#local-quick-login): accounts that fill the form in one pick. */
  quickLogins?: { email: string; password: string }[];
}) {
  // Only show Google button if OAuth is actually configured
  const showGoogleButton = googleEnabled;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Set once the password was right and the account has two-factor on (#648).
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  // True when the error is about the credentials, so both fields are marked
  // invalid and described by the one message (#309). It never says which of
  // the two was wrong: that would reveal whether the account exists.
  const [credentialsInvalid, setCredentialsInvalid] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (credentialsInvalid) document.getElementById("email")?.focus();
  }, [credentialsInvalid]);
  useEffect(() => {
    if (needsCode) document.getElementById("totp")?.focus();
  }, [needsCode]);

  const fieldAttrs = credentialsInvalid
    ? ({ "aria-invalid": true, "aria-describedby": "login-error" } as const)
    : {};

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setCredentialsInvalid(false);
        const formData = new FormData();
        formData.set("email", email);
        formData.set("password", password);
        if (needsCode) formData.set("totp", code);
        formData.set("callbackUrl", callbackUrl);
        startTransition(async () => {
          try {
            const result = await loginAction(undefined, formData);
            if (result?.error) {
              setError(result.error);
              setCredentialsInvalid(Boolean(result.field));
              if (result.needsCode) {
                setNeedsCode(true);
                setCode("");
              } else {
                setNeedsCode(false);
              }
            }
            // Success uses server redirect() only — no client router.push
            // (avoids navigation storms with middleware redirects).
          } catch (error) {
            // Must rethrow NEXT_REDIRECT so the framework can navigate
            unstable_rethrow(error);
            setError("Something went wrong. Please try again.");
          }
        });
      }}
    >
      {showGoogleButton ? (
        <>
          <GoogleSignInButtonInline
            pending={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                try {
                  // Keep the requested page, e.g. an issue from its 404 (#457).
                  await googleSignInAction(callbackUrl);
                } catch (error) {
                  unstable_rethrow(error);
                  setError("Google sign-in failed. Please try again.");
                }
              });
            }}
          />
          <div className="relative py-1 text-center text-xs font-bold tracking-[0.06em] text-zk-muted uppercase">
            <span className="relative z-10 bg-zk-surface px-2">or</span>
            <span className="absolute inset-x-0 top-1/2 border-t border-zk-border" />
          </div>
        </>
      ) : null}
      {quickLogins.length > 0 ? (
        <div className="space-y-1.5">
          <label htmlFor="quick-login" className="text-sm font-medium text-zk-text2">
            Local account
          </label>
          <select
            id="quick-login"
            className="h-9 w-full rounded-control border border-zk-border bg-zk-surface px-3 text-sm text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2"
            value=""
            onChange={(event) => {
              const pick = quickLogins.find((login) => login.email === event.target.value);
              if (!pick) return;
              setEmail(pick.email);
              setPassword(pick.password);
            }}
          >
            <option value="">Pick an account to fill in…</option>
            {quickLogins.map((login) => (
              <option key={login.email} value={login.email}>{login.email}</option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-zk-text2">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={fieldClass}
          {...fieldAttrs}
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="password" className="text-sm font-medium text-zk-text2">
            Password
          </label>
          <Link
            href="/forgot-password"
            className="text-xs font-semibold text-zk-accent hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={fieldClass}
          {...fieldAttrs}
        />
      </div>
      {needsCode ? (
        <div className="space-y-1.5">
          <label htmlFor="totp" className="text-sm font-medium text-zk-text2">
            Authentication code
          </label>
          <Input
            id="totp"
            name="totp"
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            placeholder="123456"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-describedby="totp-help"
            className={fieldClass}
          />
          <p id="totp-help" className="text-xs text-zk-muted">
            Open your authenticator app and enter the 6-digit code. Lost your phone? Use one of
            your backup codes instead.
          </p>
        </div>
      ) : null}
      {error ? (
        <p id="login-error" className="rounded-panel bg-zk-bad-bg p-3 text-sm text-zk-bad-fg" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        className="w-full"
        disabled={pending}
      >
        {pending ? "Signing in…" : needsCode ? "Verify and sign in" : "Sign in"}
      </Button>
    </form>
  );
}
