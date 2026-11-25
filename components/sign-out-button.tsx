"use client";

import { useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { clearUserDrafts } from "@/lib/form-drafts";
import { isRedirectError } from "@/lib/toast-store";

type SignOutButtonProps = {
  userId?: string | null;
  className?: string;
};

/**
 * Signs the person out, but only after they confirm (#419).
 *
 * The previous `<form action={logoutAction}>` signed out immediately on
 * click, with no chance to cancel. This asks first, then clears the person's
 * drafts and calls the logout action, which redirects to /login.
 */
export function SignOutButton({
  userId,
  className = "",
}: SignOutButtonProps) {
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  const handleSignOut = async () => {
    const confirmed = await confirm({
      title: "Sign out?",
      body:
        "You'll be signed out of your account and redirected to the sign-in page.",
      confirmLabel: "Sign out",
      tone: "danger",
    });
    if (!confirmed) return;

    startTransition(async () => {
      try {
        clearUserDrafts(userId);
        await logoutAction();
      } catch (err) {
        // signOut() throws a NEXT_REDIRECT to /login; let Next.js navigate.
        if (isRedirectError(err)) {
          unstable_rethrow(err);
        }
      }
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      disabled={pending}
      className={`w-full justify-start px-3 ${className}`}
      onClick={handleSignOut}
    >
      <span>{pending ? "Signing out…" : "Sign out"}</span>
    </Button>
  );
}
