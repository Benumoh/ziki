import type { ReactNode } from "react";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { AuthPage } from "@/components/auth-page";
import { isGoogleOAuthConfigured } from "@/lib/google-oauth";

export type AuthStory = {
  kicker: string;
  title: ReactNode;
  beats: { when: string; what: string; detail: string }[];
  promise: string;
};

/**
 * Sign up and sign in keep their story beside a panel in the shared auth shell.
 */
export function AuthStoryPage({ story, children }: { story: AuthStory; children: ReactNode }) {
  return (
    <main>
      <AuthPage
        panelLabel="Your account"
        story={
          <div className="flex min-w-0 flex-col gap-6">
            <span className="self-start rounded-chip bg-zk-tint px-3 py-1.5 text-xs font-semibold text-zk-accent">
              {story.kicker}
            </span>
            <h1 className="text-4xl leading-tight font-medium tracking-tight sm:text-5xl">
              {story.title}
            </h1>
            <ol className="flex flex-col gap-5">
              {story.beats.map((beat, index) => (
                <li key={beat.when} className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-chip bg-zk-tint text-sm font-semibold text-zk-accent" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div>
                    <b className="text-base font-semibold">{beat.when}: {beat.what}</b>
                    <p className="mt-1 text-sm leading-relaxed text-zk-muted">{beat.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="border-t border-zk-border pt-5 text-sm leading-relaxed text-zk-text2">
              {story.promise}
            </p>
          </div>
        }
      >
        {children}
      </AuthPage>
    </main>
  );
}

/**
 * Google is the default way in: its button always leads, and the email form waits folded under "Continue with email"
 * (open from the start only when the email form has something to say, such as a two-factor sign-in).
 */
export function AuthMethods({
  callbackUrl,
  emailForm,
  emailOpen = false,
}: {
  callbackUrl: string;
  /** Null when password sign-in is off. */
  emailForm: ReactNode | null;
  emailOpen?: boolean;
}) {
  const googleConfigured = isGoogleOAuthConfigured();
  return (
    <div className="flex flex-col gap-4">
      {googleConfigured ? <GoogleSignInButton callbackUrl={callbackUrl} /> : null}
      {emailForm && googleConfigured ? (
        <details open={emailOpen}>
          <summary className="flex h-9 cursor-pointer list-none items-center justify-center rounded-control px-4 text-sm font-semibold text-zk-text2 hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
            Continue with email
          </summary>
          <div className="mt-4 border-t border-zk-divider pt-4">{emailForm}</div>
        </details>
      ) : emailForm}
      {!emailForm && !googleConfigured ? <p role="status" className="text-sm text-zk-muted">Sign-in is not configured on this site. Contact an administrator.</p> : null}
    </div>
  );
}
