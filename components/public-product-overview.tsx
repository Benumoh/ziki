import { SECTION_TITLE } from "@/lib/ui-style";
import { FeedbackPageHeader } from "@/components/feedback-page-header";
import { FeedbackPortalSidebar } from "@/components/feedback-portal-sidebar";
import { FeedbackIdeasToolbar } from "@/components/feedback-ideas-toolbar";
import { PublicFeedbackIdeas } from "@/components/public-feedback-ideas";
import { RichText } from "@/components/rich-text";
import type { FeedbackPortalProject } from "@/lib/public-projects";
import type { FeedbackIdea } from "@/lib/public-feedback-ideas";
import { publicFeedbackPath } from "@/lib/public-project-paths";
export function PublicProductOverview({ product, ideas = [], query = "", status = "" }: { product: FeedbackPortalProject; ideas?: FeedbackIdea[]; query?: string; status?: string }) {
  const ref = { orgSlug: product.organisation.slug, projectSlug: product.slug };
  const base = publicFeedbackPath(ref);
  return <div className="space-y-4 pb-6"><FeedbackPageHeader title={product.name} identity={product.name} description={`${product.organisation.name} · Product information and feedback`} /><div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]"><div className="min-w-0 space-y-4">
    <section className="rounded-panel border border-zk-border bg-zk-surface p-5"><h2 className={SECTION_TITLE}>About this product</h2>{product.goal?.trim() ? <RichText content={product.goal} className="mt-3 text-sm leading-6 text-zk-text2" /> : <div className="mt-3 space-y-3 text-sm leading-6 text-zk-text2"><p>Welcome to the feedback space for {product.name}, a project by {product.organisation.name}. This is where you can share your experience, highlight something that isn’t working, or suggest a change you would find useful.</p><p>When sharing feedback, tell the team what you were trying to do, what happened, and what would make the experience better. Screenshots and clear examples can help the team understand your suggestion.</p><p>You can also browse feedback from others and follow the status of your own report. Agents review submissions and give verdicts; approved feedback can become an issue for the project team to work on.</p></div>}</section>
    <PublicFeedbackIdeas orgSlug={ref.orgSlug} ideas={ideas} title={`Feedback for ${product.name}`} viewAllHref={`/${encodeURIComponent(ref.orgSlug)}/feedback?view=ideas&project=${encodeURIComponent(ref.projectSlug)}`} toolbar={<FeedbackIdeasToolbar key={query + status} baseHref={base} query={query} status={status} />} />
  </div><FeedbackPortalSidebar orgSlug={ref.orgSlug} projectName={product.name} shareHref={base + "?view=share"} /></div></div>;
}
