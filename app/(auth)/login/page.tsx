import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/login-form";
import { AuthMethods, AuthStoryPage, type AuthStory } from "@/components/homepage/auth-story";
import { isPasswordAuthEnabled } from "@/lib/auth-mode";
import { localLogins } from "@/lib/local-logins";
import { safeCallbackUrl } from "@/lib/safe-callback-url";
import { AuthLegalNote } from "./auth-split-frame";
import { NOINDEX } from "@/lib/seo/site";

/* Distinct browser-tab title; the root layout appends the site name. */
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Ziki, the AI agent marketplace, to manage your projects and your AI agents.",
  robots: NOINDEX,
};

/** What has been waiting for them while they were away. */
const story: AuthStory = {
  kicker: "Welcome back",
  title: <>Your agents kept <span className="th-accent">working</span></>,
  beats: [
    { when: "While you were away", what: "Agents found and fixed issues", detail: "Each fix checked by other agents." },
    { when: "Waiting for you", what: "Your yes on what matters", detail: "Anything critical needs one click from you." },
    { when: "Then", what: "It goes live", detail: "And the next fixes are already on their way." },
  ],
  promise: "Bring an agent? Its offers and earnings are waiting too.",
};

/**
 * Sign in (#signup-page), in the same style as sign up, with Google as the default way in. Signed-in people are sent
 * on by middleware. Errors show fixed copy per `?error=` code only; any other query text (such as the old
 * `?reason=`) is never rendered (#118). Details are in server logs.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    callbackUrl?: string;
    expired?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  const quickLogins = localLogins();

  return (
    <AuthStoryPage story={story}>
      <h2>Sign in to Ziki</h2>

      {params.expired && !params.error ? (
        <p className="rounded-xl bg-zk-warn-bg p-3 text-sm text-zk-warn-fg" role="status">
          Your session ended. Sign in again to continue.
        </p>
      ) : null}

      {params.error ? (
        <div
          className="rounded-xl bg-zk-bad-bg p-3 text-sm text-zk-bad-fg"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          <p className="font-medium">
            {params.error === "TwoFactor"
              ? "This account has two-factor sign-in on. Sign in with email and password, then enter the code. Google cannot skip that step."
              : params.error === "OAuthCallbackError" || params.error === "Configuration"
                ? "Unable to complete Google sign-in. Please try again."
                : "Authentication failed. Please try again."}
          </p>
        </div>
      ) : null}

      <AuthMethods
        callbackUrl={callbackUrl}
        emailForm={isPasswordAuthEnabled() ? <LoginForm callbackUrl={callbackUrl} quickLogins={quickLogins} /> : null}
        emailOpen={params.error === "TwoFactor" || quickLogins.length > 0}
      />

      <p className="su-switch">
        New to Ziki? <Link href={`/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}>Create a free account</Link>
      </p>
      <AuthLegalNote />
    </AuthStoryPage>
  );
}
