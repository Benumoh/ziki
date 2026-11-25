"use client";

import { useActionState, useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import type { GoogleSecurityOperation } from "@/lib/google-auth-intent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { copyText } from "@/lib/clipboard";
import {
  confirmTwoFactorAction,
  disableTwoFactorAction,
  regenerateBackupCodesAction,
  startTwoFactorAction,
  beginGoogleSecurityAction,
} from "./actions";

type Step =
  | { name: "idle" }
  | { name: "password" }
  | { name: "scan"; secret: string; qr: string }
  | { name: "codes"; codes: string[]; heading: string }
  | { name: "regenerate" }
  | { name: "disable" };

/** Every two-factor change signs out the person's other sessions (Ziki #389). */
const SIGNED_OUT_NOTICE = "You've been signed out on your other devices.";

function GoogleVerification({ operation }: { operation: GoogleSecurityOperation }) {
  const [result, action, pending] = useActionState(beginGoogleSecurityAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="operation" value={operation} />
      <p className="text-sm text-zk-muted">Confirm your Google account before continuing. You don&apos;t need to add a password.</p>
      {result?.error ? <p role="alert" className="text-sm text-zk-bad-fg">{result.error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Connecting…" : "Verify with Google"}</Button>
    </form>
  );
}

export function TwoFactorSettings({
  enabled,
  backupCodesLeft,
  hasPassword = true,
  googleVerifiedFor,
}: {
  enabled: boolean;
  backupCodesLeft: number;
  hasPassword?: boolean;
  googleVerifiedFor?: GoogleSecurityOperation;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(() => {
    switch (googleVerifiedFor) {
      case "setup": return { name: "password" };
      case "disable": return { name: "disable" };
      case "regenerate": return { name: "regenerate" };
      default: return { name: "idle" };
    }
  });
  const [googleProofAvailable, setGoogleProofAvailable] = useState(Boolean(googleVerifiedFor));
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [signedOutOthers, setSignedOutOthers] = useState(false);
  const [pending, startTransition] = useTransition();

  function run<T extends { ok: boolean; error?: string; requiresGoogleVerification?: boolean }>(
    action: (formData: FormData) => Promise<T>,
    formData: FormData,
    onOk: (result: Extract<T, { ok: true }>) => void,
  ) {
    setError(null);
    // The notice is about the last change; a new attempt starts without it.
    setSignedOutOthers(false);
    startTransition(async () => {
      try {
        const result = await action(formData);
        if (result.ok) onOk(result as Extract<T, { ok: true }>);
        else {
          if (result.requiresGoogleVerification) setGoogleProofAvailable(false);
          setError(result.error ?? "Something went wrong.");
        }
      } catch (error) {
        unstable_rethrow(error);
        setError("Something went wrong. Please try again.");
      }
    });
  }

  function cancel() {
    setError(null);
    setSignedOutOthers(false);
    setStep({ name: "idle" });
  }

  function finish() {
    setStep({ name: "idle" });
    setCopied(false);
    setGoogleProofAvailable(false);
    router.refresh();
  }

  const errorLine = error ? (
    <p id="two-factor-error" className="text-sm text-zk-bad-fg" role="alert">
      {error}
    </p>
  ) : null;

  const signedOutLine = signedOutOthers ? (
    <p className="text-sm text-zk-muted" role="status">
      {SIGNED_OUT_NOTICE}
    </p>
  ) : null;

  async function copyBackupCodes(codes: string[]) {
    setError(null);
    const success = await copyText(codes.join("\n"));
    setCopied(success);
    if (!success) {
      setError("Couldn't copy the codes. They are still shown here so you can select and copy them manually.");
    }
  }

  if (step.name === "codes") {
    return (
      <div className="mt-4 space-y-3">
        <p className="text-sm font-medium text-zk-text">{step.heading}</p>
        {signedOutLine}
        <p className="text-sm text-zk-muted">
          Save these backup codes somewhere safe, like a password manager. Each one works once if you
          lose your phone. <strong>They are shown only now.</strong>
        </p>
        <ul
          aria-label="Backup codes"
          className="grid grid-cols-2 gap-2 rounded-lg border border-zk-border bg-zk-tint p-3 font-mono text-sm text-zk-text"
        >
          {step.codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        {errorLine}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void copyBackupCodes(step.codes)}
          >
            {copied ? "✓ Copied" : "Copy codes"}
          </Button>
          <Button type="button" onClick={finish}>
            I&apos;ve saved them
          </Button>
        </div>
      </div>
    );
  }

  if (step.name === "scan") {
    return (
      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          run(
            confirmTwoFactorAction,
            new FormData(event.currentTarget),
            (result) => {
              setSignedOutOthers(true);
              setStep({ name: "codes", codes: result.codes, heading: "Two-factor sign-in is on." });
            },
          );
        }}
      >
        <p className="text-sm text-zk-muted">
          1. Scan this with your authenticator app, or type the key in by hand.
        </p>
        {/* A data: URL made on the server from the otpauth link. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={step.qr} alt="QR code for your authenticator app" width={220} height={220} />
        <p className="text-sm text-zk-muted">
          Key: <code className="select-all font-mono text-xs text-zk-text">{step.secret}</code>
        </p>
        <div className="space-y-1.5">
          <label htmlFor="confirm-code" className="text-sm font-medium text-zk-text2">
            2. Enter the 6-digit code it shows
          </label>
          <Input
            id="confirm-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            required
            aria-describedby={error ? "two-factor-error" : undefined}
          />
        </div>
        {errorLine}
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Checking…" : "Turn on"}
          </Button>
          <Button type="button" variant="secondary" onClick={cancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  if (step.name === "password") {
    if (!hasPassword && (!googleProofAvailable || googleVerifiedFor !== "setup")) {
      return <div className="mt-4 space-y-3">
        {errorLine}
        <GoogleVerification operation="setup" />
        <Button type="button" variant="secondary" onClick={cancel}>Cancel</Button>
      </div>;
    }
    return (
      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          run(startTwoFactorAction, new FormData(event.currentTarget), (result) => {
            setGoogleProofAvailable(false);
            setStep({ name: "scan", secret: result.secret, qr: result.qr });
          });
        }}
      >
        {hasPassword ? <div className="space-y-1.5">
          <label htmlFor="setup-password" className="text-sm font-medium text-zk-text2">
            Confirm your password to continue
          </label>
          <PasswordInput
            id="setup-password"
            name="password"
            autoComplete="current-password"
            required
            aria-describedby={error ? "two-factor-error" : undefined}
          />
        </div> : <p className="text-sm text-zk-text2">Google confirmed your identity. Continue to set up your authenticator app.</p>}
        {errorLine}
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Checking…" : "Continue"}
          </Button>
          <Button type="button" variant="secondary" onClick={cancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  if (step.name === "regenerate" || step.name === "disable") {
    const disabling = step.name === "disable";
    if (!hasPassword && (!googleProofAvailable || googleVerifiedFor !== step.name)) {
      return <div className="mt-4 space-y-3">
        {errorLine}
        <GoogleVerification operation={step.name} />
        <Button type="button" variant="secondary" onClick={cancel}>Cancel</Button>
      </div>;
    }
    return (
      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          if (disabling) {
            run(disableTwoFactorAction, data, () => {
              setSignedOutOthers(true);
              finish();
            });
          } else {
            run(regenerateBackupCodesAction, data, (result) => {
              setSignedOutOthers(true);
              setGoogleProofAvailable(false);
              setStep({ name: "codes", codes: result.codes, heading: "New backup codes made." });
            });
          }
        }}
      >
        <p className="text-sm text-zk-muted">
          {disabling
            ? "Turning this off removes Ziki's authenticator step from sign-in."
            : "This replaces your old backup codes, which stop working."}{" "}
          Confirm it is you:
        </p>
        {hasPassword ? <div className="space-y-1.5">
          <label htmlFor="reauth-password" className="text-sm font-medium text-zk-text2">
            Password
          </label>
          <PasswordInput
            id="reauth-password"
            name="password"
            autoComplete="current-password"
            required
            aria-describedby={error ? "two-factor-error" : undefined}
          />
        </div> : <p className="text-sm text-zk-text2">Google confirmed your identity. Enter your authenticator or backup code to confirm this change.</p>}
        <div className="space-y-1.5">
          <label htmlFor="reauth-code" className="text-sm font-medium text-zk-text2">
            Authenticator or backup code
          </label>
          <Input
            id="reauth-code"
            name="code"
            autoComplete="one-time-code"
            required
            aria-describedby={error ? "two-factor-error" : undefined}
          />
        </div>
        {errorLine}
        <div className="flex gap-2">
          <Button type="submit" variant={disabling ? "danger" : "primary"} disabled={pending}>
            {pending ? "Checking…" : disabling ? "Turn off" : "Make new codes"}
          </Button>
          <Button type="button" variant="secondary" onClick={cancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {signedOutLine}
      <p className="text-sm text-zk-text">
        Status:{" "}
        <span className={enabled ? "font-semibold text-zk-ok-fg" : "font-semibold text-zk-text2"}>
          {enabled ? "On" : "Off"}
        </span>
      </p>
      {enabled ? (
        <>
          <p className="text-sm text-zk-muted">
            {backupCodesLeft} backup {backupCodesLeft === 1 ? "code" : "codes"} left.
            {backupCodesLeft <= 2 ? " Make new ones soon." : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setStep({ name: "regenerate" })}>
              Make new backup codes
            </Button>
            <Button type="button" variant="danger-secondary" onClick={() => setStep({ name: "disable" })}>
              Turn off
            </Button>
          </div>
        </>
      ) : (
        <Button type="button" onClick={() => setStep({ name: "password" })}>
          Set up two-factor sign-in
        </Button>
      )}
    </div>
  );
}
