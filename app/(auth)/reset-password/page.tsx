import Link from "next/link";
import { notFound } from "next/navigation";
import { isPasswordAuthEnabled } from "@/lib/auth-mode";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { AuthSplitFrame } from "../login/auth-split-frame";
import { NOINDEX } from "@/lib/seo/site";

/* Distinct browser-tab title; the root layout appends the site name. */
export const metadata = { title: "Set a new password", robots: NOINDEX };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (!isPasswordAuthEnabled()) notFound();

  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token.trim() : "";

  return (
    <main>
      <AuthSplitFrame
        panelLabel="Reset password"
        title="Set a new password"
        description="Choose a new password of at least 8 characters. Your old password will stop working immediately. Google sign-in stays connected."
      >
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <p className="text-sm text-zk-bad-fg" role="alert">
            This reset link is invalid or incomplete. Request a new one from the forgot
            password page.
          </p>
        )}
        <p className="text-center text-sm text-zk-muted">
          <Link
            href="/forgot-password"
            className="font-semibold text-zk-accent hover:underline"
          >
            Request a new reset link
          </Link>
          {" · "}
          <Link href="/login" className="font-semibold text-zk-accent hover:underline">
            Sign in
          </Link>
        </p>
      </AuthSplitFrame>
    </main>
  );
}
