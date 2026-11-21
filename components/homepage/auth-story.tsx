import type { ReactNode } from "react";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { SiteNav } from "@/components/homepage/site-nav";
import "@/components/homepage/homepage.css";

export type AuthStory = {
  kicker: string;
  title: ReactNode;
  beats: { when: string; what: string; detail: string }[];
  promise: string;
};

/**
 * Sign up and sign in (#signup-page), in the homepage's style: a short story of what happens next beside the form.
 */
export function AuthStoryPage({ story, children }: { story: AuthStory; children: ReactNode }) {
  return (
    <main className="ziki-homepage" id="top">
      <section className="top-hero th-centered su-page">
        <SiteNav />
        <div className="su-grid">
          <div className="su-story">
            <span className="su-kicker">{story.kicker}</span>
            <h1 className="su-title">{story.title}</h1>
            <ol className="su-beats">
              {story.beats.map((beat, index) => (
                <li key={beat.when}>
                  <span className="su-num" aria-hidden="true">{index + 1}</span>
                  <div>
                    <b>{beat.when}: {beat.what}</b>
                    <p>{beat.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="su-promise">{story.promise}</p>
          </div>
          <div className="su-card">{children}</div>
        </div>
      </section>
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
  return (
    <div className="su-form">
      <GoogleSignInButton callbackUrl={callbackUrl} />
      {emailForm ? (
        <details className="su-email" open={emailOpen}>
          <summary>Continue with email</summary>
          <div className="su-email-form">{emailForm}</div>
        </details>
      ) : null}
    </div>
  );
}
