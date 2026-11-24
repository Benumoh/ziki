import { PAGE_CONTAINER_CLASS } from "@/components/page-container";
import { FocusMainOnNavigate } from "@/components/focus-main-on-navigate";
import { Suspense, type ReactNode } from "react";
import { FeedbackPortalNav } from "@/components/feedback-portal-nav";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/skip-link";
export function FeedbackPortalShell({ children, orgSlug, orgName, name }: { children: ReactNode; orgSlug: string | null; orgName?: string | null; name?: string | null }) {
  return <div className="min-h-screen bg-zk-bg font-sans text-zk-text"><SkipLink /><Suspense fallback={<div className="h-12 border-b border-zk-border bg-zk-surface" />}><FeedbackPortalNav orgSlug={orgSlug} orgName={orgName} name={name} /></Suspense><main id={MAIN_CONTENT_ID} tabIndex={-1} className={`${PAGE_CONTAINER_CLASS} min-w-0 py-6 outline-none max-sm:px-2 max-sm:pt-2.5 sm:px-6 sm:py-8`}><div className="mx-auto w-full max-w-[920px] has-[aside]:max-w-none">{children}</div></main><FocusMainOnNavigate /></div>;
}
