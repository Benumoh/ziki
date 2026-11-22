"use client";

import Link from "next/link";
import { useActionState } from "react";
import { connectGoogleAction, requestPasswordSetupAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Input } from "@/components/ui/input";
import { GoogleSignInButton } from "@/components/google-sign-in-button";

const fieldClass = "h-9 rounded-control border-zk-border bg-zk-surface text-zk-text shadow-none";

export function SignInMethods({ hasPassword, googleLinked, googleConfigured, passwordEnabled, twoFactorEnabled, email }: {
  hasPassword: boolean;
  googleLinked: boolean;
  googleConfigured: boolean;
  passwordEnabled: boolean;
  twoFactorEnabled: boolean;
  email: string;
}) {
  const [link, linkAction, linking] = useActionState(connectGoogleAction, undefined);
  const [setup, setupAction, sending] = useActionState(async () => requestPasswordSetupAction(), undefined);
  return (
    <section className="flex flex-col gap-5 rounded-panel border border-zk-border bg-zk-surface p-6">
      <div>
        <h2 className="text-lg font-semibold">Sign-in methods</h2>
        <p className="mt-1 text-sm text-zk-muted">Manage how you sign in to {email}. Both methods use the same account.</p>
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Email and password</h3>
        {hasPassword ? (
          <p className="text-sm text-zk-text2">{passwordEnabled ? "Password sign-in is enabled." : "Password sign-in is disabled on this site."} {passwordEnabled ? <Link href="/forgot-password" className="text-zk-accent hover:underline">Reset password</Link> : null}</p>
        ) : passwordEnabled && googleLinked ? (
          <form action={setupAction} className="flex flex-col items-start gap-3">
            <p className="text-sm text-zk-text2">Choose a password of at least 8 characters. You can then sign in with Google or your email and password.</p>
            <p className="text-sm text-zk-muted">We’ll email you a secure link to set your password.</p>
            <Button type="submit" disabled={sending}>{sending ? "Sending…" : "Add a password"}</Button>
            {setup?.error ? <p role="alert" className="text-sm text-zk-bad-fg">{setup.error}</p> : null}
            {setup?.success ? <p role="status" className="rounded-panel bg-zk-tint p-3 text-sm text-zk-accent">{setup.success}</p> : null}
          </form>
        ) : <p className="text-sm text-zk-muted">{passwordEnabled ? "Sign in with Google again to confirm your account before adding a password." : "Password sign-in is disabled on this site."}</p>}
      </div>
      <div className="flex flex-col gap-3 border-t border-zk-divider pt-5">
        <h3 className="text-sm font-semibold">Google</h3>
        {googleLinked ? <p className="text-sm text-zk-text2">Google is connected. Your password stays available when you add or reset one.</p> : !googleConfigured ? (
          <p className="text-sm text-zk-muted">Google sign-in is not configured on this site yet.</p>
        ) : hasPassword ? (
          <form action={linkAction} className="flex flex-col gap-3">
            <p className="text-sm text-zk-muted">Confirm your password, then choose the Google account for {email}. Your password will keep working.</p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="link-password" className="text-sm font-medium">Current password</label>
              <PasswordInput id="link-password" name="currentPassword" required autoComplete="current-password" className={fieldClass} />
            </div>
            {twoFactorEnabled ? <div className="flex flex-col gap-1.5">
              <label htmlFor="link-code" className="text-sm font-medium">Authenticator or backup code</label>
              <Input id="link-code" name="code" required autoComplete="one-time-code" maxLength={32} className={fieldClass} />
            </div> : null}
            {link?.error ? <p role="alert" className="text-sm text-zk-bad-fg">{link.error}</p> : null}
            <Button type="submit" variant="secondary" disabled={linking}>{linking ? "Connecting…" : "Connect Google"}</Button>
          </form>
        ) : <GoogleSignInButton callbackUrl="/settings/security" />}
      </div>
    </section>
  );
}
