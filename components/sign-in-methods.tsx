"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { addPasswordAction, connectGoogleAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Input } from "@/components/ui/input";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { beginGoogleSecurityAction } from "@/app/(app)/settings/security/actions";

const fieldClass = "h-9 rounded-control border-zk-border bg-zk-surface text-zk-text shadow-none";

export function SignInMethods({ hasPassword, googleLinked, googleConfigured, passwordEnabled, twoFactorEnabled, email, passwordVerified = false, passwordSetupRequested = false }: {
  hasPassword: boolean;
  googleLinked: boolean;
  googleConfigured: boolean;
  passwordEnabled: boolean;
  twoFactorEnabled: boolean;
  email: string;
  passwordVerified?: boolean;
  passwordSetupRequested?: boolean;
}) {
  const [link, linkAction, linking] = useActionState(connectGoogleAction, undefined);
  const [setup, setupAction, saving] = useActionState(addPasswordAction, undefined);
  const [verification, verificationAction, verifying] = useActionState(beginGoogleSecurityAction, undefined);
  const [passwordFormOpen, setPasswordFormOpen] = useState(passwordSetupRequested);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const canSavePassword = passwordVerified && !setup?.requiresGoogleVerification;
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
          <div className="flex flex-col gap-3">
            <p className="text-sm text-zk-text2">Choose a password of at least 8 characters. You can then sign in with Google or your email and password.</p>
            {passwordFormOpen ? <>
              {!canSavePassword ? <form action={verificationAction} className="flex flex-col items-start gap-3">
                <input type="hidden" name="operation" value="password" />
                <p className="text-sm text-zk-muted">Verify your Google account before saving a password. No email link is needed.</p>
                {verification?.error ? <p role="alert" className="text-sm text-zk-bad-fg">{verification.error}</p> : null}
                <Button type="submit" variant="secondary" disabled={verifying}>{verifying ? "Connecting…" : "Verify with Google"}</Button>
              </form> : null}
              <form action={setupAction} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="add-password" className="text-sm font-medium">New password</label>
                  <PasswordInput id="add-password" name="password" required minLength={8} maxLength={128} autoComplete="new-password"
                    value={password} onChange={(event) => setPassword(event.target.value)}
                    className={fieldClass} aria-invalid={Boolean(setup?.fieldErrors?.password) || undefined}
                    aria-describedby={setup?.fieldErrors?.password ? "add-password-error" : undefined} />
                  {setup?.fieldErrors?.password ? <p id="add-password-error" role="alert" className="text-sm text-zk-bad-fg">{setup.fieldErrors.password}</p> : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="add-password-confirm" className="text-sm font-medium">Confirm password</label>
                  <PasswordInput id="add-password-confirm" name="confirmPassword" visibilityLabel="confirm password" required minLength={8} maxLength={128}
                    value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password" className={fieldClass} aria-invalid={Boolean(setup?.fieldErrors?.confirmPassword) || undefined}
                    aria-describedby={setup?.fieldErrors?.confirmPassword ? "add-password-confirm-error" : undefined} />
                  {setup?.fieldErrors?.confirmPassword ? <p id="add-password-confirm-error" role="alert" className="text-sm text-zk-bad-fg">{setup.fieldErrors.confirmPassword}</p> : null}
                </div>
                {twoFactorEnabled ? <div className="flex flex-col gap-1.5">
                  <label htmlFor="add-password-code" className="text-sm font-medium">Authenticator or backup code</label>
                  <Input id="add-password-code" name="code" required maxLength={32} autoComplete="one-time-code" className={fieldClass} />
                </div> : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={saving || !canSavePassword}>{saving ? "Saving…" : "Save password"}</Button>
                  <Button type="button" variant="secondary" disabled={saving} onClick={() => { setPassword(""); setConfirmPassword(""); setPasswordFormOpen(false); }}>Cancel</Button>
                </div>
              </form>
            </> : <Button type="button" className="self-start" onClick={() => setPasswordFormOpen(true)}>Add a password</Button>}
            {passwordFormOpen && setup?.error && !setup.field ? <p role="alert" className="text-sm text-zk-bad-fg">{setup.error}</p> : null}
          </div>
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
